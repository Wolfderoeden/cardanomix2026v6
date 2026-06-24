import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getStore } from "@netlify/blobs";
import { z } from "zod";
import { fetchAdaPrice, quoteAdaAmount } from "../../server/lib/binance.js";
import { createPayPalOrder, getPayPalOrder, paypalConfigured } from "../../server/lib/paypal.js";
import { findProduct, PRODUCTS } from "../../server/lib/products.js";

const SESSION_COOKIE = "cardanomix_session";
const USERS_KEY = "users";
const ORDERS_KEY = "orders";
const SETTINGS_KEY = "settings";

const authSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  walletAddress: z.string().trim().min(24).max(160),
  password: z.string().min(10).max(160),
  name: z.string().trim().min(2).max(80).optional()
});

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(1)
      })
    )
    .min(1)
    .max(1)
});

const statusSchema = z.object({
  status: z.enum(["new", "reviewing", "completed", "cancelled"])
});

const customAdaOrderSchema = z.object({
  adaAmount: z.number().positive().max(100000)
});

const settingsSchema = z.object({
  paypalReturnUrl: z.string().url().or(z.literal("")),
  paypalCancelUrl: z.string().url().or(z.literal("")),
  paypalFallbackUrl: z.string().url().or(z.literal("")),
  customAdaPayPalLink: z.string().url().or(z.literal("")),
  productPayPalLinks: z.record(z.string(), z.string().url().or(z.literal(""))).optional(),
  productMargins: z.record(z.string(), z.number().min(0).max(95)).optional(),
  textContent: z
    .object({
      brandSubtitle: z.string().max(80).optional(),
      heroEyebrow: z.string().max(80).optional(),
      heroTitle: z.string().max(80).optional(),
      heroBody: z.string().max(240).optional(),
      legalNotice: z.string().max(5000).optional()
    })
    .optional(),
  autoRedirectPayPal: z.boolean().optional()
});

function env(name, fallback = "") {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || fallback;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionSecret() {
  const secret = env("SESSION_SECRET");
  if (!secret) {
    throw Object.assign(new Error("SESSION_SECRET is required for deployed authentication"), { status: 500 });
  }
  return secret;
}

function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      walletAddress: user.walletAddress
    },
    sessionSecret(),
    {
      expiresIn: "30d",
      issuer: "cardanomix"
    }
  );
}

function sessionCookie(token) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=2592000"
  ].join("; ");
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

function store() {
  return getStore({ name: "cardanomix-db", consistency: "strong" });
}

async function readList(key) {
  return (await store().get(key, { type: "json" })) || [];
}

async function writeList(key, value) {
  await store().setJSON(key, value);
}

async function readUsers() {
  return readList(USERS_KEY);
}

async function writeUsers(users) {
  await writeList(USERS_KEY, users);
}

async function readOrders() {
  return readList(ORDERS_KEY);
}

async function writeOrders(orders) {
  await writeList(ORDERS_KEY, orders);
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    walletAddress: user.walletAddress,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt
  };
}

async function findUserByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const users = await readUsers();
  return users.find((user) => user.email === normalized) || null;
}

function normalizeWalletAddress(walletAddress) {
  return String(walletAddress || "").trim();
}

async function findUserByWallet(walletAddress) {
  const normalized = normalizeWalletAddress(walletAddress);
  const users = await readUsers();
  return users.find((user) => user.walletAddress === normalized) || null;
}

async function findUserById(userId) {
  const users = await readUsers();
  return users.find((user) => user.id === userId) || null;
}

async function createUser({ email, walletAddress, passwordHash, name, role = "user" }) {
  const users = await readUsers();
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (role === "user" && users.some((user) => user.walletAddress === normalizedWallet)) {
    throw Object.assign(new Error("Wallet already exists"), { status: 409 });
  }
  if (normalizedEmail && users.some((user) => user.email === normalizedEmail)) {
    throw Object.assign(new Error("Email already exists"), { status: 409 });
  }

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: normalizedEmail,
    walletAddress: normalizedWallet || null,
    passwordHash,
    name: String(name || normalizedWallet || normalizedEmail?.split("@")[0] || "Customer").trim(),
    role,
    createdAt: now,
    updatedAt: now
  };

  users.push(user);
  await writeUsers(users);
  return user;
}

