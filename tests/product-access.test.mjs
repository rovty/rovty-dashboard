import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Bundle the real Worker with Vite's existing compiler; no test runtime or
// production credentials are needed. All Supabase requests are stubbed.
const bundle = await build({
  stdin: {
    contents: "export { default } from './worker/index.ts'; export * from './shared/products.ts';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { default: worker, PRODUCTS, findProduct } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const env = {
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  SSO_SHARED_SECRET: 'local-test-secret-never-used-in-production',
  TEAM_GRANT_SHARED_SECRET: 'local-product-worker-secret',
  WED_ORIGIN: 'https://wed.example.test',
};

test('catalog exposes upcoming products without registering them for SSO', () => {
  assert.equal(PRODUCTS.find((product) => product.slug === 'assist').availability, 'planned');
  assert.equal(findProduct('assist'), undefined);
  assert.equal(findProduct('unknown'), undefined);
  assert.equal(findProduct('wed').originVar, 'WED_ORIGIN');
});

async function mint(t, product, active) {
  const calls = [];
  const uid = '00000000-0000-4000-8000-000000000001';
  const sid = '00000000-0000-4000-8000-000000000002';
  const jwt = `a.${Buffer.from(JSON.stringify({ session_id: sid })).toString('base64url')}.b`;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: uid });
    return Response.json(active ? { active: true, user_id: uid, session_id: sid, email: 'user@example.test' } : { active: false, reason: 'access' });
  });
  const response = await worker.fetch(new Request('https://dash.example.test/api/sso/mint', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Origin: 'https://dash.example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ product }),
  }), env, {});
  return { response, calls };
}

test('active Wed users receive the existing signed hand-off', async (t) => {
  const { response, calls } = await mint(t, 'wed', true);
  assert.equal(response.status, 200);
  const { url } = await response.json();
  assert.equal(new URL(url).origin, env.WED_ORIGIN);
  assert.equal(new URL(url).pathname, '/sso');
  assert.ok(new URL(url).searchParams.get('token'));
  assert.equal(calls[1].body._user, '00000000-0000-4000-8000-000000000001');
  assert.equal(calls[1].body._product, 'wed');
  assert.equal(calls[1].body._session, '00000000-0000-4000-8000-000000000002');
});

test('inactive Wed users cannot mint a hand-off', async (t) => {
  const { response } = await mint(t, 'wed', false);
  assert.equal(response.status, 403);
});

test('Assist cannot mint a hand-off, even with an active entitlement', async (t) => {
  const { response, calls } = await mint(t, 'assist', true);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Unknown product' });
  assert.equal(calls.length, 1, 'An upcoming product must never reach the entitlement query');
});

test('upcoming product access cannot be granted through the Worker', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No database write should occur'); });
  const response = await worker.fetch(new Request('https://dash.example.test/api/product-access/grant', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TEAM_GRANT_SHARED_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@example.test', product: 'assist' }),
  }), env, {});
  assert.equal(response.status, 400);
});
