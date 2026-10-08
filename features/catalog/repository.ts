import type { ProductQuery } from "./demo-repository";
import type { CatalogCategory, CatalogProduct, Product } from "./types";

export interface CatalogRepository {
  listProducts(input?: ProductQuery): Promise<Product[]>;
  getCatalogProduct(slug: string): Promise<CatalogProduct | undefined>;
  getProduct(slug: string): Promise<Product | undefined>;
  getProductsByIds(ids: string[]): Promise<Product[]>;
  getCategory(slug: string): Promise<CatalogCategory | undefined>;
  listCategories(): Promise<CatalogCategory[]>;
  getCategoryProducts(slug: string): Promise<Product[]>;
  getBrands(): Promise<string[]>;
  getSearchSuggestions(query: string, limit?: number): Promise<Product[]>;
}
