/**
 * Mobile BankID Authentication Demo
 *
 * This example demonstrates how to authenticate using Mobile BankID and fetch
 * your account information from Swedbank's API.
 *
 * IMPORTANT: This is an unofficial API client. Use responsibly and in
 * accordance with Swedbank's terms of service.
 *
 * Usage:
 *   bun run examples/bankid-demo.ts
 *
 * Environment variables (optional):
 *   BANK_APP      - Bank type: swedbank | sparbanken | swedbank_foretag | sparbanken_foretag
 *                   Defaults to 'swedbank'
 *   BANKID_MODE   - 'qr' for QR code flow, 'device' for same-device flow
 *                   Defaults to 'qr'
 *   APPDATA_CACHE - Path to AppData cache file. Defaults to './AppData.json'
 */

import { AppData, MobileBankID, SwedbankJson } from "../src/index.ts";
import type { BankAppId } from "../src/index.ts";

const BANK_APP = (process.env["BANK_APP"] ?? "swedbank") as BankAppId;
const BANKID_MODE = process.env["BANKID_MODE"] ?? "qr";
const CACHE_PATH = process.env["APPDATA_CACHE"] ?? "./AppData.json";
const SAME_DEVICE = BANKID_MODE === "device";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  SwedbankJsonTS – Mobile BankID Demo     ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();
  console.log(`Bank:   ${BANK_APP}`);
  console.log(`Mode:   ${SAME_DEVICE ? "Same-device (deeplink)" : "QR code"}`);
  console.log();

  // ── Step 1: Set up AppData ──────────────────────────────────────────────
  console.log("1. Loading app metadata (AppData)…");
  const appData = new AppData(BANK_APP, CACHE_PATH);

  // ── Step 2: Create and initialise the BankID auth object ────────────────
  console.log("2. Initialising Mobile BankID auth…");
  const auth = new MobileBankID(appData, false /* debug */);
  await auth.init(); // Generates the authorization key
  auth.setSameDevice(SAME_DEVICE);

  // ── Step 3: Start the authentication flow ───────────────────────────────
  console.log("3. Starting authentication flow…");
  await auth.initAuth();

  if (SAME_DEVICE) {
    // Same-device flow: generate and display a deeplink
    const redirectUrl = "https://example.com/bankid-callback"; // Change to your callback URL
    const bankIdUrl = auth.getBankIdAppUrl(redirectUrl);
    console.log();
    console.log("Open the following URL in the BankID app on this device:");
    console.log(bankIdUrl);
    console.log();
  } else {
    // QR code flow: display the QR code and refresh it every 2 seconds
    console.log();
    console.log("Scan the QR code below with the BankID app.");
    console.log("(The QR code refreshes every 2 seconds – keep refreshing until you have scanned it.)");
    console.log();

    // Fetch and display the first QR code image (base64-encoded PNG)
    const qrImage = await auth.getChallengeImage();
    console.log("QR code (base64 PNG – display in a browser or terminal with image support):");
    console.log(`data:image/png;base64,${Buffer.from(qrImage, "binary").toString("base64")}`);
    console.log();
  }

  // ── Step 4: Poll for verification ───────────────────────────────────────
  console.log("4. Waiting for you to approve in the BankID app…");

  let verified = false;
  const maxAttempts = 60; // Up to 2 minutes
  let attempts = 0;

  while (!verified && attempts < maxAttempts) {
    await sleep(2000);
    attempts++;

    try {
      verified = await auth.verify();
    } catch (err) {
      console.error("Verification error:", err);
      break;
    }

    if (!verified) {
      process.stdout.write(`\rWaiting… (${attempts * 2}s)`);

      // In QR mode, refresh the QR code every ~4 seconds (every 2nd poll iteration)
      if (!SAME_DEVICE && attempts % 2 === 0) {
        try {
          const qr = await auth.getChallengeImage();
          // In a real app you would update the displayed QR code here.
          // We just log the update for this demo.
          const b64 = Buffer.from(qr, "binary").toString("base64");
          console.log(`\n[QR update] data:image/png;base64,${b64}`);
        } catch {
          // Ignore QR refresh errors during polling
        }
      }
    }
  }

  if (!verified) {
    console.error("\nAuthentication timed out. Please try again.");
    process.exit(1);
  }

  console.log("\n\n✓ BankID authentication verified!");

  // ── Step 5: Finalise login ───────────────────────────────────────────────
  console.log("5. Finalising login…");
  await auth.login();

  // ── Step 6: Use the API ──────────────────────────────────────────────────
  console.log("6. Fetching account information…");
  const bank = new SwedbankJson(auth);

  try {
    // List all accounts
    const accounts = await bank.accountList();
    console.log("\n── Accounts ──────────────────────────────────────");
    console.log(JSON.stringify(accounts, null, 2));

    // Get bank statements for the first transaction account
    const firstAccountId = accounts.transactionAccounts?.[0]?.id;
    if (firstAccountId) {
      console.log("\n── Bank Statements (first 10) ────────────────────");
      const details = await bank.accountDetails(firstAccountId, 10, 1);
      console.log(JSON.stringify(details, null, 2));
    }

    // Fetch reminders / notification counts
    console.log("\n── Reminders / Notifications ─────────────────────");
    const reminders = await bank.reminders();
    console.log(JSON.stringify(reminders, null, 2));
  } finally {
    // Always sign out, even if an error occurred
    console.log("\n7. Signing out…");
    await bank.terminate();
    console.log("✓ Signed out successfully.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
