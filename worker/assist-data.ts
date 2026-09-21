// Narrow data boundary for the website support Worker. This credential cannot
// reach Auth, product_access, RPCs, or any table outside support conversations.
import { smallBody, type PlatformEnv } from "./platform";
export interface AssistDataEnv extends PlatformEnv {
  ASSIST_DATA_SECRET?: string;
  ASSIST_DATA_SECRET_PREVIOUS?: string;
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const columns: Record<string, Set<string>> = {
  assist_sessions: new Set([
    "id",
    "token",
    "visitor_name",
    "visitor_email",
    "page",
    "user_agent",
    "country",
    "status",
    "tg_thread_message_id",
    "last_seen_at",
    "created_at",
  ]),
  assist_messages: new Set([
    "id",
    "session_id",
    "sender",
    "agent_name",
    "body",
    "tg_message_id",
    "created_at",
  ]),
};
export async function handleAssistData(
  request: Request,
  env: AssistDataEnv,
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (
    !token ||
    !env.ASSIST_DATA_SECRET ||
    ![env.ASSIST_DATA_SECRET, env.ASSIST_DATA_SECRET_PREVIOUS].some(
      (key) => key && equal(token, key),
    )
  )
    return json({ error: "Unauthorized" }, 401);
  let input;
  try {
    input = (await smallBody(request)) as {
      path?: unknown;
      method?: unknown;
      body?: unknown;
      prefer?: unknown;
    };
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (
    !input ||
    typeof input.path !== "string" ||
    input.path.length > 2048 ||
    !["GET", "POST", "PATCH"].includes(String(input.method))
  )
    return json({ error: "Invalid operation" }, 400);
  const [table, query = ""] = input.path.split("?");
  if (!Object.hasOwn(columns, table) || input.path.split("?").length > 2)
    return json({ error: "Forbidden table" }, 403);
  const fields = columns[table],
    params = new URLSearchParams(query);
  for (const [key, value] of params) {
    if (key === "select") {
      if (value !== "*" && value.split(",").some((v) => !fields.has(v)))
        return json({ error: "Invalid selection" }, 400);
    } else if (key === "order") {
      if (!/^(id|created_at)\.(asc|desc)$/.test(value))
        return json({ error: "Invalid order" }, 400);
    } else if (key === "limit") {
      if (!/^\d+$/.test(value) || +value > 100)
        return json({ error: "Invalid limit" }, 400);
    } else if (!fields.has(key) || !/^(eq|gt)\./.test(value))
      return json({ error: "Invalid filter" }, 400);
  }
  if (
    input.method !== "GET" &&
    (!input.body ||
      typeof input.body !== "object" ||
      Array.isArray(input.body) ||
      Object.keys(input.body).some((key) => !fields.has(key)) ||
      JSON.stringify(input.body).length > 16384)
  )
    return json({ error: "Invalid values" }, 400);
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
  if (!env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_"))
    headers.Authorization = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (
    input.prefer === "return=representation" ||
    input.prefer === "return=minimal"
  )
    headers.Prefer = input.prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: String(input.method),
    headers,
    body: input.method === "GET" ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return json({ error: "Support storage unavailable" }, 502);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
