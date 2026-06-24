import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile(fileName, fallback) {
  await ensureDataDir();
  const fullPath = path.join(DATA_DIR, fileName);
  try {
    const contents = await readFile(fullPath, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(fileName, value) {
  await ensureDataDir();
  const fullPath = path.join(DATA_DIR, fileName);
  const tempPath = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, fullPath);
}

export async function readUsers() {
  return readJsonFile("users.json", []);
}

export async function writeUsers(users) {
  await writeJsonFile("users.json", users);
}

export async function readOrders() {
  return readJsonFile("orders.json", []);
}

export async function writeOrders(orders) {
  await writeJsonFile("orders.json", orders);
}

export async function findUserByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const users = await readUsers();
  return users.find((user) => user.email === normalized) || null;
}

export function normalizeWalletAddress(walletAddress) {
  return String(walletAddress || "").trim();
}

export async function findUserByWallet(walletAddress) {
  const normalized = normalizeWalletAddress(walletAddress);
  const users = await readUsers();
  return users.find((user) => user.walletAddress === normalized) || null;
}

export async function findUserById(userId) {
  const users = await readUsers();
  return users.find((user) => user.id === userId) || null;
}

export async function createUser({ email, walletAddress, passwordHash, name, role = "user" }) {
  const users = await readUsers();
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (role === "user" && users.some((user) => user.walletAddress === normalizedWallet)) {
    const error = new Error("Wallet already exists");
    error.status = 409;
    throw error;
  }
  if (normalizedEmail && users.some((user) => user.email === normalizedEmail)) {
    const error = new Error("Email already exists");
    error.status = 409;
    throw error;
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

export async function upsertAdminUser({ email, passwordHash }) {
  const users = await readUsers();
  const normalized = String(email).trim().toLowerCase();
  const now = new Date().toISOString();
  const existing = users.find((user) => user.email === normalized);

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = "admin";
    existing.updatedAt = now;
    await writeUsers(users);
    return existing;
  }

  const admin = {
    id: randomUUID(),
    email: normalized,
    passwordHash,
    name: "CardanoMix Admin",
    role: "admin",
    createdAt: now,
    updatedAt: now
  };
  users.push(admin);
  await writeUsers(users);
  return admin;
}

export async function createOrder(orderInput) {
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

export async function updateOrder(orderId, updater) {
  const orders = await readOrders();
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  orders[index] = {
    ...orders[index],
    ...updater(orders[index]),
    updatedAt: new Date().toISOString()
  };
  await writeOrders(orders);
  return orders[index];
}

export async function deleteOrder(orderId) {
  const orders = await readOrders();
  const nextOrders = orders.filter((order) => order.id !== orderId);
  if (nextOrders.length === orders.length) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  await writeOrders(nextOrders);
  return { ok: true };
}

export function defaultSettings() {
  return {
    paypalReturnUrl: process.env.PAYPAL_RETURN_URL || "https://cardanomix2026.netlify.app/",
    paypalCancelUrl: process.env.PAYPAL_CANCEL_URL || "https://cardanomix2026.netlify.app/",
    paypalFallbackUrl: process.env.PAYPAL_FALLBACK_URL || "",
    customAdaPayPalLink: process.env.PAYPAL_CUSTOM_ADA_LINK || "",
    productPayPalLinks: {},
    productMargins: {},
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

export async function readSettings() {
  return {
    ...defaultSettings(),
    ...(await readJsonFile("settings.json", {}))
  };
}

export async function writeSettings(settings) {
  const nextSettings = {
    ...defaultSettings(),
    paypalReturnUrl: String(settings.paypalReturnUrl || "").trim(),
    paypalCancelUrl: String(settings.paypalCancelUrl || "").trim(),
    paypalFallbackUrl: String(settings.paypalFallbackUrl || "").trim(),
    customAdaPayPalLink: String(settings.customAdaPayPalLink || "").trim(),
    productPayPalLinks: Object.fromEntries(
      Object.entries(settings.productPayPalLinks || {}).map(([key, value]) => [key, String(value || "").trim()])
    ),
    productMargins: Object.fromEntries(
      Object.entries(settings.productMargins || {}).map(([key, value]) => [key, Number(value || 0)])
    ),
    textContent: {
      ...defaultSettings().textContent,
      ...(settings.textContent || {})
    },
    autoRedirectPayPal: Boolean(settings.autoRedirectPayPal)
  };
  await writeJsonFile("settings.json", nextSettings);
  return nextSettings;
}

export async function summarizeOrders() {
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

export function toPublicUser(user) {
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