async function ensureConfiguredAdmin() {
  const email = env("ADMIN_EMAIL").trim().toLowerCase();
  const password = env("ADMIN_PASSWORD");
  if (!email || !password) {
    return null;
  }

  const users = await readUsers();
  const existing = users.find((user) => user.email === email);

  const now = new Date().toISOString();
  if (existing) {
    existing.role = "admin";
    if (!(await bcrypt.compare(password, existing.passwordHash))) {
      existing.passwordHash = await bcrypt.hash(password, 12);
    }
    existing.updatedAt = now;
    await writeUsers(users);
    return existing;
  }

  const admin = {
    id: randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 12),
    name: "CardanoMix Admin",
    role: "admin",
    createdAt: now,
    updatedAt: now
  };
  users.push(admin);
  await writeUsers(users);
  return admin;
}

async function readSession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, sessionSecret(), { issuer: "cardanomix" });
    return findUserById(payload.sub);
  } catch {
    return null;
  }
}

function requireUser(user) {
  if (!user) {
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  }
}

function requireAdmin(user) {
  if (!user || user.role !== "admin") {
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
}

function calculateOrderItems(inputItems, settings) {
  return inputItems.map((input) => {
    const product = findProduct(input.productId);
    if (!product) {
      throw Object.assign(new Error(`Unknown product: ${input.productId}`), { status: 400 });
    }
    const marginPercent = Number(settings.productMargins?.[product.id] || 0);
    const grossUsd = Number((product.priceUsd * input.quantity).toFixed(2));
    const marginUsd = Number((grossUsd * (marginPercent / 100)).toFixed(2));
    const quoteUsd = Number((grossUsd - marginUsd).toFixed(2));
    return {
      productId: product.id,
      name: product.name,
      quantity: input.quantity,
      unitPriceUsd: product.priceUsd,
      totalUsd: grossUsd,
      quoteUsd,
      marginPercent,
      marginUsd
    };
  });
}

async function createOrder(orderInput) {
  const orders = await readOrders();
  const now = new Date();
  const publicId = `CMX-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${String(orders.length + 1).padStart(4, "0")}`;
  const order = {
    id: randomUUID(),
    publicId,
    status: "new",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...orderInput
  };
  orders.unshift(order);
  await writeOrders(orders);
  return order;
}

async function updateOrder(orderId, updater) {
  const orders = await readOrders();
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) {
    throw Object.assign(new Error("Order not found"), { status: 404 });
  }

  orders[index] = {
    ...orders[index],
    ...updater(orders[index]),
    updatedAt: new Date().toISOString()
  };
  await writeOrders(orders);
  return orders[index];
}

async function deleteOrder(orderId) {
  const orders = await readOrders();
  const nextOrders = orders.filter((order) => order.id !== orderId);
  if (nextOrders.length === orders.length) {
    throw Object.assign(new Error("Order not found"), { status: 404 });
  }
  await writeOrders(nextOrders);
  return { ok: true };
}

function defaultSettings() {
  return {
    paypalReturnUrl: env("PAYPAL_RETURN_URL", "https://cardanomix2026.netlify.app/"),
    paypalCancelUrl: env("PAYPAL_CANCEL_URL", "https://cardanomix2026.netlify.app/"),
    paypalFallbackUrl: env("PAYPAL_FALLBACK_URL", ""),
    customAdaPayPalLink: env("PAYPAL_CUSTOM_ADA_LINK", ""),
    productPayPalLinks: Object.fromEntries(PRODUCTS.map((product) => [product.id, ""])),
    productMargins: Object.fromEntries(PRODUCTS.map((product) => [product.id, 0])),
    textContent: {
      brandSubtitle: "ADA Voucher Store",
      heroEyebrow: "",
      heroTitle: "CardanoMix",
      heroBody: "Buy Cardano with vouchers — simple checkout, customer account, and live ADA pricing based on Binance.",
      legalNotice:
        "CardanoMix is designed to provide a transparent and compliance-conscious voucher checkout experience for users who wish to purchase ADA-related vouchers.\n\nWe only collect and store the account, wallet-address, order, session, and transaction-related data that is necessary to operate the checkout process, maintain account security, reconcile payments, and provide operational support. Personal data is not sold, shared for advertising purposes, or used for unrelated marketing activities.\n\nPayment information is processed by PayPal as the external payment provider. CardanoMix does not store full payment card details. Binance market data is used solely as a pricing reference for ADA exchange-rate calculations and is not used for trading, custody, or financial advisory services.\n\nCryptocurrency markets are volatile, and ADA prices may change rapidly. CardanoMix does not provide financial, investment, tax, or legal advice. CardanoMix does not provide custody services, investment guarantees, price guarantees, or compensation for market losses. Users are responsible for entering the correct wallet information, confirming their payment details, understanding applicable tax obligations, and ensuring that the use of the service is permitted under their local laws and regulations.\n\nOur security and privacy approach is based on recognised data-protection and risk-management principles, including data minimisation, purpose limitation, access control, secure session handling, hashed passwords, least-privilege access to secrets, and regular operational review. These measures are designed to support GDPR/DSGVO principles and modern information-security expectations, including risk-management practices associated with ISMS and NIS2-oriented security frameworks where applicable."
    },
    autoRedirectPayPal: false
  };
}

