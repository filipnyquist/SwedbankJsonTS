import { AbstractAuth } from "./AbstractAuth.ts";
import type { AppData } from "../AppData.ts";

interface DeviceResponse {
  status?: string;
}

/**
 * UnAuth - unauthenticated access to the Swedbank API.
 *
 * Use this for endpoints that do not require BankID or security token
 * authentication, such as the Quick Balance feature.
 */
export class UnAuth extends AbstractAuth {
  constructor(appData: AppData, debug: boolean = false) {
    super(appData, debug);
  }

  /**
   * Initialise the UnAuth instance.
   * Must be called once before any API interaction.
   */
  async init(): Promise<void> {
    await this.setAuthorizationKey();
  }

  /**
   * Establish an unauthenticated session with the API.
   *
   * @returns true on success.
   * @throws Error if the connection fails.
   */
  async login(): Promise<boolean> {
    this.assertInitialized();

    const output = (await this.getRequest("identification/device/")) as DeviceResponse;

    if (output.status !== "OK") {
      throw new Error(
        "Connection error – check the authorization key or try again later.",
        { cause: 10 }
      );
    }

    return true;
  }
}
