import {
  callerSession,
  inspectSession,
  isId,
  productCaller,
  serviceHeaders,
  smallBody,
  type PlatformEnv,
} from "./platform";
import { findProduct } from "../shared/products";
import {
  PaymentError,
  providerRequest,
  rawWebhook,
  verifyWebhook,
} from "./payments-lk";
export interface BillingEnv extends PlatformEnv {
  PAYMENTS_LK_SECRET_KEY?: string;
  PAYMENTS_LK_WEBHOOK_SECRET?: string;
  PAYMENTS_LK_WEBHOOK_SECRET_PREVIOUS?: string;
  BILLING_MODE?: "test" | "live";
  BILLING_ORIGIN?: string;
}
interface Order {
  id: string;
  user_id: string;
  product: string;
  status: string;
  mode: string;
  created_at: string;
  checkout_id: string | null;
  checkout_url: string | null;
  request_body: Record<string, unknown>;
  amount_cents: number;
}
class BillingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
async function db<T>(
  env: BillingEnv,
  name: string,
  params: unknown,
): Promise<T> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...serviceHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    const e = (await r.json()) as { code?: string; message?: string };
    if (e.code === "42501")
      throw new BillingError("Rovty billing team access is required.", 403);
    if (e.code === "40001")
      throw new BillingError(
        e.message || "This record changed. Refresh and try again.",
        409,
      );
    if (e.code === "P0001")
      throw new BillingError(e.message || "Check the details and try again.");
    if (
      [
        "23514",
        "23502",
        "23503",
        "23505",
        "22P02",
        "22007",
        "22008",
        "22003",
      ].includes(e.code || "")
    )
      throw new BillingError(
        "Check the values. A required value is invalid or already exists.",
      );
    throw new BillingError(
      "Billing is temporarily unavailable. Please try again.",
      503,
    );
  }
  return r.json() as Promise<T>;
}
function paymentMode(env: BillingEnv) {
  return env.BILLING_MODE === "live" ? "live" : "test";
}
function configured(env: BillingEnv) {
  return Boolean(
    env.PAYMENTS_LK_SECRET_KEY?.startsWith(`sk_${paymentMode(env)}_`) &&
    env.PAYMENTS_LK_WEBHOOK_SECRET &&
    env.BILLING_ORIGIN,
  );
}
function product(value: unknown): string {
  if (typeof value !== "string" || !findProduct(value))
    throw new BillingError("Unknown product.");
  return value;
}
function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new BillingError("Forbidden", 403);
}
async function webhook(request: Request, env: BillingEnv) {
  if (!env.PAYMENTS_LK_WEBHOOK_SECRET)
    return json({ error: "Webhook not configured" }, 503);
  let event;
  try {
    const raw = await rawWebhook(request);
    for (const secret of [
      env.PAYMENTS_LK_WEBHOOK_SECRET,
      env.PAYMENTS_LK_WEBHOOK_SECRET_PREVIOUS,
    ].filter(Boolean)) {
      try {
        event = await verifyWebhook(
          raw,
          request.headers.get("payments-signature"),
          secret!,
        );
        break;
      } catch {
        /* Try rotating key. */
      }
    }
    if (!event) throw new Error("Invalid signature");
  } catch {
    return json({ error: "Invalid webhook" }, 400);
  }
  if (event.type === "test.ping") return json({ ok: true });
  if (event.mode !== paymentMode(env))
    return json({ error: "Webhook mode does not match this environment" }, 400);
  // Database failures must be retried by the provider, never acknowledged as fulfilled.
  try {
    return json(await db(env, "billing_event", { _event: event }));
  } catch {
    return json(
      { error: "Webhook processing unavailable. Retry delivery." },
      503,
    );
  }
}
export async function handleBilling(
  request: Request,
  env: BillingEnv,
): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/api/billing/catalog" && request.method === "GET") {
      const plans = await db(env, "billing_catalog", {
        _product: product(url.searchParams.get("product")),
      });
      return Response.json(
        { plans, checkout_enabled: configured(env), mode: paymentMode(env) },
        {
          headers: {
            "Cache-Control": "public, max-age=30",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
    if (path === "/api/billing/webhook" && request.method === "POST")
      return webhook(request, env);
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    let body;
    try {
      body = await smallBody(request);
    } catch {
      throw new BillingError("Invalid request.");
    }
    if (path === "/api/billing/entitlements") {
      const scope = productCaller(request, env);
      if (!scope || body.product !== scope)
        throw new BillingError("Forbidden", 403);
      if (
        !Array.isArray(body.users) ||
        body.users.length > 100 ||
        !body.users.every(isId)
      )
        throw new BillingError("Invalid accounts.");
      return json(
        await db(env, "billing_access_many", {
          _users: body.users,
          _product: scope,
        }),
      );
    }
    const scoped = path === "/api/billing/product";
    let uid: string;
    let scope: string | null = null;
    if (scoped) {
      scope = productCaller(request, env);
      if (
        !scope ||
        body.product !== scope ||
        !isId(body.user_id) ||
        !isId(body.session_id)
      )
        throw new BillingError("Forbidden", 403);
      if (
        !(
          await inspectSession(
            env,
            { userId: body.user_id, sessionId: body.session_id },
            scope,
          )
        ).active
      )
        throw new BillingError(
          "Your Rovty session or product access has ended.",
          401,
        );
      uid = body.user_id;
    } else {
      sameOrigin(request);
      const identity = await callerSession(request, env);
      if (!identity || !(await inspectSession(env, identity)).active)
        throw new BillingError("Sign in to continue.", 401);
      uid = identity.userId;
    }
    if (scoped || path === "/api/billing/admin") {
      return json(
        await db(env, "billing_admin", {
          _actor: uid,
          _product: scope || product(body.product),
          _action: body.action,
          _params: body.params || {},
        }),
      );
    }
    if (path === "/api/billing/orders")
      return json(await db(env, "billing_orders_for", { _user: uid }));
    if (path === "/api/billing/access")
      return json(
        await db(env, "billing_access", {
          _user: uid,
          _product: product(body.product),
        }),
      );
    if (path === "/api/billing/quote" || path === "/api/billing/checkout") {
      const slug = product(body.product);
      if (
        typeof body.plan !== "string" ||
        body.plan.length > 40 ||
        (body.code != null &&
          (typeof body.code !== "string" || body.code.length > 32))
      )
        throw new BillingError("Choose a plan and a valid promotion code.");
      const args = {
        _user: uid,
        _product: slug,
        _plan: body.plan,
        _code: body.code || "",
        _mode: paymentMode(env),
      };
      if (path.endsWith("/quote"))
        return json(await db(env, "billing_quote", args));
      if (!configured(env))
        throw new BillingError(
          "Online checkout is not available yet. Please contact Rovty.",
          503,
        );
      if (!Number.isSafeInteger(body.expected_amount))
        throw new BillingError("Review the price before paying.");
      const order = await db<Order>(env, "billing_create_order", {
        ...args,
        _origin: new URL(env.BILLING_ORIGIN!).origin,
        _expected: body.expected_amount,
      });
      // Creation reserves price/promotion before the provider is contacted. Return an order
      // URL immediately; its resume action owns retries and can recover an ambiguous timeout.
      return json({ order_id: order.id });
    }
    if (
      path === "/api/billing/order" ||
      path === "/api/billing/resume" ||
      path === "/api/billing/cancel"
    ) {
      if (!isId(body.id)) throw new BillingError("Invalid order.");
      let order = await db<Order | null>(env, "billing_order", {
        _user: uid,
        _id: body.id,
      });
      if (!order) throw new BillingError("Order not found.", 404);
      if (path.endsWith("/cancel"))
        return json(
          await db(env, "billing_checkout_action", {
            _user: uid,
            _id: order.id,
            _action: "cancel",
          }),
        );
      if (path.endsWith("/resume")) {
        if (!configured(env) || order.mode !== paymentMode(env))
          throw new BillingError(
            "This checkout is not available in the current payment mode.",
            409,
          );
        if (order.status !== "pending") return json(order);
        if (
          !order.checkout_id &&
          Date.now() - Date.parse(order.created_at) > 23 * 60 * 60 * 1000
        )
          throw new BillingError(
            "This checkout needs a Rovty team review before retrying. Contact support with the order number.",
            409,
          );
        order = await db<Order>(env, "billing_checkout_action", {
          _user: uid,
          _id: order.id,
          _action: "start",
        });
        if (order.status !== "pending") return json(order);
        const checkout = order.checkout_id
          ? await providerRequest(
              env.PAYMENTS_LK_SECRET_KEY!,
              `checkouts/${encodeURIComponent(order.checkout_id)}`,
            )
          : await providerRequest(
              env.PAYMENTS_LK_SECRET_KEY!,
              "checkouts",
              order.request_body,
              `rovty-order-${order.id}`,
            );
        order = await db<Order>(env, "billing_attach", {
          _id: order.id,
          _checkout: checkout,
        });
        return json({ ...order, provider_status: checkout.status });
      }
      return json(order);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof BillingError) return json({ error: e.message }, e.status);
    if (e instanceof PaymentError)
      return json(
        {
          error: e.message,
          code: e.code,
          reason: e.reason,
          traceId: e.traceId,
        },
        502,
      );
    return json(
      {
        error: "Billing is temporarily unavailable. Please try again.",
      },
      503,
    );
  }
}
