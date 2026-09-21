import { SITE_ORIGIN } from "../lib/navigation";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { billing, money } from "../lib/billing";
import "../billing.css";
interface Order {
  id: string;
  product: string;
  plan_name: string;
  subtotal_cents: number;
  discount_cents: number;
  amount_cents: number;
  status: string;
  mode: string;
  months: number;
  created_at: string;
  checkout_url?: string;
  checkout_started_at?: string;
  provider_status?: string;
  review_reason?: string;
}
export default function BillingOrderPage() {
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setOrder(undefined);
    setError("");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    let stopped = false;
    const load = async () => {
      try {
        const o = await billing<Order>("order", { id }, controller.signal);
        if (stopped) return;
        setOrder(o);
        if (o.status === "pending" && polls++ < 30)
          timer = setTimeout(() => {
            if (!document.hidden) void load();
          }, 4000);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    const resume = () => {
      if (!document.hidden && !stopped) {
        clearTimeout(timer);
        polls = 0;
        void load();
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    void load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [id, attempt, user?.id]);
  async function pay() {
    setBusy(true);
    setError("");
    try {
      const o = await billing<Order>("resume", { id });
      setOrder(o);
      if (
        o.status === "pending" &&
        o.checkout_url &&
        !["completed", "processing"].includes(o.provider_status || "")
      )
        window.location.assign(o.checkout_url);
      else setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function changePlan() {
    if (!order || busy) return;
    setBusy(true);
    setError("");
    try {
      const canceled = await billing<Order>("cancel", { id });
      if (canceled.status === "expired") navigate(`/billing/${order.product}`);
      else {
        setOrder(canceled);
        setError(
          "This order has already been processed. Review its status before changing plans.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const paid = order?.status === "paid";
  return (
    <AppShell>
      <div className="billing-page billing-receipt">
        <Link to="/billing/history" className="billing-back">
          ← Payment history
        </Link>
        <p className="billing-eyebrow">Rovty checkout</p>
        <h1>
          {paid
            ? order.mode === "test"
              ? "Test payment received."
              : "Payment confirmed."
            : order?.status === "review"
              ? "Payment needs a review."
              : order?.status === "refunded"
                ? "Payment refunded."
                : order?.status === "expired"
                  ? "Checkout closed."
                  : "Your order."}
        </h1>
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {!order && !error && <p role="status">Loading order…</p>}
        {order && (
          <>
            <p className="billing-notice">
              {order.mode === "test"
                ? "Sandbox order. This does not grant live product access."
                : paid
                  ? "Your plan is ready to use."
                  : order.status === "pending"
                    ? "Returning from checkout does not confirm payment. This page checks for the signed payment confirmation automatically."
                    : order.status === "review"
                      ? "The Rovty team needs to review this payment. Contact support with your order number."
                      : "Your payment record is saved below."}
            </p>
            <section className="billing-invoice">
              <h2>
                Rovty {order.product} · {order.plan_name}
              </h2>
              <p>{order.months} months hosting · one wedding</p>
              <dl>
                <div>
                  <dt>Plan</dt>
                  <dd>{money(order.subtotal_cents)}</dd>
                </div>
                {order.discount_cents > 0 && (
                  <div>
                    <dt>Discount</dt>
                    <dd>−{money(order.discount_cents)}</dd>
                  </div>
                )}
                <div className="billing-grand-total">
                  <dt>Total</dt>
                  <dd>{money(order.amount_cents)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{order.status}</dd>
                </div>
                <div>
                  <dt>Order</dt>
                  <dd className="billing-id">{order.id}</dd>
                </div>
              </dl>
              {paid && order.mode === "live" ? (
                <Link className="billing-primary" to={`/open/${order.product}`}>
                  Open Rovty {order.product} ↗
                </Link>
              ) : order.status === "pending" ? (
                <button
                  className="billing-primary"
                  disabled={busy}
                  onClick={() => void pay()}
                >
                  {busy
                    ? "Opening secure checkout…"
                    : `Continue to pay ${money(order.amount_cents)}`}
                </button>
              ) : order.status === "review" ? (
                <a className="billing-primary" href={`${SITE_ORIGIN}/contact`}>
                  Contact Rovty
                </a>
              ) : (
                <Link
                  className="billing-primary"
                  to={`/billing/${order.product}`}
                >
                  View plans
                </Link>
              )}
              {order.status === "pending" && !order.checkout_started_at && (
                <button
                  className="billing-secondary"
                  disabled={busy}
                  onClick={() => void changePlan()}
                >
                  Change plan
                </button>
              )}
              <button
                className="billing-secondary"
                onClick={() => {
                  setError("");
                  setAttempt((a) => a + 1);
                }}
              >
                Check payment status
              </button>
              <a href={`${SITE_ORIGIN}/contact`} className="billing-back">
                Get help with this order ↗
              </a>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
export function BillingHistoryPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    setOrders(undefined);
    setError("");
    const c = new AbortController();
    void billing<Order[]>("orders", {}, c.signal)
      .then(setOrders)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [user?.id]);
  return (
    <AppShell>
      <div className="billing-page">
        <Link to="/" className="billing-back">
          ← Your apps
        </Link>
        <h1>Payment history</h1>
        {error && <p role="alert">{error}</p>}
        {!orders && !error && <p role="status">Loading payments…</p>}
        {orders?.length === 0 && (
          <p>
            No orders yet.{" "}
            <Link to="/billing/wed">Explore Rovty Wed plans</Link>.
          </p>
        )}
        <div className="billing-list">
          {orders?.map((o) => (
            <Link
              key={o.id}
              className="billing-row"
              to={`/billing/orders/${o.id}`}
            >
              <div>
                <strong>
                  Rovty {o.product} · {o.plan_name}
                </strong>
                <p>
                  {new Date(o.created_at).toLocaleDateString()} · {o.mode}
                </p>
              </div>
              <span>{money(o.amount_cents)}</span>
              <span>{o.status} ↗</span>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
