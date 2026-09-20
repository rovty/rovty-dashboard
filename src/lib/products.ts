// Re-export of the single shared registry so the browser app and the Worker
// can never disagree on which products exist. Edit shared/products.ts.
export { PRODUCTS, findProduct, type Product, type AvailableProduct } from '../../shared/products';
