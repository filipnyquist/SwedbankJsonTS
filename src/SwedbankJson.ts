import { AbstractAuth } from "./auth/AbstractAuth.ts";
import { UserException } from "./exceptions/UserException.ts";

// ── Response type interfaces ───────────────────────────────────────────────

interface ProfileEntry {
  id: string;
  name?: string;
}

interface BankProfile {
  bankId?: string;
  privateProfile?: ProfileEntry;
  corporateProfiles?: ProfileEntry[];
  [key: string]: unknown;
}

interface ProfileListResponse {
  hasSwedbankProfile?: boolean;
  hasSavingsbankProfile?: boolean;
  banks?: BankProfile[];
}

interface AccountListResponse {
  transactionAccounts?: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface AccountDetailsResponse {
  transactions?: unknown[];
  [key: string]: unknown;
}

interface TransactionDetailsResponse {
  transactionDate?: string;
  [key: string]: unknown;
}

interface PortfolioResponse {
  savingsAccounts?: unknown[];
  [key: string]: unknown;
}

interface QuickBalanceAccountsResponse {
  accounts?: unknown[];
  [key: string]: unknown;
}

interface QuickBalanceSubscriptionResponse {
  subscriptionId?: string;
  [key: string]: unknown;
}

interface QuickBalanceResponse {
  balance?: unknown;
  [key: string]: unknown;
}

interface RegisteredTransfersResponse {
  links?: {
    next?: {
      uri?: string;
    };
  };
  transferGroups?: unknown[];
  [key: string]: unknown;
}

interface TransferBaseInfoResponse {
  [key: string]: unknown;
}

/**
 * SwedbankJson - main API client for Swedbank and Sparbanken.
 *
 * Wraps the Swedbank mobile app REST API (v5).
 * All methods are async and return the decoded JSON response.
 *
 * Usage:
 * ```ts
 * const auth = new MobileBankID(appData);
 * await auth.init();
 * await auth.initAuth();
 * // … wait for verify …
 * await auth.login();
 *
 * const bank = new SwedbankJson(auth);
 * const accounts = await bank.accountList();
 * await bank.terminate();
 * ```
 */
export class SwedbankJson {
  private readonly auth: AbstractAuth;
  private profileID: string = "";

