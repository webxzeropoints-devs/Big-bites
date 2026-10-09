import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import {
  calculateAmounts,
  calculateDiscountAmount,
  minorUnitsToNumber,
  parseMinorUnits,
  sumMinorUnits,
} from "./utils/currency";
import "./App.css";

const API_URL =
  ((import.meta.env.DEV && import.meta.env.VITE_API_URL) ||
    "https://big-bites-server.onrender.com").replace(/\/$/, "");
const ORDER_REPORTS_FOLDER_KEY = "big-bites-order-reports-folder";
const RESTAURANT_NAME = "BIG BITES FAMILY RESTAURANT";
const RECEIPT_RESTAURANT_NAME = "BIG BITES FAMILY\nRESTAURANT";
type DiscountKind = "AMOUNT" | "PERCENTAGE";
type ProductClassification = "VEG" | "NON_VEG" | "NOT_APPLICABLE";
type OrderReportFile = { fileName: string; contentBase64: string };

type Screen = "billing" | "admin" | "waiter";
type UserRole = "ADMIN" | "CASHIER" | "WAITER";
type User = { id: number; name: string; username: string; role: UserRole };
type Category = { id: number; name: string; sortOrder?: number; _count?: { products: number } };
type ProductVariant = { id: number; name: string; price: number | string; isActive?: boolean };
type Product = {
  id: number;
  slug?: string;
  name: string;
  description?: string;
  subcategory?: string | null;
  classification?: ProductClassification;
  price: number | string;
  stock: number;
  stockUnit?: string;
  lowStockThreshold?: number;
  isVegetarian?: boolean;
  isSignature?: boolean;
  isActive: boolean;
  categoryId: number;
  category?: { id: number; name: string };
  variants?: ProductVariant[];
};

type Table = { id: number; number: number; status: string; isParcel?: boolean };
type OrderItem = {
  id: number;
  quantity: number;
  unitPrice: string | number;
  subtotal: string | number;
  product: { name: string };
  variant?: { name: string } | null;
};
type Order = {
  id: number;
  status: string;
  total: string | number;
  subtotal?: number | string;
  taxableSubtotal?: number | string;
  gstRate?: number | string;
  gstEnabled?: boolean;
  cgstRate?: number | string;
  sgstRate?: number | string;
  cgstAmount?: number | string;
  sgstAmount?: number | string;
  gstAmount?: number | string;
  grandTotal?: number | string;
  restaurantAddress?: string;
  fssaiEnabled?: boolean;
  fssaiNumber?: string;
  gstinEnabled?: boolean;
  gstinNumber?: string;
  discountType?: DiscountKind | null;
  discountValue?: number | string | null;
  discountAmount?: number | string;
  createdAt: string;
  table?: { id?: number; number: number; isParcel?: boolean } | null;
  items?: OrderItem[];
  payment?: {
    amount?: string | number;
    amountReceived?: string | number | null;
    change?: string | number | null;
    method: string;
    status: string;
    paidAt?: string | null;
  } | null;
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
type OrderReportsSummary = {
  folderPath?: string;
  months: {
    month: string;
    fileName: string;
    orderCount: number;
    totalIncome: number;
  }[];
};

async function syncFolderPathWithServer(token: string) {
  try {
    const summary = await request("/api/admin/order-reports", {}, token);
    const serverPath = summary.folderPath?.trim() ?? "";
    if (serverPath && !window.localStorage.getItem(ORDER_REPORTS_FOLDER_KEY)) {
      window.localStorage.setItem(ORDER_REPORTS_FOLDER_KEY, serverPath);
    }
  } catch {
  }
}

async function saveOrderReportFiles(
  folderPath: string,
  reports: OrderReportFile[],
) {
  if (!Array.isArray(reports)) {
    throw new Error("The server returned an invalid monthly workbook response.");
  }
  if (reports.length === 0) return [];
  if (!folderPath.trim()) {
    throw new Error("Choose an Excel save location first.");
  }
  if (
    reports.some(
      (report) =>
        typeof report.fileName !== "string" ||
        typeof report.contentBase64 !== "string" ||
        report.contentBase64.length === 0,
    )
  ) {
    throw new Error("The server returned incomplete monthly workbook data.");
  }

  const savedFiles = await invoke<string[]>("save_order_reports", {
    folderPath,
    reports,
  });
  if (
    !Array.isArray(savedFiles) ||
    savedFiles.length !== reports.length ||
    savedFiles.some((filePath) => typeof filePath !== "string" || !filePath)
  ) {
    throw new Error("The desktop could not verify every saved monthly workbook.");
  }
  return savedFiles;
}

const tableLabel = (table?: { number: number; isParcel?: boolean } | null) =>
  table ? (table.isParcel ? "Parcel" : `Table ${table.number}`) : "Table unavailable";

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("POS screen render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main
          role="alert"
          style={{
            boxSizing: "border-box",
            minHeight: "100vh",
            padding: 32,
            background: "#f5f2ee",
            color: "#20242a",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <h1>BIG BITES POS could not display this screen</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Reload POS</button>
        </main>
      );
    }
    return this.props.children;
  }
}

const money = (value: string | number) => `₹${Number(value).toFixed(2)}`;
const percent = (value: string | number) => {
  const numericValue = Number(value);
  return `${numericValue.toFixed(Number.isInteger(numericValue) ? 0 : 2)}%`;
};
const orderAmounts = (order: Order) => {
  const subtotal = order.subtotal ?? order.total;
  const discountMinor =
    order.discountType && order.discountValue != null
      ? calculateDiscountAmount(
          subtotal,
          order.discountType,
          String(order.discountValue),
        )
      : parseMinorUnits(order.discountAmount ?? 0);
  if (discountMinor === null) throw new Error("Invalid order discount");
  return calculateAmounts(
    subtotal,
    order.gstRate ?? 0,
    minorUnitsToNumber(discountMinor),
  );
};

function calculateEnteredDiscount(
  subtotal: number | string,
  gstRate: number | string,
  type: DiscountKind,
  rawValue: string,
) : { discountAmount: number; grandTotal: number } | null {
  const discountMinor = calculateDiscountAmount(subtotal, type, rawValue);
  if (discountMinor === null) return null;
  const amounts = calculateAmounts(
    subtotal,
    gstRate,
    minorUnitsToNumber(discountMinor),
  );
  return {
    discountAmount: amounts.discountAmount,
    grandTotal: amounts.grandTotal,
  };
}

async function checkApiHealth() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${API_URL}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json().catch(() => null);
    return data?.status === "OK" && data?.database === "Connected";
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

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

