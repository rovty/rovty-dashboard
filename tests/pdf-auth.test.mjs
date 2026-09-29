import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
  stdin: {
    contents:
      "export { default } from './worker/index.ts'; export { signInDestination } from './src/lib/navigation.ts';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  define: { "import.meta.env": "{}" },
});
const { default: worker, signInDestination } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const user = "00000000-0000-4000-8000-000000000001",
  session = "00000000-0000-4000-8000-000000000002";
const env = {
  SUPABASE_URL: "https://db.test",
  SUPABASE_ANON_KEY: "public",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  SSO_SHARED_SECRET: "central-only-signing-key",
  PDF_WORKER_SECRET: "pdf-only-secret",
  PDF_ORIGIN: "https://pdf.test",
  WED_WORKER_SECRET: "wed-only-secret",
};
const jwt = `a.${Buffer.from(JSON.stringify({ session_id: session })).toString("base64url")}.b`;
const request = (action, data, token = jwt, origin = "https://dash.test") =>
  new Request(`https://dash.test/api/pdf-auth/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: origin,
    },
    body: JSON.stringify(data),
  });
test("free PDF cloud handoff is PKCE-bound, one-use, session-checked and separately scoped", async (t) => {
  let claimed = false,
    active = true;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).endsWith("/auth/v1/user"))
      return Response.json({ id: user });
    if (String(url).includes("/rpc/rovty_session_status")) {
      assert.equal(
        JSON.parse(init.body)._product,
        null,
        "PDF does not require a paid entitlement",
      );
      return Response.json({
        active,
        user_id: user,
        session_id: session,
        email: "test@example.test",
      });
    }
    if (String(url).endsWith("/sso_nonces") && init.method === "POST") {
      assert.equal(JSON.parse(init.body).product, "pdf");
      if (claimed) return new Response(null, { status: 409 });
      claimed = true;
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 204 });
  });
  const ctx = { waitUntil() {} },
    state = "a".repeat(64),
    verifier = "b".repeat(64);
  const challenge = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  assert.equal(
    (
      await worker.fetch(
        request("mint", { state, challenge }, jwt, "https://evil.test"),
        env,
        ctx,
      )
    ).status,
    403,
  );
  const minted = await worker.fetch(
    request("mint", { state, challenge }),
    env,
    ctx,
  );
  assert.equal(minted.status, 200);
  const location = new URL((await minted.json()).url),
    token = location.searchParams.get("token");
  assert.equal(location.origin, "https://pdf.test");
  assert.equal(location.pathname, "/api/auth/callback");
  assert.equal(
    (
      await worker.fetch(
        request(
          "resolve",
          { token, verifier: "c".repeat(64), state },
          env.PDF_WORKER_SECRET,
        ),
        env,
        ctx,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        request("resolve", { token, verifier, state }, env.WED_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    401,
  );
  assert.equal(claimed, false);
  assert.equal(
    (
      await worker.fetch(
        request("resolve", { token, verifier, state }, env.PDF_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await worker.fetch(
        request("resolve", { token, verifier, state }, env.PDF_WORKER_SECRET),
        env,
        ctx,
      )
    ).status,
    409,
  );
  active = false;
  assert.equal(
    (
      await worker.fetch(
        request(
          "check",
          { user_id: user, session_id: session },
          env.PDF_WORKER_SECRET,
        ),
        env,
        ctx,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        request(
          "check",
          { user_id: user, session_id: session },
          env.WED_WORKER_SECRET,
        ),
        env,
        ctx,
      )
    ).status,
    401,
  );
});
test("PDF sign-in returns only to the validated local consent screen", () => {
  const destination = `/connect/pdf?state=${"a".repeat(64)}&challenge=${"b".repeat(64)}`;
  assert.equal(signInDestination(destination), destination);
  for (const unsafe of [
    destination + "&next=https://evil.test",
    destination + "#anything",
    "/connect/pdf?state=bad",
    "//evil.test/connect/pdf",
    "/connect/pdf?state=" +
      "a".repeat(64) +
      "&challenge=" +
      "b".repeat(64) +
      "&state=" +
      "a".repeat(64),
  ])
    assert.equal(signInDestination(unsafe), "/");
});
