> [!CAUTION]  
> This project is not affiliated with, endorsed by, or associated with Swedbank, Sparbanken, or any of their subsidiaries.
> All trademarks and brand names are the property of their respective owners.
> Use of the information and resources provided in this repository is for educational and interoperability purposes only and may be subject to legal or policy restrictions.

# SwedbankJsonTS

Unofficial **TypeScript** API client for Swedbank's and Sparbanken's mobile apps in Sweden, powered by **[Bun](https://bun.sh)**.

* Overview of your bank accounts, loans, debit and credit cards
* List account transactions with pagination
* Transfer money between accounts
* Sign in with different profiles (ideal for Swedbank Företag app users)
* Activate, deactivate, and view quick balance (snabbsaldo)
* No authentication required to view quick balance — ideal for automation

**Authentication methods**

* Mobile BankID (QR code or same-device deeplink)
* Security token (one-time password or challenge/response)
* Unauthenticated (quick balance only)

## Security

All API traffic is TLS-encrypted and strictly between your device/server and Swedbank's servers. The client does not send any information to third parties.

## Requirements

* [Bun](https://bun.sh) v1.0 or later

## Installation

```bash
# Clone the repository
git clone https://github.com/filipnyquist/SwedbankJsonTS.git
cd SwedbankJsonTS

# Install dependencies (only dev deps: TypeScript types)
bun install
```

## Quick Start

### Mobile BankID (QR code)

```typescript
import { AppData, MobileBankID, SwedbankJson } from "./src/index.ts";

const appData = new AppData("swedbank", "./AppData.json");
const auth = new MobileBankID(appData);
await auth.init();

// Start the auth flow
await auth.initAuth();

// Display QR code (refresh every 2 s in your UI)
const qrImage = await auth.getChallengeImage();
// qrImage is a binary string – convert to base64 for display:
// const b64 = Buffer.from(qrImage, "binary").toString("base64");
// <img src={`data:image/png;base64,${b64}`} />

// Poll until the user approves in the BankID app
while (!await auth.verify()) {
  await Bun.sleep(2000);
  const refreshedQr = await auth.getChallengeImage(); // refresh QR
}

await auth.login();

// Use the API
const bank = new SwedbankJson(auth);
const accounts = await bank.accountList();
console.log(accounts);

await bank.terminate(); // Sign out
```

### Mobile BankID (same-device deeplink)

```typescript
import { AppData, MobileBankID, SwedbankJson } from "./src/index.ts";

const appData = new AppData("swedbank", "./AppData.json");
const auth = new MobileBankID(appData);
await auth.init();
auth.setSameDevice(true);

await auth.initAuth();

// Open this URL to launch the BankID app on the same device
const bankIdUrl = auth.getBankIdAppUrl("https://yourapp.example.com/callback");
console.log("Open in browser:", bankIdUrl);

// Poll for completion
while (!await auth.verify()) {
  await Bun.sleep(2000);
}

await auth.login();
const bank = new SwedbankJson(auth);
```

### Security Token (OTP)

```typescript
import { AppData, SecurityToken, SwedbankJson } from "./src/index.ts";

const appData = new AppData("swedbank", "./AppData.json");
const auth = new SecurityToken(appData, "198903060000" /* personnummer */);
await auth.init();

await auth.getChallenge(); // Determines token type

const code = "12345678"; // Code from token device
await auth.login(code);

const bank = new SwedbankJson(auth);
const accounts = await bank.accountList();
console.log(accounts);
await bank.terminate();
```

### Quick Balance (no authentication)

```typescript
import { AppData, UnAuth, SwedbankJson } from "./src/index.ts";

const appData = new AppData("swedbank", "./AppData.json");
const auth = new UnAuth(appData);
await auth.init();
await auth.login();

const bank = new SwedbankJson(auth);
const balance = await bank.quickBalance("your-subscription-id");
console.log(balance);
```

## Demo Examples

Run the included demo scripts (they will prompt for input):

```bash
# Mobile BankID demo (QR code by default)
bun run example:bankid

# Mobile BankID – same-device mode
BANKID_MODE=device bun run example:bankid

# Security token demo
bun run example:security-token

# Quick Balance demo (requires a saved subscription ID)
SUBSCRIPTION_ID=<your-id> bun run example:quick-balance
```

## API Reference

### `AppData`

| Constructor parameter | Type       | Default                         | Description                         |
|-----------------------|------------|---------------------------------|-------------------------------------|
| `bankAppId`           | `BankAppId`| –                               | `'swedbank'`, `'sparbanken'`, `'swedbank_foretag'`, `'sparbanken_foretag'` |
| `cacheFilePath`       | `string`   | –                               | Path to local cache file. `''` to disable. |
| `cacheTimeoutMinutes` | `number`   | `1440`                          | Cache TTL in minutes. `0` = never expire. |
| `remoteDownload`      | `string`   | GitHub sbj-resources URL        | URL to fetch AppData from. `''` to disable. |

### `SwedbankJson`

| Method | Description |
|--------|-------------|
| `profileList()` | List available user profiles |
| `accountList(profileID?)` | List all accounts (transaction, loan, savings, card) |
| `accountDetails(accountID?, perPage?, page?)` | Account details and bank statements |
| `transactionDetails(detailsTransactionID)` | Detailed info for a single transaction |
| `portfolioList(profileID?)` | List investment savings accounts |
| `reminders()` | Notification counts (rejected payments, e-invoices, etc.) |
| `transferBaseInfo()` | Info needed to create a payment |
| `transferRegisterPayment(amount, from, to, ...)` | Register a transfer (not yet executed) |
| `transferListRegistered()` | List unconfirmed transfers |
| `transferListConfirmed()` | List confirmed/scheduled transfers |
| `transferDeletePayment(transferId)` | Cancel a transfer |
| `transferConfirmPayments()` | Execute all registered transfers |
| `quickBalanceAccounts(profileID?)` | List accounts available for Quick Balance |
| `quickBalanceSubscription(accountSubID)` | Subscribe an account to Quick Balance |
| `quickBalance(subscriptionId)` | Fetch balance without authentication |
| `quickBalanceUnsubscription(subscriptionId, profileID?)` | Unsubscribe from Quick Balance |
| `terminate()` | Sign out |

## Bank Types

| Value | Description |
|-------|-------------|
| `swedbank` | Swedbank personal |
| `sparbanken` | Sparbanken personal |
| `swedbank_foretag` | Swedbank corporate |
| `sparbanken_foretag` | Sparbanken corporate |

## Type Check

```bash
bun run typecheck
```

## FAQ

### Is this compatible with Swedbank's non-Swedish apps?

No. The API is specific to the Swedish market.

### Why not use the official Open Banking API?

Getting production access to the official Open Banking API requires a regulatory license (e.g. from Finansinspektionen), QSEAL/QWAC certificates, and bank approval — a lengthy and costly process. This library works immediately if you have access to the Swedish mobile apps.

## License

[MIT](LICENSE)