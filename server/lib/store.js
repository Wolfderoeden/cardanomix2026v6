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

export async function findUserById(userId) {
  const users = await readUsers();
  return users.find((user) => user.id === userId) || null;
}

export async function createUser({ email, passwordHash, name, role = "user" }) {
  const users = await readUsers();
  const normalized = String(email).trim().toLowerCase();
  if (users.some((user) => user.email === normalized)) {
    const error = new Error("Email already exists");
    error.status = 409;
    throw error;
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

export async function summarizeOrders() {
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

export function toPublicUser(user) {
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
