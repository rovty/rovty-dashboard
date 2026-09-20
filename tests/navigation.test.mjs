import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/navigation.ts'], bundle: true, write: false, format: 'esm', define: { 'import.meta.env': '{}' } });
const { signInDestination } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('sign-in preserves known local app destinations', () => {
  for (const destination of ['/', '/#apps', '/open/wed']) assert.equal(signInDestination(destination), destination);
});

test('sign-in rejects external URLs, malformed paths, and redirect loops', () => {
  for (const destination of [undefined, '', '//evil.test', 'https://evil.test', '/\\evil.test', '/login', '/open/wed?next=https://evil.test', '/open/%2f%2fevil.test', 'javascript:alert(1)']) {
    assert.equal(signInDestination(destination), '/', String(destination));
  }
});
