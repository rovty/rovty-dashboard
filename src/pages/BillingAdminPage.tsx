import { WED_ORIGIN } from "../lib/navigation";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { billing, money, type Access, type Plan } from "../lib/billing";
import "../billing.css";
type Tab = "users" | "plans" | "promotions" | "orders" | "audit";
interface Account {
  id: string;
  email: string;
  name: string;
  access: Access;
}
interface Promotion {
  id: string;
  code: string;
  plan_code: string | null;
  kind: string;
  value: number;
  active: boolean;
  starts_at: string;
  ends_at: string;
  max_uses: number;
  per_user: number;
  version: number;
}
interface Order {
  id: string;
  email: string;
  plan_name: string;
  amount_cents: number;
  status: string;
  mode: string;
  created_at: string;
  review_reason?: string;
  payment_id?: string;
  checkout_id?: string;
  promotion_code?: string;
}
interface Audit {
  id: number;
  action: string;
  target: string;
  reason: string;
  created_at: string;
  before_value: unknown;
  after_value: unknown;
}
interface View {
  users?: { items: Account[]; total: number };
  plans?: Plan[];
  promotions?: Promotion[];
  orders?: { items: Order[] };
  audit?: Audit[];
}
export default function BillingAdminPage() {
  const { user } = useAuth();
  const { product = "wed" } = useParams();
  const [tab, setTab] = useState<Tab>("users");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [role, setRole] = useState<string>();
  const [view, setView] = useState<View>({});
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [edit, setEdit] = useState<Account | Plan | Promotion | "new" | null>(
    null,
  );
  const editRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (edit) {
      editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      editRef.current
        ?.querySelector<HTMLElement>("input, select")
        ?.focus({ preventScroll: true });
    }
  }, [edit]);
  const admin = <T,>(
    action: string,
    params: unknown = {},
    signal?: AbortSignal,
  ) => billing<T>("admin", { product, action, params }, signal);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    const c = new AbortController();
    setView({});
    setRole(undefined);
    setPlans([]);
    setError("");
    void Promise.all([
      billing<{ role: string }>(
        "admin",
        { product, action: "access" },
        c.signal,
      ),
      billing<Plan[]>("admin", { product, action: "plans" }, c.signal),
      billing<unknown>(
        "admin",
        { product, action: tab, params: { query: search, page } },
        c.signal,
      ),
    ])
      .then(([a, p, v]) => {
        if (!c.signal.aborted) {
          setRole(a.role);
          setPlans(p);
          setView({ [tab]: v });
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setRole(undefined);
          setView({});
          setPlans([]);
          setEdit(null);
          setError(e.message);
        }
      });
    return () => c.abort();
  }, [product, tab, search, page, refresh, user?.id]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !edit) return;
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(event.currentTarget);
    const value = (key: string) => String(f.get(key) || "");
    try {
      if (tab === "users" && typeof edit === "object" && "access" in edit)
        await admin("assign", {
          user_id: edit.id,
          version: edit.access.revision,
          plan: value("plan"),
          status: value("status"),
          expires_at: new Date(value("expires_at")).toISOString(),
          reason: value("reason"),
        });
      if (tab === "plans" && typeof edit === "object" && "price_cents" in edit)
        await admin("save_plan", {
          code: edit.code,
          version: edit.version,
          price_cents: Math.round(Number(value("price")) * 100),
          months: Number(value("months")),
          active: f.has("active"),
          reason: value("reason"),
        });
      if (tab === "promotions") {
        const p = edit === "new" ? null : (edit as Promotion);
        await admin("save_promotion", {
          id: p?.id,
          version: p?.version || 0,
          code: value("code"),
          plan_code: value("plan_code"),
          kind: value("kind"),
          value:
            value("kind") === "fixed"
              ? Math.round(Number(value("value")) * 100)
              : Number(value("value")),
          active: f.has("active"),
          starts_at: p?.starts_at || new Date().toISOString(),
          ends_at: new Date(value("ends_at")).toISOString(),
          max_uses: Number(value("max_uses")),
          per_user: Number(value("per_user")),
          reason: value("reason"),
        });
      }
      setEdit(null);
      setNotice("Saved. The change is recorded in billing history.");
      setRefresh((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const dateInput = (date?: string, months = 6) => {
    const d = date ? new Date(date) : new Date();
    if (!date) d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  const canEdit = role === "admin";
  return (
    <AppShell>
      <div className="billing-page">
        <Link to="/" className="billing-back">
          ← Your apps
        </Link>
        <div className="billing-heading">
          <div>
            <p className="billing-eyebrow">Rovty {product} · team management</p>
            <h1>Plans & payments</h1>
            <p>Manage product access, pricing and promotions in one place.</p>
          </div>
          {product === "wed" && (
            <a href={`${WED_ORIGIN}/admin/manage`}>Wedding management ↗</a>
          )}
        </div>
        <nav className="billing-tabs" aria-label="Billing management">
          {(["users", "plans", "promotions", "orders", "audit"] as Tab[]).map(
            (t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => {
                  setTab(t);
                  setEdit(null);
                  setPage(0);
                  setQuery("");
                  setNotice("");
                }}
              >
                {t === "audit" ? "Change history" : t}
              </button>
            ),
          )}
        </nav>
        {error && (
          <p role="alert" className="billing-error">
            {error}{" "}
            <button
              onClick={() => {
                setEdit(null);
                setRefresh((r) => r + 1);
              }}
            >
              Refresh
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="billing-notice">
            {notice}
          </p>
        )}
        {["users", "orders"].includes(tab) && (
          <label className="billing-search">
            {tab === "users" ? "Search all Rovty accounts" : "Search payments"}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                tab === "users"
                  ? "Name or email address"
                  : "Email, order number, status or mode"
              }
            />
          </label>
        )}
        {!view[tab] && !error && (
          <div className="billing-skeleton" role="status">
            Loading {tab}…
          </div>
        )}
        {view.users?.items.map((u) => (
          <div className="billing-row" key={u.id}>
            <div>
              <strong>{u.name || u.email}</strong>
              <p>{u.email}</p>
            </div>
            <div>
              <strong>{u.access.plan || "No purchased plan"}</strong>
              <p>
                {u.access.active ? "Active" : "Inactive"} ·{" "}
                {u.access.source || "No access"}
                {u.access.expires_at
                  ? ` · ${new Date(u.access.expires_at).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            {canEdit && (
              <button className="billing-secondary" onClick={() => setEdit(u)}>
                Manage access
              </button>
            )}
          </div>
        ))}
        {view.users?.total === 0 && <p>No matching accounts.</p>}
        {view.plans?.map((p) => (
          <div key={p.code} className="billing-row">
            <div>
              <h2>{p.name}</h2>
              <p>
                {p.active ? "Available" : "Hidden from checkout"} · {p.months}{" "}
                months
              </p>
            </div>
            <strong>{money(p.price_cents)}</strong>
            {canEdit && (
              <button className="billing-secondary" onClick={() => setEdit(p)}>
                Edit plan
              </button>
            )}
          </div>
        ))}
        {tab === "promotions" && canEdit && (
          <button className="billing-primary" onClick={() => setEdit("new")}>
            Create promotion
          </button>
        )}
        {view.promotions?.map((p) => (
          <div key={p.id} className="billing-row">
            <div>
              <strong>{p.code}</strong>
              <p>
                {p.kind === "percent" ? `${p.value}%` : money(p.value)} off ·{" "}
                {p.plan_code || "All plans"} · {p.active ? "Active" : "Paused"}
              </p>
            </div>
            <p>
              Ends {new Date(p.ends_at).toLocaleDateString()}
              <br />
              Limit {p.max_uses} · {p.per_user} per account
            </p>
            {canEdit && (
              <button className="billing-secondary" onClick={() => setEdit(p)}>
                Edit promotion
              </button>
            )}
          </div>
        ))}
        {view.orders?.items.map((o) => (
          <details key={o.id} className="billing-details">
            <summary>
              <strong>
                {o.email} · {o.plan_name}
              </strong>
              <span>
                {money(o.amount_cents)} · {o.mode} · {o.status}
              </span>
            </summary>
            <dl>
              <div>
                <dt>Order</dt>
                <dd>{o.id}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(o.created_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{o.payment_id || "Not created"}</dd>
              </div>
              <div>
                <dt>Checkout</dt>
                <dd>{o.checkout_id || "Not created"}</dd>
              </div>
              <div>
                <dt>Promotion</dt>
                <dd>{o.promotion_code || "None"}</dd>
              </div>
            </dl>
            {o.review_reason && (
              <p className="billing-notice">{o.review_reason}</p>
            )}
            <p>
              Refunds are issued in Payments.lk. A signed full-refund event
              removes access granted by that order.
            </p>
          </details>
        ))}
        {view.audit?.map((a) => (
          <details className="billing-details" key={a.id}>
            <summary>
              <strong>{a.action.replace(/_/g, " ")}</strong>
              <span>{new Date(a.created_at).toLocaleString()}</span>
            </summary>
            <p>{a.reason}</p>
            <p className="billing-id">{a.target}</p>
            <pre>
              {JSON.stringify(
                { before: a.before_value, after: a.after_value },
                null,
                2,
              )}
            </pre>
          </details>
        ))}
        {(["users", "orders"] as string[]).includes(tab) && view[tab] && (
          <div className="billing-pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page + 1}
              {view.users && ` · ${view.users.total} accounts`}
            </span>
            <button
              disabled={
                view.users
                  ? (page + 1) * 25 >= view.users.total
                  : (view.orders?.items.length || 0) < 25
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
        {edit && canEdit && (
          <form
            ref={editRef}
            key={edit === "new" ? "new" : "id" in edit ? edit.id : edit.code}
            className="billing-edit"
            onSubmit={(e) => void save(e)}
          >
            <div className="billing-heading">
              <h2>
                {tab === "users"
                  ? "Account access"
                  : tab === "plans"
                    ? "Plan settings"
                    : "Promotion settings"}
              </h2>
              <button
                type="button"
                className="billing-secondary"
                onClick={() => setEdit(null)}
              >
                Close
              </button>
            </div>
            {tab === "users" &&
              typeof edit === "object" &&
              "access" in edit && (
                <>
                  <p>
                    <strong>{edit.email}</strong>
                    <br />
                    Plan access is separate from wedding team and Rovty staff
                    roles.
                  </p>
                  <label>
                    Plan
                    <select
                      aria-label="Plan"
                      name="plan"
                      defaultValue={edit.access.plan || plans[0]?.code}
                    >
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select
                      aria-label="Status"
                      name="status"
                      defaultValue={edit.access.active ? "active" : "inactive"}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <label>
                    Access ends (UTC)
                    <input
                      name="expires_at"
                      type="date"
                      required
                      defaultValue={dateInput(edit.access.expires_at)}
                    />
                  </label>
                </>
              )}
            {tab === "plans" &&
              typeof edit === "object" &&
              "price_cents" in edit && (
                <>
                  <p>
                    New orders use this price. Existing orders keep their saved
                    total.
                  </p>
                  <label>
                    Price (LKR)
                    <input
                      name="price"
                      type="number"
                      min="10"
                      max="1000000"
                      step="0.01"
                      required
                      defaultValue={edit.price_cents / 100}
                    />
                  </label>
                  <label>
                    Hosting months
                    <input
                      name="months"
                      type="number"
                      min="1"
                      max="120"
                      required
                      defaultValue={edit.months}
                    />
                  </label>
                  <label className="billing-checkbox">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={edit.active}
                    />
                    Available for purchase
                  </label>
                </>
              )}
            {tab === "promotions" &&
              (() => {
                const p = edit === "new" ? null : (edit as Promotion);
                return (
                  <>
                    <p>
                      Existing orders retain their discount. Test and live
                      redemption limits are counted separately. Pending
                      checkouts reserve uses until confirmed closed.
                    </p>
                    <label>
                      Code
                      <input
                        name="code"
                        required
                        pattern="[A-Z0-9][A-Z0-9_-]{2,31}"
                        defaultValue={p?.code || ""}
                        readOnly={!!p}
                      />
                    </label>
                    <label>
                      Applies to
                      <select
                        aria-label="Applies to"
                        name="plan_code"
                        defaultValue={p?.plan_code || ""}
                        disabled={!!p}
                      >
                        <option value="">All plans</option>
                        {plans.map((plan) => (
                          <option key={plan.code} value={plan.code}>
                            {plan.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Discount type
                      <select
                        aria-label="Discount type"
                        name="kind"
                        defaultValue={p?.kind || "percent"}
                        disabled={!!p}
                      >
                        <option value="percent">Percentage (1 to 95)</option>
                        <option value="fixed">Fixed amount (LKR)</option>
                      </select>
                    </label>
                    <label>
                      Discount value
                      <input
                        name="value"
                        type="number"
                        step="0.01"
                        min="1"
                        required
                        readOnly={!!p}
                        defaultValue={
                          p
                            ? p.kind === "fixed"
                              ? p.value / 100
                              : p.value
                            : 10
                        }
                      />
                    </label>
                    <label>
                      Ends (UTC)
                      <input
                        name="ends_at"
                        type="date"
                        required
                        defaultValue={dateInput(p?.ends_at, 1)}
                      />
                    </label>
                    <label>
                      Total uses
                      <input
                        name="max_uses"
                        type="number"
                        min="1"
                        max="1000000"
                        required
                        defaultValue={p?.max_uses || 100}
                      />
                    </label>
                    <label>
                      Uses per account
                      <input
                        name="per_user"
                        type="number"
                        min="1"
                        max="100"
                        required
                        readOnly={!!p}
                        defaultValue={p?.per_user || 1}
                      />
                    </label>
                    <label className="billing-checkbox">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={p?.active ?? true}
                      />
                      Active
                    </label>
                    {p && (
                      <p>
                        To change the discount terms, pause this code and create
                        a new one.
                      </p>
                    )}
                  </>
                );
              })()}
            <label>
              Reason for this change
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={500}
                placeholder="For example, launch pricing or an approved customer adjustment"
              />
            </label>
            <button className="billing-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
