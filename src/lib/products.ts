// Browser view of the shared catalog. Only marketing origins vary by environment;
// availability and product identifiers still come from shared/products.ts.
import {
  PRODUCTS as CATALOG,
  type AvailableProduct,
  type Product,
} from "../../shared/products";
import { SITE_ORIGIN } from "./navigation";

export const PRODUCTS: readonly Product[] = CATALOG.map((product) => ({
  ...product,
  productUrl: new URL(new URL(product.productUrl).pathname, SITE_ORIGIN).href,
  ...(product.availability === "available"
    ? {
        pricingUrl: product.pricingUrl.startsWith("/")
          ? product.pricingUrl
          : new URL(new URL(product.pricingUrl).pathname, SITE_ORIGIN).href,
      }
    : {}),
}));

// The workspace is for released apps. Planned entries stay out of every
// dashboard view, even if an old entitlement row references one.
export const AVAILABLE_PRODUCTS = PRODUCTS.filter(
  (product): product is AvailableProduct =>
    product.availability === "available",
);
export function findProduct(slug: string): AvailableProduct | undefined {
  return AVAILABLE_PRODUCTS.find((product) => product.slug === slug);
}
export type { Product, AvailableProduct } from "../../shared/products";
