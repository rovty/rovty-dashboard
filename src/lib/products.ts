// Re-export of the single shared registry so the browser app and the Worker
// can never disagree on which products exist. Edit shared/products.ts.
import { PRODUCTS, type AvailableProduct } from '../../shared/products';

// The workspace is for released apps. Planned entries stay out of every
// dashboard view, even if an old entitlement row references one.
export const AVAILABLE_PRODUCTS = PRODUCTS.filter((product): product is AvailableProduct => product.availability === 'available');
export { PRODUCTS, findProduct, type Product, type AvailableProduct } from '../../shared/products';
