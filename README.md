# CardanoMix ADA Voucher Store

Modern ADA voucher storefront with a separate admin dashboard, direct website user auth, Binance live pricing, and persistent Netlify storage.

## What is included

- Arctic storefront for customers and Midnight admin dashboard.
- Website-native registration and login. No ChatGPT auth is used.
- Admin login via email and password only.
- Live ADA pricing from Binance on every price request and every order quote.
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

The app requests `https://api.binance.com/api/v3/ticker/price?symbol=ADAEUR` by default. Change `ADA_QUOTE_CURRENCY` if you want another Binance quote currency.

## Checks

```bash
pnpm test
pnpm build
```