async function readSettings() {
  try {
    return {
      ...defaultSettings(),
      ...((await store().get(SETTINGS_KEY, { type: "json" })) || {})
    };
  } catch {
    return defaultSettings();
  }
}

async function writeSettings(settings) {
  const nextSettings = {
    ...defaultSettings(),
    paypalReturnUrl: String(settings.paypalReturnUrl || "").trim(),
    paypalCancelUrl: String(settings.paypalCancelUrl || "").trim(),
    paypalFallbackUrl: String(settings.paypalFallbackUrl || "").trim(),
    customAdaPayPalLink: String(settings.customAdaPayPalLink || "").trim(),
    productPayPalLinks: Object.fromEntries(
      PRODUCTS.map((product) => [product.id, String(settings.productPayPalLinks?.[product.id] || "").trim()])
    ),
    productMargins: Object.fromEntries(
      PRODUCTS.map((product) => [product.id, Number(settings.productMargins?.[product.id] || 0)])
    ),
    textContent: {
      ...defaultSettings().textContent,
      ...(settings.textContent || {})
    },
    autoRedirectPayPal: Boolean(settings.autoRedirectPayPal)
  };
  await store().setJSON(SETTINGS_KEY, nextSettings);
  return nextSettings;
}

async function summarizeOrders() {
  const orders = await readOrders();
  const revenueUsd = orders.reduce((sum, order) => sum + Number(order.totalUsd ?? order.totalEur ?? 0), 0);
  const adaQuoted = orders.reduce((sum, order) => sum + Number(order.adaAmount || 0), 0);
  const pending = orders.filter((order) => order.status !== "completed").length;

  return {
    orderCount: orders.length,
    revenueUsd,
    adaQuoted,
    pending
  };
}

function paypalCredentials() {
  return {
    clientId: env("PAYPAL_CLIENT_ID"),
    clientSecret: env("PAYPAL_CLIENT_SECRET"),
    paypalEnv: env("PAYPAL_ENV", "sandbox"),
    baseUrl: env("PAYPAL_API_BASE")
  };
}

function paymentExpired(order) {
  if (order.status === "completed" || order.status === "cancelled") {
    return false;
  }
  return Date.now() - new Date(order.createdAt).getTime() > 10 * 60 * 1000;
}

async function syncPaymentState(order) {
  if (order.status === "completed" || order.status === "cancelled") {
    return order;
  }

  if (paypalConfigured(paypalCredentials()) && order.paypalOrderId) {
    try {
      const paypalOrder = await getPayPalOrder({
        paypalOrderId: order.paypalOrderId,
        credentials: paypalCredentials()
      });
      if (paypalOrder.status === "COMPLETED") {
        return updateOrder(order.id, () => ({
          status: "completed",
          paymentStatus: paypalOrder.status,
          paidAt: new Date().toISOString(),
          payerEmail: paypalOrder.payerEmail
        }));
      }
      if (paypalOrder.status === "APPROVED") {
        return updateOrder(order.id, () => ({
          status: "reviewing",
          paymentStatus: paypalOrder.status
        }));
      }
      order = await updateOrder(order.id, () => ({
        paymentStatus: paypalOrder.status
      }));
    } catch {
      // Keep local status if PayPal is temporarily unavailable; expiry still applies.
    }
  }

  if (paymentExpired(order)) {
    return updateOrder(order.id, () => ({
      status: "cancelled",
      paymentStatus: order.paymentStatus || "expired",
      cancelledAt: new Date().toISOString(),
      cancelReason: "No PayPal payment detected within 10 minutes"
    }));
  }

  return order;
}

async function syncVisibleOrders(orders) {
  const synced = [];
  for (const order of orders) {
    synced.push(await syncPaymentState(order));
  }
  return synced;
}

