import {
  callerSession,
  inspectSession,
  isId,
  serviceHeaders,
  smallBody,
  type PlatformEnv,
} from "./platform";
import { mintSsoToken, verifySsoToken } from "./sso";

interface PdfEnv extends PlatformEnv {
  SSO_SHARED_SECRET: string;
  PDF_ORIGIN?: string;
  PDF_WORKER_SECRET?: string;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
async function same(a: string, b: string) {
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const x = new Uint8Array(await digest(a)),
    y = new Uint8Array(await digest(b));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
// PDF cloud is free: validate the central account session without querying a
// paid product entitlement. Its credential cannot grant access or act as Wed.
export async function handlePdfAuth(
  request: Request,
  env: PdfEnv,
  ctx: ExecutionContext,
) {
  const path = new URL(request.url).pathname;
  if (!env.PDF_ORIGIN || !env.PDF_WORKER_SECRET)
    return json({ error: "PDF cloud sign-in is not configured yet." }, 503);
  const data = await smallBody(request);
  if (path === "/api/pdf-auth/mint") {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ error: "Forbidden" }, 403);
    if (
      !/^[a-f0-9]{64}$/.test(String(data.challenge)) ||
      !/^[a-f0-9]{64}$/.test(String(data.state))
    )
      return json({ error: "Start sign-in from Rovty PDF." }, 400);
    const user = await callerSession(request, env);
    if (!user) return json({ error: "Sign in again." }, 401);
    const status = await inspectSession(env, user);
    if (!status.active) return json({ error: "Your session has ended." }, 401);
    const token = await mintSsoToken(
      user.userId,
      user.sessionId,
      "pdf",
      env.SSO_SHARED_SECRET,
      { challenge: String(data.challenge), state: String(data.state) },
    );
    const target = new URL("/api/auth/callback", env.PDF_ORIGIN);
    target.searchParams.set("token", token);
    target.searchParams.set("state", String(data.state));
    return json({ url: target.href });
  }
  if (
    !(await same(
      request.headers.get("authorization") || "",
      `Bearer ${env.PDF_WORKER_SECRET}`,
    ))
  )
    return json({ error: "Unauthorized" }, 401);
  if (path === "/api/pdf-auth/check") {
    if (!isId(data.user_id) || !isId(data.session_id))
      return json({ error: "Invalid session" }, 400);
    const status = await inspectSession(env, {
      userId: data.user_id,
      sessionId: data.session_id,
    });
    return json(status, status.active ? 200 : 401);
  }
  if (
    path !== "/api/pdf-auth/resolve" ||
    typeof data.token !== "string" ||
    typeof data.verifier !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.verifier)
  )
    return json({ error: "Invalid hand-off" }, 400);
  const payload = await verifySsoToken(data.token, env.SSO_SHARED_SECRET);
  const challenge = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(data.verifier),
      ),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  if (
    !payload ||
    payload.product !== "pdf" ||
    payload.challenge !== challenge ||
    payload.state !== data.state
  )
    return json({ error: "Invalid hand-off" }, 401);
  const claim = await fetch(`${env.SUPABASE_URL}/rest/v1/sso_nonces`, {
    method: "POST",
    headers: {
      ...serviceHeaders(env),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      nonce: payload.nonce,
      user_id: payload.user_id,
      product: "pdf",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!claim.ok)
    return json(
      { error: "Hand-off already used or unavailable." },
      claim.status === 409 ? 409 : 503,
    );
  const status = await inspectSession(env, {
    userId: payload.user_id,
    sessionId: payload.session_id,
  });
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  ctx.waitUntil(
    fetch(
      `${env.SUPABASE_URL}/rest/v1/sso_nonces?consumed_at=lt.${encodeURIComponent(cutoff)}`,
      { method: "DELETE", headers: serviceHeaders(env) },
    ).catch(() => undefined),
  );
  return json(status, status.active ? 200 : 401);
}
