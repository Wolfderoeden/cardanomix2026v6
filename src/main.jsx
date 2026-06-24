import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Snowflake,
  UserRound,
  WalletCards
} from "lucide-react";
import "./styles.css";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR"
});

function classNames(...values) {
  return values.filter(Boolean).join(" ");
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
        const [me, products, price, health] = await Promise.all([
          api("/api/auth/me"),
          api("/api/products"),
          api("/api/price/ada"),
          api("/api/health")
        ]);
        if (!cancelled) {
          setState({
            user: me.user,
            products: products.products,
            price: price.price,
            health,
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

function Brand({ compact = false }) {
  return (
    <a className="brand" href="/" aria-label="CardanoMix Store">
      <img src="/assets/cardanomix-mark.svg" alt="" />
      {!compact && (
        <span>
          <strong>CardanoMix</strong>
          <small>ADA Voucher Store</small>
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

function AuthPanel({ mode, setMode, onAuth }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
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
        {busy ? "Working" : mode === "register" ? "Register" : "Login"}
      </button>
      <button className="text-button" type="button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
        {mode === "register" ? "Already registered" : "Create customer account"}
      </button>
    </form>
  );
}

function ProductCard({ product, adaPrice, quantity, setQuantity }) {
  const adaAmount = adaPrice ? (product.priceEur / adaPrice.price).toFixed(4) : "0.0000";
  return (
    <article className={classNames("product-card", product.tone)}>
      <div className="voucher-face">
        <span>{product.tier}</span>
        <strong>{product.name}</strong>
      </div>
      <div className="product-copy">
        <p>{product.description}</p>
        <div className="product-meta">
          <span>{currency.format(product.priceEur)}</span>
          <span>{adaAmount} ADA</span>
        </div>
      </div>
      <div className="stepper">
        <button type="button" aria-label={`Decrease ${product.name}`} onClick={() => setQuantity(product.id, Math.max(0, quantity - 1))}>
          -
        </button>
        <output>{quantity}</output>
        <button type="button" aria-label={`Increase ${product.name}`} onClick={() => setQuantity(product.id, quantity + 1)}>
          +
        </button>
      </div>
    </article>
  );
}

function CartPanel({ products, cart, price, user, setUser, setCart }) {
  const [authMode, setAuthMode] = useState("register");
  const [orders, setOrders] = useState([]);
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
          lineTotal: product.priceEur * cart[product.id]
        })),
    [cart, products]
  );
  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const ada = price && total ? (total / price.price).toFixed(6) : "0.000000";

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
      setCart({});
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
    <aside className="cart-panel">
      <div className="section-title">
        <ShoppingCart size={18} />
        <span>Order desk</span>
      </div>

      <div className="cart-lines">
        {cartItems.length === 0 && <p className="muted">Select vouchers to build a live ADA quote.</p>}
        {cartItems.map((item) => (
          <div className="cart-line" key={item.id}>
            <span>{item.quantity} x {item.name}</span>
            <strong>{currency.format(item.lineTotal)}</strong>
          </div>
        ))}
      </div>

      <div className="quote-total">
        <span>Total</span>
        <strong>{currency.format(total)}</strong>
        <small>{ada} ADA at Binance live price</small>
      </div>

      {!user ? (
        <AuthPanel mode={authMode} setMode={setAuthMode} onAuth={setUser} />
      ) : (
        <div className="signed-in">
          <div className="signed-user">
            <UserRound size={18} />
            <span>{user.name}</span>
            <button className="icon-button" type="button" onClick={logout} aria-label="Logout" title="Logout">
              <LogOut size={15} />
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          {status && <p className="form-success">{status}</p>}
          <button className="primary-button" type="button" onClick={checkout} disabled={busy || cartItems.length === 0}>
            <WalletCards size={17} />
            {busy ? "Sending" : "Place order"}
          </button>
        </div>
      )}

      {orders.length > 0 && (
        <div className="recent-orders">
          <div className="mini-heading">Recent orders</div>
          {orders.slice(0, 3).map((order) => (
            <div className="order-chip" key={order.id}>
              <span>{order.publicId}</span>
              <strong>{order.status}</strong>
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

  function setQuantity(productId, quantity) {
    setCart((current) => ({
      ...current,
      [productId]: Math.min(20, Math.max(0, quantity))
    }));
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app-shell storefront">
      <header className="topbar">
        <Brand />
        <nav>
          <a href="/admin">Admin</a>
          <ThemeSwitch theme={theme} setTheme={setTheme} />
        </nav>
      </header>

      <main className="store-layout">
        <section className="store-main">
          <div className="store-hero">
            <div className="hero-copy">
              <span className="eyebrow">Live ADA vouchers</span>
              <h1>CardanoMix</h1>
              <p>Clean voucher checkout with direct customer accounts, Binance-priced ADA quotes, and instant order notification.</p>
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
          setUser={(user) => setState((current) => ({ ...current, user }))}
          setCart={setCart}
        />
      </main>
    </div>
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

function AdminDashboard({ state, setState, refreshPrice }) {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  async function loadAdmin() {
    try {
      const [ordersPayload, summaryPayload] = await Promise.all([api("/api/admin/orders"), api("/api/admin/summary")]);
      setOrders(ordersPayload.orders);
      setSummary(summaryPayload);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = "midnight";
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
            <strong>{currency.format(summary?.summary.revenueEur || 0)}</strong>
          </div>
          <div className="metric-card">
            <Activity size={20} />
            <span>ADA quoted</span>
            <strong>{(summary?.summary.adaQuoted || 0).toFixed(4)}</strong>
          </div>
          <div className="metric-card">
            <ShieldCheck size={20} />
            <span>Gmail</span>
            <strong>{summary?.mailerConfigured ? "Ready" : "Missing"}</strong>
          </div>
        </section>

        <section className="orders-table-wrap">
          <div className="table-head">
            <h2>Orders</h2>
            <button className="ghost-button" onClick={loadAdmin} type="button">
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
          <div className="orders-table">
            <div className="orders-row header">
              <span>Order</span>
              <span>Customer</span>
              <span>Total</span>
              <span>ADA</span>
              <span>Email</span>
              <span>Status</span>
            </div>
            {orders.map((order) => (
              <div className="orders-row" key={order.id}>
                <span>{order.publicId}</span>
                <span>{order.customer.email}</span>
                <span>{currency.format(order.totalEur)}</span>
                <span>{order.adaAmount}</span>
                <span>{order.emailDelivery?.status || "pending"}</span>
                <span className="status-cell">
                  <StatusPill value={order.status} />
                  <select value={order.status} onChange={(event) => setOrderStatus(order.id, event.target.value)} aria-label={`Set status for ${order.publicId}`}>
                    <option value="new">new</option>
                    <option value="reviewing">reviewing</option>
                    <option value="completed">completed</option>
                    <option value="cancelled">cancelled</option>
                  </select>
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
