# CardanoMix ADA Voucher Store

Modern ADA voucher storefront with a separate admin dashboard, direct website user auth, Binance live pricing, and Gmail order notifications.

## What is included

- Arctic storefront for customers and Midnight admin dashboard.
- Website-native registration and login. No ChatGPT auth is used.
- Admin login via email and password only.
- Live ADA pricing from Binance on every price request and every order quote.
- Gmail SMTP notification for each order.
- HttpOnly session cookies, password hashing, rate limiting, and server-side order totals.
- File-backed local persistence in `data/` for users and orders.

## Local setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Copy `.env.example` to `.env` and set real values.
3. Create the first admin:
   ```bash
   pnpm seed:admin
   ```
4. Run the API server:
   ```bash
   pnpm server
   ```
5. In another terminal, run the Vite app:
   ```bash
   pnpm dev
   ```
6. Open `http://127.0.0.1:5173`.

## Gmail settings

Automatic order mail is sent with Gmail SMTP. Set:

- `GMAIL_USER`: the Gmail address that sends the notification.
- `GMAIL_APP_PASSWORD`: a Gmail app password. Do not use your normal password.
- `ORDER_NOTIFY_EMAIL`: the Gmail inbox that receives order alerts. Defaults to `GMAIL_USER`.
- `REQUIRE_EMAIL_DELIVERY=true`: rejects order confirmation if email cannot be delivered.

## Binance settings

The app requests `https://api.binance.com/api/v3/ticker/price?symbol=ADAEUR` by default. Change `ADA_QUOTE_CURRENCY` if you want another Binance quote currency.

## Checks

```bash
pnpm test
pnpm build
```