  constructor(auth: AbstractAuth) {
    this.auth = auth;
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  /**
   * List available user profiles.
   * Each user has one private profile and may have multiple corporate profiles.
   *
   * @returns The first bank entry from the profile response.
   */
  async profileList(): Promise<BankProfile> {
    const output = (await this.auth.getRequest("profile/")) as ProfileListResponse;

    if (output.hasSwedbankProfile === undefined) {
      throw new Error("Unknown error with the profile page.", { cause: 20 });
    }

    const banks = output.banks;
    if (!banks || banks.length === 0 || !banks[0]!.bankId) {
      if (!output.hasSwedbankProfile && output.hasSavingsbankProfile) {
        throw new UserException(
          "The user is not a Swedbank customer. " +
            "Please choose one of the Sparbanken bank types (sparbanken or sparbanken_foretag).",
          21
        );
      } else if (output.hasSwedbankProfile && !output.hasSavingsbankProfile) {
        throw new UserException(
          "The user is not a Sparbanken customer. " +
            "Please choose one of the Swedbank bank types (swedbank or swedbank_foretag).",
          22
        );
      } else {
        throw new Error("The profile does not contain any bank accounts.", {
          cause: 23,
        });
      }
    }

    return banks[0]!;
  }

  // ── Reminders / Notifications ─────────────────────────────────────────────

  /**
   * Retrieve notification counts (rejected payments, pending e-invoices, etc.).
   */
  async reminders(): Promise<unknown> {
    await this.selectProfile();
    return this.auth.getRequest("message/reminders");
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  /**
   * List all bank accounts for the current profile.
   *
   * Account categories returned:
   * - `transactionAccounts` – regular accounts
   * - `transactionDisposalAccounts` – disposal accounts
   * - `loanAccounts` – loans (including mortgages)
   * - `savingAccounts` – savings accounts
   * - `cardAccounts` – credit cards
   * - `cardCredit` – credit information
   *
   * @param profileID - (optional) Use a specific profile ID instead of the default.
   */
  async accountList(profileID?: string): Promise<AccountListResponse> {
    await this.selectProfile(profileID);

    const output = (await this.auth.getRequest(
      "engagement/overview"
    )) as AccountListResponse;

    if (!output.transactionAccounts) {
      throw new Error("Cannot fetch account list.", { cause: 30 });
    }

    return output;
  }

  /**
   * List investment/savings accounts for the current profile.
   *
   * @param profileID - (optional) Use a specific profile ID instead of the default.
   */
  async portfolioList(profileID?: string): Promise<PortfolioResponse> {
    await this.selectProfile(profileID);

    const output = (await this.auth.getRequest(
      "portfolio/holdings"
    )) as PortfolioResponse;

    if (!output.savingsAccounts) {
      throw new Error("Cannot fetch investment savings list.", { cause: 40 });
    }

    return output;
  }

  /**
   * Get account details and bank statements (transactions).
   *
   * @param accountID            - Account ID. Defaults to the first transaction account.
   * @param transactionsPerPage  - Number of transactions per page. 0 = API default (50).
   * @param page                 - Page number (1-indexed).
   */
  async accountDetails(
    accountID?: string,
    transactionsPerPage: number = 0,
    page: number = 1
  ): Promise<AccountDetailsResponse> {
    if (!accountID) {
      const accounts = await this.accountList();
      accountID = accounts.transactionAccounts![0]!.id;
    }

    const query: Record<string, number> = {};
    if (transactionsPerPage > 0 && page >= 1) {
      query["transactionsPerPage"] = transactionsPerPage;
      query["page"] = page;
    }

    const output = (await this.auth.getRequest(
      `engagement/transactions/${accountID}`,
      query
    )) as AccountDetailsResponse;

    if (!output.transactions) {
      throw new Error("Not a valid AccountID.", { cause: 50 });
    }

    return output;
  }

  /**
   * Get detailed information for a single transaction.
   *
   * @param detailsTransactionID - The `details.id` value from a transaction row.
   */
  async transactionDetails(
    detailsTransactionID: string
  ): Promise<TransactionDetailsResponse> {
    const output = (await this.auth.getRequest(
      `engagement/transactions/details/${detailsTransactionID}`
    )) as TransactionDetailsResponse;

    if (!output.transactionDate) {
      throw new Error("Not a valid DetailsTransactionID.", { cause: 60 });
    }

    return output;
  }

  // ── Transfers ─────────────────────────────────────────────────────────────

  /**
   * Retrieve transfer base info.
   *
   * Lists accounts that can send or receive payments.
   * Use the account IDs from this response for `transferRegisterPayment()`.
   */
  async transferBaseInfo(): Promise<TransferBaseInfoResponse> {
    await this.selectProfile();
    return this.auth.getRequest("payment/baseinfo") as Promise<TransferBaseInfoResponse>;
  }

  /**
   * Register a new payment/transfer (does NOT execute immediately).
   * Call `transferConfirmPayments()` to execute all registered transfers.
   *
   * @param amount                  - Amount to transfer.
   * @param fromAccountId           - Sender account ID (from `transferBaseInfo()`).
   * @param recipientAccountId      - Recipient account ID (from `transferBaseInfo()`).
   * @param fromAccountNote         - Message shown on the sender's statement.
   * @param recipientAccountMessage - Message shown on the recipient's statement.
   * @param transferDate            - Date for the transfer (YYYY-MM-DD). Empty = immediate.
   * @param periodicity             - Recurrence (e.g. 'MONTHLY'). Empty = one-time.
   */
  async transferRegisterPayment(
    amount: number,
    fromAccountId: string,
    recipientAccountId: string,
    fromAccountNote: string = "",
    recipientAccountMessage: string = "",
    transferDate: string = "",
    periodicity: string = ""
  ): Promise<RegisteredTransfersResponse> {
    const data: Record<string, string> = {
      // The Swedbank API expects amounts with a comma decimal separator (Swedish locale)
      amount: amount.toFixed(2).replace(".", ","),
      noteToSender: fromAccountNote,
      noteToRecipient: recipientAccountMessage,
      recipientId: recipientAccountId,
      fromAccountId,
      date: transferDate,
    };

    if (periodicity) {
      data["periodicity"] = periodicity;
    }

    await this.auth.postRequest("payment/registered/transfer", data);

    return this.transferListRegistered();
  }

  /**
   * List unconfirmed (registered but not yet executed) transfers.
   */
  async transferListRegistered(): Promise<RegisteredTransfersResponse> {
    return this.auth.getRequest("payment/registered") as Promise<RegisteredTransfersResponse>;
  }

  /**
   * List confirmed and scheduled transfers.
   * Historical and direct transfers that have already executed are not listed.
   */
  async transferListConfirmed(): Promise<unknown> {
    return this.auth.getRequest("payment/confirmed");
  }

  /**
   * Delete a registered or confirmed transfer.
   *
   * @param transferId - Transfer ID from `transferListRegistered()` or `transferListConfirmed()`.
   */
  async transferDeletePayment(transferId: string): Promise<void> {
    await this.auth.getRequest(`payment/${transferId}`);
    await this.auth.deleteRequest(`payment/${transferId}`);
  }

  /**
   * Confirm and execute all registered transfers.
   * Direct transfers are sent immediately; scheduled transfers are queued.
   *
   * @returns The confirmation response.
   */
  async transferConfirmPayments(): Promise<unknown> {
    const transactions = await this.transferListRegistered();

    if (!transactions.links?.next?.uri) {
      throw new UserException("There are no registered transactions to confirm.", 55);
    }

    const match = transactions.links.next.uri.match(/payment\/confirmed\/([^/]+)/iu);
    if (!match || !match[1]) {
      throw new Error("Could not extract confirmTransferId from URI.", { cause: 56 });
    }

    const confirmTransferId = match[1];
    return this.auth.putRequest(`payment/confirmed/${confirmTransferId}`);
  }

  // ── Quick Balance ──────────────────────────────────────────────────────────

  /**
   * List accounts that support Quick Balance (no-auth balance fetch).
   *
   * @param profileID - (optional) Use a specific profile ID instead of the default.
   */
  async quickBalanceAccounts(
    profileID?: string
  ): Promise<QuickBalanceAccountsResponse> {
    await this.selectProfile(profileID);

    const output = (await this.auth.getRequest(
      "quickbalance/accounts"
    )) as QuickBalanceAccountsResponse;

    if (!output.accounts) {
      throw new Error("Quick Balance accounts cannot be listed.", { cause: 60 });
    }

    return output;
  }

  /**
   * Subscribe an account to Quick Balance.
   * Save the returned `subscriptionId` permanently – it is needed to fetch balance later.
   *
   * @param accountQuickBalanceSubID - The subscription ID from `quickBalanceAccounts()`.
   */
  async quickBalanceSubscription(
    accountQuickBalanceSubID: string
  ): Promise<QuickBalanceSubscriptionResponse> {
    const output = (await this.auth.postRequest(
      `quickbalance/subscription/${accountQuickBalanceSubID}`
    )) as QuickBalanceSubscriptionResponse;

    if (!output.subscriptionId) {
      throw new Error(
        'Cannot subscribe to account. Please verify that the ID is from quickBalanceAccounts().',
        { cause: 61 }
      );
    }

    return output;
  }

  /**
   * Fetch the current balance for a subscribed account.
   * Does not require BankID or security token authentication.
   *
   * @param subscriptionId - The subscription ID from `quickBalanceSubscription()`.
   */
  async quickBalance(subscriptionId: string): Promise<QuickBalanceResponse> {
    const output = (await this.auth.getRequest(
      `quickbalance/${subscriptionId}`
    )) as QuickBalanceResponse;

    if (!output.balance) {
      throw new Error(
        "Cannot fetch Quick Balance. Please verify the Subscription ID.",
        { cause: 62 }
      );
    }

    return output;
  }

  /**
   * Unsubscribe an account from Quick Balance.
   *
   * @param subscriptionId - The subscription ID to unsubscribe.
   * @param profileID      - (optional) Use a specific profile ID instead of the default.
   */
  async quickBalanceUnsubscription(
    subscriptionId: string,
    profileID?: string
  ): Promise<QuickBalanceSubscriptionResponse> {
    await this.selectProfile(profileID);

    const output = (await this.auth.deleteRequest(
      `quickbalance/subscription/${subscriptionId}`
    )) as QuickBalanceSubscriptionResponse;

    if (!output.subscriptionId) {
      throw new Error(
        "Cannot unsubscribe. Please verify the Subscription ID.",
        { cause: 63 }
      );
    }

    return output;
  }

  // ── Session ────────────────────────────────────────────────────────────────

  /**
   * Sign out and terminate the session.
   */
  async terminate(): Promise<unknown> {
    return this.auth.terminate();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async selectProfile(profileID?: string): Promise<void> {
    if (!profileID) {
      if (this.profileID) return; // Already selected

      const profiles = await this.profileList();
      const profileType = await this.auth.getProfileType();

      const profileData = profiles[profileType] as
        | ProfileEntry
        | ProfileEntry[]
        | undefined;

      if (!profileData) {
        throw new Error(
          `No profile data found for type '${profileType}'.`,
          { cause: 24 }
        );
      }

      profileID = Array.isArray(profileData)
        ? profileData[0]!.id
        : profileData.id;
    }

    await this.auth.postRequest(`profile/${profileID}`);
    this.profileID = profileID;
  }
}
