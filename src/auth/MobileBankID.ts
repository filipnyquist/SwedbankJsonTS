import { AbstractAuth } from "./AbstractAuth.ts";
import type { AppData } from "../AppData.ts";

interface InitAuthResponse {
  status: string;
  autoStartToken?: string;
}

interface VerifyResponse {
  status?: string;
}

/**
 * MobileBankID - authentication via Swedish Mobile BankID.
 *
 * Supports two modes:
 *  - QR code: Display an animated QR code that the user scans with the BankID app.
 *  - Same device: Generate a deeplink that opens the BankID app directly on the same device.
 *
 * Typical flow:
 * 1. `initAuth()` – start the authentication process.
 * 2a. QR mode: call `getChallengeImage()` every ~2 s and display the QR code.
 * 2b. Same device: open `getBankIdAppUrl(redirectUrl)` in the browser.
 * 3. `verify()` – poll until the user has confirmed in the BankID app.
 * 4. `login()` – finalise the login (no-op after a successful verify).
 */
export class MobileBankID extends AbstractAuth {
  private verified: boolean = false;
  private autoStartToken?: string;
  private useSameDevice: boolean = false;

  constructor(appData: AppData, debug: boolean = false) {
    super(appData, debug);
  }

  /**
   * Initialise the MobileBankID instance.
   * Must be called once before `initAuth()`.
   */
  async init(): Promise<void> {
    await this.setAuthorizationKey();
  }

  /**
   * Enable same-device mode.
   * When true, `initAuth()` will return an autoStartToken for a BankID deeplink.
   * When false (default), the QR code flow is used.
   */
  setSameDevice(value: boolean): void {
    this.useSameDevice = value;
  }

  /**
   * Start the Mobile BankID authentication process.
   *
   * @returns true immediately if already verified, otherwise true after sending the auth request.
   * @throws Error if Mobile BankID is not available for the user.
   */
  async initAuth(): Promise<boolean> {
    if (this.verified) return true;

    this.assertInitialized();

    const output = (await this.postRequest("identification/bankid/mobile", {
      bankIdOnSameDevice: this.useSameDevice,
    })) as InitAuthResponse;

    if (output.status !== "USER_SIGN") {
      throw new Error(
        "Unable to use Mobile BankID. Check if the user has enabled Mobile BankID.",
        { cause: 10 }
      );
    }

    if (output.autoStartToken) {
      this.autoStartToken = output.autoStartToken;
    }

    return true;
  }

  /**
   * Returns the autoStartToken received from `initAuth()`.
   * Only available when same-device mode is used.
   */
  getAutoStartToken(): string | undefined {
    return this.autoStartToken;
  }

  /**
   * Returns a deeplink URL that opens the BankID app on the same device.
   *
   * @param redirectUrl - URL the BankID app should redirect to after authentication.
   */
  getBankIdAppUrl(redirectUrl: string = ""): string {
    if (!this.autoStartToken) {
      throw new Error(
        "autoStartToken is not set. Call initAuth() first with same-device mode enabled."
      );
    }
    return `https://app.bankid.com/?autostarttoken=${this.autoStartToken}&redirect=${encodeURIComponent(redirectUrl)}`;
  }

  /**
   * Poll for user confirmation in the BankID app.
   *
   * @returns true when the user has confirmed, false if still pending.
   * @throws Error if the session has timed out.
   */
  async verify(): Promise<boolean> {
    if (this.verified) return true;

    this.assertInitialized();

    const output = (await this.getRequest(
      "identification/bankid/mobile/verify"
    )) as VerifyResponse;

    if (!output.status) {
      throw new Error(
        "Mobile BankID cannot be verified. The session may have timed out.",
        { cause: 11 }
      );
    }

    this.verified = output.status === "COMPLETE";
    return this.verified;
  }

  /**
   * Fetch the animated QR code image (used in the QR code flow).
   * Should be called every ~2 seconds while waiting for the user to scan.
   *
   * @returns Raw binary string of the QR code image.
   */
  async getChallengeImage(): Promise<string> {
    this.assertInitialized();
    return (await this.getRequest("identification/bankid/mobile/image")) as string;
  }

  /**
   * Finalise the login after a successful `verify()`.
   *
   * @returns true on success.
   * @throws Error if `verify()` has not returned true yet.
   */
  async login(): Promise<boolean> {
    if (!this.verified) {
      throw new Error(
        "The authentication process has not completed. Call verify() until it returns true.",
        { cause: 12 }
      );
    }
    return true;
  }
}
