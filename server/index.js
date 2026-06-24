import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import {
  attachUser,
  authResponse,
  authSchema,
  clearSessionCookie,
  hashPassword,
  requireAdmin,
  requireUser,
  setSessionCookie,
  signSession,
  verifyPassword
} from "./lib/auth.js";
import { fetchAdaPrice, quoteAdaAmount } from "./lib/binance.js";
import { sendOrderNotification, isMailerConfigured, requiresEmailDelivery } from "./lib/mailer.js";
import { findProduct, PRODUCTS } from "./lib/products.js";
import {
  createOrder,
  createUser,
  ensureAdminBootstrap,
  findUserByEmail,
  readOrders,
  summarizeOrders,
  toPublicUser,
  updateOrder
} from "./lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

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

function calculateOrderItems(inputItems) {
  return inputItems.map((input) => {
    const product = findProduct(input.productId);
    if (!product) {
      const error = new Error(`Unknown product: ${input.productId}`);
      error.status = 400;
      throw error;
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

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "256kb" }));
  app.use(attachUser);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false
  });

  app.get("/api/health", async (_req, res) => {
    res.json({
      ok: true,
      mailerConfigured: isMailerConfigured(),
      emailRequired: requiresEmailDelivery(),
      quoteCurrency: process.env.ADA_QUOTE_CURRENCY || "EUR"
    });
  });

  app.get("/api/products", (_req, res) => {
    res.json({ products: PRODUCTS });
  });

  app.get("/api/price/ada", async (_req, res, next) => {
    try {
      res.json({ price: await fetchAdaPrice() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: toPublicUser(req.user) });
  });

  app.post("/api/auth/register", authLimiter, async (req, res, next) => {
    try {
      const payload = authSchema.parse(req.body);
      const user = await createUser({
        email: payload.email,
        passwordHash: await hashPassword(payload.password),
        name: payload.name || payload.email.split("@")[0],
        role: "user"
      });
      setSessionCookie(res, signSession(user));
      res.status(201).json(authResponse(user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    try {
      const payload = authSchema.pick({ email: true, password: true }).parse(req.body);
      const user = await findUserByEmail(payload.email);
      if (!user || user.role === "admin" || !(await verifyPassword(payload.password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      setSessionCookie(res, signSession(user));
      res.json(authResponse(user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/login", authLimiter, async (req, res, next) => {
    try {
      const payload = authSchema.pick({ email: true, password: true }).parse(req.body);
      const user = await findUserByEmail(payload.email);
      if (!user || user.role !== "admin" || !(await verifyPassword(payload.password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid admin credentials" });
      }
      setSessionCookie(res, signSession(user));
      res.json(authResponse(user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.post("/api/orders", requireUser, async (req, res, next) => {
    try {
      const payload = orderSchema.parse(req.body);
      const items = calculateOrderItems(payload.items);
      const totalEur = Number(items.reduce((sum, item) => sum + item.totalEur, 0).toFixed(2));
      const price = await fetchAdaPrice();
      const adaAmount = quoteAdaAmount(totalEur, price.price);
      const order = await createOrder({
        userId: req.user.id,
        customer: {
          name: req.user.name,
          email: req.user.email
        },
        items,
        totalEur,
        adaAmount,
        price
      });

      let emailDelivery;
      try {
        emailDelivery = await sendOrderNotification(order, req.user);
      } catch (mailError) {
        emailDelivery = {
          delivered: false,
          status: "failed",
          message: mailError.message
        };
      }

      const updatedOrder = await updateOrder(order.id, () => ({ emailDelivery }));
      if (!emailDelivery.delivered && requiresEmailDelivery()) {
        return res.status(502).json({
          error: "Order was stored, but Gmail notification could not be delivered",
          order: updatedOrder
        });
      }

      res.status(201).json({ order: updatedOrder });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/orders/my", requireUser, async (req, res, next) => {
    try {
      const orders = (await readOrders()).filter((order) => order.userId === req.user.id);
      res.json({ orders });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/summary", requireAdmin, async (_req, res, next) => {
    try {
      res.json({
        summary: await summarizeOrders(),
        mailerConfigured: isMailerConfigured(),
        emailRequired: requiresEmailDelivery()
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/orders", requireAdmin, async (_req, res, next) => {
    try {
      res.json({ orders: await readOrders() });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/orders/:orderId", requireAdmin, async (req, res, next) => {
    try {
      const payload = statusSchema.parse(req.body);
      const order = await updateOrder(req.params.orderId, () => ({ status: payload.status }));
      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      return next();
    }
    return res.sendFile(path.join(distDir, "index.html"));
  });

  app.use((error, _req, res, _next) => {
    const normalized = normalizeError(error);
    res.status(normalized.status).json(normalized.body);
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  await ensureAdminBootstrap();
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`CardanoMix API listening on http://127.0.0.1:${port}`);
  });
}
