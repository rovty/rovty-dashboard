import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const built = await build({
  stdin: {
    contents:
      "export { default } from './worker/index.ts'; export * from './worker/sso.ts'; export * from './worker/platform.ts';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  default: worker,
  mintSsoToken,
  verifySsoToken,
  productCaller,
} = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const uid = "00000000-0000-4000-8000-000000000001",
  sid = "00000000-0000-4000-8000-000000000002";
const jwt = `a.${Buffer.from(JSON.stringify({ session_id: sid })).toString("base64url")}.b`;
const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_ANON_KEY: "public",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server",
  SSO_SHARED_SECRET: "test-signing-secret",
  WED_WORKER_SECRET: "wed-only-secret",
  TEAM_GRANT_SHARED_SECRET: "old-shared-secret",
  WED_ORIGIN: "https://wed.example.test",
  ASSIST_DATA_SECRET: "support-only-secret",
};
const request = (
  path,
  body = {},
  token = jwt,
  origin = "https://dash.example.test",
) =>
  new Request(`https://dash.example.test${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
const ctx = { waitUntil: () => {} };
test("product credentials have fixed scope and old shared key stops working after rotation", () => {
  assert.equal(
    productCaller(request("/x", {}, env.WED_WORKER_SECRET), env),
    "wed",
  );
  for (const secret of [
    env.TEAM_GRANT_SHARED_SECRET,
    env.ASSIST_DATA_SECRET,
    "unknown",
  ])
    assert.equal(productCaller(request("/x", {}, secret), env), null);
  assert.equal(
    productCaller(request("/x", {}, "previous"), {
      ...env,
      WED_WORKER_SECRET_PREVIOUS: "previous",
    }),
    "wed",
  );
});
test("handoff signatures bind the central session and expire safely for malformed tokens", async () => {
  const token = await mintSsoToken(uid, sid, "wed", env.SSO_SHARED_SECRET);
  assert.equal(
    (await verifySsoToken(token, env.SSO_SHARED_SECRET)).session_id,
    sid,
  );
  for (const input of ["bad", "a.b", ".".repeat(8000), token + "x"])
    assert.equal(await verifySsoToken(input, env.SSO_SHARED_SECRET), null);
});
test("resolve returns a permanent ID and refuses replay or newly revoked access", async (t) => {
  let claimed = false,
    active = true;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    if (String(url).endsWith("/sso_nonces") && init.method === "POST") {
      if (claimed) return Response.json({}, { status: 409 });
      claimed = true;
      return Response.json({}, { status: 201 });
    }
    if (String(url).includes("/rpc/rovty_session_status"))
      return Response.json({
        active,
        reason: "access",
        user_id: uid,
        session_id: sid,
        email: "current@example.test",
      });
    return new Response(null, { status: 204 });
  });
  const token = await mintSsoToken(uid, sid, "wed", env.SSO_SHARED_SECRET);
  const response = await worker.fetch(
    request("/api/sso/resolve", { token }, env.WED_WORKER_SECRET),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.user_id, uid);
  assert.equal(result.session_id, sid);
  assert.equal(result.version, 2);
  assert.equal(
    (
      await worker.fetch(
        request("/api/sso/resolve", { token }, env.WED_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    409,
  );
  claimed = false;
  active = false;
  assert.equal(
    (
      await worker.fetch(
        request("/api/sso/resolve", { token }, env.WED_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    403,
  );
});
test("each product request rechecks access and credential scope cannot expand through the body", async (t) => {
  let active = true,
    calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ active, reason: "access" });
  });
  const args = { product: "wed", user_id: uid, session_id: sid };
  assert.equal(
    (
      await worker.fetch(
        request("/api/product-session/check", args, env.WED_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    200,
  );
  active = false;
  assert.equal(
    (
      await worker.fetch(
        request("/api/product-session/check", args, env.WED_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request(
          "/api/product-session/check",
          { ...args, product: "assist" },
          env.WED_WORKER_SECRET,
        ),
        env,
        ctx,
      )
    ).status,
    403,
  );
  assert.equal(calls, 2);
});
test("logout derives the central user from Auth and commits revocation before success", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({
      url: String(url),
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (String(url).endsWith("/auth/v1/user"))
      return Response.json({ id: uid });
    return Response.json(true);
  });
  const response = await worker.fetch(
    request("/api/account/logout", { user_id: "spoofed" }),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[1].body, { _user: uid, _session: sid });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  calls.length = 0;
  assert.equal(
    (
      await worker.fetch(
        request("/api/account/logout", {}, jwt, "https://evil.test"),
        env,
        ctx,
      )
    ).status,
    403,
  );
  assert.equal(calls.length, 0);
});
test("service outage does not report a successful logout", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  assert.equal(
    (await worker.fetch(request("/api/account/logout"), env, ctx)).status,
    503,
  );
});
test("support credential can reach support tables but cannot read accounts or grant access", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return Response.json([]);
  });
  const response = await worker.fetch(
    request(
      "/api/assist-data",
      {
        path: "assist_messages?session_id=eq.test&select=id,body&limit=100",
        method: "GET",
      },
      env.ASSIST_DATA_SECRET,
    ),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  for (const path of [
    "product_access",
    "../auth/v1/users",
    "rpc/rovty_revoke_sessions",
    "assist_sessions?select=*,auth.users(*)",
  ])
    assert.notEqual(
      (
        await worker.fetch(
          request(
            "/api/assist-data",
            { path, method: "GET" },
            env.ASSIST_DATA_SECRET,
          ),
          env,
          ctx,
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await worker.fetch(
        request(
          "/api/product-access/grant",
          { product: "wed", email: "x@example.test" },
          env.ASSIST_DATA_SECRET,
        ),
        env,
        ctx,
      )
    ).status,
    401,
  );
  assert.equal(calls.length, 1);
});