async function attachPaymentLink(order, settings) {
  const productId = order.items?.[0]?.productId;
  const manualProductLink = order.type === "voucher" ? settings.productPayPalLinks?.[productId] : "";
  const manualCustomLink = order.type === "custom-ada" ? settings.customAdaPayPalLink : "";

  if (paypalConfigured(paypalCredentials())) {
    const paypalOrder = await createPayPalOrder({
      publicId: order.publicId,
      totalUsd: order.totalUsd,
      description: `${order.publicId} CardanoMix ADA order`,
      returnUrl: settings.paypalReturnUrl,
      cancelUrl: settings.paypalCancelUrl,
      credentials: paypalCredentials()
    });
    return updateOrder(order.id, () => ({
      paypalOrderId: paypalOrder.id,
      paymentUrl: paypalOrder.approvalUrl,
      paymentProvider: "paypal",
      paymentStatus: paypalOrder.status
    }));
  }

  const manualLink = manualProductLink || manualCustomLink || settings.paypalFallbackUrl;
  if (manualLink) {
    return updateOrder(order.id, () => ({
      paymentUrl: manualLink,
      paymentProvider: "paypal-link",
      paymentStatus: "manual-link"
    }));
  }

  return order;
}

function routePath(request) {
  return new URL(request.url).pathname.replace(/\/+$/, "") || "/";
}

function normalizeError(error) {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: "Invalid request",
        details: error.issues.map((issue) => issue.message)
      }
    };
  }

  return {
    status: error.status || 500,
    body: {
      error: error.status ? error.message : "Unexpected server error"
    }
  };
}

