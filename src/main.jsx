import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Moon,
  RefreshCw,
  Save,
  ShieldCheck,
  ShoppingCart,
  Snowflake,
  Trash2,
  UserRound,
  WalletCards
} from "lucide-react";
import "./styles.css";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

const DEFAULT_LEGAL_NOTICE =
  "CardanoMix is designed to provide a transparent and compliance-conscious voucher checkout experience for users who wish to purchase ADA-related vouchers.\n\nWe only collect and store the account, wallet-address, order, session, and transaction-related data that is necessary to operate the checkout process, maintain account security, reconcile payments, and provide operational support. Personal data is not sold, shared for advertising purposes, or used for unrelated marketing activities.\n\nPayment information is processed by PayPal as the external payment provider. CardanoMix does not store full payment card details. Binance market data is used solely as a pricing reference for ADA exchange-rate calculations and is not used for trading, custody, or financial advisory services.\n\nCryptocurrency markets are volatile, and ADA prices may change rapidly. CardanoMix does not provide financial, investment, tax, or legal advice. CardanoMix does not provide custody services, investment guarantees, price guarantees, or compensation for market losses. Users are responsible for entering the correct wallet information, confirming their payment details, understanding applicable tax obligations, and ensuring that the use of the service is permitted under their local laws and regulations.\n\nOur security and privacy approach is based on recognised data-protection and risk-management principles, including data minimisation, purpose limitation, access control, secure session handling, hashed passwords, least-privilege access to secrets, and regular operational review. These measures are designed to support GDPR/DSGVO principles and modern information-security expectations, including risk-management practices associated with ISMS and NIS2-oriented security frameworks where applicable.";

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function maskWallet(walletAddress = "") {
  if (!walletAddress) {
    return "No wallet";
  }
  if (walletAddress.length <= 12) {
    return walletAddress;
  }
  return `${walletAddress.slice(0, 5)}...${walletAddress.slice(-4)}`;
}

function contentFrom(settings) {
  return settings?.settings?.textContent || {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function useBootstrap() {
  const [state, setState] = useState({
    user: null,
    products: [],
    price: null,
    health: null,
    settings: null,
    loading: true,
    error: ""
  });

  async function refreshPrice() {
    const payload = await api("/api/price/ada");
    setState((current) => ({ ...current, price: payload.price }));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [me, products, price, health, settings] = await Promise.all([
          api("/api/auth/me"),
          api("/api/products"),
          api("/api/price/ada"),
          api("/api/health"),
          api("/api/settings")
        ]);
        if (!cancelled) {
          setState({
            user: me.user,
            products: products.products,
            price: price.price,
            health,
            settings,
            loading: false,
            error: ""
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error.message
          }));
        }
      }
    }
    load();
    const interval = setInterval(() => refreshPrice().catch(() => {}), 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return [state, setState, refreshPrice];
}

function Brand({ compact = false, subtitle = "ADA Voucher Store" }) {
  return (
    <a className="brand" href="/" aria-label="CardanoMix Store">
      <img src="/assets/cardanomix-mark.svg" alt="" />
      {!compact && (
        <span>
          <strong>CardanoMix</strong>
          <small>{subtitle}</small>
        </span>
      )}
    </a>
  );
}

function ThemeSwitch({ theme, setTheme }) {
  return (
    <div className="segmented" aria-label="Design mode">
      <button className={theme === "arctic" ? "active" : ""} onClick={() => setTheme("arctic")} type="button">
        <Snowflake size={16} />
        Arctic
      </button>
      <button className={theme === "midnight" ? "active" : ""} onClick={() => setTheme("midnight")} type="button">
        <Moon size={16} />
        Midnight
      </button>
    </div>
  );
}

function PriceBadge({ price, onRefresh }) {
  return (
    <div className="price-badge">
      <Activity size={18} />
      <div>
        <span>ADA live</span>
        <strong>{price ? `${price.price.toFixed(4)} ${price.quoteCurrency}` : "Unavailable"}</strong>
      </div>
      <button className="icon-button" onClick={onRefresh} type="button" aria-label="Refresh ADA price" title="Refresh ADA price">
        <RefreshCw size={16} />
      </button>
    </div>
  );
}

function AccountMenu({ user, theme, setTheme, onLogout }) {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }
    api("/api/orders/my")
      .then((payload) => setOrders(payload.orders || []))
      .catch(() => setOrders([]));
  }, [user]);

  function inspectOrders() {
    document.getElementById("customer-orders")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <details className="account-menu">
      <summary className="profile-chip">
        <UserRound size={16} />
        <span>{user.name}</span>
      </summary>
      <div className="account-popover">
        <div>
          <div className="mini-heading">Wallet</div>
          <p className="wallet-note">{maskWallet(user.walletAddress)}</p>
        </div>
        <ThemeSwitch theme={theme} setTheme={setTheme} />
        <button className="ghost-button" type="button" onClick={inspectOrders}>
          Inspect orders
        </button>
        <div className="account-orders">
          <div className="mini-heading">Orders</div>
          {orders.length === 0 && <p className="muted">No orders yet.</p>}
          {orders.map((order) => (
            <div className="order-chip compact" key={order.id}>
              <span>{order.publicId}</span>
              <strong>{order.status}</strong>
            </div>
          ))}
        </div>
        <button className="ghost-button" onClick={onLogout} type="button">
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </details>
  );
}

