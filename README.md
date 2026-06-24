# CardanoMix ADA Voucher Store

Modern ADA voucher storefront with a separate admin dashboard, direct website user auth, Binance live pricing, and persistent Netlify storage.

## What is included

- Arctic storefront for customers and Midnight admin dashboard.
- Website-native customer registration and login with Cardano wallet addresses. No ChatGPT auth is used.
- Admin login via email and password only.
- Live ADA/USD pricing from Binance on every price request and every order quote.
- Fixed voucher denominations plus custom ADA amount checkout.
- PayPal Checkout order links with editable return/cancel/fallback routing in admin.
- Admin order delete and Excel-compatible CSV export.
- Admin order review without Gmail side effects.
- HttpOnly session cookies, password hashing, rate limiting, and server-side order totals.
- Netlify Blobs persistence in production and file-backed local persistence in `data/`.

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

## Production storage

Netlify deployments use Netlify Blobs through `netlify/functions/api.js`. Set `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in Netlify environment variables before using `/admin`.

The temporary admin URL is:

```text
https://cardanomix2026.netlify.app/admin
```

The final production admin URL should be:

```text
https://cardanomix.com/admin
```

## Binance settings

The app displays dollar pricing and requests Binance market data from `https://data-api.binance.vision/api/v3/ticker/price?symbol=ADAUSDT` first, then falls back to other Binance public endpoints. Keep `ADA_QUOTE_CURRENCY=USD` for dollar pricing.

## PayPal settings

Set these in Netlify environment variables. Mark the secret as secret in Netlify.

```text
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your-client-id
PAYPAL_CLIENT_SECRET=your-client-secret
PAYPAL_RETURN_URL=https://cardanomix2026.netlify.app/
PAYPAL_CANCEL_URL=https://cardanomix2026.netlify.app/
```

The admin dashboard can edit return, cancel, and fallback PayPal links stored in Netlify Blobs.

## Checks

```bash
pnpm test
pnpm build
```
