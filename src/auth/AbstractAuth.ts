import { ApiException } from "../exceptions/ApiException.ts";
import { UserException } from "../exceptions/UserException.ts";
import type { AppData } from "../AppData.ts";

const BASE_URI =
  "https://auth.api.swedbank.se/TDE_DAP_Portal_REST_WEB/api/v5/";

const TERMINATE_ENDPOINT = "identification/logout";

/**
 * Simple in-memory cookie jar compatible with the fetch API.
 * Parses Set-Cookie response headers and re-sends them as Cookie request headers.
 */
class CookieJar {
  private cookies: Map<string, string> = new Map();

  /** Returns true if the Headers object supports getSetCookie() (WHATWG spec, Bun/modern browsers) */
  private static hasGetSetCookie(
    headers: Headers
  ): headers is Headers & { getSetCookie(): string[] } {
    return typeof (headers as unknown as Record<string, unknown>)["getSetCookie"] === "function";
  }

  /** Parse and store cookies from a response's Set-Cookie headers */
  ingest(response: Response): void {
    const setCookieHeaders: string[] = [];

    if (CookieJar.hasGetSetCookie(response.headers)) {
      // WHATWG-compliant environments (Bun, modern Node, modern browsers)
      setCookieHeaders.push(...response.headers.getSetCookie());
    } else {
      // Fallback: iterate all headers looking for set-cookie entries
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() === "set-cookie") {
          setCookieHeaders.push(value);
        }
      });
    }

    for (const cookieHeader of setCookieHeaders) {
      const [nameValue] = cookieHeader.split(";");
      if (!nameValue) continue;
      const eqIdx = nameValue.indexOf("=");
      if (eqIdx === -1) continue;
      const key = nameValue.slice(0, eqIdx).trim();
      const val = nameValue.slice(eqIdx + 1).trim();
      this.cookies.set(key, val);
    }
  }

  /** Build the Cookie header string for outgoing requests */
  cookieHeader(): string {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /** Clear all stored cookies */
  clear(): void {
    this.cookies.clear();
  }
}

/**
 * AbstractAuth - base class for all Swedbank authentication methods.
 *
 * Handles HTTP communication with the Swedbank API including:
 * - Authorization header generation
 * - Cookie management
 * - GET / POST / PUT / DELETE request helpers
 */
export abstract class AbstractAuth {
  protected appData: AppData;
  protected authorization: string = "";
  protected debug: boolean;
  protected cookieJar: CookieJar = new CookieJar();

  private baseUri: string = BASE_URI;

  constructor(appData: AppData, debug: boolean = false) {
    this.appData = appData;
    this.debug = debug;
  }

  /** Must be implemented by each authentication subclass */
  abstract login(): Promise<boolean>;

  /**
   * Initialise the authorization key.
   * Call this after construction (async because AppData.getAppID() is async).
   */
  protected async setAuthorizationKey(key?: string): Promise<void> {
    this.authorization = key ?? (await this.genAuthorizationKey());
  }

  /** Generates the Base64-encoded authorization key: base64(appID:deviceID) */
  async genAuthorizationKey(): Promise<string> {
    const appID = await this.appData.getAppID();
    const deviceID = this.generateDeviceID();
    return btoa(`${appID}:${deviceID}`);
  }

  /** Returns 'corporateProfiles' or 'privateProfile' based on the selected bank type */
  async getProfileType(): Promise<string> {
    const userAgent = await this.appData.getUserAgent();
    return userAgent.includes("Corporate") ? "corporateProfiles" : "privateProfile";
  }

  /** Sign out and clean up session state */
  async terminate(): Promise<unknown> {
    const result = await this.putRequest(TERMINATE_ENDPOINT);
    this.cleanup();
    return result;
  }

  /** Send a GET request to the API */
  async getRequest(
    apiRequest: string,
    query: Record<string, string | number> = {}
  ): Promise<unknown> {
    return this.sendRequest("GET", apiRequest, query);
  }

  /** Send a POST request to the API */
  async postRequest(apiRequest: string, data?: unknown): Promise<unknown> {
    return this.sendRequest("POST", apiRequest, {}, data);
  }

  /** Send a PUT request to the API */
  async putRequest(apiRequest: string): Promise<unknown> {
    return this.sendRequest("PUT", apiRequest);
  }

  /** Send a DELETE request to the API */
  async deleteRequest(apiRequest: string): Promise<unknown> {
    return this.sendRequest("DELETE", apiRequest);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private cleanup(): void {
    this.cookieJar.clear();
  }

  private async buildHeaders(
    extraHeaders: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    const userAgent = await this.appData.getUserAgent();
    const cookieHeader = this.cookieJar.cookieHeader();

    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: "*/*",
      "Accept-Language": "sv-se",
      "Accept-Encoding": "gzip, deflate",
      Connection: "keep-alive",
      "User-Agent": userAgent,
      "X-Client": userAgent,
      ...extraHeaders,
    };

    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    return headers;
  }

  private async sendRequest(
    method: string,
    apiRequest: string,
    query: Record<string, string | number> = {},
    body?: unknown
  ): Promise<unknown> {
    let url = `${this.baseUri}${apiRequest}`;

    const queryEntries = Object.entries(query);
    if (queryEntries.length > 0) {
      const params = new URLSearchParams(
        queryEntries.map(([k, v]) => [k, String(v)] as [string, string])
      );
      url = `${url}?${params.toString()}`;
    }

    const extraHeaders: Record<string, string> = {};
    let bodyString: string | undefined;

    if (body !== undefined) {
      extraHeaders["Content-Type"] = "application/json; charset=UTF-8";
      bodyString = JSON.stringify(body);
    }

    const headers = await this.buildHeaders(extraHeaders);

    if (this.debug) {
      console.debug(`[SwedbankJson] ${method} ${url}`);
      if (bodyString) console.debug(`[SwedbankJson] Body: ${bodyString}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: bodyString,
        // Note: redirect follows are handled automatically by fetch
      });
    } catch (err) {
      throw new Error(`Network error while calling ${url}: ${String(err)}`);
    }

    // Store cookies from this response
    this.cookieJar.ingest(response);

    if (!response.ok) {
      const errorBody = await response.text();

      if (this.debug) {
        console.debug(`[SwedbankJson] Error response (${response.status}): ${errorBody}`);
      }

      // If we hit an error on any request other than the terminate call, sign out
      if (apiRequest !== TERMINATE_ENDPOINT) {
        try {
          await this.terminate();
        } catch {
          // Best-effort sign-out; ignore secondary errors
        }
      } else {
        this.cleanup();
      }

      throw new ApiException(errorBody, response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const text = await response.text();
      if (this.debug) {
        console.debug(`[SwedbankJson] Response: ${text}`);
      }
      return JSON.parse(text) as unknown;
    }

    // Return raw text for non-JSON responses (e.g. QR code images as base64)
    return response.text();
  }

  /** Override the base URI (useful for testing) */
  protected setBaseUri(baseUri: string): void {
    this.baseUri = baseUri;
  }

  /** Generate a random uppercase UUID for use as device ID */
  private generateDeviceID(): string {
    return crypto.randomUUID().toUpperCase();
  }

  /**
   * Verify the auth is initialised.
   * Returns true if the authorization header has been set.
   */
  isInitialized(): boolean {
    return this.authorization !== "";
  }

  /**
   * Throw a UserException if the auth is not initialised.
   */
  protected assertInitialized(): void {
    if (!this.isInitialized()) {
      throw new UserException(
        "Authorization key has not been set. Call the auth method first.",
        3
      );
    }
  }
}
