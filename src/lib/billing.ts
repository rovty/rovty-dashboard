import { supabase } from "./supabase";
export async function billing<T>(
  path: string,
  body: unknown = {},
  signal?: AbortSignal,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to continue.");
  const response = await fetch(`/api/billing/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "Could not load billing. Please try again.",
    );
  return result as T;
}
export interface Plan {
  product: string;
  code: string;
  name: string;
  price_cents: number;
  months: number;
  features: string[];
  rank: number;
  version: number;
  active: boolean;
}
export interface Access {
  plan?: string;
  active: boolean;
  source?: string;
  expires_at?: string;
  revision: number;
  features: string[];
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const featureNames: Record<string, string> = {
  website: "Wedding website",
  templates: "All invitation templates",
  rsvp: "Online RSVP",
  guests: "Guest management",
  seating: "Seating planner",
  team: "Wedding team access",
  canvas: "Custom design canvas",
};
