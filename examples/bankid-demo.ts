/**
 * Mobile BankID Authentication Demo
 *
 * This example demonstrates how to authenticate using Mobile BankID and fetch
 * your account information from Swedbank's API.
 *
 * In QR mode the QR code is rendered directly in the terminal and rotates
 * (updates in-place) every 2 seconds, as required by the BankID specification.
 *
 * Terminal rendering:
 *  - iTerm2, WezTerm, VS Code integrated terminal, Kitty, Hyper, and other
 *    terminals that support the iTerm2 inline-image escape sequence will show
 *    the actual QR code image.
 *  - All other terminals fall back to a clear-screen display that shows the
 *    base64 data URL so you can paste it into a browser.
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

// ── Constants ────────────────────────────────────────────────────────────────

const BANK_APP = (process.env["BANK_APP"] ?? "swedbank") as BankAppId;
const BANKID_MODE = process.env["BANKID_MODE"] ?? "qr";
const CACHE_PATH = process.env["APPDATA_CACHE"] ?? "./AppData.json";
const SAME_DEVICE = BANKID_MODE === "device";

/** Milliseconds between each QR refresh + verify poll cycle */
const POLL_INTERVAL_MS = 2000;
/** Maximum number of polling attempts before giving up (~2 minutes) */
const MAX_ATTEMPTS = 60;

// ── QR rendering helpers ─────────────────────────────────────────────────────

/**
 * Returns true when the current terminal supports the iTerm2 inline-image
 * escape sequence, which lets us display the actual PNG QR code image.
 *
 * Supported terminals include: iTerm2, WezTerm, VS Code integrated terminal,
 * Kitty (via the iTerm2 compatibility shim), and Hyper.
 */
function supportsInlineImages(): boolean {
  return (
    process.env["TERM_PROGRAM"] === "iTerm.app" ||
    process.env["TERM_PROGRAM"] === "WezTerm" ||
    process.env["TERM_PROGRAM"] === "vscode" ||
    process.env["TERM"] === "xterm-kitty" ||
    !!process.env["ITERM_SESSION_ID"] ||
    !!process.env["WEZTERM_EXECUTABLE"]
  );
}

/**
 * Clear the terminal screen and reset the cursor to the top-left corner.
 * Used before each QR redraw so that the new code replaces the previous one.
 */
