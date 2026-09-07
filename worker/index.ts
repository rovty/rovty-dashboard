import { mintSsoToken, verifySsoToken } from "./sso";

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SSO_SHARED_SECRET: string;
  // Separate from SSO_SHARED_SECRET on purpose — that one signs short-lived
  // per-user hand-off tokens; this one is a static credential a product's
  // own Worker presents to prove it's allowed to grant product_access on
  // someone else's behalf (see handleGrantProductAccess). Different
  // purpose, different blast radius if it ever leaks, so it rotates
  // independently.
  TEAM_GRANT_SHARED_SECRET: string;
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

// Constant-time compare for the shared-secret check below — a naive `===`
// short-circuits on the first mismatched byte, which leaks how many leading
// characters a guess got right via response timing. The secret is long and
// random enough that this is a defense-in-depth measure, not the only thing
// standing between an attacker and the endpoint, but it's cheap to do right.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
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

// Server-to-server only — called by a product's own Worker (e.g. rovty-wed's
// /api/team) right after IT decides someone should have access, typically
// because that product has its own team/collaborator concept (e.g.
// wedding_members) that this dashboard knows nothing about and never will.
// This is deliberately the mirror image of the mint/resolve pair above:
// those two prove "this dashboard user may enter that product"; this one
// lets a product tell the dashboard "this email should be entitled to me."
// Trust is a static shared secret rather than a per-call signed token
// because there's no browser/session in the loop to scope a token to — the
// caller IS the trusted party, not someone acting on a user's behalf.
async function handleGrantProductAccess(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization");
  const presented = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!presented || !timingSafeEqual(presented, env.TEAM_GRANT_SHARED_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { email?: unknown; product?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; product?: unknown };
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const product = typeof body.product === "string" ? body.product : null;
  if (!email || !product) return Response.json({ error: "Missing email or product" }, { status: 400 });

  // Reuses productOrigin as an allowlist even though we don't need the
  // origin here — it's the one place "which products exist" is already
  // enumerated, and rejecting an unknown product keeps a typo or a
  // compromised caller from writing arbitrary product_access rows.
  if (!productOrigin(env, product)) return Response.json({ error: "Unknown product" }, { status: 400 });

  // Find-or-create the dashboard-project auth user for this email. Same
  // technique rovty-wed's own /sso route uses for its project (see that
  // file's comment): generateLink creates the user if this email has never
  // been seen in *this* Supabase project before, and returns the existing
  // user unchanged if it has — either way we get back an id, and unlike
  // inviteUserByEmail this never sends an email of its own, so a teammate
  // who's about to get a "you've been added" email from the product itself
  // doesn't also get an unrelated dashboard invite they didn't ask for.
  // Trade-off: the account this creates has an unconfirmed email until they
  // actually sign in (OAuth, or password reset) — acceptable here since the
  // alternative (inviteUserByEmail) both duplicates the product's own email
  // and fails outright for anyone who already has a dashboard account.
  const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!linkRes.ok) return Response.json({ error: "Could not resolve dashboard account" }, { status: 502 });
  const linked = (await linkRes.json()) as { id?: string; user?: { id?: string } };
  const userId = linked.id ?? linked.user?.id;
  if (!userId) return Response.json({ error: "Could not resolve dashboard account" }, { status: 502 });

  // Upsert rather than insert: re-inviting someone (or a retried call) just
  // re-affirms `active` instead of erroring on the (user_id, product)
  // unique constraint.
  const upsertRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/product_access?on_conflict=user_id,product`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: userId, product, status: "active", granted_at: new Date().toISOString() }),
    },
  );
  if (!upsertRes.ok) return Response.json({ error: "Could not grant access" }, { status: 502 });

  return Response.json({ ok: true, email, product });
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
    if (request.method === "POST" && url.pathname === "/api/product-access/grant") {
      return handleGrantProductAccess(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
