import { hasSupabasePublicConfig } from "@/lib/env";
import { demoRepository, type ProductQuery } from "./demo-repository";
import { supabaseRepository } from "./supabase-repository";
import type { CatalogRepository } from "./repository";

function getRepository(): CatalogRepository {
  // Missing public Supabase configuration is an explicit local-development
  // fallback condition. Once configured, database errors are surfaced rather
  // than silently returning demo data.
  return hasSupabasePublicConfig() ? supabaseRepository : demoRepository;
}

export type { ProductQuery };

export async function listProducts(input: ProductQuery = {}) {
  return getRepository().listProducts(input);
}

export async function getCatalogProduct(slug: string) {
  return getRepository().getCatalogProduct(slug);
}

export async function getProduct(slug: string) {
  return getRepository().getProduct(slug);
}

export async function getProductsByIds(ids: string[]) {
  return getRepository().getProductsByIds(ids);
}

export async function getCategory(slug: string) {
  return getRepository().getCategory(slug);
}

export async function listCategories() {
  return getRepository().listCategories();
}

export async function getCategoryProducts(slug: string) {
  return getRepository().getCategoryProducts(slug);
}

export async function getBrands() {
  return getRepository().getBrands();
}

export async function getSearchSuggestions(query: string, limit = 4) {
  return getRepository().getSearchSuggestions(query, limit);
}
