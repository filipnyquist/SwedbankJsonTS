import { ApiException } from "./exceptions/ApiException.ts";

/** Available bank app types */
export type BankAppId =
  | "swedbank"
  | "sparbanken"
  | "swedbank_foretag"
  | "sparbanken_foretag";

interface BankAppEntry {
  appID: string;
  useragent: string;
}

interface AppDataJson {
  apps: Record<string, BankAppEntry>;
}

const REMOTE_APPDATA_URL =
  "https://raw.githubusercontent.com/walle89/sbj-resources/master/src/AppData.json";

/**
 * AppData - manages Swedbank API app metadata (appID and user-agent strings).
 *
 * Swedbank's mobile API requires specific app identifiers that change over time.
 * This class fetches and caches the required metadata automatically.
 */
export class AppData {
  private readonly appId: BankAppId;
  private readonly cacheFilePath: string;
  private readonly cacheTimeoutMinutes: number;
  private readonly remoteDownloadUrl: string;

  private cachedAppData: AppDataJson | null = null;

  /**
   * @param bankAppId       - One of: 'swedbank', 'sparbanken', 'swedbank_foretag', 'sparbanken_foretag'
   * @param cacheFilePath   - Absolute or relative path for the local cache file. Empty string to disable.
   * @param cacheTimeout    - Cache TTL in minutes. 0 = never expire. Default: 1440 (24 h).
   * @param remoteDownload  - URL to download fresh AppData from. Empty string to disable remote fetch.
   */
  constructor(
    bankAppId: BankAppId,
    cacheFilePath: string,
    cacheTimeoutMinutes: number = 1440,
    remoteDownload: string = REMOTE_APPDATA_URL
  ) {
    this.appId = bankAppId;
    this.cacheFilePath = cacheFilePath;
    this.cacheTimeoutMinutes = cacheTimeoutMinutes;
    this.remoteDownloadUrl = remoteDownload;
  }

  /** Returns the appID string for the configured bank app */
  async getAppID(): Promise<string> {
    const bankAppData = await this.getBankAppData();
    return bankAppData.appID;
  }

  /** Returns the User-Agent string for the configured bank app */
  async getUserAgent(): Promise<string> {
    const bankAppData = await this.getBankAppData();
    return bankAppData.useragent;
  }

  /**
   * Fetch fresh AppData from the remote URL and optionally write it to the cache file.
   * @param downloadUri - Override the remote URL. Leave empty to use the configured URL.
   */
  async remoteFetch(downloadUri?: string): Promise<string> {
    const url = downloadUri ?? this.remoteDownloadUrl;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Safari/605.1.15",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-us",
        Connection: "keep-alive",
        "Accept-Encoding": "gzip, deflate",
      },
    });

    if (![200, 301, 302, 304].includes(response.status)) {
      throw new ApiException(
        `Can't fetch remote AppData. Try again later. (Status code ${response.status})`,
        101
      );
    }

    const data = await response.text();

    if (this.cacheFilePath) {
      let parsed: AppDataJson;
      try {
        parsed = JSON.parse(data) as AppDataJson;
      } catch {
        throw new Error("Malformed AppData JSON downloaded.");
      }

      if (!parsed.apps) {
        throw new Error("Malformed AppData JSON downloaded.");
      }

      await Bun.write(this.cacheFilePath, data);
    }

    return data;
  }

  private async getBankAppData(): Promise<BankAppEntry> {
    const appData = await this.getAppData();

    if (!appData.apps[this.appId]) {
      const available = Object.keys(appData.apps).join(", ");
      throw new Error(
        `Bank type '${this.appId}' does not exist. Use one of: ${available}`,
        { cause: 2 }
      );
    }

    return appData.apps[this.appId]!;
  }

  private async getAppData(): Promise<AppDataJson> {
    if (this.cachedAppData !== null) {
      return this.cachedAppData;
    }

    this.cachedAppData = await this.fetch();
    return this.cachedAppData;
  }

  private async fetch(): Promise<AppDataJson> {
    // Try local cache first
    if (this.cacheFilePath) {
      const cacheFile = Bun.file(this.cacheFilePath);
      const exists = await cacheFile.exists();

      if (exists) {
        const mtime = (await import("node:fs")).statSync(
          this.cacheFilePath
        ).mtimeMs;
        const expireTime =
          mtime + this.cacheTimeoutMinutes * 60 * 1000;

        if (this.cacheTimeoutMinutes === 0 || expireTime > Date.now()) {
          const raw = await cacheFile.text();
          let parsed: AppDataJson;

          try {
            parsed = JSON.parse(raw) as AppDataJson;
          } catch {
            throw new Error("Malformed AppData JSON from cache.");
          }

          if (!parsed.apps) {
            throw new Error("Malformed AppData JSON from cache.");
          }

          return parsed;
        }
      }
    }

    // No valid cache — try remote
    if (!this.remoteDownloadUrl) {
      throw new Error(
        "Cache does not exist and remote download is disabled."
      );
    }

    const raw = await this.remoteFetch();
    const parsed = JSON.parse(raw) as AppDataJson;

    if (!parsed) {
      throw new ApiException(
        "Can't fetch remote AppData. Try again later.",
        100
      );
    }

    return parsed;
  }
}