function clearScreen(): void {
  // ESC[2J  – erase entire display
  // ESC[H   – move cursor to row 1, col 1
  process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Render (or re-render) a QR code image in the terminal.
 *
 * On the first call the full header + QR section is printed.
 * On subsequent calls `clearScreen()` must have been called first so that
 * the new QR replaces the previous one without scrolling.
 *
 * @param pngBinary  Raw binary string returned by `getChallengeImage()`.
 * @param elapsedSec Seconds elapsed since authentication started (shown to the user).
 */
function renderQrCode(pngBinary: string, elapsedSec: number): void {
  const b64 = Buffer.from(pngBinary, "binary").toString("base64");
  const inline = supportsInlineImages();

  // ── Banner ────────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  SwedbankJsonTS – Mobile BankID          ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();

  if (inline) {
    // ── Inline image (iTerm2 / WezTerm / VS Code / Kitty) ─────────────────
    // The iTerm2 inline-image protocol:
    //   ESC ] 1337 ; File = [params] : <base64> BEL
    // width=40 terminal columns, height=20 rows; terminal scales the PNG.
    process.stdout.write(
      `\x1b]1337;File=inline=1;width=40;height=20;preserveAspectRatio=1:${b64}\x07\n`
    );
    console.log();
    console.log("  Scan the QR code above with the BankID app.");
    console.log(`  The code rotates every ${POLL_INTERVAL_MS / 1000} s.  ` +
                `(${elapsedSec}s elapsed)`);
  } else {
    // ── Fallback: base64 data URL ──────────────────────────────────────────
    // The user can copy the URL into a browser to view the QR code image.
    const dataUrl = `data:image/png;base64,${b64}`;
    const border =
      "  ┌──────────────────────────────────────────────────────────────────────────┐";
    const borderBot =
      "  └──────────────────────────────────────────────────────────────────────────┘";
    const inner = (text: string) =>
      `  │ ${text.padEnd(74)} │`;

    console.log(border);
    console.log(inner("Scan with BankID app – copy the URL below into a browser to view the QR:"));
    console.log(inner(""));
    // Wrap the data URL across multiple lines so it stays inside the box
    const lineWidth = 74;
    for (let i = 0; i < dataUrl.length; i += lineWidth) {
      console.log(inner(dataUrl.slice(i, i + lineWidth)));
    }
    console.log(inner(""));
    console.log(inner(`↻ QR rotates every ${POLL_INTERVAL_MS / 1000} s  (${elapsedSec}s elapsed)`));
    console.log(borderBot);
  }

  console.log();
}

// ── Utilities ────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  clearScreen();
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
    // ── Same-device flow: display a deeplink ───────────────────────────────
    const redirectUrl = "https://example.com/bankid-callback"; // Change to your callback URL
    const bankIdUrl = auth.getBankIdAppUrl(redirectUrl);
    console.log();
    console.log("Open the following URL to launch the BankID app on this device:");
    console.log();
    console.log(`  ${bankIdUrl}`);
    console.log();
    console.log("4. Waiting for you to approve in the BankID app…");
  } else {
    // ── QR code flow: display the rotating QR code ─────────────────────────
    const startTime = Date.now();

    // Fetch the initial QR code and display it immediately
    console.log("4. Displaying rotating QR code – scan it with the BankID app…");
    console.log();

    let firstQr: string;
    try {
      firstQr = await auth.getChallengeImage();
    } catch (err) {
      console.error("Failed to fetch initial QR code:", err);
      process.exit(1);
    }

    clearScreen();
    renderQrCode(firstQr, 0);

    // ── Polling + QR rotation loop ──────────────────────────────────────────
    let verified = false;
    let attempts = 0;

    while (!verified && attempts < MAX_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS);
      attempts++;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);

      // Refresh the QR code on every iteration (required by BankID spec)
      try {
        const freshQr = await auth.getChallengeImage();
        clearScreen();
        renderQrCode(freshQr, elapsedSec);
      } catch {
        // A failed image fetch is non-fatal; continue polling
      }

      // Check whether the user has approved in the BankID app
      try {
        verified = await auth.verify();
      } catch (err) {
        console.error("Verification error:", err);
        break;
      }
    }

    if (!verified) {
      clearScreen();
      console.error("Authentication timed out. Please try again.");
      process.exit(1);
    }

    clearScreen();
    console.log("╔══════════════════════════════════════════╗");
    console.log("║  SwedbankJsonTS – Mobile BankID Demo     ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log();
    console.log("✓ BankID authentication verified!");
    console.log();

    // ── Step 5: Finalise login ─────────────────────────────────────────────
    console.log("5. Finalising login…");
    await auth.login();

    // ── Step 6: Use the API ───────────────────────────────────────────────
    console.log("6. Fetching account information…");
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

      console.log("\n── Reminders / Notifications ─────────────────────");
      const reminders = await bank.reminders();
      console.log(JSON.stringify(reminders, null, 2));
    } finally {
      console.log("\n7. Signing out…");
      await bank.terminate();
      console.log("✓ Signed out successfully.");
    }

    return; // QR flow handled everything above
  }

  // ── Same-device: simple polling loop (no QR) ───────────────────────────
  let verified = false;
  let attempts = 0;

  while (!verified && attempts < MAX_ATTEMPTS) {
    await sleep(POLL_INTERVAL_MS);
    attempts++;

    try {
      verified = await auth.verify();
    } catch (err) {
      console.error("Verification error:", err);
      break;
    }

    if (!verified) {
      process.stdout.write(`\rWaiting for BankID approval… (${attempts * (POLL_INTERVAL_MS / 1000)}s)`);
    }
  }

  if (!verified) {
    console.error("\nAuthentication timed out. Please try again.");
    process.exit(1);
  }

  console.log("\n✓ BankID authentication verified!");

  // ── Step 5: Finalise login ───────────────────────────────────────────────
  console.log("5. Finalising login…");
  await auth.login();

  // ── Step 6: Use the API ──────────────────────────────────────────────────
  console.log("6. Fetching account information…");
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

    console.log("\n── Reminders / Notifications ─────────────────────");
    const reminders = await bank.reminders();
    console.log(JSON.stringify(reminders, null, 2));
  } finally {
    console.log("\n7. Signing out…");
    await bank.terminate();
    console.log("✓ Signed out successfully.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
