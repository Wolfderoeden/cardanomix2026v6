import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { findUserById, toPublicUser } from "./store.js";

export const authSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  walletAddress: z.string().trim().min(24).max(160),
  password: z.string().min(10).max(160),
  name: z.string().trim().min(2).max(80).optional()
});

const SESSION_COOKIE = "cardanomix_session";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
  }
  return secret || "dev-only-cardanomix-session-secret";
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      walletAddress: user.walletAddress
    },
    getSessionSecret(),
    {
      expiresIn: "30d",
      issuer: "cardanomix"
    }
  );
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export async function readSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, getSessionSecret(), {
      issuer: "cardanomix"
    });
    const user = await findUserById(payload.sub);
    return user || null;
  } catch {
    return null;
  }
}

export async function attachUser(req, _res, next) {
  req.user = await readSession(req);
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

export function authResponse(user) {
  return { user: toPublicUser(user) };
}
