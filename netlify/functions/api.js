import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getStore } from "@netlify/blobs";
import { z } from "zod";
import { fetchAdaPrice, quoteAdaAmount } from "../../server/lib/binance.js";
import { findProduct, PRODUCTS } from "../../server/lib/products.js";

const SESSION_COOKIE = "cardanomix_session";
const USERS_KEY = "users";
const ORDERS_KEY = "orders";

const authSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(160),
  name: z.string().trim().min(2).max(80).optional()
});

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(20)
      })
    )
    .min(1)
    .max(12)
});

const statusSchema = z.object({
  status: z.enum(["new", "reviewing", "completed", "cancelled"])
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
      email: user.email
    },
    sessionSecret(),
    {
      expiresIn: "7d",
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
    "Max-Age=604800"
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

async function findUserById(userId) {
  const users = await readUsers();
  return users.find((user) => user.id === userId) || null;
}

async function createUser({ email, passwordHash, name, role = "user" }) {
  const users = await readUsers();
  const normalized = String(email).trim().toLowerCase();
  if (users.some((user) => user.email === normalized)) {
    throw Object.assign(new Error("Email already exists"), { status: 409 });
  }

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: normalized,
    passwordHash,
    name: String(name || normalized.split("@")[0]).trim(),
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

function calculateOrderItems(inputItems) {
  return inputItems.map((input) => {
    const product = findProduct(input.productId);
    if (!product) {
      throw Object.assign(new Error(`Unknown product: ${input.productId}`), { status: 400 });
    }
    return {
      productId: product.id,
      name: product.name,
      quantity: input.quantity,
      unitPriceEur: product.priceEur,
      totalEur: Number((product.priceEur * input.quantity).toFixed(2))
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

async function summarizeOrders() {
  const orders = await readOrders();
  const revenueEur = orders.reduce((sum, order) => sum + Number(order.totalEur || 0), 0);
  const adaQuoted = orders.reduce((sum, order) => sum + Number(order.adaAmount || 0), 0);
  const pending = orders.filter((order) => order.status !== "completed").length;

  return {
    orderCount: orders.length,
    revenueEur,
    adaQuoted,
    pending
  };
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
      quoteCurrency: env("ADA_QUOTE_CURRENCY", "EUR")
    });
  }

  if (request.method === "GET" && path === "/api/products") {
    return json({ products: PRODUCTS });
  }

  if (request.method === "GET" && path === "/api/price/ada") {
    return json({
      price: await fetchAdaPrice({
        quoteCurrency: env("ADA_QUOTE_CURRENCY", "EUR"),
        baseUrl: env("BINANCE_API_BASE", "https://api.binance.com")
      })
    });
  }

  if (request.method === "GET" && path === "/api/auth/me") {
    return json({ user: publicUser(user) });
  }

  if (request.method === "POST" && path === "/api/auth/register") {
    const payload = authSchema.parse(await request.json());
    const created = await createUser({
      email: payload.email,
      passwordHash: await bcrypt.hash(payload.password, 12),
      name: payload.name || payload.email.split("@")[0],
      role: "user"
    });
    return json({ user: publicUser(created) }, 201, { "Set-Cookie": sessionCookie(signSession(created)) });
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    const payload = authSchema.pick({ email: true, password: true }).parse(await request.json());
    const found = await findUserByEmail(payload.email);
    if (!found || found.role === "admin" || !(await bcrypt.compare(payload.password, found.passwordHash))) {
      return json({ error: "Invalid email or password" }, 401);
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
    const items = calculateOrderItems(payload.items);
    const totalEur = Number(items.reduce((sum, item) => sum + item.totalEur, 0).toFixed(2));
    const price = await fetchAdaPrice({
      quoteCurrency: env("ADA_QUOTE_CURRENCY", "EUR"),
      baseUrl: env("BINANCE_API_BASE", "https://api.binance.com")
    });
    const order = await createOrder({
      userId: user.id,
      customer: {
        name: user.name,
        email: user.email
      },
      items,
      totalEur,
      adaAmount: quoteAdaAmount(totalEur, price.price),
      price
    });
    return json({ order }, 201);
  }

  if (request.method === "GET" && path === "/api/orders/my") {
    requireUser(user);
    const orders = (await readOrders()).filter((order) => order.userId === user.id);
    return json({ orders });
  }

  if (request.method === "GET" && path === "/api/admin/summary") {
    requireAdmin(user);
    return json({
      summary: await summarizeOrders(),
      database: "netlify-blobs"
    });
  }

  if (request.method === "GET" && path === "/api/admin/orders") {
    requireAdmin(user);
    return json({ orders: await readOrders() });
  }

  if (request.method === "PATCH" && path.startsWith("/api/admin/orders/")) {
    requireAdmin(user);
    const orderId = context.params?.orderId || path.split("/").pop();
    const payload = statusSchema.parse(await request.json());
    const order = await updateOrder(orderId, () => ({ status: payload.status }));
    return json({ order });
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
    "/api/auth/me",
    "/api/auth/register",
    "/api/auth/login",
    "/api/admin/login",
    "/api/auth/logout",
    "/api/orders",
    "/api/orders/my",
    "/api/admin/summary",
    "/api/admin/orders",
    "/api/admin/orders/:orderId"
  ]
};
