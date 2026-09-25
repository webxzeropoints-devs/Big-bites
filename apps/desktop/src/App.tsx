import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./App.css";

const API_URL = "https://big-bites-server.onrender.com";

type Screen = "billing" | "admin";
type User = { id: number; name: string; username: string; role: string };
type Category = { id: number; name: string; _count?: { products: number } };
type Product = {
  id: number;
  name: string;
  price: number | string;
  stock: number;
  isActive: boolean;
  categoryId: number;
  category?: { id: number; name: string };
};
type Table = { id: number; number: number; status: string; isParcel?: boolean };
type OrderItem = {
  id: number;
  quantity: number;
  unitPrice: string | number;
  subtotal: string | number;
  product: { name: string };
};
type Order = {
  id: number;
  status: string;
  total: string | number;
  createdAt: string;
  table: { id?: number; number: number; isParcel?: boolean };
  items: OrderItem[];
  payment?: { method: string; status: string; paidAt?: string | null } | null;
};
type Dashboard = {
  openOrders: number;
  completedOrders: number;
  revenue: number;
  activeProducts: number;
  totalCategories: number;
  totalTables: number;
  availableTables: number;
  occupiedTables: number;
};

const tableLabel = (table: { number: number; isParcel?: boolean }) =>
  table.isParcel ? "Parcel" : `Table ${table.number}`;

const money = (value: string | number) => `₹${Number(value).toFixed(2)}`;

async function request(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "Request failed");
  return data;
}

function App() {
  const [screen, setScreen] = useState<Screen>("billing");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);

  if (!token || !user) {
    return (
      <Login
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setUser(nextUser);
          setScreen(nextUser.role === "ADMIN" || nextUser.role === "MANAGER" ? "admin" : "billing");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">BIG BITES</div>
          <h1>Billing & Administration</h1>
          <span className="user-role">{user.name} · {user.role}</span>
        </div>
        <nav className="top-nav">
          <button
            className={screen === "billing" ? "nav-btn active" : "nav-btn"}
            onClick={() => setScreen("billing")}
          >
            Billing
          </button>
          {(user.role === "ADMIN" || user.role === "MANAGER") && (
            <button
              className={screen === "admin" ? "nav-btn active" : "nav-btn"}
              onClick={() => setScreen("admin")}
            >
              Admin
            </button>
          )}
          <button
            className="nav-btn ghost"
            onClick={() => {
              setToken("");
              setUser(null);
            }}
          >
            Logout
          </button>
        </nav>
      </header>

      {screen === "billing" ? <BillingScreen token={token} /> : <AdminScreen token={token} />}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-block">
          <div className="brand-circle">BB</div>
          <div>
            <div className="eyebrow">BIG BITES</div>
            <h1>Welcome back</h1>
          </div>
        </div>

        <label>
          Username
          <input
            value={username}
            placeholder="Enter username"
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            placeholder="Enter password"
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button className="primary-btn full" disabled={loading} type="submit">
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </main>
  );
}

function ReceiptPreview({
  order,
  onClose,
  onProceedToPayment,
}: {
  order: Order;
  onClose: () => void;
  onProceedToPayment?: () => void;
}) {
  const paid = order.payment?.status === "PAID" || order.status === "COMPLETED";

  return (
    <div className="receipt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="receipt-dialog">
        <div className="receipt-actions no-print">
          {onProceedToPayment && (
            <button className="primary-btn" onClick={onProceedToPayment}>
              Proceed to payment
            </button>
          )}
          <button className="secondary-btn" onClick={() => window.print()}>
            Print bill
          </button>
          <button className="secondary-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <article className="thermal-receipt" id="receipt-to-print">
          <div className="receipt-header">
            <h2>BIG BITES</h2>
            <p>Hotel Restaurant</p>
          </div>

          <div className="receipt-meta">
            <div>
              <span>Table</span>
              <strong>{order.table.isParcel ? "Parcel" : `Table ${order.table.number}`}</strong>
            </div>
            <div>
              <span>Order</span>
              <strong>#{order.id}</strong>
            </div>
          </div>

          <hr />

          <div className="receipt-row receipt-heading">
            <span>Item</span>
            <span>Qty</span>
            <span>Amt</span>
          </div>

          {order.items.map((item) => (
            <div className="receipt-row" key={item.id}>
              <span>
                {item.product.name}
                <small>{money(item.unitPrice)} each</small>
              </span>
              <span>{item.quantity}</span>
              <span>{money(item.subtotal)}</span>
            </div>
          ))}

          <hr />

          <div className="receipt-total">
            <span>Total</span>
            <strong>{money(order.total)}</strong>
          </div>

          <p>Payment: {paid ? order.payment?.method ?? "PAID" : "UNPAID"}</p>
          <p>Status: {paid ? "PAID" : "UNPAID"}</p>
          <hr />
          <h3>Thank you!</h3>
          <p>Visit again</p>
        </article>
      </div>
    </div>
  );
}

