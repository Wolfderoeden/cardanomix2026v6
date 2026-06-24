const DEFAULT_BASE = "https://api.binance.com";

export function buildAdaTickerSymbol(quoteCurrency = "EUR") {
  const quote = String(quoteCurrency || "EUR").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,10}$/.test(quote)) {
    throw new Error("Invalid Binance quote currency");
  }
  return `ADA${quote}`;
}

export async function fetchAdaPrice(options = {}) {
  const quoteCurrency = options.quoteCurrency || process.env.ADA_QUOTE_CURRENCY || "EUR";
  const symbol = buildAdaTickerSymbol(quoteCurrency);
  const baseUrl = options.baseUrl || process.env.BINANCE_API_BASE || DEFAULT_BASE;
  const timeoutMs = options.timeoutMs || 7000;
  const url = new URL("/api/v3/ticker/price", baseUrl);
  url.searchParams.set("symbol", symbol);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Binance responded with ${response.status} for ${symbol}`);
  }

  const payload = await response.json();
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Binance returned an invalid ADA price for ${symbol}`);
  }

  return {
    symbol,
    quoteCurrency: String(quoteCurrency).toUpperCase(),
    price,
    source: "binance",
    fetchedAt: new Date().toISOString()
  };
}

export function quoteAdaAmount(totalFiat, adaPrice) {
  const fiat = Number(totalFiat);
  const price = Number(adaPrice);
  if (!Number.isFinite(fiat) || fiat <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error("Cannot quote ADA amount with invalid values");
  }

  return Number((fiat / price).toFixed(6));
}
