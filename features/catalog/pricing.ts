import type { Product } from "./types";

export function discount(product: Pick<Product, "price" | "originalPrice">) {
  return product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : 0;
}