function AuthPanel({ mode, setMode, onAuth }) {
  const [form, setForm] = useState({ name: "", walletAddress: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await api(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: form
      });
      onAuth(payload.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-panel" onSubmit={submit}>
      <div className="section-title">
        <UserRound size={18} />
        <span>{mode === "register" ? "Create account" : "Customer login"}</span>
      </div>
      {mode === "register" && (
        <label>
          Name
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} />
        </label>
      )}
      <label>
        Cardano wallet
        <input
          value={form.walletAddress}
          onChange={(event) => setForm({ ...form, walletAddress: event.target.value })}
          required
          minLength={24}
          placeholder="addr1..."
        />
      </label>
      <label>
        Password
        <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={10} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy} type="submit">
        <LockKeyhole size={17} />
        {busy ? "Working" : mode === "register" ? "Register" : "Login"}
      </button>
      <button className="text-button" type="button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
        {mode === "register" ? "Already registered" : "Create customer account"}
      </button>
    </form>
  );
}

function ProductCard({ product, adaPrice, marginPercent = 0, quantity, setQuantity }) {
  const quoteUsd = product.priceUsd * (1 - marginPercent / 100);
  const adaAmount = adaPrice ? (quoteUsd / adaPrice.price).toFixed(4) : "0.0000";
  return (
    <article className={classNames("product-card", product.tone)}>
      <div className="voucher-face">
        <span>{product.tier}</span>
        <strong>{product.name}</strong>
      </div>
      <div className="product-copy">
        <p>{product.description}</p>
        <div className="product-meta">
          <span>{currency.format(product.priceUsd)}</span>
          <span>{adaAmount} ADA</span>
        </div>
        {marginPercent > 0 && <small className="muted">ADA quote after {marginPercent}% service margin</small>}
      </div>
      <div className="stepper">
        <button
          className={quantity ? "selected" : ""}
          type="button"
          aria-label={`Select ${product.name}`}
          onClick={() => setQuantity(product.id, quantity ? 0 : 1)}
        >
          {quantity ? "Selected" : "Select voucher"}
        </button>
      </div>
    </article>
  );
}

