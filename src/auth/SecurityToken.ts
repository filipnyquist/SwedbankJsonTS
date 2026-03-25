import { AbstractAuth } from "./AbstractAuth.ts";
import { UserException } from "../exceptions/UserException.ts";
import type { AppData } from "../AppData.ts";

interface ChallengeResponse {
  challenge?: string;
  useOneTimePassword?: boolean;
  links?: {
    next?: {
      uri?: string;
    };
  };
}

interface LoginResponse {
  links?: {
    next?: {
      uri?: string;
    };
  };
}

/**
 * SecurityToken - authentication via Swedbank hardware security token.
 *
 * Supports two token types:
 * - **One-Time Password (OTP):** Press "1" on the token to get an 8-digit code.
 * - **Challenge/Response:** Receive a control number from the API, enter it into
 *   the token, and respond with the generated 8-digit response code.
 *
 * Typical OTP flow:
 * 1. Construct and call `init()`.
 * 2. Call `getChallenge()` (also works for OTP; sets `useOneTimePassword = true`).
 * 3. Call `login(otpCode)` with the code from the token.
 *
 * Typical Challenge/Response flow:
 * 1. Construct and call `init()`.
 * 2. Call `getChallenge()` — note the returned control number.
 * 3. Enter the control number into the security token.
 * 4. Call `login(responseCode)` with the response code from the token.
 */
export class SecurityToken extends AbstractAuth {
  private readonly username: string;
  private challengeResponse: string | number;
  private challenge: string | null = null;
  private useOneTimePassword: boolean = false;

  /**
   * @param appData           - AppData instance for the desired bank.
   * @param username          - Personal identity number (personnummer) or corporate ID (organisationsnummer).
   * @param challengeResponse - OTP code or response code. Can be set later with `setChallengeResponse()`.
   * @param debug             - Enable debug logging.
   */
  constructor(
    appData: AppData,
    username: string,
    challengeResponse: string | number = 0,
    debug: boolean = false
  ) {
    super(appData, debug);
    this.username = username;
    this.challengeResponse = challengeResponse;
  }

  /**
   * Initialise the SecurityToken instance.
   * Must be called once before any API interaction.
   */
  async init(): Promise<void> {
    await this.setAuthorizationKey();
  }

  /**
   * Fetch the challenge (control number) for challenge/response tokens.
   * For OTP tokens the challenge will be null and `isUseOneTimePassword()` will return true.
   *
   * @returns The control number, or null for OTP tokens.
   */
  async getChallenge(): Promise<string | null> {
    if (this.challenge !== null) return this.challenge;

    this.assertInitialized();

    const output = (await this.postRequest(
      "identification/securitytoken/challenge",
      {
        useEasyLogin: false,
        generateEasyLoginId: false,
        userId: this.username,
      }
    )) as ChallengeResponse;

    if (!output.links?.next?.uri) {
      throw new Error(
        "Cannot fetch challenge. Check that the username (personnummer) is correct.",
        { cause: 10 }
      );
    }

    this.challenge = output.challenge ?? null;
    this.useOneTimePassword = output.useOneTimePassword ?? false;

    return this.challenge;
  }

  /**
   * Sign in with the OTP code or challenge/response code.
   *
   * @param challengeResponse - OTP or response code. If omitted, uses the value provided in the constructor.
   * @returns true on successful sign-in.
   */
  async login(challengeResponse?: string | number): Promise<boolean> {
    if (challengeResponse !== undefined) {
      this.setChallengeResponse(challengeResponse);
    }

    if (this.challenge === null) {
      await this.getChallenge();
    }

    if (!this.challengeResponse) {
      throw new UserException(
        "One-time code or response code from the security token is missing.",
        11
      );
    }

    this.assertInitialized();

    const output = (await this.postRequest("identification/securitytoken", {
      response: String(this.challengeResponse),
    })) as LoginResponse;

    if (!output.links?.next?.uri) {
      const codeType = this.useOneTimePassword ? "one-time code" : "response code";
      const errorCode = this.useOneTimePassword ? 12 : 13;
      throw new Error(
        `Cannot sign in. Probably due to an invalid or expired ${codeType}.`,
        { cause: errorCode }
      );
    }

    return true;
  }

  /**
   * Set or update the OTP or response code.
   */
  setChallengeResponse(value: string | number): void {
    this.challengeResponse = value;
  }

  /**
   * Returns true if the security token uses a one-time password (OTP),
   * false if it uses challenge/response.
   */
  isUseOneTimePassword(): boolean {
    return this.useOneTimePassword;
  }
}
