import { mintSsoToken, verifySsoToken } from "./sso";
import { findProduct } from "../shared/products";

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SSO_SHARED_SECRET: string;
  // Separate from SSO_SHARED_SECRET on purpose — that one signs short-lived
  // per-user hand-off tokens; this one is a static credential a product's
  // own Worker presents to prove it IS that product's server (used by both
  // /api/sso/resolve and /api/product-access/grant). Different purpose,
  // different blast radius if it ever leaks, so it rotates independently.
  TEAM_GRANT_SHARED_SECRET: string;
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

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
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

// Constant-time compare for shared-secret checks — a naive `===`
// short-circuits on the first mismatched byte, leaking prefix length via
// response timing.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
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

// Proves the caller is one of *our* product Workers (server-to-server), not a
// browser. Both /resolve and /grant require this: a leaked SSO token URL in
// someone's history or a proxy log must not be redeemable by whoever holds it.
function requireProductWorker(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  const presented = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  return !!presented && !!env.TEAM_GRANT_SHARED_SECRET && timingSafeEqual(presented, env.TEAM_GRANT_SHARED_SECRET);
}

async function requireCallerSession(
  request: Request,
  env: Env,
): Promise<{ id: string; email?: string; accessToken: string } | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const accessToken = auth.slice("Bearer ".length);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: string; email?: string };
  return { ...user, accessToken };
}

// `authKey` is either the caller's own access token (mint — RLS scopes them to
// their own rows) or the service_role key (resolve — server-to-server, no user
// token exists, so this is the one place that genuinely needs it).
async function hasActiveAccess(env: Env, userId: string, product: string, authKey: string): Promise<boolean> {
  const apikey = authKey === env.SUPABASE_SERVICE_ROLE_KEY ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const qs = new URLSearchParams({
    user_id: `eq.${userId}`,
    product: `eq.${product}`,
    status: "eq.active",
    select: "id",
    limit: "1",
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/product_access?${qs}`, {
    headers: { Authorization: `Bearer ${authKey}`, apikey },
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

// Step 1: browser calls this, already signed in to the dashboard. Verifies the
// caller's own session + current product_access, then mints a token scoped to
// just their user_id and the one product.
async function handleMint(request: Request, env: Env): Promise<Response> {
  // Same-origin only: the browser app is served from this Worker.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Forbidden" }, 403);
  if (await rateLimited(env, `mint:${clientIp(request)}`)) return tooMany();

  const user = await requireCallerSession(request, env);
  if (!user) return json({ error: "Missing or invalid session" }, 401);

  let product: unknown;
  try {
    ({ product } = (await request.json()) as { product?: unknown });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (typeof product !== "string") return json({ error: "Invalid product" }, 400);

  const target = productOrigin(env, product);
  if (!target) return json({ error: "Unknown product" }, 400);

  if (!(await hasActiveAccess(env, user.id, product, user.accessToken))) {
    return json({ error: "Not active for this product" }, 403);
  }

  const token = await mintSsoToken(user.id, product, env.SSO_SHARED_SECRET);
  return json({ url: `${target}/sso?token=${encodeURIComponent(token)}` });
}

// Housekeeping: a nonce only needs to live as long as a token can (3 min);
// anything older is dead weight. Runs via waitUntil after a successful
// resolve so it never adds latency to the hand-off itself.
async function pruneNonces(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await fetch(`${env.SUPABASE_URL}/rest/v1/sso_nonces?consumed_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: "return=minimal",
    },
  }).catch(() => undefined);
}

// Step 2: the product Worker's own server calls this (server-to-server) to
// redeem a token it received via redirect. This is where the signature is
// actually checked, the nonce claimed exactly once, and access re-verified
// live — a token alone never establishes access; this endpoint does.
async function handleResolve(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!requireProductWorker(request, env)) return json({ error: "Unauthorized" }, 401);
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
  if (!productOrigin(env, payload.product)) return json({ error: "Unknown product" }, 400);

  // Claim the nonce — sso_nonces.nonce is a primary key, so a repeat claim
  // hits a unique-violation and this insert fails. That failure IS the
  // one-time-use enforcement; no separate check-then-act race.
  const claimRes = await fetch(`${env.SUPABASE_URL}/rest/v1/sso_nonces`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ nonce: payload.nonce, user_id: payload.user_id, product: payload.product }),
  });
  if (!claimRes.ok) return json({ error: "Token already used" }, 409);

  // Re-check access at redemption time, not just at mint time.
  if (!(await hasActiveAccess(env, payload.user_id, payload.product, env.SUPABASE_SERVICE_ROLE_KEY))) {
    return json({ error: "Not active for this product" }, 403);
  }

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(payload.user_id)}`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!userRes.ok) return json({ error: "User not found" }, 404);
  const user = (await userRes.json()) as { email?: string };
  if (!user.email) return json({ error: "Account has no email" }, 400);

  ctx.waitUntil(pruneNonces(env));
  return json({ email: user.email, product: payload.product });
}

// Server-to-server only — called by a product's own Worker (e.g. rovty-wed's
// /api/team) right after IT decides someone should have access, because that
// product has its own team concept (wedding_members) the dashboard knows
// nothing about. Mirror image of mint/resolve: those prove "this dashboard
// user may enter that product"; this lets a product say "this email should be
// entitled to me."
async function handleGrantProductAccess(request: Request, env: Env): Promise<Response> {
  if (!requireProductWorker(request, env)) return json({ error: "Unauthorized" }, 401);
  if (await rateLimited(env, `grant:${clientIp(request)}`)) return tooMany();

  let body: { email?: unknown; product?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; product?: unknown };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const product = typeof body.product === "string" ? body.product : null;
  if (!email || !product) return json({ error: "Missing email or product" }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Invalid email" }, 400);
  if (!productOrigin(env, product)) return json({ error: "Unknown product" }, 400);

  // Find-or-create the dashboard-project auth user for this email.
  // generateLink creates the user if never seen before and returns the
  // existing one otherwise, and unlike inviteUserByEmail never sends mail.
  // The account has an unconfirmed email until they actually sign in.
  const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!linkRes.ok) return json({ error: "Could not resolve dashboard account" }, 502);
  const linked = (await linkRes.json()) as { id?: string; user?: { id?: string } };
  const userId = linked.id ?? linked.user?.id;
  if (!userId) return json({ error: "Could not resolve dashboard account" }, 502);

  // Upsert: re-inviting someone (or a retried call) re-affirms `active`
  // instead of erroring on the (user_id, product) unique constraint.
  const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/product_access?on_conflict=user_id,product`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: userId, product, status: "active", granted_at: new Date().toISOString() }),
  });
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
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      if (url.pathname === "/api/sso/mint") return handleMint(request, env);
      if (url.pathname === "/api/sso/resolve") return handleResolve(request, env, ctx);
      if (url.pathname === "/api/product-access/grant") return handleGrantProductAccess(request, env);
      return json({ error: "Not found" }, 404);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;