function BillingScreen({ token }: { token: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [completed, setCompleted] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [method, setMethod] = useState("CASH");
  const [amountReceived, setAmountReceived] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [preview, setPreview] = useState<Order | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState<"active" | "completed" | "all">("active");

  async function load() {
    try {
      const [active, done] = await Promise.all([
        request("/api/billing/orders", {}, token),
        request("/api/billing/completed", {}, token),
      ]);
      setOrders(active);
      setCompleted(done);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load billing orders");
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [token]);

  const visibleOrders = useMemo(() => {
    const source =
      orderFilter === "completed"
        ? completed
        : orderFilter === "all"
          ? [...orders, ...completed]
          : orders;
    const query = orderQuery.trim().toLowerCase();
    if (!query) return source;
    return source.filter((order) =>
      [`${order.id}`, tableLabel(order.table), order.status]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [completed, orderFilter, orderQuery, orders]);

  async function pay() {
    if (!selected) return;

    const received = method === "CASH" ? Number(amountReceived) : 0;
    if (method === "CASH" && (!Number.isFinite(received) || received < Number(selected.total))) {
      setError(`Amount received must be at least ${money(selected.total)}.`);
      return;
    }

    try {
      const result = await request(
        `/api/billing/orders/${selected.id}/pay`,
        {
          method: "POST",
          body: JSON.stringify({ method, amountReceived: received }),
        },
        token,
      );

      const paidOrder = { ...selected, status: "COMPLETED", payment: result.payment };
      setSuccess(`Payment successful. Order #${selected.id} is completed.`);
      setSelected(null);
      setShowPayment(false);
      setAmountReceived("");
      await load();
      setPreview(paidOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    }
  }

  return (
    <main className="content-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Cashier desk</div>
          <h2>Billing</h2>
          <p className="page-subtitle">Manage orders and process payments.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="billing-layout">
        <aside className="panel order-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Open orders</div>
              <h3>Active bills</h3>
            </div>
            <span className="pill dark">{orders.length}</span>
          </div>
          <div className="toolbar">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                value={orderQuery}
                onChange={(event) => setOrderQuery(event.target.value)}
                placeholder="Search orders..."
                aria-label="Search orders"
              />
            </label>
            <div className="segmented-control" aria-label="Order filter">
              {(["active", "completed", "all"] as const).map((filter) => (
                <button
                  key={filter}
                  className={orderFilter === filter ? "active" : ""}
                  onClick={() => setOrderFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {visibleOrders.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">B</div>
              <h4>No matching orders</h4>
            </div>
          ) : (
            <div className="order-list">
              {visibleOrders.map((order) => (
                <button
                  key={order.id}
                  className={selected?.id === order.id ? "order-card selected" : "order-card"}
                  onClick={() => {
                    setSelected(order);
                    setShowPayment(false);
                    setError("");
                  }}
                >
                  <div className="order-card-top">
                    <div>
                      <span className="label">Order #{order.id}</span>
                      <h4>{tableLabel(order.table)}</h4>
                    </div>
                    <span className="status-pill pending">{order.status}</span>
                  </div>

                  <div className="order-card-grid">
                    <div>
                      <span>Items</span>
                      <strong>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</strong>
                    </div>
                    <div>
                      <span>Time</span>
                      <strong>{new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{money(order.total)}</strong>
                    </div>
                  </div>

                  <div className="card-actions">
                    <span className="text-link">Open bill</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="panel bill-panel">
          {!selected ? (
            <div className="bill-placeholder">
              <div className="placeholder-icon">P</div>
              <h3>Select an order</h3>
              <p>Choose an unpaid order to review, confirm payment, and print the receipt.</p>
            </div>
          ) : (
            <>
              <div className="bill-header">
                <div>
                  <span>Order · {new Date(selected.createdAt).toLocaleString()}</span>
                  <h3>#{selected.id}</h3>
                </div>
                <span className="pill neutral">{tableLabel(selected.table).toUpperCase()}</span>
              </div>

              <div className="bill-items">
                {selected.items.map((item) => (
                  <div className="bill-item" key={item.id}>
                    <div>
                      <strong>{item.product.name}</strong>
                      <span>
                        {item.quantity} × {money(item.unitPrice)}
                      </span>
                    </div>
                    <strong>{money(item.subtotal)}</strong>
                  </div>
                ))}
              </div>

              <div className="bill-total-row">
                <span>Grand total</span>
                <strong>{money(selected.total)}</strong>
              </div>

              <div className="action-row">
                <button className="secondary-btn" onClick={() => setPreview(selected)}>
                  View bill
                </button>
              </div>

              {!showPayment ? (
                <button className="primary-btn full" onClick={() => setShowPayment(true)}>
                  Proceed to payment
                </button>
              ) : (
                <div className="payment-box">
                  <h4>Payment details</h4>
                  <div className="due-amount">Amount due: {money(selected.total)}</div>

                  <div className="payment-methods">
                    {["CASH", "UPI", "CARD"].map((value) => (
                      <button
                        key={value}
                        className={method === value ? "method-btn active" : "method-btn"}
                        onClick={() => setMethod(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>

                  {method === "CASH" && (
                    <label className="money-input">
                      Amount received
                      <input
                        type="number"
                        min={Number(selected.total)}
                        step="0.01"
                        value={amountReceived}
                        onChange={(event) => setAmountReceived(event.target.value)}
                      />
                      {amountReceived && Number(amountReceived) >= Number(selected.total) && (
                        <strong>Change: {money(Number(amountReceived) - Number(selected.total))}</strong>
                      )}
                    </label>
                  )}

                  <button className="primary-btn full" onClick={() => void pay()}>
                    Confirm {method} payment
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <section className="panel full-span">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Receipt history</div>
            <h3>Completed orders</h3>
          </div>
        </div>

        {completed.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-icon">OK</div>
            <h4>No completed orders yet</h4>
          </div>
        ) : (
          <div className="completed-list">
            {completed.slice(0, 10).map((order) => (
              <div className="completed-item" key={order.id}>
                <div>
                  <strong>
                    Order #{order.id} · {tableLabel(order.table)}
                  </strong>
                  <span>
                    {money(order.total)} · {order.payment?.method ?? "-"} · PAID
                  </span>
                </div>
                <button className="secondary-btn small" onClick={() => setPreview(order)}>
                  Print again
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {preview && (
        <ReceiptPreview
          order={preview}
          onClose={() => setPreview(null)}
          onProceedToPayment={
            preview.payment?.status === "PAID" || preview.status === "COMPLETED"
              ? undefined
              : () => {
                  setSelected(preview);
                  setPreview(null);
                  setShowPayment(true);
                }
          }
        />
      )}
    </main>
  );
}

function AdminScreen({ token }: { token: string }) {
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "tables" | "orders" | "payments" | "waiters" | "staff">("overview");
  const [dashboard, setDashboard] = useState<Dashboard>({
    openOrders: 0,
    completedOrders: 0,
    revenue: 0,
    activeProducts: 0,
    totalCategories: 0,
    totalTables: 0,
    availableTables: 0,
    occupiedTables: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [staffUsers, setStaffUsers] = useState<User[]>([]);
  const [waiters, setWaiters] = useState<User[]>([]);
  const [waiterError, setWaiterError] = useState("");
  const [waitersLoading, setWaitersLoading] = useState(false);
  const [error, setError] = useState("");
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingWaiter, setEditingWaiter] = useState<User | null>(null);
  const [waiterForm, setWaiterForm] = useState({ name: "", username: "", password: "" });
  const [productForm, setProductForm] = useState({
    name: "",
    categoryId: "",
    price: "",
    stock: "",
    isActive: true,
  });
  const [productQuery, setProductQuery] = useState("");

  const load = async () => {
    try {
      const [dash, nextCategories, nextProducts, nextTables, nextOrders, nextPayments] = await Promise.all([
        request("/api/admin/dashboard", {}, token),
        request("/api/admin/categories", {}, token),
        request("/api/admin/products", {}, token),
        request("/api/admin/tables", {}, token),
        request("/api/admin/orders", {}, token),
        request("/api/admin/payments", {}, token),
      ]);

      setDashboard(dash);
      setCategories(nextCategories);
      setProducts(nextProducts);
      setTables(nextTables);
      setOrders(nextOrders);
      setPayments(nextPayments);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load admin data");
    }
  };

  const loadUsers = async () => {
    setWaitersLoading(true);
    try {
      const users: User[] = await request("/api/admin/users", {}, token);
      setStaffUsers(users);
      setWaiters(users.filter((user) => user.role === "WAITER"));
      setWaiterError("");
    } catch (err) {
      setWaiterError(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setWaitersLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    if (activeTab === "waiters" || activeTab === "staff") void loadUsers();
  }, [activeTab, token]);

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ value: String(category.id), label: category.name })),
    [categories],
  );

  const visibleProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, product.category?.name ?? "", String(product.id)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [productQuery, products]);

  const openCreateProduct = () => {
    setEditingProduct(null);
    setProductForm({
      name: "",
      categoryId: categoryOptions[0]?.value ?? "",
      price: "",
      stock: "",
      isActive: true,
    });
    setProductModalOpen(true);
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      categoryId: String(product.categoryId ?? product.category?.id ?? ""),
      price: String(product.price),
      stock: String(product.stock),
      isActive: Boolean(product.isActive),
    });
    setProductModalOpen(true);
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();

    const payload = {
      ...productForm,
      categoryId: Number(productForm.categoryId),
      price: Number(productForm.price),
      stock: Number(productForm.stock),
    };

    try {
      if (editingProduct) {
        await request(`/api/admin/products/${editingProduct.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }, token);
      } else {
        await request("/api/admin/products", {
          method: "POST",
          body: JSON.stringify(payload),
        }, token);
      }

      setProductModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save product");
    }
  };

  const deleteProduct = async (productId: number) => {
    try {
      await request(`/api/admin/products/${productId}`, { method: "DELETE" }, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete product");
    }
  };

  const saveTable = async (event: FormEvent) => {
    event.preventDefault();
    const number = Number(tableNumber);

    if (!Number.isInteger(number) || number <= 0) {
      setError("Enter a valid table number.");
      return;
    }

    try {
      await request(
        "/api/admin/tables",
        {
          method: "POST",
          body: JSON.stringify({ number }),
        },
        token,
      );
      setTableModalOpen(false);
      setTableNumber("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add table");
    }
  };

  const openCreateWaiter = () => {
    setEditingWaiter(null);
    setWaiterForm({ name: "", username: "", password: "" });
    setWaiterError("");
    setWaiterModalOpen(true);
  };

  const openEditUser = (user: User) => {
    setEditingWaiter(user);
    setWaiterForm({ name: user.name, username: user.username, password: "" });
    setWaiterError("");
    setWaiterModalOpen(true);
  };

  const closeWaiterModal = () => {
    setWaiterModalOpen(false);
    setEditingWaiter(null);
    setWaiterForm({ name: "", username: "", password: "" });
    setWaiterError("");
  };

  const saveWaiter = async (event: FormEvent) => {
    event.preventDefault();
    setWaiterError("");

    const payload = editingWaiter
      ? {
          name: waiterForm.name.trim(),
          username: waiterForm.username.trim(),
          ...(waiterForm.password ? { password: waiterForm.password } : {}),
        }
      : {
          name: waiterForm.name.trim(),
          username: waiterForm.username.trim(),
          password: waiterForm.password,
          role: "WAITER",
        };

    try {
      await request(
        editingWaiter ? `/api/admin/users/${editingWaiter.id}` : "/api/admin/users",
        {
          method: editingWaiter ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
        token,
      );
      closeWaiterModal();
      await loadUsers();
    } catch (err) {
      setWaiterError(err instanceof Error ? err.message : "Unable to save waiter");
    }
  };

  return (
    <main className="content-shell">
      <div className="page-header admin-header">
        <div>
          <div className="eyebrow">Operations</div>
          <h2>Admin dashboard</h2>
          <p className="page-subtitle">Here&apos;s what&apos;s happening at your restaurant today.</p>
        </div>
        <button className="secondary-btn" onClick={() => void load()}>
          Refresh data
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="sidebar-brand">
            <div className="brand-circle small">BB</div>
            <strong>BIG BITES</strong>
          </div>

          <div className="sidebar-nav">
            <button className={activeTab === "overview" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("overview")}>
              <span className="nav-icon">⌂</span> Overview
            </button>
            <button className={activeTab === "products" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("products")}>
              <span className="nav-icon">▦</span> Food Management
            </button>
            <button className={activeTab === "tables" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("tables")}>
              <span className="nav-icon">▤</span> Tables
            </button>
            <button className={activeTab === "orders" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("orders")}>
              <span className="nav-icon">≡</span> Orders
            </button>
            <button className={activeTab === "payments" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("payments")}>
              <span className="nav-icon">₹</span> Payments
            </button>
            <button className={activeTab === "waiters" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("waiters")}>
              <span className="nav-icon">♙</span> Waiters
            </button>
            <button className={activeTab === "staff" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("staff")}>
              <span className="nav-icon">♟</span> Staff Management
            </button>
          </div>
        </aside>

        <div className="admin-main">
          {activeTab === "overview" && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span>Active orders</span>
                  <strong>{dashboard.openOrders}</strong>
                </div>
                <div className="stat-card">
                  <span>Completed orders</span>
                  <strong>{dashboard.completedOrders}</strong>
                </div>
                <div className="stat-card">
                  <span>Today&apos;s sales</span>
                  <strong>{money(dashboard.revenue)}</strong>
                </div>
                <div className="stat-card">
                  <span>Available products</span>
                  <strong>{dashboard.activeProducts}</strong>
                </div>
              </div>

              <div className="admin-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">Inventory</div>
                      <h3>Table status</h3>
                    </div>
                  </div>

                  <div className="data-list">
                    {tables.map((table) => (
                      <div className="data-row" key={table.id}>
                        <strong>{table.isParcel ? "Parcel" : `Table ${table.number}`}</strong>
                        <span className={table.status === "AVAILABLE" ? "status-text success" : "status-text danger"}>{table.status}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel wide-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">History</div>
                      <h3>Recent orders</h3>
                    </div>
                  </div>

                  <div className="data-list">
                    {orders.slice(0, 8).map((order) => (
                      <div className="data-row" key={order.id}>
                        <strong>Order #{order.id} · {tableLabel(order.table)}</strong>
                        <span>
                          {order.status} · {money(order.total)} · {new Date(order.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}

          {activeTab === "products" && (
            <section className="panel product-panel">
              <div className="panel-heading product-heading">
                <div>
                  <div className="eyebrow">Food catalog</div>
                  <h3>Food &amp; products</h3>
                </div>
                <div className="page-actions">
                  <label className="search-field compact">
                    <span aria-hidden="true">⌕</span>
                    <input
                      value={productQuery}
                      onChange={(event) => setProductQuery(event.target.value)}
                      placeholder="Search food..."
                      aria-label="Search food"
                    />
                  </label>
                  <button className="primary-btn" onClick={openCreateProduct}>
                    + Add food
                  </button>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <div className="product-name-cell">
                            <div className="brand-circle small">FO</div>
                            <div>
                              <strong>{product.name}</strong>
                            </div>
                          </div>
                        </td>
                        <td>{product.category?.name ?? product.categoryId}</td>
                        <td>{money(product.price)}</td>
                        <td>{product.stock}</td>
                        <td>
                          <span className={product.isActive ? "status-text success" : "status-text danger"}>
                            {product.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            <button className="secondary-btn small" onClick={() => openEditProduct(product)}>
                              Edit
                            </button>
                            <button className="danger-btn small" onClick={() => void deleteProduct(product.id)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "tables" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Service floor</div>
                  <h3>Table overview</h3>
                </div>
                <button className="primary-btn" onClick={() => {
                  setTableNumber("");
                  setError("");
                  setTableModalOpen(true);
                }}>
                  Add table
                </button>
              </div>

              <div className="data-list">
                {tables.map((table) => (
                  <div className="data-row" key={table.id}>
                    <strong>{table.isParcel ? "Parcel" : `Table ${table.number}`}</strong>
                    <span className={table.status === "AVAILABLE" ? "status-text success" : "status-text danger"}>{table.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "orders" && (
            <section className="panel wide-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Transactions</div>
                  <h3>Order history</h3>
                </div>
              </div>

              <div className="data-list">
                {orders.slice(0, 20).map((order) => (
                  <div className="data-row" key={order.id}>
                    <strong>Order #{order.id} · {tableLabel(order.table)}</strong>
                    <span>
                      {order.status} · {money(order.total)} · {new Date(order.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "payments" && (
            <section className="panel wide-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Cash flow</div>
                  <h3>Payments</h3>
                </div>
              </div>

              <div className="data-list">
                {payments.slice(0, 20).map((payment) => (
                  <div className="data-row" key={payment.id}>
                    <strong>
                      Payment #{payment.id} · Order #{payment.orderId}
                    </strong>
                    <span>
                      {payment.method} · {payment.status} · {money(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "waiters" && (
            <section className="panel product-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Team access</div>
                  <h3>Waiter management</h3>
                </div>
                <button className="primary-btn" onClick={openCreateWaiter}>
                  + Add Waiter
                </button>
              </div>

              {waiterError && !waiterModalOpen && <div className="error-banner">{waiterError}</div>}

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiters.map((waiter) => (
                      <tr key={waiter.id}>
                        <td><strong>{waiter.name}</strong></td>
                        <td>{waiter.username}</td>
                        <td><span className="pill neutral">{waiter.role}</span></td>
                        <td>
                          <div className="table-actions">
                            <button className="secondary-btn small" onClick={() => openEditUser(waiter)}>
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!waitersLoading && waiters.length === 0 && !waiterError && (
                <div className="empty-state">
                  <h4>No waiters yet</h4>
                  <span>Add a waiter to give them access to the waiter app.</span>
                </div>
              )}
              {waitersLoading && <p className="page-subtitle">Loading waiters...</p>}
            </section>
          )}

          {activeTab === "staff" && (
            <section className="panel product-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Team access</div>
                  <h3>User management</h3>
                  <p className="page-subtitle">Manage login credentials for all staff roles.</p>
                </div>
              </div>

              {waiterError && <div className="error-banner">{waiterError}</div>}

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffUsers.map((staffUser) => (
                      <tr key={staffUser.id}>
                        <td><strong>{staffUser.name}</strong></td>
                        <td>{staffUser.username}</td>
                        <td><span className="pill neutral">{staffUser.role}</span></td>
                        <td>
                          <div className="table-actions">
                            <button className="secondary-btn small" onClick={() => openEditUser(staffUser)}>
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!waitersLoading && staffUsers.length === 0 && !waiterError && (
                <div className="empty-state">
                  <h4>No staff users found</h4>
                </div>
              )}
              {waitersLoading && <p className="page-subtitle">Loading users...</p>}
            </section>
          )}
        </div>
      </div>

      {productModalOpen && (
        <div className="modal-backdrop" onClick={() => setProductModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingProduct ? "Edit product" : "Add product"}</h3>
              <button className="icon-btn" onClick={() => setProductModalOpen(false)} aria-label="Close form">
                ×
              </button>
            </div>

            <form className="product-form" onSubmit={saveProduct}>
              <label>
                Product name
                <input
                  value={productForm.name}
                  onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>

              <div className="two-col">
                <label>
                  Category
                  <select
                    value={productForm.categoryId}
                    onChange={(event) => setProductForm((current) => ({ ...current, categoryId: event.target.value }))}
                    required
                  >
                    {categoryOptions.length === 0 && <option value="">No categories</option>}
                    {categoryOptions.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.price}
                    onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))}
                    required
                  />
                </label>
              </div>

              <div className="two-col">
                <label>
                  Stock
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={productForm.stock}
                    onChange={(event) => setProductForm((current) => ({ ...current, stock: event.target.value }))}
                    required
                  />
                </label>

                <div className="switch-row">
                  <span>Available</span>
                  <button
                    type="button"
                    className={productForm.isActive ? "toggle-btn active" : "toggle-btn"}
                    onClick={() => setProductForm((current) => ({ ...current, isActive: !current.isActive }))}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setProductModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  {editingProduct ? "Save changes" : "Create product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tableModalOpen && (
        <div className="modal-backdrop" onClick={() => setTableModalOpen(false)}>
          <div className="modal-card compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">Service floor</div>
                <h3>Add table</h3>
              </div>
              <button className="icon-btn" onClick={() => setTableModalOpen(false)} aria-label="Close table form">
                ×
              </button>
            </div>

            <form className="product-form" onSubmit={saveTable}>
              <label>
                Table number
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={tableNumber}
                  onChange={(event) => setTableNumber(event.target.value)}
                  placeholder="Example: 12"
                  required
                  autoFocus
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setTableModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Create table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {waiterModalOpen && (
        <div className="modal-backdrop" onClick={closeWaiterModal}>
          <div className="modal-card compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">Team access</div>
                <h3>{editingWaiter ? "Edit staff user" : "Add waiter"}</h3>
              </div>
              <button className="icon-btn" onClick={closeWaiterModal} aria-label="Close waiter form">
                ×
              </button>
            </div>

            {waiterError && <div className="error-banner">{waiterError}</div>}

            <form className="product-form" onSubmit={saveWaiter}>
              <label>
                Name
                <input
                  value={waiterForm.name}
                  onChange={(event) => setWaiterForm((current) => ({ ...current, name: event.target.value }))}
                  autoComplete="name"
                  required
                />
              </label>

              {!editingWaiter && (
                <label>
                  Username
                  <input
                    value={waiterForm.username}
                    onChange={(event) => setWaiterForm((current) => ({ ...current, username: event.target.value }))}
                    autoComplete="username"
                    required
                  />
                </label>
              )}

              {editingWaiter && (
                <label>
                  Username
                  <input
                    value={waiterForm.username}
                    onChange={(event) => setWaiterForm((current) => ({ ...current, username: event.target.value }))}
                    autoComplete="username"
                    required
                  />
                </label>
              )}

              <label>
                Password{editingWaiter ? " (optional)" : ""}
                <input
                  type="password"
                  value={waiterForm.password}
                  onChange={(event) => setWaiterForm((current) => ({ ...current, password: event.target.value }))}
                  autoComplete="new-password"
                  placeholder={editingWaiter ? "Leave blank to keep the current password" : ""}
                  required={!editingWaiter}
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={closeWaiterModal}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  {editingWaiter ? "Save changes" : "Create waiter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
