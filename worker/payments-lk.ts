// Worker-native implementation of the provider's REST + raw-body HMAC contract.
// No secret or card details are sent to the browser.
export class PaymentError extends Error {
  constructor(
    public status: number,
    public code: string,
    public reason?: string,
    public traceId?: string,
  ) {
    super(
      reason === "merchant_not_live" ||
        reason === "merchant_unavailable" ||
        status === 401 ||
        status === 403
        ? "Online payments are not available yet. Please contact Rovty."
        : reason === "idempotency_key_reused"
          ? "This order needs a Rovty team review before payment. Please contact support."
          : reason === "idempotency_key_in_progress"
            ? "Your checkout is still being prepared. Try again in a moment."
            : status === 429
              ? "Too many payment requests. Wait a moment and try again."
              : "Checkout could not be opened. Please try again or contact Rovty.",
    );
  }
}
export interface Checkout {
  object: "checkout";
  id: string;
  mode: "test" | "live";
  status: string;
  url: string;
  expiresAt: string;
  payment: {
    id: string;
    checkoutId: string;
    mode: string;
    currency: string;
    reference: string;
    amountCents: number;
  };
}
export function checkoutUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "payments.lk" || url.hostname.endsWith(".payments.lk"))
  )
    throw new Error("Invalid hosted checkout URL");
  return url.href;
}
export async function providerRequest(
  key: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<Checkout> {
  // Ambiguous network failures return to the caller. The stored body/key makes a later retry safe.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.payments.lk/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    const data = (await response.json()) as Checkout & {
      code?: string;
      reason?: string;
      traceId?: string;
    };
    if (response.ok) {
      checkoutUrl(data.url);
      if (
        data.object !== "checkout" ||
        typeof data.id !== "string" ||
        !data.id ||
        data.id.length > 200 ||
        !["test", "live"].includes(data.mode) ||
        !["open", "processing", "completed", "expired", "canceled"].includes(
          data.status,
        ) ||
        !Number.isFinite(Date.parse(data.expiresAt)) ||
        !data.payment ||
        !data.payment.id ||
        data.payment.checkoutId !== data.id ||
        data.payment.mode !== data.mode ||
        data.payment.currency !== "LKR" ||
        !Number.isSafeInteger(data.payment.amountCents) ||
        typeof data.payment.reference !== "string"
      )
        throw new Error("Invalid checkout response");
      return data;
    }
    const retry =
      [429, 500, 503].includes(response.status) ||
      data.reason === "idempotency_key_in_progress";
    const retryAfter = Number(response.headers.get("retry-after"));
    if (!retry || attempt === 2 || retryAfter > 2)
      throw new PaymentError(
        response.status,
        data.code || "PROVIDER_ERROR",
        data.reason,
        data.traceId,
      );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(250 * 2 ** attempt, retryAfter * 1000)),
    );
  }
  throw new Error("Checkout unavailable");
}
export async function verifyWebhook(
  raw: Uint8Array,
  header: string | null,
  secret: string,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  if (!header || header.length > 1000 || !secret)
    throw new Error("Invalid signature");
  const parts = header.split(",").map((v) => v.trim());
  const timestamps = parts.filter((p) => p.startsWith("t="));
  if (timestamps.length !== 1 || !/^t=\d+$/.test(timestamps[0]))
    throw new Error("Invalid timestamp");
  const timestamp = timestamps[0].slice(2);
  if (Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new Error("Expired signature");
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let valid = false;
  for (const part of parts.filter((p) => /^v1=[0-9a-f]{64}$/i.test(p))) {
    const bytes = new Uint8Array(
      part
        .slice(3)
        .match(/../g)!
        .map((v) => parseInt(v, 16)),
    );
    if (await crypto.subtle.verify("HMAC", key, bytes, signed)) valid = true;
  }
  if (!valid) throw new Error("Invalid signature");
  const event = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw),
  );
  if (
    event?.object !== "event" ||
    typeof event.id !== "string" ||
    !event.id ||
    event.id.length > 200 ||
    typeof event.type !== "string" ||
    !["test", "live"].includes(event.mode) ||
    !event.data ||
    typeof event.data !== "object"
  )
    throw new Error("Invalid event");
  return event;
}
export async function rawWebhook(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) {
        await reader.cancel();
        throw new Error("Body too large");
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
  return bytes;
}
