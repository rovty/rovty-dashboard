import { handleAssistData, type AssistDataEnv } from "./assist-data";
import { mintSsoToken, verifySsoToken } from "./sso";
import { findProduct } from "../shared/products";
import {
  callerSession,
  serviceHeaders,
  inspectSession,
  productCaller,
  handlePlatform,
  type PlatformEnv,
} from "./platform";

export interface Env extends PlatformEnv, AssistDataEnv {
  ROVTY_ENV?: string;
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SSO_SHARED_SECRET: string;
  // product -> the Worker origin that should receive the hand-off token. The
  // var *name* per product lives in shared/products.ts; the value lives in
  // wrangler.jsonc (prod) / .dev.vars (local).
  WED_ORIGIN: string;
  // Optional Cloudflare rate-limit binding (wrangler.jsonc `ratelimits`).
  // When absent (plain local dev) endpoints work, just unlimited.
  SSO_RATE_LIMITER?: RateLimit;
}

// Declared locally rather than pulled from workers-types so the code compiles
// on a types package that predates the binding.
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

// product slug -> origin allowed to receive/redeem a token for it. Backed by
// the shared registry so the browser and this Worker can never disagree on
// which products exist.
function productOrigin(env: Env, product: string): string | null {
  const p = findProduct(product);
  if (!p) return null;
  const origin = env[p.originVar];
  return typeof origin === "string" && origin.length > 0 ? origin : null;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

// Best-effort abuse brake, keyed per endpoint so a burst on one can't lock
// legitimate traffic on another. Never fails closed if the limiter errors.
async function rateLimited(env: Env, key: string): Promise<boolean> {
  if (!env.SSO_RATE_LIMITER) return false;
  try {
    const { success } = await env.SSO_RATE_LIMITER.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

function tooMany(): Response {
  return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
}

// Step 1: browser calls this, already signed in to the dashboard. Verifies the
// caller's own session + current product_access, then mints a token scoped to
// just their user_id and the one product.
async function handleMint(request: Request, env: Env): Promise<Response> {
  // Same-origin only: the browser app is served from this Worker.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Forbidden" }, 403);
  if (await rateLimited(env, `mint:${clientIp(request)}`)) return tooMany();

  const user = await callerSession(request, env);
  if (!user) return json({ error: "Missing or invalid session" }, 401);

  let product: unknown;
  try {
    ({ product } = (await request.json()) as { product?: unknown });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (typeof product !== "string")
    return json({ error: "Invalid product" }, 400);

  const target = productOrigin(env, product);
  if (!target) return json({ error: "Unknown product" }, 400);

  const status = await inspectSession(env, user, product);
  if (!status.active)
    return json(
      {
        error:
          status.reason === "access"
            ? "Not active for this product"
            : "Your session has ended",
      },
      status.reason === "access" ? 403 : 401,
    );

  const token = await mintSsoToken(
    user.userId,
    user.sessionId,
    product,
    env.SSO_SHARED_SECRET,
  );
  return json({ url: `${target}/sso?token=${encodeURIComponent(token)}` });
}

// Housekeeping: a nonce only needs to live as long as a token can (3 min);
// anything older is dead weight. Runs via waitUntil after a successful
// resolve so it never adds latency to the hand-off itself.
async function pruneNonces(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/sso_nonces?consumed_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: "DELETE",
      headers: {
        ...serviceHeaders(env),
        Prefer: "return=minimal",
      },
    },
  ).catch(() => undefined);
}

// Step 2: the product Worker's own server calls this (server-to-server) to
// redeem a token it received via redirect. This is where the signature is
// actually checked, the nonce claimed exactly once, and access re-verified
// live — a token alone never establishes access; this endpoint does.
async function handleResolve(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const scope = productCaller(request, env);
  if (!scope) return json({ error: "Unauthorized" }, 401);
  if (await rateLimited(env, `resolve:${clientIp(request)}`)) return tooMany();

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (typeof token !== "string") return json({ error: "Invalid token" }, 400);

  const payload = await verifySsoToken(token, env.SSO_SHARED_SECRET);
  if (!payload) return json({ error: "Invalid or expired token" }, 401);
  if (!productOrigin(env, payload.product))
    return json({ error: "Unknown product" }, 400);
  if (payload.product !== scope)
    return json({ error: "Wrong product credential" }, 403);

  // Claim the nonce — sso_nonces.nonce is a primary key, so a repeat claim
  // hits a unique-violation and this insert fails. That failure IS the
  // one-time-use enforcement; no separate check-then-act race.
  const claimRes = await fetch(`${env.SUPABASE_URL}/rest/v1/sso_nonces`, {
    method: "POST",
    headers: {
      ...serviceHeaders(env),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      nonce: payload.nonce,
      user_id: payload.user_id,
      product: payload.product,
    }),
  });
  if (!claimRes.ok) return json({ error: "Token already used" }, 409);

  const status = await inspectSession(
    env,
    { userId: payload.user_id, sessionId: payload.session_id },
    scope,
  );
  if (!status.active)
    return json(
      {
        error:
          status.reason === "access"
            ? "Not active for this product"
            : "Your session has ended",
      },
      status.reason === "access" ? 403 : 401,
    );
  ctx.waitUntil(pruneNonces(env));
  return json({ ...status, product: scope, version: 2 });
}

// Server-to-server only — called by a product's own Worker (e.g. rovty-wed's
// /api/team) right after IT decides someone should have access, because that
// product has its own team concept (wedding_members) the dashboard knows
// nothing about. Mirror image of mint/resolve: those prove "this dashboard
// user may enter that product"; this lets a product say "this email should be
// entitled to me."
async function handleGrantProductAccess(
  request: Request,
  env: Env,
): Promise<Response> {
  const scope = productCaller(request, env);
  if (!scope) return json({ error: "Unauthorized" }, 401);
  if (await rateLimited(env, `grant:${clientIp(request)}`)) return tooMany();

  let body: { email?: unknown; product?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; product?: unknown };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const product = typeof body.product === "string" ? body.product : null;
  if (!email || !product)
    return json({ error: "Missing email or product" }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return json({ error: "Invalid email" }, 400);
  if (!productOrigin(env, product))
    return json({ error: "Unknown product" }, 400);
  if (product !== scope)
    return json({ error: "Wrong product credential" }, 403);

  // Find-or-create the dashboard-project auth user for this email.
  // generateLink creates the user if never seen before and returns the
  // existing one otherwise, and unlike inviteUserByEmail never sends mail.
  // The account has an unconfirmed email until they actually sign in.
  const linkRes = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/generate_link`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(env),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "magiclink", email }),
    },
  );
  if (!linkRes.ok)
    return json({ error: "Could not resolve dashboard account" }, 502);
  const linked = (await linkRes.json()) as {
    id?: string;
    user?: { id?: string };
  };
  const userId = linked.id ?? linked.user?.id;
  if (!userId)
    return json({ error: "Could not resolve dashboard account" }, 502);

  // Upsert: re-inviting someone (or a retried call) re-affirms `active`
  // instead of erroring on the (user_id, product) unique constraint.
  const upsertRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/product_access?on_conflict=user_id,product`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(env),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        product,
        status: "active",
        granted_at: new Date().toISOString(),
      }),
    },
  );
  if (!upsertRes.ok) return json({ error: "Could not grant access" }, 502);

  return json({ ok: true, email, product });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      try {
        if (url.pathname === "/api/assist-data")
          return await handleAssistData(request, env);
        if (
          [
            "/api/account/session",
            "/api/account/logout",
            "/api/product-session/check",
            "/api/product-session/logout",
          ].includes(url.pathname)
        )
          return await handlePlatform(request, env);
        if (url.pathname === "/api/sso/mint")
          return await handleMint(request, env);
        if (url.pathname === "/api/sso/resolve")
          return await handleResolve(request, env, ctx);
        if (url.pathname === "/api/product-access/grant")
          return await handleGrantProductAccess(request, env);
        return json({ error: "Not found" }, 404);
      } catch {
        return json(
          { error: "Rovty is temporarily unavailable. Please try again." },
          503,
        );
      }
    }
    const response = withSecurityHeaders(await env.ASSETS.fetch(request));
    if (env.ROVTY_ENV === "staging")
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  },
} satisfies ExportedHandler<Env>;