function CartPanel({ products, cart, price, user, settings, orderMode, setOrderMode, setUser, setCart }) {
  const [authMode, setAuthMode] = useState("register");
  const [orders, setOrders] = useState([]);
  const [customUsd, setCustomUsd] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cartItems = useMemo(
    () =>
      products
        .filter((product) => cart[product.id] > 0)
        .map((product) => ({
          ...product,
          quantity: cart[product.id],
          lineTotal: product.priceUsd * cart[product.id]
        })),
    [cart, products]
  );
  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const selectedProduct = cartItems[0];
  const selectedMargin = Number(settings?.settings?.productMargins?.[selectedProduct?.id] || 0);
  const quoteUsd = selectedProduct ? Number((total * (1 - selectedMargin / 100)).toFixed(2)) : 0;
  const ada = price && quoteUsd ? (quoteUsd / price.price).toFixed(6) : "0.000000";
  const customUsdNumber = Number(customUsd);
  const customAdaQuote = price && Number.isFinite(customUsdNumber) && customUsdNumber > 0 ? customUsdNumber / price.price : 0;

  async function loadOrders() {
    if (!user) {
      return;
    }
    const payload = await api("/api/orders/my");
    setOrders(payload.orders);
  }

  useEffect(() => {
    loadOrders().catch(() => {});
  }, [user]);

  async function checkout() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const payload = await api("/api/orders", {
        method: "POST",
        body: {
          items: cartItems.map((item) => ({ productId: item.id, quantity: item.quantity }))
        }
      });
      setStatus(`Order ${payload.order.publicId} received`);
      setPaymentUrl(payload.order.paymentUrl || "");
      if (payload.order.paymentUrl) {
        window.location.href = payload.order.paymentUrl;
      }
      setCart({});
      await loadOrders();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function buyCustomAda() {
    setBusy(true);
    setError("");
    setStatus("");
    setPaymentUrl("");
    try {
      const payload = await api("/api/orders/custom", {
        method: "POST",
        body: {
          adaAmount: Number(customAdaQuote.toFixed(6))
        }
      });
      setStatus(`Order ${payload.order.publicId} received`);
      setPaymentUrl(payload.order.paymentUrl || "");
      if (payload.order.paymentUrl) {
        window.location.href = payload.order.paymentUrl;
      }
      setCustomUsd("");
      await loadOrders();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOrders([]);
  }

  return (
    <aside className={classNames("cart-panel", `mode-${orderMode}`)} id="order-desk">
      <div className="section-title">
        <ShoppingCart size={18} />
        <span>Order desk</span>
      </div>

      <div className="segmented full" aria-label="Order type">
        <button className={orderMode === "custom" ? "active" : ""} type="button" onClick={() => setOrderMode("custom")}>
          Custom ADA
        </button>
        <button className={orderMode === "voucher" ? "active" : ""} type="button" onClick={() => setOrderMode("voucher")}>
          Voucher
        </button>
      </div>

      {orderMode === "voucher" && (
        <div className="cart-lines">
          {cartItems.length === 0 && <p className="muted">Select one voucher to build a live ADA quote.</p>}
          {cartItems.map((item) => (
            <div className="cart-line" key={item.id}>
              <span>{item.name}</span>
              <strong>{currency.format(item.lineTotal)}</strong>
            </div>
          ))}
        </div>
      )}

      {orderMode === "voucher" && (
        <div className="quote-total ada-focus">
          <span>ADA quote</span>
          <strong>{ada} ADA</strong>
          <small>{currency.format(quoteUsd)} quoted from {currency.format(total)} voucher at Binance live price</small>
        </div>
      )}

      {orderMode === "custom" && (
        <div className="custom-buy-panel">
          <div className="mini-heading">Custom ADA buy</div>
          <label>
            USD amount
            <input
              type="number"
              min="1"
              step="0.01"
              value={customUsd}
              onChange={(event) => setCustomUsd(event.target.value)}
              placeholder="100.00"
            />
          </label>
          <div className="quote-total ada-focus">
            <span>ADA quote</span>
            <strong>{customAdaQuote > 0 ? customAdaQuote.toFixed(6) : "0.000000"} ADA</strong>
            <small>{currency.format(customUsdNumber || 0)} at Binance live price</small>
          </div>
        </div>
      )}

      {!user ? (
        <AuthPanel mode={authMode} setMode={setAuthMode} onAuth={setUser} />
      ) : (
        <div className="signed-in">
          <p className="muted wallet-note">{maskWallet(user.walletAddress)}</p>
          {error && <p className="form-error">{error}</p>}
          {status && <p className="form-success">{status}</p>}
          {orderMode === "voucher" && (
            <button className="primary-button" type="button" onClick={checkout} disabled={busy || cartItems.length === 0}>
              <WalletCards size={17} />
              {busy ? "Sending" : "Buy with PayPal"}
            </button>
          )}
          {orderMode === "custom" && (
            <button className="primary-button" type="button" disabled>
              <ExternalLink size={17} />
              Coming Soon
            </button>
          )}
        </div>
      )}

      {!user && orderMode === "custom" && <p className="muted">Register with your wallet before continuing to PayPal.</p>}

      {user && (
        <div className="recent-orders" id="customer-orders">
          <div className="mini-heading">Your orders</div>
          {orders.length === 0 && <p className="muted">No previous orders yet.</p>}
          {orders.map((order) => (
            <div className="order-chip" key={order.id}>
              <span>{order.publicId}</span>
              <strong>{order.status} - {Number(order.adaAmount || 0).toFixed(4)} ADA</strong>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function Storefront({ state, setState, refreshPrice }) {
  const [theme, setTheme] = useState("arctic");
  const [cart, setCart] = useState({});
  const [orderMode, setOrderMode] = useState("custom");
  const content = contentFrom(state.settings);

  function setQuantity(productId, quantity) {
    setCart(quantity > 0 ? { [productId]: 1 } : {});
    if (quantity > 0) {
      setOrderMode("voucher");
      if (window.innerWidth <= 700) {
        setTimeout(() => document.getElementById("order-desk")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
      }
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setState((current) => ({ ...current, user: null }));
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app-shell storefront">
      <header className="topbar">
        <Brand subtitle={content.brandSubtitle || "ADA Voucher Store"} />
        <nav>
          {state.user ? (
            <AccountMenu user={state.user} theme={theme} setTheme={setTheme} onLogout={logout} />
          ) : (
            <span className="muted">Wallet checkout</span>
          )}
        </nav>
      </header>

      <main className="store-layout">
        <section className="store-main">
          <div className="store-hero">
            <div className="hero-copy">
              {content.heroEyebrow && <span className="eyebrow">{content.heroEyebrow}</span>}
              <h1>{content.heroTitle || "CardanoMix"}</h1>
              <p>{content.heroBody || "Buy Cardano with vouchers — simple checkout, customer account, and live ADA pricing based on Binance."}</p>
              <PriceBadge price={state.price} onRefresh={refreshPrice} />
            </div>
            <img className="hero-asset" src="/assets/voucher-stack.svg" alt="Stacked ADA voucher cards" />
          </div>

          {state.error && (
            <div className="system-alert">
              <AlertTriangle size={18} />
              <span>{state.error}</span>
            </div>
          )}

          <div className="product-grid">
            {state.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                adaPrice={state.price}
                marginPercent={Number(state.settings?.settings?.productMargins?.[product.id] || 0)}
                quantity={cart[product.id] || 0}
                setQuantity={setQuantity}
              />
            ))}
          </div>
        </section>

        <CartPanel
          products={state.products}
          cart={cart}
          price={state.price}
          user={state.user}
          settings={state.settings}
          orderMode={orderMode}
          setOrderMode={setOrderMode}
          setUser={(user) => setState((current) => ({ ...current, user }))}
          setCart={setCart}
        />
      </main>
      <Footer settings={state.settings} />
    </div>
  );
}

function Footer({ settings }) {
  const legalNotice = contentFrom(settings).legalNotice || DEFAULT_LEGAL_NOTICE;
  return (
    <footer className="site-footer">
      <details className="legal-copy">
        <summary>Terms, Privacy, Risk & Liability Notice</summary>
        {legalNotice.split("\n\n").filter(Boolean).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </details>
    </footer>
  );
}

function AdminLogin({ setUser }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await api("/api/admin/login", {
        method: "POST",
        body: form
      });
      setUser(payload.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <Brand />
      <form className="auth-panel admin-auth" onSubmit={submit}>
        <div className="section-title">
          <ShieldCheck size={18} />
          <span>Admin login</span>
        </div>
        <label>
          Email
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={10} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">
          <LockKeyhole size={17} />
          {busy ? "Checking" : "Enter dashboard"}
        </button>
      </form>
    </div>
  );
}

function StatusPill({ value }) {
  const icon = value === "completed" ? <CheckCircle2 size={14} /> : <Activity size={14} />;
  return <span className={classNames("status-pill", value)}>{icon}{value}</span>;
}

function exportOrdersCsv(orders) {
  const headers = ["Order", "Name", "Wallet", "Timestamp", "Voucher Amount USD", "Quote USD", "Quoted ADA", "Margin %", "Status", "Payment URL"];
  const rows = orders.map((order) => [
    order.publicId,
    order.customer?.name || "",
    order.customer?.walletAddress || order.customer?.email || "",
    order.createdAt,
    order.voucherAmountUsd ?? order.totalUsd ?? order.totalEur ?? 0,
    order.quoteUsd ?? order.totalUsd ?? order.totalEur ?? 0,
    order.adaAmount || 0,
    order.marginPercent || 0,
    order.status,
    order.paymentUrl || ""
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cardanomix-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function AdminSettingsPanel({ settings, setSettings, paypalConfigured, products }) {
  const [draft, setDraft] = useState(settings || {});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(settings || {});
  }, [settings]);

  async function saveSettings(event) {
    event.preventDefault();
    setStatus("");
    setError("");
    try {
      const payload = await api("/api/admin/settings", {
        method: "PATCH",
        body: {
          paypalReturnUrl: draft.paypalReturnUrl || "",
          paypalCancelUrl: draft.paypalCancelUrl || "",
          paypalFallbackUrl: draft.paypalFallbackUrl || "",
          customAdaPayPalLink: draft.customAdaPayPalLink || "",
          productPayPalLinks: draft.productPayPalLinks || {},
          productMargins: Object.fromEntries(
            products.map((product) => [product.id, Number(draft.productMargins?.[product.id] || 0)])
          ),
          textContent: {
            brandSubtitle: draft.textContent?.brandSubtitle || "",
            heroEyebrow: draft.textContent?.heroEyebrow || "",
            heroTitle: draft.textContent?.heroTitle || "",
            heroBody: draft.textContent?.heroBody || "",
            legalNotice: draft.textContent?.legalNotice || ""
          },
          autoRedirectPayPal: Boolean(draft.autoRedirectPayPal)
        }
      });
      setSettings(payload.settings);
      setStatus("PayPal links updated");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <form className="settings-panel" onSubmit={saveSettings}>
      <div className="table-head">
        <h2>PayPal routing</h2>
        <span className={classNames("status-pill", paypalConfigured ? "completed" : "cancelled")}>
          {paypalConfigured ? "API ready" : "Fallback only"}
        </span>
      </div>
      <div className="settings-grid">
        <label>
          Return URL
          <input value={draft.paypalReturnUrl || ""} onChange={(event) => setDraft({ ...draft, paypalReturnUrl: event.target.value })} />
        </label>
        <label>
          Cancel URL
          <input value={draft.paypalCancelUrl || ""} onChange={(event) => setDraft({ ...draft, paypalCancelUrl: event.target.value })} />
        </label>
        <label>
          Manual PayPal fallback link
          <input value={draft.paypalFallbackUrl || ""} onChange={(event) => setDraft({ ...draft, paypalFallbackUrl: event.target.value })} />
        </label>
        <label>
          Custom ADA PayPal link
          <input value={draft.customAdaPayPalLink || ""} onChange={(event) => setDraft({ ...draft, customAdaPayPalLink: event.target.value })} />
        </label>
        {products.map((product) => (
          <label key={product.id}>
            {product.name} PayPal link
            <input
              value={draft.productPayPalLinks?.[product.id] || ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  productPayPalLinks: {
                    ...(draft.productPayPalLinks || {}),
                    [product.id]: event.target.value
                  }
                })
              }
            />
          </label>
        ))}
        {products.map((product) => (
          <label key={`${product.id}-margin`}>
            {product.name} margin %
            <input
              type="number"
              min="0"
              max="95"
              step="0.1"
              value={draft.productMargins?.[product.id] || 0}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  productMargins: {
                    ...(draft.productMargins || {}),
                    [product.id]: Number(event.target.value)
                  }
                })
              }
            />
          </label>
        ))}
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={Boolean(draft.autoRedirectPayPal)}
            onChange={(event) => setDraft({ ...draft, autoRedirectPayPal: event.target.checked })}
          />
          Auto redirect after order
        </label>
      </div>
      <div className="settings-grid text-settings">
        <label>
          Brand subtitle
          <input
            value={draft.textContent?.brandSubtitle || ""}
            onChange={(event) => setDraft({ ...draft, textContent: { ...(draft.textContent || {}), brandSubtitle: event.target.value } })}
          />
        </label>
        <label>
          Hero eyebrow
          <input
            value={draft.textContent?.heroEyebrow || ""}
            onChange={(event) => setDraft({ ...draft, textContent: { ...(draft.textContent || {}), heroEyebrow: event.target.value } })}
            placeholder="Leave empty to hide"
          />
        </label>
        <label>
          Hero title
          <input
            value={draft.textContent?.heroTitle || ""}
            onChange={(event) => setDraft({ ...draft, textContent: { ...(draft.textContent || {}), heroTitle: event.target.value } })}
          />
        </label>
        <label>
          Hero body
          <textarea
            value={draft.textContent?.heroBody || ""}
            onChange={(event) => setDraft({ ...draft, textContent: { ...(draft.textContent || {}), heroBody: event.target.value } })}
          />
        </label>
        <label className="wide-field">
          Footer legal notice
          <textarea
            value={draft.textContent?.legalNotice || ""}
            onChange={(event) => setDraft({ ...draft, textContent: { ...(draft.textContent || {}), legalNotice: event.target.value } })}
            rows={8}
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {status && <p className="form-success">{status}</p>}
      <button className="ghost-button" type="submit">
        <Save size={16} />
        Save PayPal links
      </button>
    </form>
  );
}

function AdminDashboard({ state, setState, refreshPrice }) {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [paypalConfigured, setPaypalConfigured] = useState(false);
  const [adminTheme, setAdminTheme] = useState("midnight");
  const [error, setError] = useState("");

  async function loadAdmin() {
    try {
      const [ordersPayload, summaryPayload, settingsPayload] = await Promise.all([
        api("/api/admin/orders"),
        api("/api/admin/summary"),
        api("/api/admin/settings")
      ]);
      setOrders(ordersPayload.orders);
      setSummary(summaryPayload);
      setSettings(settingsPayload.settings);
      setPaypalConfigured(Boolean(settingsPayload.paypalConfigured));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = adminTheme;
  }, [adminTheme]);

  useEffect(() => {
    loadAdmin();
  }, []);

  async function setOrderStatus(orderId, status) {
    const payload = await api(`/api/admin/orders/${orderId}`, {
      method: "PATCH",
      body: { status }
    });
    setOrders((current) => current.map((order) => (order.id === orderId ? payload.order : order)));
    await loadAdmin();
  }

  async function deleteOrder(orderId) {
    if (!window.confirm("Delete this order permanently?")) {
      return;
    }
    await api(`/api/admin/orders/${orderId}`, { method: "DELETE" });
    await loadAdmin();
  }

  async function syncOrder(orderId) {
    await api(`/api/admin/orders/${orderId}/sync`, { method: "POST" });
    await loadAdmin();
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setState((current) => ({ ...current, user: null }));
  }

  return (
    <div className="app-shell admin-shell">
      <header className="topbar">
        <Brand />
        <nav>
          <a href="/">Store</a>
          <ThemeSwitch theme={adminTheme} setTheme={setAdminTheme} />
          <button className="ghost-button" onClick={logout} type="button">
            <LogOut size={16} />
            Logout
          </button>
        </nav>
      </header>

      <main className="admin-layout">
        <section className="admin-heading">
          <div>
            <span className="eyebrow">Midnight control room</span>
            <h1>Operations</h1>
          </div>
          <PriceBadge price={state.price} onRefresh={refreshPrice} />
        </section>

        {error && (
          <div className="system-alert dark">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="metric-grid">
          <div className="metric-card">
            <LayoutDashboard size={20} />
            <span>Orders</span>
            <strong>{summary?.summary.orderCount || 0}</strong>
          </div>
          <div className="metric-card">
            <WalletCards size={20} />
            <span>Revenue</span>
            <strong>{currency.format(summary?.summary.revenueUsd || 0)}</strong>
          </div>
          <div className="metric-card">
            <Activity size={20} />
            <span>ADA quoted</span>
            <strong>{(summary?.summary.adaQuoted || 0).toFixed(4)}</strong>
          </div>
          <div className="metric-card">
            <ShieldCheck size={20} />
            <span>Storage</span>
            <strong>{summary?.database || "Ready"}</strong>
          </div>
        </section>

        {settings && (
          <AdminSettingsPanel settings={settings} setSettings={setSettings} paypalConfigured={paypalConfigured} products={state.products} />
        )}

        <section className="orders-table-wrap">
          <div className="table-head">
            <h2>Orders</h2>
            <div className="table-actions">
              <button className="ghost-button" onClick={() => exportOrdersCsv(orders)} type="button" disabled={orders.length === 0}>
                <Download size={16} />
                Export CSV
              </button>
              <button className="ghost-button" onClick={loadAdmin} type="button">
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
          </div>
          <div className="orders-table">
            <div className="orders-row header">
              <span>Order</span>
              <span>Name</span>
              <span>Wallet</span>
              <span>Timestamp</span>
              <span>Voucher</span>
              <span>Quoted ADA</span>
              <span>Status / payment</span>
            </div>
            {orders.map((order) => (
              <div className="orders-row" key={order.id}>
                <span>{order.publicId}</span>
                <span>{order.customer?.name || "Unknown"}</span>
                <span className="wallet-text">{order.customer?.walletAddress || order.customer?.email || "Unknown"}</span>
                <span>{new Date(order.createdAt).toLocaleString()}</span>
                <span>{currency.format(order.voucherAmountUsd ?? order.totalUsd ?? order.totalEur ?? 0)}</span>
                <span>{Number(order.adaAmount || 0).toFixed(6)}</span>
                <span className="status-cell">
                  <StatusPill value={order.status} />
                  <select value={order.status} onChange={(event) => setOrderStatus(order.id, event.target.value)} aria-label={`Set status for ${order.publicId}`}>
                    <option value="new">new</option>
                    <option value="reviewing">reviewing</option>
                    <option value="completed">completed</option>
                    <option value="cancelled">cancelled</option>
                  </select>
                  {order.paymentUrl && (
                    <a className="icon-button" href={order.paymentUrl} target="_blank" rel="noreferrer" aria-label="Open PayPal link" title="Open PayPal link">
                      <ExternalLink size={15} />
                    </a>
                  )}
                  <button className="icon-button" type="button" onClick={() => syncOrder(order.id)} aria-label={`Sync ${order.publicId}`} title="Sync payment">
                    <RefreshCw size={15} />
                  </button>
                  <button className="icon-button danger" type="button" onClick={() => deleteOrder(order.id)} aria-label={`Delete ${order.publicId}`} title="Delete order">
                    <Trash2 size={15} />
                  </button>
                </span>
              </div>
            ))}
            {orders.length === 0 && <div className="empty-table">No orders yet.</div>}
          </div>
        </section>
      </main>
    </div>
  );
}

function App() {
  const [state, setState, refreshPrice] = useBootstrap();
  const isAdminPath = window.location.pathname.startsWith("/admin");

  if (state.loading) {
    return (
      <div className="loading-screen">
        <Brand compact />
        <span>Loading CardanoMix</span>
      </div>
    );
  }

  if (isAdminPath) {
    if (!state.user || state.user.role !== "admin") {
      document.documentElement.dataset.theme = "midnight";
      return <AdminLogin setUser={(user) => setState((current) => ({ ...current, user }))} />;
    }
    return <AdminDashboard state={state} setState={setState} refreshPrice={refreshPrice} />;
  }

  return <Storefront state={state} setState={setState} refreshPrice={refreshPrice} />;
}

createRoot(document.getElementById("root")).render(<App />);
