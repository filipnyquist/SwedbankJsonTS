/**
 * Quick Balance Demo
 *
 * Demonstrates fetching an account balance without BankID or security token
 * authentication. You need a Quick Balance Subscription ID first.
 *
 * How to get a Subscription ID:
 *   1. Authenticate with BankID (see bankid-demo.ts).
 *   2. Call `bank.quickBalanceAccounts()` to list accounts.
 *   3. Call `bank.quickBalanceSubscription(account.quickbalanceSubscription.id)`.
 *   4. Save the returned `subscriptionId` permanently.
 *
 * Usage:
 *   SUBSCRIPTION_ID=<your-id> bun run examples/quick-balance-demo.ts
 *
 * Environment variables:
 *   BANK_APP         - Bank type: swedbank | sparbanken | ...  (default: swedbank)
 *   SUBSCRIPTION_ID  - Your Quick Balance subscription ID (required)
 *   APPDATA_CACHE    - Path to AppData cache file (default: ./AppData.json)
 */

import { AppData, UnAuth, SwedbankJson } from "../src/index.ts";
import type { BankAppId } from "../src/index.ts";

const BANK_APP = (process.env["BANK_APP"] ?? "swedbank") as BankAppId;
const CACHE_PATH = process.env["APPDATA_CACHE"] ?? "./AppData.json";
const SUBSCRIPTION_ID = process.env["SUBSCRIPTION_ID"] ?? "";

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  SwedbankJsonTS – Quick Balance Demo     ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();

  if (!SUBSCRIPTION_ID) {
    console.error(
      "Error: SUBSCRIPTION_ID environment variable is required.\n" +
        "Set it with: SUBSCRIPTION_ID=<your-id> bun run examples/quick-balance-demo.ts\n\n" +
        "To obtain a Subscription ID, first authenticate with BankID and use\n" +
        "bank.quickBalanceAccounts() and bank.quickBalanceSubscription()."
    );
    process.exit(1);
  }

  console.log(`Bank:            ${BANK_APP}`);
  console.log(`Subscription ID: ${SUBSCRIPTION_ID}`);
  console.log();

  // ── Set up unauthenticated session ───────────────────────────────────────
  console.log("1. Setting up unauthenticated session…");
  const appData = new AppData(BANK_APP, CACHE_PATH);
  const auth = new UnAuth(appData);
  await auth.init();
  await auth.login();

  const bank = new SwedbankJson(auth);

  // ── Fetch balance ────────────────────────────────────────────────────────
  console.log("2. Fetching Quick Balance…");
  const balance = await bank.quickBalance(SUBSCRIPTION_ID);

  console.log("\n── Balance ────────────────────────────────────────");
  console.log(JSON.stringify(balance, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
