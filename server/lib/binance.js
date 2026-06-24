const DEFAULT_BASES = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com"
];

export function buildAdaTickerSymbol(quoteCurrency = "EUR") {
  const quote = String(quoteCurrency || "EUR").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,10}$/.test(quote)) {
    throw new Error("Invalid Binance quote currency");
  }
  return `ADA${quote}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function endpointCandidates(options = {}) {
  const configured = options.baseUrl || process.env.BINANCE_API_BASE || "";
  const configuredList = String(options.baseUrls || process.env.BINANCE_API_BASES || "")
    .split(",")
    .map((value) => value.trim());
  return unique([configured, ...configuredList, ...DEFAULT_BASES]);
}

export async function fetchAdaPrice(options = {}) {
  const quoteCurrency = options.quoteCurrency || process.env.ADA_QUOTE_CURRENCY || "EUR";
  const symbol = buildAdaTickerSymbol(quoteCurrency);
  const timeoutMs = options.timeoutMs || 7000;
  const errors = [];

  for (const baseUrl of endpointCandidates(options)) {
    const url = new URL("/api/v3/ticker/price", baseUrl);
    url.searchParams.set("symbol", symbol);

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json"
        }
      });

      if (!response.ok) {
        errors.push(`${baseUrl}: HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const price = Number(payload.price);
      if (!Number.isFinite(price) || price <= 0) {
        errors.push(`${baseUrl}: invalid price`);
        continue;
      }

      return {
        symbol,
        quoteCurrency: String(quoteCurrency).toUpperCase(),
        price,
        source: "binance",
        endpoint: baseUrl,
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      errors.push(`${baseUrl}: ${error.message}`);
    }
  }

  const error = new Error(`Binance live price unavailable for ${symbol}: ${errors.join("; ")}`);
  error.status = 502;
  throw error;
}

export function quoteAdaAmount(totalFiat, adaPrice) {
  const fiat = Number(totalFiat);
  const price = Number(adaPrice);
  if (!Number.isFinite(fiat) || fiat <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error("Cannot quote ADA amount with invalid values");
  }

  return Number((fiat / price).toFixed(6));
}
