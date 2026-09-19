// The one product registry, shared by the browser app (src/) and the Worker
// (worker/). A product's `slug` is exactly the `product_access.product`
// value in Supabase; `originVar` names the Worker env binding that holds the
// product's origin (kept as a var name, not a URL, so this file has no
// environment-specific values and can be imported client-side).
//
// Add a product here and:
//   1. add `<ORIGIN_VAR>` to wrangler.jsonc `vars` (and `Env` in worker/index.ts),
//   2. make sure that product's Worker implements `/sso` (see rovty-wed/src/routes/sso.ts).

export interface Product {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** Marketing/pricing page a locked user is sent to. */
  pricingUrl: string;
  /** Public product page for "learn more". */
  productUrl: string;
  /** Name of the Worker env var that holds this product's origin. */
  originVar: "WED_ORIGIN";
}

export const PRODUCTS: readonly Product[] = [
  {
    slug: "wed",
    name: "Rovty Wed",
    tagline: "Wedding invitation & guest platform.",
    description:
      "Designed invitation page, personalised WhatsApp links, RSVPs, and seating — everything your guests need in one link.",
    pricingUrl: "https://rovty.com/pricing/wed",
    productUrl: "https://rovty.com/products/wed",
    originVar: "WED_ORIGIN",
  },
] as const;

export function findProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}