function AppContent() {
  const [screen, setScreen] = useState<Screen>("billing");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);

  if (!token || !user) {
    return (
      <Login
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setUser(nextUser);
          setScreen(nextUser.role === "ADMIN" ? "admin" : "billing");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">{RESTAURANT_NAME}</div>
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
          {user.role === "ADMIN" && (
            <>
              <button
                className={screen === "admin" ? "nav-btn active" : "nav-btn"}
                onClick={() => setScreen("admin")}
              >
                Admin
              </button>
              <button
                className={screen === "waiter" ? "nav-btn active" : "nav-btn"}
                onClick={() => setScreen("waiter")}
              >
                Waiter
              </button>
            </>
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

      {screen === "billing" ? (
        <BillingScreen token={token} cashierName={user.name} />
      ) : screen === "waiter" ? (
        <WaiterModeScreen token={token} />
      ) : (
        <AdminScreen token={token} role={user.role} />
      )}
    </div>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [loading, setLoading] = useState(false);

  async function ensureBackendAvailable() {
    setCheckingConnection(true);
    setError("");
    let healthy = false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      healthy = await checkApiHealth();
      if (healthy || attempt === 3) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!healthy) {
      setError(
        `The POS server is not available at ${API_URL}. Check the Big Bites backend service and retry.`,
      );
      setCheckingConnection(false);
      return false;
    }

    setError("");
    setCheckingConnection(false);
    return true;
  }

  useEffect(() => {
    void ensureBackendAvailable();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const available = await ensureBackendAvailable();
    if (!available) {
      setLoading(false);
      return;
    }

    try {
      const data = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin(data.token, data.user);
    } catch (err) {
      const message =
        err instanceof Error && err.message === "Failed to fetch"
          ? `The POS server is unavailable at ${API_URL}. Please check the backend and retry.`
          : err instanceof Error
            ? err.message
            : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-block">
          <img className="brand-logo" src="/big-bites-logo.png" alt="Big Bites logo" />
          <div>
            <div className="eyebrow">{RESTAURANT_NAME}</div>
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

        {!error && checkingConnection && (
          <div className="info-banner">Checking POS server connection...</div>
        )}

        <button
          className="secondary-btn full"
          type="button"
          disabled={loading || checkingConnection}
          onClick={() => void ensureBackendAvailable()}
        >
          Retry connection
        </button>

        <button className="primary-btn full" disabled={loading || checkingConnection} type="submit">
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </main>
  );
}

function ReceiptPreview({
  order,
  cashierName,
  onClose,
  onProceedToPayment,
}: {
  order: Order;
  cashierName: string;
  onClose: () => void;
  onProceedToPayment?: () => void;
}) {
  const paid = order.payment?.status === "PAID" || order.status === "COMPLETED";
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = sumMinorUnits(items.map((item) => item.subtotal));
  const amounts = orderAmounts(order);
  const totalItems = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const settlementType = order.payment?.method ?? (paid ? "PAID" : "UNPAID");
  const gstCharged = order.gstEnabled !== false;
  const receiptDate = new Date(order.payment?.paidAt ?? order.createdAt);
  const dateTime = Number.isNaN(receiptDate.getTime())
    ? "Date unavailable"
    : `${String(receiptDate.getDate()).padStart(2, "0")}/${String(
        receiptDate.getMonth() + 1,
      ).padStart(2, "0")}/${receiptDate.getFullYear()} ${String(
        receiptDate.getHours(),
      ).padStart(2, "0")}:${String(receiptDate.getMinutes()).padStart(2, "0")}`;

  return createPortal(
    <div
      className="receipt-modal-backdrop"
      id="receipt-modal-root"
      role="dialog"
      aria-modal="true"
    >
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

        <article
          className="thermal-receipt"
          id="receipt-to-print"
          aria-label={`Receipt for order ${order.id}`}
        >
          <div className="receipt-header">
            <img
              className="receipt-logo"
              src="/big-bites-logo.png"
              alt="Big Bites logo"
            />
            <h2>{RECEIPT_RESTAURANT_NAME}</h2>
          </div>

          <hr className="receipt-divider" />

          {gstCharged && (
            <div className="receipt-tax-invoice">TAX INVOICE</div>
          )}
          {order.fssaiEnabled && order.fssaiNumber?.trim() && (
            <div className="receipt-tax-id">FSSAI: {order.fssaiNumber}</div>
          )}
          {order.gstinEnabled && order.gstinNumber?.trim() && (
            <div className="receipt-tax-id">GSTIN: {order.gstinNumber}</div>
          )}

          <div className="receipt-details">
            <div>
              <span>Bill No:</span>
              <strong>#{order.id}</strong>
            </div>
            <div>
              <span>Date:</span>
              <strong>{dateTime}</strong>
            </div>
            <div>
              <span>Table:</span>
              <strong>{order.table?.isParcel ? "Parcel" : order.table?.number ?? "—"}</strong>
            </div>
            <div>
              <span>Cashier:</span>
              <strong>{cashierName}</strong>
            </div>
          </div>

          <hr className="receipt-divider" />

          <div className="receipt-items">
            <div className="receipt-row receipt-heading">
              <span>Item</span>
              <span>Qty</span>
              <span>Price</span>
              <span>Total</span>
            </div>

            {items.map((item) => (
              <div key={item.id}>
                <div className="receipt-row">
                  <span className="receipt-item-name">
                    {item.product.name}{item.variant ? ` - ${item.variant.name}` : ""}
                  </span>
                  <span>{item.quantity}</span>
                  <span>{money(item.unitPrice)}</span>
                  <span>{money(item.subtotal)}</span>
                </div>
                <div className="receipt-item-divider" aria-hidden="true" />
              </div>
            ))}
          </div>

          <hr className="receipt-divider" />

          <div className="receipt-summary">
            <div className="receipt-summary-row">
              <span>Subtotal</span>
              <strong>{money(minorUnitsToNumber(subtotal))}</strong>
            </div>
            {amounts.discountAmount > 0 && (
              <>
                <div className="receipt-summary-row">
                  <span>
                    {order.discountType === "PERCENTAGE"
                      ? `Discount (${percent(order.discountValue ?? 0)})`
                      : "Discount"}
                  </span>
                  <strong>-{money(amounts.discountAmount)}</strong>
                </div>
                <div className="receipt-summary-row">
                  <span>Taxable Amount</span>
                  <strong>{money(amounts.taxableSubtotal)}</strong>
                </div>
              </>
            )}
            {gstCharged && (
              <>
                <div className="receipt-summary-row">
                  <span>CGST ({percent(amounts.cgstRate)})</span>
                  <strong>{money(amounts.cgstAmount)}</strong>
                </div>
                <div className="receipt-summary-row">
                  <span>SGST ({percent(amounts.sgstRate)})</span>
                  <strong>{money(amounts.sgstAmount)}</strong>
                </div>
              </>
            )}
          </div>

          <hr className="receipt-divider" />

          <div className="receipt-total">
            <span>TOTAL</span>
            <strong>{money(amounts.grandTotal)}</strong>
          </div>

          <hr className="receipt-divider" />

          <div className="receipt-summary receipt-settlement">
            <div className="receipt-summary-row">
              <span>Total Items</span>
              <strong>{totalItems}</strong>
            </div>
            <div className="receipt-summary-row">
              <span>Payment method</span>
              <strong>{settlementType}</strong>
            </div>
            {paid && order.payment?.amountReceived != null && (
              <div className="receipt-summary-row">
                <span>Amount received</span>
                <strong>{money(order.payment.amountReceived)}</strong>
              </div>
            )}
            {paid && order.payment?.change != null && (
              <div className="receipt-summary-row">
                <span>Change</span>
                <strong>{money(order.payment.change)}</strong>
              </div>
            )}
          </div>

          <hr className="receipt-divider" />

          <div className="receipt-footer">
            <strong>THANK YOU! VISIT US AGAIN!!</strong>
            {order.restaurantAddress?.trim() && (
              <p className="receipt-address">{order.restaurantAddress.trim()}</p>
            )}
            <div className="receipt-branding">Developed By ZEROPOINT LABS</div>
            <div className="receipt-website">www.zeropointlabs.in</div>
          </div>
        </article>
      </div>
    </div>,
    document.body,
  );
}

function BillingScreen({
  token,
  cashierName,
}: {
  token: string;
  cashierName: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [completed, setCompleted] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [method, setMethod] = useState("CASH");
  const [amountReceived, setAmountReceived] = useState("");
  const [discountType, setDiscountType] = useState<DiscountKind>("AMOUNT");
  const [discountValue, setDiscountValue] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const [preview, setPreview] = useState<Order | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState<"active" | "completed" | "all">("active");

  async function loadBillAddress(order: Order) {
    const billDetails = await request(
      `/api/billing/orders/${order.id}`,
      { cache: "no-store" },
      token,
    );

    if (typeof billDetails.restaurantAddress !== "string") {
      throw new Error(
        "The billing server did not return the saved restaurant address. Refresh the server deployment and try again.",
      );
    }

    return {
      ...order,
      restaurantAddress: billDetails.restaurantAddress,
      fssaiEnabled: billDetails.fssaiEnabled === true,
      fssaiNumber:
        typeof billDetails.fssaiNumber === "string"
          ? billDetails.fssaiNumber
          : "",
      gstinEnabled: billDetails.gstinEnabled === true,
      gstinNumber:
        typeof billDetails.gstinNumber === "string"
          ? billDetails.gstinNumber
          : "",
      discountType:
        billDetails.discountType === "AMOUNT" ||
        billDetails.discountType === "PERCENTAGE"
          ? billDetails.discountType
          : null,
      discountValue:
        typeof billDetails.discountValue === "string" ||
        typeof billDetails.discountValue === "number"
          ? billDetails.discountValue
          : null,
      discountAmount:
        typeof billDetails.discountAmount === "string" ||
        typeof billDetails.discountAmount === "number"
          ? billDetails.discountAmount
          : 0,
      subtotal: billDetails.subtotal ?? order.subtotal ?? order.total,
      taxableSubtotal: billDetails.taxableSubtotal,
      gstRate: billDetails.gstRate ?? order.gstRate,
      gstEnabled: billDetails.gstEnabled !== false,
      cgstRate: billDetails.cgstRate,
      sgstRate: billDetails.sgstRate,
      cgstAmount: billDetails.cgstAmount,
      sgstAmount: billDetails.sgstAmount,
      gstAmount: billDetails.gstAmount,
      grandTotal: billDetails.grandTotal,
    };
  }

  async function saveDiscount(order: Order) {
    const trimmedValue = discountValue.trim();
    const value = trimmedValue || null;
    const type = value === null ? null : discountType;
    const result = await request(
      `/api/billing/orders/${order.id}/discount`,
      {
        method: "PATCH",
        body: JSON.stringify({ discountType: type, discountValue: value }),
      },
      token,
    );
    return {
      ...order,
      discountType: result.discountType as DiscountKind | null,
      discountValue:
        result.discountValue == null ? null : Number(result.discountValue),
      discountAmount: Number(result.discountAmount ?? 0),
      subtotal: result.subtotal ?? order.subtotal ?? order.total,
      taxableSubtotal: result.taxableSubtotal,
      gstRate: result.gstRate ?? order.gstRate,
      gstEnabled: result.gstEnabled !== false,
      cgstRate: result.cgstRate,
      sgstRate: result.sgstRate,
      cgstAmount: result.cgstAmount,
      sgstAmount: result.sgstAmount,
      gstAmount: result.gstAmount,
      grandTotal: result.grandTotal,
    };
  }

  async function load() {
    try {
      const [active, done] = await Promise.all([
        request("/api/billing/orders", {}, token),
        request("/api/billing/completed", {}, token),
      ]);
      setOrders(active);
      setCompleted(done);
      setSelected((current) => {
        if (!current) return current;
        return (
          active.find((order: Order) => order.id === current.id) ??
          done.find((order: Order) => order.id === current.id) ??
          null
        );
      });
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

  const selectedTaxAmounts = selected ? orderAmounts(selected) : null;
  const enteredDiscount = selectedTaxAmounts
    ? calculateEnteredDiscount(
        selectedTaxAmounts.subtotal,
        selectedTaxAmounts.gstRate,
        discountType,
        discountValue,
      )
    : null;
  const selectedIsBillable = selected?.status === "READY_FOR_BILLING";
  const displayedDiscountAmount = selectedIsBillable
    ? enteredDiscount?.discountAmount ?? 0
    : selected
      ? orderAmounts(selected).discountAmount
      : 0;
  const displayedFinalTotal = selectedIsBillable
    ? enteredDiscount?.grandTotal ?? orderAmounts(selected!).grandTotal
    : selected
      ? orderAmounts(selected).grandTotal
      : 0;
  const paymentDue = displayedFinalTotal;
  const receivedMinor = amountReceived.trim()
    ? parseMinorUnits(amountReceived)
    : null;
  const paymentDueMinor = parseMinorUnits(paymentDue);
  const cashPaymentValid =
    (!selectedIsBillable || enteredDiscount !== null) &&
    (method !== "CASH" ||
      (receivedMinor !== null &&
      paymentDueMinor !== null &&
      receivedMinor >= paymentDueMinor));

  async function pay() {
    if (!selected || payingRef.current || !cashPaymentValid) return;

    payingRef.current = true;
    setPaying(true);
    setError("");
    try {
      const discountedOrder = await saveDiscount(selected);
      const billWithAddress = await loadBillAddress(discountedOrder);
      setSelected(billWithAddress);

      const result = await request(
        `/api/billing/orders/${selected.id}/pay`,
        {
          method: "POST",
          body: JSON.stringify({
            method,
            ...(method === "CASH"
              ? { amountReceived: amountReceived.trim() }
              : {}),
          }),
        },
        token,
      );
      const reportFolder =
        window.localStorage.getItem(ORDER_REPORTS_FOLDER_KEY) ?? "";
      let reportExportError = result.orderReportError as string | undefined;
      if (reportFolder && result.orderReportFiles?.length) {
        try {
          await saveOrderReportFiles(reportFolder, result.orderReportFiles);
        } catch (reportError) {
          reportExportError =
            reportError instanceof Error
              ? reportError.message
              : "Unable to save the monthly Excel workbook to this device.";
        }
      }

      const paidOrder = {
        ...billWithAddress,
        gstRate: result.gstRate,
        gstEnabled: result.gstEnabled,
        status: "COMPLETED",
        payment: {
          ...result.payment,
          amountReceived: result.amountReceived,
          change: result.change,
        },
      };
      setSuccess(`Payment successful. Order #${selected.id} is completed.`);
      setSelected(null);
      setShowPayment(false);
      setAmountReceived("");
      await load();
      if (reportExportError) {
        setError(
          `Payment completed, but the Excel order report could not be updated: ${reportExportError}`,
        );
      }
      setPreview(paidOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare or process payment");
    } finally {
      payingRef.current = false;
      setPaying(false);
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
              <h3>Ready for billing</h3>
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
                  onClick={async () => {
                    setSelected(order);
                    setDiscountType(order.discountType ?? "AMOUNT");
                    setDiscountValue(
                      order.discountValue == null
                        ? ""
                        : String(order.discountValue),
                    );
                    setShowPayment(false);
                    setError("");
                    try {
                      const orderWithAddress = await loadBillAddress(order);
                      setSelected((current) =>
                        current?.id === order.id ? orderWithAddress : current,
                      );
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Unable to load bill details",
                      );
                    }
                  }}
                >
                  <div className="order-card-top">
                    <div>
                      <span className="label">Order #{order.id}</span>
                      <h4>{tableLabel(order.table)}</h4>
                    </div>
                    <span className="status-pill pending">
                      {order.status === "READY_FOR_BILLING"
                        ? "READY FOR BILLING"
                        : order.status}
                    </span>
                  </div>

                  <div className="order-card-grid">
                    <div>
                      <span>Items</span>
                      <strong>{(Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + item.quantity, 0)}</strong>
                    </div>
                    <div>
                      <span>Time</span>
                      <strong>{new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{money(orderAmounts(order).grandTotal)}</strong>
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
              <p>              Choose an order sent by the waiter to generate its bill and receive payment.</p>
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

              {selected.restaurantAddress?.trim() && (
                <div className="bill-restaurant-address">
                  {selected.restaurantAddress}
                </div>
              )}

              <div className="bill-items">
                {(Array.isArray(selected.items) ? selected.items : []).map((item) => (
                  <div className="bill-item" key={item.id}>
                    <div>
                      <strong>
                        {item.product.name}{item.variant ? ` - ${item.variant.name}` : ""}
                      </strong>
                      <span>
                        {item.quantity} × {money(item.unitPrice)}
                      </span>
                    </div>
                    <strong>{money(item.subtotal)}</strong>
                  </div>
                ))}
              </div>

              <div className="bill-summary">
                <div className="bill-summary-row">
                  <span>Subtotal</span>
                  <strong>{money(orderAmounts(selected).subtotal)}</strong>
                </div>
                {selected.gstEnabled !== false ? (
                  <>
                    <div className="bill-summary-row">
                      <span>CGST ({percent(orderAmounts(selected).cgstRate)})</span>
                      <strong>{money(orderAmounts(selected).cgstAmount)}</strong>
                    </div>
                    <div className="bill-summary-row">
                      <span>SGST ({percent(orderAmounts(selected).sgstRate)})</span>
                      <strong>{money(orderAmounts(selected).sgstAmount)}</strong>
                    </div>
                  </>
                ) : null}
                {displayedDiscountAmount > 0 && (
                  <div className="bill-summary-row">
                    <span>
                      {selectedIsBillable
                        ? discountType === "PERCENTAGE"
                          ? `Discount (${percent(discountValue)})`
                          : "Discount"
                        : selected.discountType === "PERCENTAGE"
                          ? `Discount (${percent(selected.discountValue ?? 0)})`
                          : "Discount"}
                    </span>
                    <strong>-{money(displayedDiscountAmount)}</strong>
                  </div>
                )}
                <div className="bill-total-row">
                  <span>Total</span>
                  <strong>{money(displayedFinalTotal)}</strong>
                </div>
              </div>

              {selected.status === "READY_FOR_BILLING" && (
                <div className="discount-controls">
                  <label>
                    Discount type
                    <select
                      value={discountType}
                      onChange={(event) =>
                        setDiscountType(event.target.value as DiscountKind)
                      }
                    >
                      <option value="AMOUNT">Amount (₹)</option>
                      <option value="PERCENTAGE">Percentage (%)</option>
                    </select>
                  </label>
                  <label>
                    Discount
                    <input
                      type="number"
                      min="0"
                      max={discountType === "PERCENTAGE" ? 100 : undefined}
                      step="0.01"
                      value={discountValue}
                      onChange={(event) => setDiscountValue(event.target.value)}
                      placeholder="No discount"
                    />
                    {discountValue.trim() && !enteredDiscount && (
                      <span className="field-error">
                        Enter a valid discount with at most 2 decimal places.
                      </span>
                    )}
                  </label>
                </div>
              )}

              {selectedIsBillable && <div className="action-row">
                <button
                  className="secondary-btn"
                  onClick={async () => {
                    try {
                      const discountedOrder = await saveDiscount(selected);
                      const orderWithAddress = await loadBillAddress(
                        discountedOrder,
                      );
                      setSelected(orderWithAddress);
                      setPreview(orderWithAddress);
                      setError("");
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Unable to load bill details",
                      );
                    }
                  }}
                >
                  Generate Bill
                </button>
              </div>}

              {selectedIsBillable && (!showPayment ? (
                <button
                  className="primary-btn full"
                  onClick={() => {
                    setAmountReceived(paymentDue.toFixed(2));
                    setShowPayment(true);
                  }}
                >
                  Proceed to payment
                </button>
              ) : (
                <div className="payment-box">
                  <h4>Payment details</h4>
                  <div className="due-amount">
                    Amount due: {money(paymentDue)}
                  </div>

                  <div className="payment-methods">
                    {["CASH", "UPI", "CARD"].map((value) => (
                      <button
                        key={value}
                        className={method === value ? "method-btn active" : "method-btn"}
                        onClick={() => {
                          setMethod(value);
                          if (value === "CASH" && !amountReceived.trim()) {
                            setAmountReceived(paymentDue.toFixed(2));
                          }
                        }}
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
                        min={
                          enteredDiscount?.grandTotal ??
                          orderAmounts(selected).grandTotal
                        }
                        step="0.01"
                        value={amountReceived}
                        onChange={(event) => setAmountReceived(event.target.value)}
                      />
                      {amountReceived && receivedMinor !== null && paymentDueMinor !== null && (
                        <strong>
                          {receivedMinor >= paymentDueMinor
                            ? `Change: ${money(minorUnitsToNumber(receivedMinor - paymentDueMinor))}`
                            : `Balance: ${money(minorUnitsToNumber(paymentDueMinor - receivedMinor))}`}
                        </strong>
                      )}
                      {amountReceived && receivedMinor === null && (
                        <span className="field-error">
                          Enter an amount with at most 2 decimal places.
                        </span>
                      )}
                    </label>
                  )}

                  <button
                    className="primary-btn full"
                    onClick={() => void pay()}
                    disabled={paying || !cashPaymentValid}
                  >
                    {paying ? "Processing..." : "PAYMENT RECEIVED"}
                  </button>
                </div>
              ))}
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
                    {money(orderAmounts(order).grandTotal)} · {order.payment?.method ?? "-"} · PAID
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
          cashierName={cashierName}
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

function AdminScreen({ token, role }: { token: string; role: UserRole }) {
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "tables" | "orders" | "payments" | "settings" | "reports" | "waiters" | "staff">("overview");
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
  const [orderMessage, setOrderMessage] = useState("");
  const [waitersLoading, setWaitersLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingOrderId, setDeletingOrderId] = useState<number | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [tableNumber, setTableNumber] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [editingWaiter, setEditingWaiter] = useState<User | null>(null);
  const [waiterForm, setWaiterForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "" as UserRole | "",
  });
  const [productForm, setProductForm] = useState({
    name: "",
    description: "",
    subcategory: "",
    categoryId: "",
    price: "",
    stock: "",
    stockUnit: "pcs",
    lowStockThreshold: "0",
    classification: "VEG" as ProductClassification,
    isSignature: false,
    isActive: true,
    variantsText: "",
  });
  const [productQuery, setProductQuery] = useState("");
  const [gstRate, setGstRate] = useState("5");
  const [gstEnabled, setGstEnabled] = useState(true);
  const [restaurantAddress, setRestaurantAddress] = useState("");
  const [fssaiEnabled, setFssaiEnabled] = useState(false);
  const [fssaiNumber, setFssaiNumber] = useState("");
  const [gstinEnabled, setGstinEnabled] = useState(false);
  const [gstinNumber, setGstinNumber] = useState("");
  const [savingGst, setSavingGst] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reportSummary, setReportSummary] = useState<OrderReportsSummary | null>(null);
  const [reportFolderPath, setReportFolderPath] = useState(
    () => window.localStorage.getItem(ORDER_REPORTS_FOLDER_KEY) ?? "",
  );
  const [reportLoading, setReportLoading] = useState(false);
  const [reportLocationSaving, setReportLocationSaving] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");

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

  const loadGstSettings = async () => {
    setSettingsLoaded(false);
    setSettingsError("");
    try {
      const settings = await request(
        "/api/admin/settings",
        { cache: "no-store" },
        token,
      );
      setGstRate(String(settings.gstRate));
      setGstEnabled(settings.gstEnabled !== false);
      setRestaurantAddress(settings.restaurantAddress ?? "");
      setFssaiEnabled(settings.fssaiEnabled === true);
      setFssaiNumber(settings.fssaiNumber ?? "");
      setGstinEnabled(settings.gstinEnabled === true);
      setGstinNumber(settings.gstinNumber ?? "");
      setSettingsLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load GST settings";
      setSettingsError(
        message === "API route not found"
          ? "GST settings are unavailable because the backend update has not been deployed. Deploy the server update and apply its database migration, then refresh."
          : `Unable to load GST settings: ${message}`,
      );
    }
  };

  const loadOrderReports = async () => {
    setReportLoading(true);
    setReportError("");
    try {
      const summary = await request("/api/admin/order-reports", {}, token);
      setReportSummary(summary);
    } catch (err) {
      setReportError(
        err instanceof Error
          ? err.message
          : "Unable to load monthly order reports",
      );
    } finally {
      setReportLoading(false);
    }
  };

  const saveOrderReportsPath = async (folderPath: string) => {
    setReportLocationSaving(true);
    setReportMessage("");
    setReportError("");
    try {
      window.localStorage.setItem(ORDER_REPORTS_FOLDER_KEY, folderPath);
      setReportFolderPath(folderPath);
      const result = await request(
        "/api/admin/order-reports/export",
        { method: "POST" },
        token,
      );
      const savedFiles = await saveOrderReportFiles(folderPath, result.reports);
      setReportMessage(
        result.reports.length
          ? `Saved monthly workbook(s): ${savedFiles.join("; ")}`
          : "Excel save location saved. No completed and paid orders are available to export yet.",
      );
      await loadOrderReports();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to update order reports";
      setReportError(`The folder was selected, but Excel files could not be saved: ${message}`);
      await loadOrderReports();
    } finally {
      setReportLocationSaving(false);
    }
  };

  const chooseOrderReportsPath = async () => {
    setReportError("");
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Choose Excel order-history folder",
      });
      if (typeof selectedPath === "string" && selectedPath.trim()) {
        await saveOrderReportsPath(selectedPath);
      }
    } catch (err) {
      setReportError(
        err instanceof Error
          ? `Unable to open the folder picker: ${err.message}`
          : "Unable to open the folder picker.",
      );
    }
  };

  const exportOrderReports = async () => {
    setReportExporting(true);
    setReportMessage("");
    setReportError("");
    try {
      if (!reportFolderPath) {
        throw new Error("Choose an Excel save location first.");
      }
      const result = await request(
        "/api/admin/order-reports/export",
        { method: "POST" },
        token,
      );
      const savedFiles = await saveOrderReportFiles(reportFolderPath, result.reports);
      setReportMessage(
        result.reports.length
          ? `Saved monthly workbook(s): ${savedFiles.join("; ")}`
          : "No completed and paid orders are available to export yet.",
      );
      await loadOrderReports();
    } catch (err) {
      setReportError(
        err instanceof Error
          ? err.message
          : "Unable to update monthly Excel reports",
      );
      await loadOrderReports();
    } finally {
      setReportExporting(false);
    }
  };

  useEffect(() => {
    if (activeTab === "settings") void loadGstSettings();
    if (activeTab === "reports") {
      void syncFolderPathWithServer(token);
      void loadOrderReports();
    }
  }, [activeTab, token]);

  const saveGstRate = async (event: FormEvent) => {
    event.preventDefault();
    setSettingsMessage("");
    setSettingsError("");
    setSavingGst(true);

    try {
      const settings = await request(
        "/api/admin/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            gstRate: Number(gstRate),
            gstEnabled,
            restaurantAddress,
            fssaiEnabled,
            fssaiNumber,
            gstinEnabled,
            gstinNumber,
          }),
        },
        token,
      );
      setGstRate(String(settings.gstRate));
      setGstEnabled(settings.gstEnabled !== false);
      setRestaurantAddress(settings.restaurantAddress ?? "");
      setFssaiEnabled(settings.fssaiEnabled === true);
      setFssaiNumber(settings.fssaiNumber ?? "");
      setGstinEnabled(settings.gstinEnabled === true);
      setGstinNumber(settings.gstinNumber ?? "");
      setSettingsLoaded(true);
      setSettingsMessage("Restaurant billing settings saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save GST setting";
      setSettingsError(
        message === "API route not found"
          ? "GST settings cannot be saved until the backend update is deployed and its database migration is applied."
          : `Unable to save GST setting: ${message}`,
      );
    } finally {
      setSavingGst(false);
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

  const deleteUser = async (staffUser: User) => {
    if (
      !window.confirm(
        `Delete ${staffUser.role === "WAITER" ? "waiter" : "user"} "${staffUser.name}"? Users with order history cannot be deleted.`,
      )
    ) {
      return;
    }

    setWaiterError("");
    setDeletingUserId(staffUser.id);
    try {
      await request(
        `/api/admin/users/${staffUser.id}`,
        { method: "DELETE" },
        token,
      );
      await loadUsers();
    } catch (err) {
      setWaiterError(
        err instanceof Error ? err.message : "Unable to delete user",
      );
    } finally {
      setDeletingUserId(null);
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
      description: "",
      subcategory: "",
      categoryId: categoryOptions[0]?.value ?? "",
      price: "",
      stock: "",
      stockUnit: "pcs",
      lowStockThreshold: "0",
      classification: "VEG",
      isSignature: false,
      isActive: true,
      variantsText: "",
    });
    setProductModalOpen(true);
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      description: product.description ?? "",
      subcategory: product.subcategory ?? "",
      categoryId: String(product.categoryId ?? product.category?.id ?? ""),
      price: String(product.price),
      stock: String(product.stock),
      stockUnit: product.stockUnit ?? "pcs",
      lowStockThreshold: String(product.lowStockThreshold ?? 0),
      classification: product.classification ?? (product.isVegetarian === false ? "NON_VEG" : "VEG"),
      isSignature: Boolean(product.isSignature),
      isActive: Boolean(product.isActive),
      variantsText: (product.variants ?? [])
        .filter((variant) => variant.isActive !== false)
        .map((variant) => `${variant.name} - ${variant.price}`)
        .join("\n"),
    });
    setProductModalOpen(true);
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();

    let variants: { name: string; price: number }[];
    try {
      variants = productForm.variantsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.lastIndexOf("-");
          if (separator <= 0) throw new Error(`Use "variant name - price" for: ${line}`);
          const name = line.slice(0, separator).trim();
          const price = Number(line.slice(separator + 1).trim());
          if (!name || !Number.isFinite(price) || price < 0) {
            throw new Error(`Enter a valid name and price for: ${line}`);
          }
          return { name, price };
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid product variants");
      return;
    }

    const payload = {
      ...productForm,
      categoryId: Number(productForm.categoryId),
      price: Number(productForm.price),
      stock: Number(productForm.stock),
      lowStockThreshold: Number(productForm.lowStockThreshold),
      isVegetarian: productForm.classification === "VEG",
      isSignature: Boolean(productForm.isSignature),
      isActive: Boolean(productForm.isActive),
      variants,
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

      setError("");
      setProductModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save product");
    }
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) {
      setError("Enter a category name.");
      return;
    }
    try {
      await request(
        editingCategoryId
          ? `/api/admin/categories/${editingCategoryId}`
          : "/api/admin/categories",
        {
          method: editingCategoryId ? "PATCH" : "POST",
          body: JSON.stringify({ name }),
        },
        token,
      );
      setCategoryName("");
      setEditingCategoryId(null);
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save category");
    }
  };

  const adjustProductStock = async (product: Product, mode: "add" | "set") => {
    const label = mode === "add" ? "Add stock for" : "Set stock for";
    const value = window.prompt(
      mode === "add"
        ? `${label} ${product.name}. Enter a positive quantity to add.`
        : `${label} ${product.name}. Enter the new total stock quantity.`,
      mode === "add" ? "10" : String(product.stock),
    );
    if (value === null || value.trim() === "") return;
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || (mode === "add" ? quantity <= 0 : quantity < 0)) {
      setError(mode === "add" ? "Added stock must be a positive integer." : "New stock must be a non-negative integer.");
      return;
    }

    try {
      await request(
        `/api/admin/products/${product.id}/stock`,
        {
          method: "PATCH",
          body: JSON.stringify(
            mode === "add"
              ? { quantity, reason: `Added stock for ${product.name}` }
              : { newStock: quantity, reason: `Set stock for ${product.name}` },
          ),
        },
        token,
      );
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update stock");
    }
  };

  const deleteProduct = async (product: Product) => {
    const confirmed = window.confirm(
      `Delete "${product.name}"? If this item has historical orders, it will be deactivated rather than permanently removed.`,
    );
    if (!confirmed) return;

    try {
      await request(`/api/admin/products/${product.id}`, { method: "DELETE" }, token);
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete product");
    }
  };

  const deleteOrder = async (order: Order) => {
    const paidOrCompleted =
      order.status === "COMPLETED" ||
      order.payment?.status === "PAID" ||
      order.payment?.status === "REFUNDED";
    const confirmation = paidOrCompleted
      ? `Delete order #${order.id} and its payment record? This cannot be undone and sold stock will not be restored.`
      : `Delete unpaid order #${order.id}? Its items and pending payment record will be deleted, and its stock returned.`;

    if (role !== "ADMIN" || !window.confirm(confirmation)) return;

    setError("");
    setOrderMessage("");
    setDeletingOrderId(order.id);
    try {
      await request(
        `/api/admin/orders/${order.id}`,
        { method: "DELETE" },
        token,
      );
      setOrders((current) => current.filter((item) => item.id !== order.id));
      setOrderMessage(`Order #${order.id} was deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete order");
    } finally {
      setDeletingOrderId(null);
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
    setWaiterForm({ name: "", username: "", password: "", role: "WAITER" });
    setWaiterError("");
    setWaiterModalOpen(true);
  };

  const openCreateStaffUser = () => {
    setEditingWaiter(null);
    setWaiterForm({ name: "", username: "", password: "", role: "" });
    setWaiterError("");
    setWaiterModalOpen(true);
  };

  const openEditUser = (user: User) => {
    setEditingWaiter(user);
    setWaiterForm({ name: user.name, username: user.username, password: "", role: user.role });
    setWaiterError("");
    setWaiterModalOpen(true);
  };

  const closeWaiterModal = () => {
    setWaiterModalOpen(false);
    setEditingWaiter(null);
    setWaiterForm({ name: "", username: "", password: "", role: "" });
    setWaiterError("");
  };

  const saveWaiter = async (event: FormEvent) => {
    event.preventDefault();
    setWaiterError("");

    if (activeTab !== "waiters" && !waiterForm.role) {
      setWaiterError("Select a role.");
      return;
    }

    const payload = {
      name: waiterForm.name.trim(),
      username: waiterForm.username.trim(),
      role: activeTab === "waiters" ? "WAITER" : waiterForm.role,
      ...(!editingWaiter || waiterForm.password ? { password: waiterForm.password } : {}),
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
            <img className="brand-logo small" src="/big-bites-logo.png" alt="Big Bites logo" />
            <strong>{RESTAURANT_NAME}</strong>
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
            <button className={activeTab === "settings" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("settings")}>
              <span className="nav-icon">⚙</span> GST Settings
            </button>
            <button className={activeTab === "reports" ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab("reports")}>
              <span className="nav-icon">▤</span> Order Reports
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
                      <div className="data-row table-data-row" key={table.id}>
                        <strong className="data-row-primary">{table.isParcel ? "Parcel" : `Table ${table.number}`}</strong>
                        <span className={`data-row-status ${table.status === "AVAILABLE" ? "status-text success" : "status-text danger"}`}>{table.status}</span>
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
                      <div className="data-row order-data-row" key={order.id}>
                        <strong className="data-row-primary">Order #{order.id} · {tableLabel(order.table)}</strong>
                        <span className="data-row-secondary order-row-details">
                          <span>{order.status}</span>
                          <span>{money(orderAmounts(order).grandTotal)}</span>
                          <time>{new Date(order.createdAt).toLocaleString()}</time>
                          {role === "ADMIN" && (
                            <button
                              type="button"
                              className="order-delete-btn"
                              onClick={() => void deleteOrder(order)}
                              disabled={deletingOrderId === order.id}
                              aria-label={`Delete order ${order.id}`}
                              title="Delete order"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="m19 6-1 14H6L5 6" />
                                <path d="M10 11v5M14 11v5" />
                              </svg>
                            </button>
                          )}
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
                    {visibleProducts.map((product) => {
                      const isLowStock =
                        Number(product.lowStockThreshold ?? 0) > 0 &&
                        Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 0);

                      return (
                        <tr key={product.id}>
                          <td>
                            <div className="product-name-cell">
                              <div className="brand-circle small">FO</div>
                              <div>
                                <strong>{product.name}</strong>
                                {product.isSignature && <div className="tiny-meta">Signature</div>}
                                <div className="tiny-meta">
                                  {product.classification === "NOT_APPLICABLE"
                                    ? "Not Applicable"
                                    : product.classification === "NON_VEG" || product.isVegetarian === false
                                      ? "Non Vegetarian"
                                      : "Vegetarian"}
                                </div>
                                {product.subcategory && <div className="tiny-meta">{product.subcategory}</div>}
                                {product.variants?.filter((variant) => variant.isActive !== false).map((variant) => (
                                  <div className="tiny-meta" key={variant.id}>
                                    {variant.name}: {money(variant.price)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td>{product.category?.name ?? product.categoryId}</td>
                          <td>{money(product.price)}</td>
                          <td>
                            <div>
                              <strong>{product.stock}</strong>
                              {product.stockUnit && <div className="tiny-meta">{product.stockUnit}</div>}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "grid", gap: 4 }}>
                              <span className={product.isActive ? "status-text success" : "status-text danger"}>
                                {product.isActive ? "Active" : "Inactive"}
                              </span>
                              {isLowStock && <span className="status-text danger">Low stock</span>}
                            </div>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button className="secondary-btn small" onClick={() => openEditProduct(product)}>
                                Edit
                              </button>
                              <button className="secondary-btn small" onClick={() => void adjustProductStock(product, "add")}>
                                + Stock
                              </button>
                              <button className="secondary-btn small" onClick={() => void adjustProductStock(product, "set")}>
                                Set
                              </button>
                              <button className="danger-btn small" onClick={() => void deleteProduct(product)}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">Menu organization</div>
                    <h3>Categories</h3>
                  </div>
                </div>
                <form className="page-actions" onSubmit={saveCategory}>
                  <input
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    placeholder="Category name"
                    aria-label="Category name"
                    required
                  />
                  <button className="primary-btn" type="submit">
                    {editingCategoryId ? "Save category" : "Add category"}
                  </button>
                  {editingCategoryId && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setEditingCategoryId(null);
                        setCategoryName("");
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </form>
                <div className="data-list">
                  {categories.map((category) => (
                    <div className="data-row" key={category.id}>
                      <strong className="data-row-primary">{category.name}</strong>
                      <span>{category._count?.products ?? 0} products</span>
                      <button
                        type="button"
                        className="secondary-btn small"
                        onClick={() => {
                          setEditingCategoryId(category.id);
                          setCategoryName(category.name);
                        }}
                      >
                        Rename
                      </button>
                    </div>
                  ))}
                </div>
              </section>
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
                  <div className="data-row table-data-row" key={table.id}>
                    <strong className="data-row-primary">{table.isParcel ? "Parcel" : `Table ${table.number}`}</strong>
                    <span className={`data-row-status ${table.status === "AVAILABLE" ? "status-text success" : "status-text danger"}`}>{table.status}</span>
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

              {error && <div className="error-banner">{error}</div>}
              {orderMessage && <div className="success-banner">{orderMessage}</div>}
              <div className="data-list">
                {orders.map((order) => (
                  <div className="data-row order-data-row" key={order.id}>
                    <strong className="data-row-primary">Order #{order.id} · {tableLabel(order.table)}</strong>
                    <span className="data-row-secondary order-row-details">
                      <span>{order.status}</span>
                      <span>{money(orderAmounts(order).grandTotal)}</span>
                      <time>{new Date(order.createdAt).toLocaleString()}</time>
                      {role === "ADMIN" && (
                        <button
                          type="button"
                          className="order-delete-btn"
                          onClick={() => void deleteOrder(order)}
                          disabled={deletingOrderId === order.id}
                          aria-label={`Delete order ${order.id}`}
                          title="Delete order"
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="m19 6-1 14H6L5 6" />
                            <path d="M10 11v5M14 11v5" />
                          </svg>
                        </button>
                      )}
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
                  <div className="data-row payment-data-row" key={payment.id}>
                    <strong className="data-row-primary">
                      Payment #{payment.id} · Order #{payment.orderId}
                    </strong>
                    <span className="data-row-secondary payment-row-details">
                      <span>{payment.method ?? "—"}</span>
                      <span>{payment.status}</span>
                      <strong>{money(payment.amount)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "settings" && (
            <section className="panel gst-settings-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Billing configuration</div>
                  <h3>Restaurant &amp; Billing Settings</h3>
                </div>
              </div>
              {settingsMessage && (
                <div className="success-banner">{settingsMessage}</div>
              )}
              {settingsError && (
                <div className="error-banner">{settingsError}</div>
              )}
              <form className="gst-settings-form" onSubmit={saveGstRate}>
                <label className="setting-toggle">
                  <span>GST: {gstEnabled ? "ON" : "OFF"}</span>
                  <input
                    type="checkbox"
                    checked={gstEnabled}
                    onChange={(event) => {
                      setGstEnabled(event.target.checked);
                      setSettingsMessage("");
                      setSettingsError("");
                    }}
                    disabled={!settingsLoaded || savingGst}
                    aria-label="Enable GST charges"
                  />
                </label>
                <label>
                  GST rate
                  <div className="gst-input-row">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={gstRate}
                      onChange={(event) => {
                        setGstRate(event.target.value);
                        setSettingsMessage("");
                        setSettingsError("");
                      }}
                      required
                      disabled={!settingsLoaded || savingGst}
                    />
                    <span>%</span>
                  </div>
                </label>
                {gstEnabled ? (
                  <div className="gst-split-preview">
                    <span>CGST ({percent(Number(gstRate) / 2)})</span>
                    <span>SGST ({percent(Number(gstRate) / 2)})</span>
                  </div>
                ) : (
                  <div className="gst-split-preview">
                    <span>GST is OFF. No CGST or SGST will be charged.</span>
                  </div>
                )}
                <label className="address-field">
                  Restaurant address
                  <textarea
                    rows={4}
                    maxLength={1000}
                    placeholder="Enter each address line on a new line"
                    value={restaurantAddress}
                    onChange={(event) => {
                      setRestaurantAddress(event.target.value);
                      setSettingsMessage("");
                      setSettingsError("");
                    }}
                    disabled={!settingsLoaded || savingGst}
                  />
                  <small>Use a new line for each address line. It will be printed at the bottom of the receipt.</small>
                </label>
                <label className="setting-toggle">
                  <span>Print FSSAI number</span>
                  <input
                    type="checkbox"
                    checked={fssaiEnabled}
                    onChange={(event) => {
                      setFssaiEnabled(event.target.checked);
                      setSettingsMessage("");
                      setSettingsError("");
                    }}
                    disabled={!settingsLoaded || savingGst}
                  />
                </label>
                {fssaiEnabled && (
                  <label className="address-field">
                    FSSAI number
                    <input
                      type="text"
                      maxLength={100}
                      value={fssaiNumber}
                      onChange={(event) => {
                        setFssaiNumber(event.target.value);
                        setSettingsMessage("");
                        setSettingsError("");
                      }}
                      required
                      disabled={!settingsLoaded || savingGst}
                    />
                  </label>
                )}
                <label className="setting-toggle">
                  <span>Print GSTIN</span>
                  <input
                    type="checkbox"
                    checked={gstinEnabled}
                    onChange={(event) => {
                      setGstinEnabled(event.target.checked);
                      setSettingsMessage("");
                      setSettingsError("");
                    }}
                    disabled={!settingsLoaded || savingGst}
                  />
                </label>
                {gstinEnabled && (
                  <label className="address-field">
                    GSTIN
                    <input
                      type="text"
                      maxLength={100}
                      value={gstinNumber}
                      onChange={(event) => {
                        setGstinNumber(event.target.value);
                        setSettingsMessage("");
                        setSettingsError("");
                      }}
                      required
                      disabled={!settingsLoaded || savingGst}
                    />
                  </label>
                )}
                <button
                  className="secondary-btn"
                  disabled={settingsLoaded || savingGst}
                  onClick={() => void loadGstSettings()}
                  type="button"
                >
                  Retry
                </button>
                <button
                  className="primary-btn"
                  disabled={!settingsLoaded || savingGst}
                  type="submit"
                >
                  {savingGst ? "Saving..." : "Save settings"}
                </button>
              </form>
            </section>
          )}

          {activeTab === "reports" && (
            <section className="panel product-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Completed and paid orders</div>
                  <h3>Order History &amp; Monthly Excel Reports</h3>
                </div>
                <button
                  className="secondary-btn"
                  onClick={() => void loadOrderReports()}
                  disabled={reportLoading || reportLocationSaving || reportExporting}
                >
                  Refresh
                </button>
              </div>
              <p className="page-subtitle">
                Monthly workbooks are rebuilt from paid orders in the database, so
                refreshing or exporting again will not duplicate an order.
              </p>
              {reportError && <div className="error-banner">{reportError}</div>}
              {reportMessage && <div className="success-banner">{reportMessage}</div>}
              {!reportFolderPath && (
                <div className="error-banner">
                  Choose and save an Excel order-history folder on this device.
                </div>
              )}
              <div className="report-location">
                <div>
                  <span className="label">Excel save folder</span>
                  <strong className="report-folder-path">
                    {reportFolderPath || "Not configured"}
                  </strong>
                </div>
                <button
                  className="secondary-btn"
                  onClick={() => void chooseOrderReportsPath()}
                  disabled={reportLoading || reportLocationSaving || reportExporting}
                >
                  {reportLocationSaving
                    ? "Saving folder..."
                    : "Choose Excel Save Location"}
                </button>
                <button
                  className="primary-btn"
                  onClick={() => void exportOrderReports()}
                  disabled={
                    !reportFolderPath ||
                    reportLoading ||
                    reportLocationSaving ||
                    reportExporting
                  }
                >
                  {reportExporting ? "Updating..." : "Update Monthly Workbooks"}
                </button>
              </div>
              {reportLoading ? (
                <div className="empty-state">Loading monthly report information...</div>
              ) : reportSummary?.months.length ? (
                <div className="data-list">
                  {reportSummary.months.map((month) => (
                    <div className="data-row" key={month.month}>
                      <strong className="data-row-primary">{month.fileName}</strong>
                      <span className="data-row-secondary">
                        {month.orderCount} paid order(s) · Monthly total income{" "}
                        {money(month.totalIncome)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">B</div>
                  <h4>No completed and paid orders to report</h4>
                </div>
              )}
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
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiters.map((waiter) => (
                      <tr key={waiter.id}>
                        <td><strong>{waiter.name}</strong></td>
                        <td>{waiter.username}</td>
                        <td>
                          <div className="table-actions">
                            <button className="secondary-btn small" onClick={() => openEditUser(waiter)}>
                              Edit
                            </button>
                            <button
                              className="danger-btn small"
                              onClick={() => void deleteUser(waiter)}
                              disabled={deletingUserId === waiter.id}
                            >
                              {deletingUserId === waiter.id ? "Deleting..." : "Delete"}
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
                  <p className="page-subtitle">Manage Admin and Cashier accounts.</p>
                </div>
                <button className="primary-btn" onClick={openCreateStaffUser}>
                  Add User
                </button>
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
                    {staffUsers.filter((staffUser) => staffUser.role !== "WAITER").map((staffUser) => (
                      <tr key={staffUser.id}>
                        <td><strong>{staffUser.name}</strong></td>
                        <td>{staffUser.username}</td>
                        <td><span className="pill neutral">{staffUser.role}</span></td>
                        <td>
                          <div className="table-actions">
                            <button className="secondary-btn small" onClick={() => openEditUser(staffUser)}>
                              Edit
                            </button>
                            <button
                              className="danger-btn small"
                              onClick={() => void deleteUser(staffUser)}
                              disabled={deletingUserId === staffUser.id}
                            >
                              {deletingUserId === staffUser.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!waitersLoading &&
                staffUsers.every((staffUser) => staffUser.role === "WAITER") &&
                !waiterError && (
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

              <label>
                Description
                <textarea
                  value={productForm.description}
                  onChange={(event) => setProductForm((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                />
              </label>

              <label>
                Subcategory
                <input
                  value={productForm.subcategory}
                  onChange={(event) => setProductForm((current) => ({ ...current, subcategory: event.target.value }))}
                  placeholder="Optional menu section"
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

                <label>
                  Stock unit
                  <input
                    value={productForm.stockUnit}
                    onChange={(event) => setProductForm((current) => ({ ...current, stockUnit: event.target.value }))}
                  />
                </label>
              </div>

              <div className="two-col">
                <label>
                  Low-stock threshold
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={productForm.lowStockThreshold}
                    onChange={(event) => setProductForm((current) => ({ ...current, lowStockThreshold: event.target.value }))}
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

              <div className="two-col">
                <label>
                  Classification
                  <select
                    value={productForm.classification}
                    onChange={(event) => setProductForm((current) => ({
                      ...current,
                      classification: event.target.value === "NON_VEG" || event.target.value === "NOT_APPLICABLE"
                        ? event.target.value
                        : "VEG",
                    }))}
                  >
                    <option value="VEG">Vegetarian</option>
                    <option value="NON_VEG">Non Vegetarian</option>
                    <option value="NOT_APPLICABLE">Not Applicable</option>
                  </select>
                </label>
                <div className="switch-row">
                  <span>Signature</span>
                  <button
                    type="button"
                    className={productForm.isSignature ? "toggle-btn active" : "toggle-btn"}
                    onClick={() => setProductForm((current) => ({ ...current, isSignature: !current.isSignature }))}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>

              <label>
                Variants and prices (one per line)
                <textarea
                  value={productForm.variantsText}
                  onChange={(event) => setProductForm((current) => ({ ...current, variantsText: event.target.value }))}
                  rows={5}
                  placeholder={"Quarter - 130\nHalf - 250\nFull - 460"}
                />
              </label>

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
                <h3>
                  {activeTab === "waiters"
                    ? editingWaiter
                      ? "Edit waiter"
                      : "Add waiter"
                    : editingWaiter
                      ? "Edit staff user"
                      : "Add user"}
                </h3>
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

              <label>
                Username
                <input
                  value={waiterForm.username}
                  onChange={(event) => setWaiterForm((current) => ({ ...current, username: event.target.value }))}
                  autoComplete="username"
                  required
                />
              </label>

              {activeTab !== "waiters" && (
                <label>
                  Role
                  <select
                    value={waiterForm.role}
                    onChange={(event) => setWaiterForm((current) => ({ ...current, role: event.target.value as UserRole | "" }))}
                    required
                  >
                    <option value="" disabled>Select a role</option>
                    <option value="ADMIN">Admin</option>
                    <option value="CASHIER">Cashier</option>
                  </select>
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
                  {editingWaiter
                    ? "Save changes"
                    : activeTab === "waiters"
                      ? "Create waiter"
                      : "Create user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function WaiterModeScreen({ token }: { token: string }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});
  const [menuCategoryId, setMenuCategoryId] = useState<number | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? null;

  useEffect(() => {
    void loadData();
  }, [token]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [tablesResponse, categoriesResponse, productsResponse] = await Promise.all([
        request("/api/tables", {}, token),
        request("/api/products/categories", {}, token),
        request("/api/products", {}, token),
      ]);

      setTables(tablesResponse as Table[]);
      setCategories(categoriesResponse as Category[]);
      setProducts(productsResponse as Product[]);
      setSelectedVariants((current) => {
        const next = { ...current };
        for (const product of productsResponse as Product[]) {
          if (!product.variants?.length) continue;
          if (!product.variants.some((variant) => variant.id === next[product.id])) {
            next[product.id] = product.variants[0].id;
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load waiter console data");
    } finally {
      setLoading(false);
    }
  }

  const visibleMenuProducts = useMemo(() => {
    const query = menuSearch.trim().toLocaleLowerCase();
    return products.filter((product) => {
      if (menuCategoryId !== null && product.categoryId !== menuCategoryId) return false;
      if (!query) return true;
      return [product.name, product.category?.name ?? "", product.subcategory ?? ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [menuCategoryId, menuSearch, products]);

  const cartTotal = useMemo(() => {
    return Object.entries(quantities).reduce((sum, [key, quantity]) => {
      const [rawProductId, rawVariantId] = key.split(":");
      const productId = Number(rawProductId);
      const variantId = Number(rawVariantId);
      const product = products.find((item) => item.id === productId);
      if (!product) return sum;
      const variant = variantId
        ? product.variants?.find((item) => item.id === variantId)
        : undefined;
      const priceMinor = parseMinorUnits(variant?.price ?? product.price);
      if (priceMinor === null) throw new Error(`Invalid price for ${product.name}`);
      return sum + priceMinor * BigInt(quantity);
    }, 0n);
  }, [products, quantities]);

  function updateQuantity(productId: number, variantId: number | null, delta: number, stock: number) {
    setSuccess("");
    setQuantities((current) => {
      const key = `${productId}:${variantId ?? ""}`;
      const totalProductQuantity = Object.entries(current)
        .filter(([currentKey]) => currentKey.startsWith(`${productId}:`))
        .reduce((sum, [, quantity]) => sum + quantity, 0);
      if (delta > 0 && totalProductQuantity >= stock) return current;
      const nextQuantity = Math.max(0, (current[key] ?? 0) + delta);
      if (nextQuantity === 0) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: nextQuantity };
    });
  }

  async function openTable(tableId: number) {
    setSelectedTableId(tableId);
    setQuantities({});
    setSuccess("");

    try {
      const activeOrder = await request(`/api/orders/table/${tableId}/active`, {}, token);
      setActiveOrderId(activeOrder && typeof activeOrder === "object" && "id" in activeOrder ? Number((activeOrder as { id: number }).id) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load table order");
    }
  }

  async function submitOrder() {
    if (submittingRef.current) return;
    if (selectedTableId == null) {
      setError("Select a table before placing the order.");
      return;
    }

    const items = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([key, quantity]) => {
        const [productId, variantId] = key.split(":").map(Number);
        return {
          productId,
          ...(variantId ? { variantId } : {}),
          quantity: Number(quantity),
        };
      });

    if (!items.length) {
      setError("Select at least one item before placing the order.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      const endpoint = activeOrderId
        ? `/api/orders/${activeOrderId}/add-items`
        : "/api/orders";

      const body = activeOrderId
        ? { items }
        : { tableId: selectedTableId, items };

      const response = await request(endpoint, {
        method: activeOrderId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }, token);

      setSuccess(
        activeOrderId
          ? "Items were added to the active table order."
          : `Order created for ${selectedTable ? (selectedTable.isParcel ? "Parcel" : `Table ${selectedTable.number}`) : "the selected table"}.`,
      );
      setQuantities({});
      const createdOrderId = Number((response as { order?: { id?: number } })?.order?.id);
      setActiveOrderId(activeOrderId ?? (Number.isInteger(createdOrderId) && createdOrderId > 0 ? createdOrderId : null));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the order");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function sendToCashier() {
    if (submittingRef.current) return;
    if (!activeOrderId) {
      setError("There is no active order to send to the cashier.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      await request(`/api/orders/${activeOrderId}/send-to-cashier`, { method: "PATCH" }, token);
      setSuccess("Order sent to cashier successfully.");
      setActiveOrderId(null);
      setQuantities({});
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send the order to cashier");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="content-shell">
      <div className="page-header admin-header">
        <div>
          <div className="eyebrow">Service flow</div>
          <h2>Waiter Console</h2>
          <p className="page-subtitle">Create waiter orders directly from the desktop POS.</p>
        </div>
        <button className="secondary-btn" onClick={() => void loadData()}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      {loading ? (
        <div className="panel"><div className="empty-state"><div className="empty-icon">…</div><h4>Loading waiter console...</h4></div></div>
      ) : (
        <div className="billing-layout">
          <section className="panel order-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Choose service</div>
                <h3>Tables</h3>
              </div>
            </div>

            <div className="data-list">
              {tables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  className={selectedTableId === table.id ? "order-card selected" : "order-card"}
                  onClick={() => void openTable(table.id)}
                >
                  <div className="order-card-top">
                    <h4>{table.isParcel ? "Parcel" : `Table ${table.number}`}</h4>
                    <span className={`status-text ${table.status === "AVAILABLE" ? "success" : "danger"}`}>
                      {table.status}
                    </span>
                  </div>
                  <div className="order-card-grid">
                    <span>{table.isParcel ? "Parcel order" : "Restaurant table"}</span>
                    <strong>{table.status === "AVAILABLE" ? "Open for ordering" : "Order in progress"}</strong>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="panel bill-panel">
            {!selectedTable ? (
              <div className="bill-placeholder">
                <div>
                  <div className="placeholder-icon">☰</div>
                  <h3>Select a table</h3>
                  <p>Pick a table to view the menu and create a waiter order.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="bill-header">
                  <div>
                    <span className="eyebrow">Order</span>
                    <h3>{selectedTable.isParcel ? "Parcel" : `Table ${selectedTable.number}`}</h3>
                  </div>
                  <span className={`status-text ${selectedTable.status === "AVAILABLE" ? "success" : "danger"}`}>
                    {selectedTable.status}
                  </span>
                </div>

                <label className="search-field compact">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={menuSearch}
                    onChange={(event) => setMenuSearch(event.target.value)}
                    placeholder="Search menu..."
                    aria-label="Search menu"
                  />
                </label>
                <div className="card-actions" aria-label="Menu categories">
                  <button
                    type="button"
                    className={menuCategoryId === null ? "secondary-btn small active" : "secondary-btn small"}
                    onClick={() => setMenuCategoryId(null)}
                  >
                    All
                  </button>
                  {categories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      className={menuCategoryId === category.id ? "secondary-btn small active" : "secondary-btn small"}
                      onClick={() => setMenuCategoryId(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>

                <div className="bill-items">
                  {visibleMenuProducts.map((product) => {
                    const stock = Number(product.stock ?? 0);
                    const selectedVariantId = selectedVariants[product.id] ?? null;
                    const selectedVariant = product.variants?.find(
                      (variant) => variant.id === selectedVariantId,
                    );
                    const quantityKey = `${product.id}:${selectedVariantId ?? ""}`;
                    const quantity = quantities[quantityKey] ?? 0;
                    const totalQuantity = Object.entries(quantities)
                      .filter(([key]) => key.startsWith(`${product.id}:`))
                      .reduce((sum, [, count]) => sum + count, 0);
                    return (
                      <div className="bill-item" key={product.id}>
                        <div>
                          <strong>{product.name}</strong>
                          {product.subcategory && <span>{product.subcategory}</span>}
                          <span>
                            {product.classification === "NOT_APPLICABLE"
                              ? "Not Applicable"
                              : product.classification === "NON_VEG" || product.isVegetarian === false
                                ? "Non Vegetarian"
                                : "Vegetarian"}
                            {product.isSignature ? " · Signature" : ""}
                          </span>
                          {product.variants && product.variants.length > 0 && (
                            <select
                              aria-label={`${product.name} size`}
                              value={selectedVariantId ?? ""}
                              onChange={(event) => {
                                const variantId = Number(event.target.value);
                                if (product.variants?.some((variant) => variant.id === variantId)) {
                                  setSelectedVariants((current) => ({ ...current, [product.id]: variantId }));
                                }
                              }}
                            >
                              {product.variants.map((variant) => (
                                <option key={variant.id} value={variant.id}>
                                  {variant.name} · {money(variant.price)}
                                </option>
                              ))}
                            </select>
                          )}
                          <span>
                            {money(selectedVariant?.price ?? product.price)} · Stock {stock}
                          </span>
                        </div>
                        <div className="card-actions">
                          <button type="button" className="secondary-btn small" onClick={() => updateQuantity(product.id, selectedVariantId, -1, stock)} disabled={quantity === 0}>
                            −
                          </button>
                          <strong>{quantity}</strong>
                          <button type="button" className="secondary-btn small" onClick={() => updateQuantity(product.id, selectedVariantId, 1, stock)} disabled={totalQuantity >= stock}>
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {visibleMenuProducts.length === 0 && (
                    <div className="empty-state"><h4>No menu items match this filter</h4></div>
                  )}
                </div>

                <div className="bill-total-row">
                  <span>Selected total</span>
                  <strong>{money(minorUnitsToNumber(cartTotal))}</strong>
                </div>

                <div className="action-row">
                  <button type="button" className="secondary-btn" onClick={() => setQuantities({})}>
                    Clear
                  </button>
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="primary-btn full"
                    onClick={() => void submitOrder()}
                    disabled={submitting}
                  >
                    {submitting ? "Processing..." : activeOrderId ? "Add items to order" : "Place order"}
                  </button>
                </div>

                {activeOrderId && (
                  <div className="action-row">
                    <button
                      type="button"
                      className="secondary-btn full"
                      onClick={() => void sendToCashier()}
                      disabled={submitting}
                    >
                      Send to cashier
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
