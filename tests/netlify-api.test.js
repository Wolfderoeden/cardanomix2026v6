import test from "node:test";
import assert from "node:assert/strict";
import api, { config } from "../netlify/functions/api.js";

process.env.SESSION_SECRET = "test-session-secret-with-enough-length";

async function readJson(response) {
  return JSON.parse(await response.text());
}

test("netlify api exposes health without requiring a logged-in user", async () => {
  const response = await api(new Request("https://example.test/api/health"), { params: {} });
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.database, "netlify-blobs");
});

test("netlify api exposes products for the storefront", async () => {
  const response = await api(new Request("https://example.test/api/products"), { params: {} });
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.products.length, 4);
  assert.ok(body.products.some((product) => product.priceUsd === 50));
});

test("netlify function is bound to admin and api routes", () => {
  assert.ok(config.path.includes("/api/price/ada"));
  assert.ok(config.path.includes("/api/orders/custom"));
  assert.ok(config.path.includes("/api/admin/login"));
  assert.ok(config.path.includes("/api/admin/settings"));
  assert.ok(config.path.includes("/api/admin/orders/:orderId"));
});
