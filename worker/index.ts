import { mintSsoToken, verifySsoToken } from "./sso";

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SSO_SHARED_SECRET: string;
  // product -> the Worker origin that should receive the hand-off token.
  // Add an entry here (and a matching origin allowlist entry, see below) for
  // each product this pattern gets extended to.
  WED_ORIGIN: string;
}

// product slug -> product_access.product value AND the origin allowed to
// redeem a token for it. Resolve only trusts callers whose request matches
// this map — not strictly required (the token itself is the credential) but
// cheap defense in depth against a completely unrelated caller fishing for
// behavior on this endpoint.
function productOrigin(env: Env, product: string): string | null {
  if (product === "wed") return env.WED_ORIGIN;
  return null;
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

// `authKey` is either the caller's own access token (handleMint — RLS
// already scopes them to their own rows, no elevated privilege needed) or
// the service_role key (handleResolve — there's no user token at all in a
// server-to-server call, so this is the one place that genuinely needs it).
async function hasActiveAccess(env: Env, userId: string, product: string, authKey: string): Promise<boolean> {
  // apikey and Authorization must be the same credential for a service_role
  // call (PostgREST ties the acting role to Authorization, but expects a
  // matching apikey) — for a user call, apikey is always the anon key
  // regardless of whose JWT Authorization carries.
  const apikey = authKey === env.SUPABASE_SERVICE_ROLE_KEY ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/product_access?user_id=eq.${userId}&product=eq.${product}&status=eq.active&select=id&limit=1`,
    { headers: { Authorization: `Bearer ${authKey}`, apikey } },
  );
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

// Step 1: browser calls this, already signed in to the dashboard. Verifies
// the caller's own session + current product_access, then mints a token
// scoped to just their user_id and the one product.
async function handleMint(request: Request, env: Env): Promise<Response> {
  const user = await requireCallerSession(request, env);
  if (!user) return Response.json({ error: "Missing or invalid session" }, { status: 401 });

  let product: unknown;
  try {
    ({ product } = (await request.json()) as { product?: unknown });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof product !== "string") return Response.json({ error: "Invalid product" }, { status: 400 });

  const origin = productOrigin(env, product);
  if (!origin) return Response.json({ error: "Unknown product" }, { status: 400 });

  if (!(await hasActiveAccess(env, user.id, product, user.accessToken))) {
    return Response.json({ error: "Not active for this product" }, { status: 403 });
  }

  const token = await mintSsoToken(user.id, product, env.SSO_SHARED_SECRET);
  return Response.json({ url: `${origin}/sso?token=${encodeURIComponent(token)}` });
}

// Step 2: the product Worker's own server calls this (server-to-server, no
// browser involved) to redeem a token it received via redirect. This is
// where the token's signature is actually checked, where its nonce gets
// claimed exactly once, and where access is re-verified live — a token
// alone never establishes access; this endpoint is what does, every time.
async function handleResolve(request: Request, env: Env): Promise<Response> {
  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof token !== "string") return Response.json({ error: "Invalid token" }, { status: 400 });

  const payload = await verifySsoToken(token, env.SSO_SHARED_SECRET);
  if (!payload) return Response.json({ error: "Invalid or expired token" }, { status: 401 });

  if (!productOrigin(env, payload.product)) {
    return Response.json({ error: "Unknown product" }, { status: 400 });
  }

  // Claim the nonce — sso_nonces.nonce is a primary key, so a repeat claim
  // hits a unique-violation and this insert simply fails. That failure IS
  // the one-time-use enforcement; no separate check-then-act race.
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
  if (!claimRes.ok) {
    // 409 from Postgres' unique violation is the expected "already used" case;
    // anything else is still treated as a reject, never a silent pass-through.
    return Response.json({ error: "Token already used" }, { status: 409 });
  }

  // Re-check access at redemption time, not just at mint time — closes the
  // (small, ~3-minute) window where access could be revoked in between.
  if (!(await hasActiveAccess(env, payload.user_id, payload.product, env.SUPABASE_SERVICE_ROLE_KEY))) {
    return Response.json({ error: "Not active for this product" }, { status: 403 });
  }

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${payload.user_id}`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!userRes.ok) return Response.json({ error: "User not found" }, { status: 404 });
  const user = (await userRes.json()) as { email?: string };
  if (!user.email) return Response.json({ error: "Account has no email" }, { status: 400 });

  return Response.json({ email: user.email, product: payload.product });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/sso/mint") {
      return handleMint(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/sso/resolve") {
      return handleResolve(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
