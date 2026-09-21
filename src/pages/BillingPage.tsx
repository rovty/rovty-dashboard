import { SITE_ORIGIN } from "../lib/navigation";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  billing,
  money,
  featureNames,
  type Plan,
  type Access,
} from "../lib/billing";
import "../billing.css";
interface Quote {
  amount_cents: number;
  subtotal_cents: number;
  discount_cents: number;
}
export default function BillingPage() {
  const { user } = useAuth();
  const { product = "wed" } = useParams();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<{
    plans: Plan[];
    mode: string;
    checkout_enabled: boolean;
  }>();
  const [access, setAccess] = useState<Access>();
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("plan") || "",
  );
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setAccess(undefined);
    setQuote(undefined);
    setError("");
    void Promise.all([
      fetch(`/api/billing/catalog?product=${encodeURIComponent(product)}`, {
        signal: controller.signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error("Plans are temporarily unavailable.");
        return r.json();
      }),
      billing<Access>("access", { product }, controller.signal),
    ])
      .then(([c, a]) => {
        if (!controller.signal.aborted) {
          setCatalog(c);
          setAccess(a);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [product, attempt, user?.id]);
  const plan = catalog?.plans.find((p) => p.code === selected);
  const currentRank =
    access?.active && access.source !== "member"
      ? catalog?.plans.find((p) => p.code === access.plan)?.rank || 0
      : 0;
  async function review() {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!quote)
        setQuote(
          await billing<Quote>("quote", { product, plan: selected, code }),
        );
      else {
        const result = await billing<{ order_id: string }>("checkout", {
          product,
          plan: selected,
          code,
          expected_amount: quote.amount_cents,
        });
        navigate(`/billing/orders/${result.order_id}`);
      }
    } catch (e) {
      setQuote(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell>
      <div className="billing-page">
        <Link to="/" className="billing-back">
          ← Your apps
        </Link>
        <div className="billing-heading">
          <div>
            <p className="billing-eyebrow">Rovty {product}</p>
            <h1>A plan for your celebration.</h1>
            <p>
              One payment for one wedding. Choose your tools, then make it
              yours.
            </p>
          </div>
          <Link to="/billing/history">Payment history ↗</Link>
        </div>
        {catalog?.mode === "test" && (
          <p className="billing-notice">
            Test checkout. No live payment or product access will be created.
          </p>
        )}
        {access?.active && (
          <p className="billing-notice">
            Your access: <strong>{access.plan || "Wedding team"}</strong>
            {access.expires_at &&
              ` · until ${new Date(access.expires_at).toLocaleDateString()}`}
            . Upgrades are charged at the full plan price and start a new
            hosting period.
          </p>
        )}
        {error && (
          <p role="alert" className="billing-error">
            {error}{" "}
            {!catalog && (
              <button onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            )}
          </p>
        )}
        {!catalog && !error && (
          <div className="billing-skeleton" role="status">
            Loading plans…
          </div>
        )}
        <div className="billing-plans">
          {catalog?.plans.map((p) => (
            <button
              type="button"
              key={p.code}
              disabled={p.rank <= (currentRank || 0)}
              aria-pressed={selected === p.code}
              className={`billing-plan ${selected === p.code ? "selected" : ""}`}
              onClick={() => {
                setSelected(p.code);
                setQuote(undefined);
                setError("");
              }}
            >
              <span className="billing-eyebrow">
                {p.rank <= (currentRank || 0)
                  ? "Included in your access"
                  : selected === p.code
                    ? "Selected"
                    : "Select plan"}
              </span>
              <h2>{p.name}</h2>
              <strong className="billing-price">{money(p.price_cents)}</strong>
              <p>{p.months} months hosting · one wedding</p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{featureNames[f] || f}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        {plan && plan.rank > (currentRank || 0) && (
          <section className="billing-checkout">
            <div>
              <h2>Your {plan.name} plan</h2>
              <p>
                You’ll pay securely on Payments.lk. Access begins after payment
                is confirmed.
              </p>
              <label>
                Promotion code <span>(optional)</span>
                <input
                  value={code}
                  maxLength={32}
                  autoComplete="off"
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setQuote(undefined);
                  }}
                  placeholder="Enter a code"
                />
              </label>
            </div>
            <div className="billing-total">
              {quote && (
                <>
                  <p>
                    Plan <span>{money(quote.subtotal_cents)}</span>
                  </p>
                  {quote.discount_cents > 0 && (
                    <p>
                      Promotion <span>−{money(quote.discount_cents)}</span>
                    </p>
                  )}
                  <p>
                    <strong>Total</strong>
                    <strong>{money(quote.amount_cents)}</strong>
                  </p>
                </>
              )}
              <button
                className="billing-primary"
                disabled={busy || !catalog?.checkout_enabled}
                onClick={() => void review()}
              >
                {busy
                  ? "Please wait…"
                  : quote
                    ? "Create order"
                    : "Review total"}
              </button>
              {!catalog?.checkout_enabled && (
                <p>
                  Online checkout is being set up.{" "}
                  <a href={`${SITE_ORIGIN}/contact`}>Contact Rovty</a>.
                </p>
              )}
              <p className="billing-fine">
                A saved checkout keeps its original price. A pending order will
                be reopened before a new one is created.
              </p>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
