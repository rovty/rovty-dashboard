import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { build } from "esbuild";
const built = await build({
  stdin: {
    contents:
      "export * from './worker/payments-lk.ts';export * from './worker/billing.ts';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { verifyWebhook, handleBilling, providerRequest, checkoutUrl } =
  await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );
const secret = "whsec_local_test_only",
  now = 1790000000000;
const event = {
  object: "event",
  id: "evt_1",
  mode: "test",
  type: "payment.succeeded",
  data: { reference: "Rovty 💐" },
};
const raw = Buffer.from(JSON.stringify(event));
const sign = (bytes = raw, timestamp = Math.floor(now / 1000)) =>
  `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.`).update(bytes).digest("hex")}`;
test("raw byte verification supports unicode and rotating signatures; rejects edits, bad keys and stale/future replay", async () => {
  assert.deepEqual(await verifyWebhook(raw, sign(), secret, now), event);
  assert.deepEqual(
    await verifyWebhook(raw, sign() + ",v1=" + "0".repeat(64), secret, now),
    event,
  );
  for (const [bytes, header, key] of [
    [Buffer.from(raw.toString() + " "), sign(), secret],
    [raw, sign(), "wrong"],
    [raw, sign(raw, now / 1000 - 301), secret],
    [raw, sign(raw, now / 1000 + 301), secret],
    [raw, sign() + ",t=1", secret],
    [raw, "x".repeat(1001), secret],
  ])
    await assert.rejects(verifyWebhook(bytes, header, key, now));
});
const env = {
  SUPABASE_URL: "https://db.test",
  SUPABASE_ANON_KEY: "public",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server",
  WED_WORKER_SECRET: "product_only",
  BILLING_MODE: "test",
  BILLING_ORIGIN: "https://dash.test",
  PAYMENTS_LK_SECRET_KEY: "sk_test_example",
  PAYMENTS_LK_WEBHOOK_SECRET: secret,
};
const uid = "00000000-0000-4000-8000-000000000001",
  sid = "00000000-0000-4000-8000-000000000002";
const token = `a.${Buffer.from(JSON.stringify({ session_id: sid })).toString("base64url")}.b`;
const req = (path, body, bearer = token, origin = "https://dash.test") =>
  new Request(`https://dash.test/api/billing/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("webhook rejects unsigned and wrong mode requests without database writes", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({});
  });
  assert.equal((await handleBilling(req("webhook", event), env)).status, 400);
  const rawLive = Buffer.from(JSON.stringify({ ...event, mode: "live" }));
  const stamp = Math.floor(Date.now() / 1000);
  assert.equal(
    (
      await handleBilling(
        new Request("https://dash.test/api/billing/webhook", {
          method: "POST",
          body: rawLive,
          headers: { "payments-signature": sign(rawLive, stamp) },
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});
test("webhook never acknowledges failed database fulfillment", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: "08006" }, { status: 503 }),
  );
  const response = await handleBilling(
    new Request("https://dash.test/api/billing/webhook", {
      method: "POST",
      body: raw,
      headers: {
        "payments-signature": sign(raw, Math.floor(Date.now() / 1000)),
      },
    }),
    env,
  );
  assert.equal(response.status, 503);
});
test("catalog alone is public, and product credentials have fixed entitlement scope", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json([]);
  });
  const catalog = await handleBilling(
    new Request("https://dash.test/api/billing/catalog?product=wed"),
    env,
  );
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    (
      await handleBilling(
        req(
          "entitlements",
          { product: "assist", users: [uid] },
          env.WED_WORKER_SECRET,
        ),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleBilling(
        req("entitlements", { product: "wed", users: [uid] }, "wrong"),
        env,
      )
    ).status,
    403,
  );
  assert.equal(calls, 1);
});
test("checkout derives account from validated token; price is only a comparison, not a source", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push([String(url), body]);
    if (String(url).endsWith("/auth/v1/user"))
      return Response.json({ id: uid });
    if (String(url).endsWith("/rovty_session_status"))
      return Response.json({ active: true });
    if (String(url).endsWith("/billing_create_order")) {
      assert.equal(body._user, uid);
      assert.equal(body._expected, 1000);
      assert.equal(body._origin, env.BILLING_ORIGIN);
      return Response.json(
        {
          code: "P0001",
          message: "The price changed. Review the updated total before paying.",
        },
        { status: 400 },
      );
    }
    throw new Error("Unexpected call");
  });
  const response = await handleBilling(
    req("checkout", {
      product: "wed",
      plan: "essential",
      expected_amount: 1000,
      user_id: sid,
      amount: 1,
      successUrl: "https://evil.test",
    }),
    env,
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 3);
  assert.equal(
    (await handleBilling(req("checkout", {}, token, "https://evil.test"), env))
      .status,
    403,
  );
  assert.equal(calls.length, 3);
});
test("an arbitrary return URL cannot mark an order paid and another user cannot read an order", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/auth/v1/user"))
      return Response.json({ id: uid });
    if (String(url).endsWith("/rovty_session_status"))
      return Response.json({ active: true });
    if (String(url).endsWith("/billing_order")) return Response.json(null);
    throw new Error("Unexpected write");
  });
  assert.equal(
    (await handleBilling(req("order", { id: sid, status: "paid" }), env))
      .status,
    404,
  );
  assert.equal(
    (await handleBilling(req("paid", { id: sid }), env)).status,
    404,
  );
});
test("only documented transient provider errors retry with identical payload and idempotency key", async (t) => {
  const calls = [];
  const checkout = {
    object: "checkout",
    id: "chk_test",
    mode: "test",
    status: "open",
    expiresAt: "2030-01-01T00:00:00Z",
    url: "https://payments.lk/checkout/abc",
    payment: {
      id: "pay_test",
      checkoutId: "chk_test",
      mode: "test",
      currency: "LKR",
      amountCents: 490000,
      reference: uid,
    },
  };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(init);
    return calls.length === 1
      ? Response.json(
          { code: "CONFLICT", reason: "idempotency_key_in_progress" },
          { status: 409 },
        )
      : Response.json(checkout);
  });
  await providerRequest(
    "sk_test_example",
    "checkouts",
    { amountCents: 490000, reference: uid },
    "rovty-order-" + uid,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(
    calls[0].headers["Idempotency-Key"],
    calls[1].headers["Idempotency-Key"],
  );
});
test("permanent provider errors do not retry or turn into new orders", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(
      { code: "CONFLICT", reason: "merchant_not_live", traceId: "trace1" },
      { status: 409 },
    );
  });
  await assert.rejects(
    providerRequest("sk_live_example", "checkouts", {}, "order-local-1"),
    (e) => e.reason === "merchant_not_live" && e.traceId === "trace1",
  );
  assert.equal(calls, 1);
});
test("hosted checkout destinations cannot redirect to unrelated origins or active content", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://payments.lk.evil.test/a",
    "http://payments.lk/a",
    "https://evil.test",
    "https://user:pass@payments.lk/a",
  ])
    assert.throws(() => checkoutUrl(url));
  assert.equal(
    checkoutUrl("https://checkout.payments.lk/test"),
    "https://checkout.payments.lk/test",
  );
});

test("a cancellation winning the start lock never reaches the payment provider", async (t) => {
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = String(url);
    if (path.startsWith("https://api.payments.lk")) {
      providerCalls++;
      throw new Error("Must not create a checkout");
    }
    if (path.endsWith("/auth/v1/user")) return Response.json({ id: uid });
    if (path.endsWith("/rovty_session_status"))
      return Response.json({ active: true });
    if (path.endsWith("/billing_order"))
      return Response.json({
        id: uid,
        status: "pending",
        mode: "test",
        created_at: new Date().toISOString(),
        checkout_id: null,
      });
    if (path.endsWith("/billing_checkout_action"))
      return Response.json({ id: uid, status: "expired", mode: "test" });
    throw new Error("Unexpected operation");
  });
  const response = await handleBilling(req("resume", { id: uid }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "expired");
  assert.equal(providerCalls, 0);
});
