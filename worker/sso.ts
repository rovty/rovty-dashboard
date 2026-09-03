// Signed hand-off token for cross-Worker SSO. Not a JWT — deliberately
// simpler, since this only ever needs to prove "we minted this, just now,
// for this user" to one relying party: our own /api/sso/resolve endpoint.
// The shared secret lives ONLY here — rovty-wed never sees it and can't
// verify tokens itself; it always calls back to /api/sso/resolve, which is
// also where one-time-use and live entitlement are enforced. That keeps a
// single source of truth for both the signing key and the nonce state,
// rather than splitting trust across two Workers.
//
// Deliberately excludes email/PII — just enough to look the user back up:
// user_id, product, iat, exp, nonce. `payload.signature`, both base64url,
// HMAC-SHA256.

export interface SsoTokenPayload {
  user_id: string;
  product: string;
  iat: number;
  exp: number;
  nonce: string;
}

const TOKEN_TTL_MS = 3 * 60_000; // 3 minutes

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintSsoToken(userId: string, product: string, secret: string): Promise<string> {
  const now = Date.now();
  const payload: SsoTokenPayload = { user_id: userId, product, iat: now, exp: now + TOKEN_TTL_MS, nonce: randomNonce() };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Verifies signature and expiry only — does NOT check or claim the nonce (that's a
 *  stateful check the caller does against sso_nonces, since it needs a DB round trip). */
export async function verifySsoToken(token: string, secret: string): Promise<SsoTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSig] = parts;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(encodedSig),
    new TextEncoder().encode(encodedPayload),
  );
  if (!valid) return null;

  let payload: SsoTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  if (!payload.user_id || !payload.product || !payload.nonce) return null;
  return payload;
}
