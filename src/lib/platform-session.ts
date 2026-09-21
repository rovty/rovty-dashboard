import type { Session } from "@supabase/supabase-js";
export async function platformSessionRequest(
  session: Session,
  action: "session" | "logout",
  signal?: AbortSignal,
) {
  return fetch(`/api/account/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(10000),
  });
}
