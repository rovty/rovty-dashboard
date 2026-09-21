export const WED_ORIGIN = new URL(
  import.meta.env.VITE_ROVTY_WED_ORIGIN || "https://wed.rovty.com",
).origin;
export const SITE_ORIGIN = new URL(
  import.meta.env.VITE_ROVTY_SITE_ORIGIN || "https://rovty.com",
).origin;

/** Sign-in only returns to known local screens, never an arbitrary URL. */
export function signInDestination(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (value === "/" || value === "/#apps") return value;
  // Product names are validated again against the catalog by OpenProductPage.
  if (/^\/open\/[a-z0-9-]+$/.test(value)) return value;
  if (
    /^\/billing\/(history|orders\/[a-f0-9-]{36}|manage\/[a-z0-9-]+|[a-z0-9-]+)(\?(plan=[a-z0-9-]+|returned=cancel))?$/.test(
      value,
    )
  )
    return value;
  return "/";
}
