// Server-side platform identity. JWT claims are only read AFTER Supabase validates
// the bearer; the session record and revocation cutoff are checked in PostgreSQL.
export interface PlatformEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WED_WORKER_SECRET?: string;
  WED_WORKER_SECRET_PREVIOUS?: string;
  // Transitional alias, restricted to Wed and ignored once its new key is set.
  TEAM_GRANT_SHARED_SECRET?: string;
}
export interface Identity {
  userId: string;
  sessionId: string;
  token: string;
}
export interface SessionStatus {
  active: boolean;
  reason?: "session" | "access";
  user_id?: string;
  session_id?: string;
  email?: string;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isId = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v);
export function sessionId(token: string): string | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")),
    );
    return isId(payload.session_id) ? payload.session_id : null;
  } catch {
    return null;
  }
}
function equal(a: string, b: string) {
  const x = new TextEncoder().encode(a),
    y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
export function productCaller(
  request: Request,
  env: PlatformEnv,
): "wed" | null {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  const current = env.WED_WORKER_SECRET || env.TEAM_GRANT_SHARED_SECRET;
  if (!token || !current) return null;
  // Registry-owned scope. Request bodies can never expand a credential's scope.
  return [
    current,
    env.WED_WORKER_SECRET ? env.WED_WORKER_SECRET_PREVIOUS : undefined,
  ].some((key) => key && equal(token, key))
    ? "wed"
    : null;
}
export function serviceHeaders(env: PlatformEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    ...(!env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")
      ? { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
      : {}),
  };
}
export async function rpc<T>(
  env: PlatformEnv,
  name: string,
  params: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
  if (!env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_"))
    headers.Authorization = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("Platform database unavailable");
  return res.json() as Promise<T>;
}
export async function callerSession(
  request: Request,
  env: PlatformEnv,
): Promise<Identity | null> {
  const auth = request.headers.get("authorization");
  const token = auth?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status >= 500) throw new Error("Authentication unavailable");
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  const sid = sessionId(token);
  return isId(user.id) && sid
    ? { userId: user.id, sessionId: sid, token }
    : null;
}
export const inspectSession = (
  env: PlatformEnv,
  identity: Pick<Identity, "userId" | "sessionId">,
  product: string | null = null,
) =>
  rpc<SessionStatus>(env, "rovty_session_status", {
    _user: identity.userId,
    _session: identity.sessionId,
    _product: product,
  });
export async function smallBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(bytes);
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value;
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
export async function handlePlatform(
  request: Request,
  env: PlatformEnv,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const product = path.startsWith("/api/product-session/");
  let identity: Pick<Identity, "userId" | "sessionId">;
  let scope: string | null = null;
  if (product) {
    scope = productCaller(request, env);
    if (!scope) return json({ error: "Unauthorized" }, 401);
    let body;
    try {
      body = await smallBody(request);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    if (body.product !== scope || !isId(body.user_id) || !isId(body.session_id))
      return json({ error: "Invalid product or session" }, 403);
    identity = { userId: body.user_id, sessionId: body.session_id };
  } else {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ error: "Forbidden" }, 403);
    const caller = await callerSession(request, env);
    if (!caller)
      return json({ error: "Sign in again.", code: "SESSION_EXPIRED" }, 401);
    identity = caller;
  }
  if (path.endsWith("/logout")) {
    await rpc(env, "rovty_revoke_sessions", {
      _user: identity.userId,
      _session: identity.sessionId,
    });
    return json({ ok: true });
  }
  const status = await inspectSession(env, identity, scope);
  if (!status.active)
    return json(
      {
        error:
          status.reason === "access"
            ? "Your product access is no longer active."
            : "Your Rovty session has ended.",
        code: status.reason === "access" ? "ACCESS_REVOKED" : "SESSION_EXPIRED",
      },
      status.reason === "access" ? 403 : 401,
    );
  return json(status);
}
