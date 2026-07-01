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
import { createPayPalOrder, paypalConfigured } from "./lib/paypal.js";
import { findProduct, PRODUCTS } from "./lib/products.js";
import {
  createOrder,
  createUser,
  deleteOrder,
  findUserByEmail,
  findUserByWallet,
  readSettings,
  readOrders,
  summarizeOrders,
  toPublicUser,
  updateOrder,
  writeSettings
} from "./lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const orderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(80),
    walletAddress: z.string().trim().min(24).max(160)
  }),
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
      legalNotice: z.string().max(5000).optional()
    })
    .optional(),
  autoRedirectPayPal: z.boolean().optional()
});

const statusSchema = z.object({
  status: z.enum(["new", "reviewing", "completed", "cancelled"])
});

function calculateOrderItems(inputItems, settings) {
  return inputItems.map((input) => {
    const product = findProduct(input.productId);
    if (!product) {
      const error = new Error(`Unknown product: ${input.productId}`);
      error.status = 400;
      throw error;
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

function paypalCredentials() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    paypalEnv: process.env.PAYPAL_ENV,
    baseUrl: process.env.PAYPAL_API_BASE
  };
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
      database: "local-json",
      quoteCurrency: process.env.ADA_QUOTE_CURRENCY || "USD",
      paypalConfigured: paypalConfigured(paypalCredentials())
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

  app.get("/api/settings", async (_req, res, next) => {
    try {
      const settings = await readSettings();
      res.json({
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
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: toPublicUser(req.user) });
  });

  app.post("/api/auth/register", authLimiter, async (req, res, next) => {
    try {
      const payload = authSchema.pick({ walletAddress: true, password: true, name: true }).parse(req.body);
      const user = await createUser({
        walletAddress: payload.walletAddress,
        passwordHash: await hashPassword(payload.password),
        name: payload.name || "Wallet customer",
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
      const payload = authSchema.pick({ walletAddress: true, password: true }).parse(req.body);
      const user = await findUserByWallet(payload.walletAddress);
      if (!user || user.role === "admin" || !(await verifyPassword(payload.password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid wallet or password" });
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

  app.post("/api/orders", async (req, res, next) => {
    try {
      const payload = orderSchema.parse(req.body);
      const settings = await readSettings();
      const items = calculateOrderItems(payload.items, settings);
      const totalUsd = Number(items.reduce((sum, item) => sum + item.totalUsd, 0).toFixed(2));
      const quoteUsd = Number(items.reduce((sum, item) => sum + item.quoteUsd, 0).toFixed(2));
      const price = await fetchAdaPrice();
      const adaAmount = quoteAdaAmount(quoteUsd, price.price);
      const order = await createOrder({
        type: "voucher",
        userId: req.user?.role === "user" ? req.user.id : null,
        customer: {
          name: payload.customer.name,
          walletAddress: payload.customer.walletAddress
        },
        items,
        totalUsd,
        voucherAmountUsd: totalUsd,
        quoteUsd,
        marginPercent: items[0]?.marginPercent || 0,
        marginUsd: Number(items.reduce((sum, item) => sum + item.marginUsd, 0).toFixed(2)),
        adaAmount,
        price
      });
      const orderWithPayment = await attachPaymentLink(order, settings);
      res.status(201).json({ order: orderWithPayment });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/orders/custom", requireUser, async (req, res, next) => {
    try {
      const payload = customAdaOrderSchema.parse(req.body);
      const price = await fetchAdaPrice();
      const totalUsd = Number((payload.adaAmount * price.price).toFixed(2));
      const order = await createOrder({
        type: "custom-ada",
        userId: req.user.id,
        customer: {
          name: req.user.name,
          walletAddress: req.user.walletAddress
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
      const orderWithPayment = await attachPaymentLink(order, await readSettings());
      res.status(201).json({ order: orderWithPayment });
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
        database: "local-json",
        paypalConfigured: paypalConfigured(paypalCredentials())
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

  app.get("/api/admin/settings", requireAdmin, async (_req, res, next) => {
    try {
      res.json({
        settings: await readSettings(),
        paypalConfigured: paypalConfigured(paypalCredentials())
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/settings", requireAdmin, async (req, res, next) => {
    try {
      const payload = settingsSchema.parse(req.body);
      res.json({ settings: await writeSettings(payload) });
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

  app.delete("/api/admin/orders/:orderId", requireAdmin, async (req, res, next) => {
    try {
      res.json(await deleteOrder(req.params.orderId));
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
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`CardanoMix API listening on http://127.0.0.1:${port}`);
  });
}
