/**
 * Security Token Authentication Demo
 *
 * Demonstrates authentication using a Swedbank hardware security token.
 * Two token types are supported:
 *  - One-Time Password (OTP): Press "1" on the token to generate a code.
 *  - Challenge/Response: The API provides a control number; enter it into the
 *    token to get a response code.
 *
 * Usage:
 *   bun run examples/security-token-demo.ts
 *
 * Environment variables:
 *   BANK_APP      - Bank type: swedbank | sparbanken | swedbank_foretag | sparbanken_foretag
 *                   Defaults to 'swedbank'
 *   USERNAME      - Your personnummer (Swedish personal identity number), e.g. 198903060000
 *   APPDATA_CACHE - Path to AppData cache file. Defaults to './AppData.json'
 */

import { AppData, SecurityToken, SwedbankJson } from "../src/index.ts";
import type { BankAppId } from "../src/index.ts";
import * as readline from "node:readline";

const BANK_APP = (process.env["BANK_APP"] ?? "swedbank") as BankAppId;
const CACHE_PATH = process.env["APPDATA_CACHE"] ?? "./AppData.json";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  SwedbankJsonTS – Security Token Demo    ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();
  console.log(`Bank: ${BANK_APP}`);
  console.log();

  // ── Step 1: Get username ────────────────────────────────────────────────
  let username = process.env["USERNAME"] ?? "";
  if (!username) {
    username = await prompt("Enter your personnummer (e.g. 198903060000): ");
  }

  if (!username) {
    console.error("Username is required.");
    process.exit(1);
  }

  // ── Step 2: Set up AppData and auth ─────────────────────────────────────
  console.log("\n1. Loading app metadata…");
  const appData = new AppData(BANK_APP, CACHE_PATH);

  console.log("2. Initialising security token auth…");
  const auth = new SecurityToken(appData, username);
  await auth.init();

  // ── Step 3: Fetch challenge ──────────────────────────────────────────────
  console.log("3. Fetching challenge from the API…");
  const challenge = await auth.getChallenge();

  let code: string;

  if (auth.isUseOneTimePassword()) {
    console.log("\nThis token uses a One-Time Password (OTP).");
    code = await prompt("Press '1' on your security token and enter the 8-digit code: ");
  } else {
    console.log(`\nControl number from the API: ${challenge}`);
    code = await prompt(
      `Enter the ${challenge} on your security token and enter the 8-digit response code: `
    );
  }

  if (!code || code.length !== 8 || !/^\d{8}$/.test(code)) {
    console.error("Invalid code – must be exactly 8 digits.");
    process.exit(1);
  }

  // ── Step 4: Sign in ──────────────────────────────────────────────────────
  console.log("\n4. Signing in…");
  await auth.login(code);
  console.log("✓ Signed in successfully!");

  // ── Step 5: Use the API ──────────────────────────────────────────────────
  console.log("5. Fetching account information…");
  const bank = new SwedbankJson(auth);

  try {
    const accounts = await bank.accountList();
    console.log("\n── Accounts ──────────────────────────────────────");
    console.log(JSON.stringify(accounts, null, 2));

    const firstAccountId = accounts.transactionAccounts?.[0]?.id;
    if (firstAccountId) {
      console.log("\n── Bank Statements (first 10) ────────────────────");
      const details = await bank.accountDetails(firstAccountId, 10, 1);
      console.log(JSON.stringify(details, null, 2));
    }
  } finally {
    console.log("\n6. Signing out…");
    await bank.terminate();
    console.log("✓ Signed out successfully.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
