// The one product registry, shared by the browser app (src/) and the Worker
// (worker/). A product's `slug` is exactly the `product_access.product`
// value in Supabase; `originVar` names the Worker env binding that holds the
// product's origin (kept as a var name, not a URL, so this file has no
// environment-specific values and can be imported client-side).
//
// Planned products belong in the catalog too, but cannot be launched.
// To make a product available:
//   1. add `<ORIGIN_VAR>` to wrangler.jsonc `vars` (and `Env` in worker/index.ts),
//   2. make sure that product's Worker implements `/sso` (see rovty-wed/src/routes/sso.ts).

interface ProductDetails {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** Public product page for "learn more". */
  productUrl: string;
}

export interface AvailableProduct extends ProductDetails {
  availability: 'available';
  /** Dashboard plan selection for a user without product access. */
  pricingUrl: string;
  /** Only launchable products have an SSO origin. */
  originVar: "WED_ORIGIN";
}

export interface PlannedProduct extends ProductDetails {
  availability: 'planned';
}

export type Product = AvailableProduct | PlannedProduct;

export const PRODUCTS: readonly Product[] = [
  {
    slug: "wed",
    availability: 'available',
    name: "Rovty Wed",
    tagline: "Wedding invitation & guest platform.",
    description:
      "Designed invitation page, personalised WhatsApp links, RSVPs, and seating. Everything your guests need in one link.",
    pricingUrl: "/billing/wed",
    productUrl: "https://rovty.com/products/wed",
    originVar: "WED_ORIGIN",
  },
  {
    slug: 'assist',
    availability: 'planned',
    name: 'Rovty Assist',
    tagline: 'Customer conversations, connected.',
    description: 'An upcoming assistant for customer conversations, lead capture, and getting the right people involved at the right moment.',
    productUrl: 'https://rovty.com/products/assist',
  },
] as const;

// Used by the Worker for mint, resolve, and grant. A catalog entry alone
// must never make an unfinished product a valid SSO destination.
export function findProduct(slug: string): AvailableProduct | undefined {
  return PRODUCTS.find((p): p is AvailableProduct => p.slug === slug && p.availability === 'available');
}