async function handle(request, context) {
  const path = routePath(request);
  const user = await readSession(request);

  if (request.method === "GET" && path === "/api/health") {
    return json({
      ok: true,
      database: "netlify-blobs",
      adminConfigured: Boolean(env("ADMIN_EMAIL") && env("ADMIN_PASSWORD")),
      quoteCurrency: env("ADA_QUOTE_CURRENCY", "USD"),
      paypalConfigured: paypalConfigured(paypalCredentials())
    });
  }

  if (request.method === "GET" && path === "/api/products") {
    return json({ products: PRODUCTS });
  }

  if (request.method === "GET" && path === "/api/price/ada") {
    return json({
      price: await fetchAdaPrice({
        quoteCurrency: env("ADA_QUOTE_CURRENCY", "USD"),
        baseUrl: env("BINANCE_API_BASE")
      })
    });
  }

  if (request.method === "GET" && path === "/api/settings") {
    const settings = await readSettings();
    return json({
      settings: {
        paypalFallbackUrl: settings.paypalFallbackUrl,
        customAdaPayPalLink: settings.customAdaPayPalLink,
        productPayPalLinks: settings.productPayPalLinks,
        productMargins: settings.productMargins,
        textContent: settings.textContent,
        autoRedirectPayPal: settings.autoRedirectPayPal
      },
      paypalConfigured: paypalConfigured(paypalCredentials())
    });
  }

  if (request.method === "GET" && path === "/api/auth/me") {
    return json({ user: publicUser(user) });
  }

  if (request.method === "POST" && path === "/api/auth/register") {
    const payload = authSchema.pick({ walletAddress: true, password: true, name: true }).parse(await request.json());
    const created = await createUser({
      walletAddress: payload.walletAddress,
      passwordHash: await bcrypt.hash(payload.password, 12),
      name: payload.name || "Wallet customer",
      role: "user"
    });
    return json({ user: publicUser(created) }, 201, { "Set-Cookie": sessionCookie(signSession(created)) });
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    const payload = authSchema.pick({ walletAddress: true, password: true }).parse(await request.json());
    const found = await findUserByWallet(payload.walletAddress);
    if (!found || found.role === "admin" || !(await bcrypt.compare(payload.password, found.passwordHash))) {
      return json({ error: "Invalid wallet or password" }, 401);
    }
    return json({ user: publicUser(found) }, 200, { "Set-Cookie": sessionCookie(signSession(found)) });
  }

  if (request.method === "POST" && path === "/api/admin/login") {
    await ensureConfiguredAdmin();
    const payload = authSchema.pick({ email: true, password: true }).parse(await request.json());
    const found = await findUserByEmail(payload.email);
    if (!found || found.role !== "admin" || !(await bcrypt.compare(payload.password, found.passwordHash))) {
      return json({ error: "Invalid admin credentials" }, 401);
    }
    return json({ user: publicUser(found) }, 200, { "Set-Cookie": sessionCookie(signSession(found)) });
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  if (request.method === "POST" && path === "/api/orders") {
    requireUser(user);
    const payload = orderSchema.parse(await request.json());
    const settings = await readSettings();
    const items = calculateOrderItems(payload.items, settings);
    const totalUsd = Number(items.reduce((sum, item) => sum + item.totalUsd, 0).toFixed(2));
    const quoteUsd = Number(items.reduce((sum, item) => sum + item.quoteUsd, 0).toFixed(2));
    const price = await fetchAdaPrice({
      quoteCurrency: env("ADA_QUOTE_CURRENCY", "USD"),
      baseUrl: env("BINANCE_API_BASE")
    });
    const order = await createOrder({
      type: "voucher",
      userId: user.id,
      customer: {
        name: user.name,
        walletAddress: user.walletAddress
      },
      items,
      totalUsd,
      voucherAmountUsd: totalUsd,
      quoteUsd,
      marginPercent: items[0]?.marginPercent || 0,
      marginUsd: Number(items.reduce((sum, item) => sum + item.marginUsd, 0).toFixed(2)),
      adaAmount: quoteAdaAmount(quoteUsd, price.price),
      price
    });
    return json({ order: await attachPaymentLink(order, settings) }, 201);
  }

  if (request.method === "POST" && path === "/api/orders/custom") {
    requireUser(user);
    const payload = customAdaOrderSchema.parse(await request.json());
    const price = await fetchAdaPrice({
      quoteCurrency: env("ADA_QUOTE_CURRENCY", "USD"),
      baseUrl: env("BINANCE_API_BASE")
    });
    const totalUsd = Number((payload.adaAmount * price.price).toFixed(2));
    const order = await createOrder({
      type: "custom-ada",
      userId: user.id,
      customer: {
        name: user.name,
        walletAddress: user.walletAddress
      },
      items: [
        {
          productId: "custom-ada",
          name: "Custom ADA buy",
          quantity: 1,
          unitPriceUsd: totalUsd,
          totalUsd
        }
      ],
      totalUsd,
      adaAmount: Number(payload.adaAmount.toFixed(6)),
      price
    });
    return json({ order: await attachPaymentLink(order, await readSettings()) }, 201);
  }

  if (request.method === "GET" && path === "/api/orders/my") {
    requireUser(user);
    const orders = await syncVisibleOrders((await readOrders()).filter((order) => order.userId === user.id));
    return json({ orders });
  }

  if (request.method === "GET" && path === "/api/admin/summary") {
    requireAdmin(user);
    await syncVisibleOrders(await readOrders());
    return json({
      summary: await summarizeOrders(),
      database: "netlify-blobs",
      paypalConfigured: paypalConfigured(paypalCredentials())
    });
  }

  if (request.method === "GET" && path === "/api/admin/orders") {
    requireAdmin(user);
    return json({ orders: await syncVisibleOrders(await readOrders()) });
  }

  if (request.method === "GET" && path === "/api/admin/settings") {
    requireAdmin(user);
    return json({
      settings: await readSettings(),
      paypalConfigured: paypalConfigured(paypalCredentials())
    });
  }

  if (request.method === "PATCH" && path === "/api/admin/settings") {
    requireAdmin(user);
    const payload = settingsSchema.parse(await request.json());
    return json({ settings: await writeSettings(payload) });
  }

  if (request.method === "PATCH" && path.startsWith("/api/admin/orders/")) {
    requireAdmin(user);
    const orderId = context.params?.orderId || path.split("/").pop();
    const payload = statusSchema.parse(await request.json());
    const order = await updateOrder(orderId, () => ({ status: payload.status }));
    return json({ order });
  }

  if (request.method === "POST" && path.endsWith("/sync") && path.startsWith("/api/admin/orders/")) {
    requireAdmin(user);
    const orderId = path.split("/").at(-2);
    const order = (await readOrders()).find((candidate) => candidate.id === orderId);
    if (!order) {
      throw Object.assign(new Error("Order not found"), { status: 404 });
    }
    return json({ order: await syncPaymentState(order) });
  }

  if (request.method === "DELETE" && path.startsWith("/api/admin/orders/")) {
    requireAdmin(user);
    const orderId = context.params?.orderId || path.split("/").pop();
    return json(await deleteOrder(orderId));
  }

  return json({ error: "Not found" }, 404);
}

export default async (request, context) => {
  try {
    return await handle(request, context);
  } catch (error) {
    const normalized = normalizeError(error);
    return json(normalized.body, normalized.status);
  }
};

export const config = {
  path: [
    "/api/health",
    "/api/products",
    "/api/price/ada",
    "/api/settings",
    "/api/auth/me",
    "/api/auth/register",
    "/api/auth/login",
    "/api/admin/login",
    "/api/auth/logout",
    "/api/orders",
    "/api/orders/custom",
    "/api/orders/my",
    "/api/admin/summary",
    "/api/admin/orders",
    "/api/admin/settings",
    "/api/admin/orders/:orderId",
    "/api/admin/orders/:orderId/sync"
  ]
};
