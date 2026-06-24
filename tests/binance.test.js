import test from "node:test";
import assert from "node:assert/strict";
import { buildAdaTickerSymbol, quoteAdaAmount } from "../server/lib/binance.js";

test("builds a Binance ADA ticker symbol", () => {
  assert.equal(buildAdaTickerSymbol(), "ADAUSDT");
  assert.equal(buildAdaTickerSymbol("usd"), "ADAUSDT");
  assert.equal(buildAdaTickerSymbol("eur"), "ADAEUR");
  assert.equal(buildAdaTickerSymbol("USDT"), "ADAUSDT");
});

test("rejects invalid Binance quote currencies", () => {
  assert.throws(() => buildAdaTickerSymbol("EUR/USDT"), /Invalid Binance quote currency/);
});

test("quotes ADA amount from fiat total and live price", () => {
  assert.equal(quoteAdaAmount(100, 0.5), 200);
  assert.equal(quoteAdaAmount(25, 0.333333), 75.000075);
});
