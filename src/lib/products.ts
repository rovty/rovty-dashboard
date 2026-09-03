// The dashboard's product catalog. Matches product_access.product values in
// the Supabase migration — the slug here is the string a row's `product`
// column must equal for that entitlement to apply.
export interface Product {
  slug: string;
  name: string;
  tagline: string;
  pricingUrl: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: 'wed',
    name: 'Rovty Wed',
    tagline: 'Wedding invitation & guest platform.',
    pricingUrl: 'https://rovty.com/pricing/wed',
  },
];
