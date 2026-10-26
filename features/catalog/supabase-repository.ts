import { createClient } from "@/lib/supabase/server";
import type {
  CatalogBrand,
  CatalogCategory,
  CatalogImage,
  CatalogProduct,
  CatalogVariant,
  Product,
} from "./types";
import type { ProductQuery } from "./demo-repository";
import { discount } from "./pricing";

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
};

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
};

type ImageRow = {
  id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
};

type VariantRow = {
  id: string;
  sku: string;
  name: string;
  option_values: Record<string, unknown>;
  price_override: number | string | null;
  is_active: boolean;
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  legacy_id: string | null;
  short_description: string | null;
  description: string | null;
  price: number | string;
  compare_at_price: number | string | null;
  status: "draft" | "active" | "archived";
  is_featured: boolean;
  is_active: boolean;
  rating: number | string;
  review_count: number;
  tags: string[];
  categories: CategoryRow | CategoryRow[] | null;
  brands: BrandRow | BrandRow[] | null;
  product_images: ImageRow[] | null;
  product_variants: VariantRow[] | null;
};

type AvailabilityRow = {
  product_id: string;
  in_stock: boolean;
  available_quantity: number;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapCategory(row: CategoryRow | null): CatalogCategory | null {
  return row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        imageUrl: row.image_url,
        isActive: row.is_active,
        sortOrder: row.sort_order,
      }
    : null;
}

function mapBrand(row: BrandRow | null): CatalogBrand | null {
  return row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        logoUrl: row.logo_url,
        isActive: row.is_active,
      }
    : null;
}

function mapImage(row: ImageRow): CatalogImage {
  return {
    id: row.id,
    url: row.url,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
  };
}

function mapVariant(row: VariantRow): CatalogVariant {
  const optionValues = Object.fromEntries(
    Object.entries(row.option_values ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    optionValues,
    priceOverride: row.price_override == null ? null : Number(row.price_override),
    isActive: row.is_active,
  };
}

function mapProduct(row: ProductRow, availability: AvailabilityRow | undefined): CatalogProduct {
  const category = mapCategory(one(row.categories));
  const brand = mapBrand(one(row.brands));
  const images = [...(row.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapImage);
  // Products that only have products.image_url (no product_images rows) still show their image.
  if (!images.length && row.image_url && /^(\/|https:\/\/)/.test(row.image_url)) {
    images.push({ id: `${row.id}-primary`, url: row.image_url, altText: row.name, sortOrder: 0, isPrimary: true });
  }
  const variants = (row.product_variants ?? []).filter((variant) => variant.is_active).map(mapVariant);

  return {
    catalogId: row.id,
    id: row.legacy_id ?? row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    shortDescription: row.short_description,
    description: row.description,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price == null ? null : Number(row.compare_at_price),
    status: row.status,
    isFeatured: row.is_featured,
    isActive: row.is_active,
    rating: Number(row.rating),
    reviewCount: row.review_count,
    category,
    brand,
    images,
    variants,
    requiresVariantSelection: variants.length > 0,
    availability: {
      inStock: availability?.in_stock ?? false,
      availableQuantity: availability?.available_quantity ?? 0,
    },
    tags: row.tags ?? [],
  };
}

function toStorefrontProduct(product: CatalogProduct): Product {
  const primary = product.images.find((image) => image.isPrimary) ?? product.images[0];
  const secondary = product.images.find((image) => !image.isPrimary) ?? primary;
  return {
    catalogId: product.catalogId,
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand?.name ?? "Nuvicart",
    category: product.category?.name ?? "Catalog",
    categorySlug: product.category?.slug ?? "catalog",
    price: product.price,
    originalPrice: product.compareAtPrice ?? undefined,
    rating: product.rating,
    reviews: product.reviewCount,
    stock: product.availability.availableQuantity,
    badge: product.isFeatured ? "Bestseller" : undefined,
    description: product.description ?? product.shortDescription ?? "",
    image: primary?.url ?? "/placeholder-product.svg",
    secondaryImage: secondary?.url ?? primary?.url ?? "/placeholder-product.svg",
    tags: product.tags,
    requiresVariantSelection: product.variants.length > 0,
  };
}

async function availabilityFor(client: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  if (!ids.length) return new Map<string, AvailabilityRow>();
  const { data, error } = await client.rpc("get_product_availability", { product_ids: ids });
  if (error) throw new Error(`Catalog availability query failed: ${error.message}`);
  return new Map(((data ?? []) as AvailabilityRow[]).map((row) => [row.product_id, row]));
}

async function fetchRows(query: ProductQuery = {}, options: { slug?: string; ids?: string[]; limit?: number } = {}) {
  const client = await createClient();
  let request = client
    .from("products")
    .select(`
      id, slug, name, sku, legacy_id, short_description, description, price,
      compare_at_price, status, is_featured, is_active, rating, review_count, tags,
      image_url,
      categories${query.category ? "!inner" : ""}(id, name, slug, description, image_url, is_active, sort_order),
      brands${query.brand ? "!inner" : ""}(id, name, slug, description, logo_url, is_active),
      product_images(id, url, alt_text, sort_order, is_primary),
      product_variants(id, sku, name, option_values, price_override, is_active)
    `)
    .eq("is_active", true)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (options.slug) request = request.eq("slug", options.slug);
  if (options.ids?.length) request = request.in("id", options.ids);
  if (!options.slug) request = request.range(0, Math.max(0, (options.limit ?? 48) - 1));

  if (query.category) request = request.eq("categories.slug", query.category);
  if (query.brand) request = request.eq("brands.name", query.brand);

  const search = query.query?.trim();
  if (search) {
    const clientForSearch = client;
    const { data: matchingIds, error: searchError } = await clientForSearch.rpc(
      "search_catalog_product_ids",
      { search_term: search },
    );
    if (searchError) throw new Error(`Catalog search query failed: ${searchError.message}`);
    const ids = ((matchingIds ?? []) as Array<{ product_id: string }>).map((row) => row.product_id);
    if (!ids.length) return [];
    request = request.in("id", ids);
  }

  const { data, error } = await request;
  if (error) throw new Error(`Catalog product query failed: ${error.message}`);
  return (data ?? []) as unknown as ProductRow[];
}

async function fetchRowsByLegacyIds(legacyIds: string[]) {
  const client = await createClient();
  const { data, error } = await client
    .from("products")
    .select(`
      id, slug, name, sku, legacy_id, short_description, description, price,
      compare_at_price, status, is_featured, is_active, rating, review_count, tags,
      image_url,
      categories(id, name, slug, description, image_url, is_active, sort_order),
      brands(id, name, slug, description, logo_url, is_active),
      product_images(id, url, alt_text, sort_order, is_primary),
      product_variants(id, sku, name, option_values, price_override, is_active)
    `)
    .in("legacy_id", legacyIds)
    .eq("is_active", true)
    .eq("status", "active");
  if (error) throw new Error(`Catalog wishlist query failed: ${error.message}`);
  return (data ?? []) as unknown as ProductRow[];
}

export const supabaseRepository = {
  async listProducts(input: ProductQuery = {}) {
    let products = (await fetchRows(input)).map((row) => row);
    const availability = await availabilityFor(await createClient(), products.map((product) => product.id));
    let models = products.map((product) => mapProduct(product, availability.get(product.id)));

    const minPrice = Number.isFinite(input.minPrice) && input.minPrice! >= 0 ? input.minPrice : undefined;
    const maxPrice = Number.isFinite(input.maxPrice) && input.maxPrice! >= 0 ? input.maxPrice : undefined;
    const minRating = Number.isFinite(input.minRating) && input.minRating! >= 0 && input.minRating! <= 5 ? input.minRating : undefined;
    const minDiscount = Number.isFinite(input.minDiscount) && input.minDiscount! >= 0 && input.minDiscount! <= 100 ? input.minDiscount : undefined;

    if (minPrice !== undefined) models = models.filter((product) => product.price >= minPrice);
    if (maxPrice !== undefined) models = models.filter((product) => product.price <= maxPrice);
    if (minRating !== undefined) models = models.filter((product) => product.rating >= minRating);
    if (input.inStock) models = models.filter((product) => product.availability.inStock);
    if (minDiscount !== undefined) models = models.filter((product) => {
      const storefront = toStorefrontProduct(product);
      return discount(storefront) >= minDiscount;
    });

    switch (input.sort) {
      case "price-asc": models.sort((a, b) => a.price - b.price); break;
      case "price-desc": models.sort((a, b) => b.price - a.price); break;
      case "rating": models.sort((a, b) => b.rating - a.rating); break;
      case "discount": models.sort((a, b) => discount(toStorefrontProduct(b)) - discount(toStorefrontProduct(a))); break;
      case "popular": models.sort((a, b) => b.reviewCount - a.reviewCount); break;
      case "newest": break;
    }

    return models.map(toStorefrontProduct);
  },

  async getCatalogProduct(slug: string) {
    const rows = await fetchRows({}, { slug, limit: 1 });
    const row = rows[0];
    if (!row) return undefined;
    const availability = await availabilityFor(await createClient(), [row.id]);
    return mapProduct(row, availability.get(row.id));
  },

  async getProduct(slug: string) {
    const product = await this.getCatalogProduct(slug);
    return product ? toStorefrontProduct(product) : undefined;
  },

  async getProductsByIds(ids: string[]) {
    if (!ids.length) return [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const uuidIds = ids.filter((id) => uuidPattern.test(id));
    const legacyIds = ids.filter((id) => !uuidPattern.test(id));
    const [uuidRows, legacyRows] = await Promise.all([
      uuidIds.length ? fetchRows({}, { ids: uuidIds, limit: uuidIds.length }) : Promise.resolve([]),
      legacyIds.length ? fetchRowsByLegacyIds(legacyIds) : Promise.resolve([]),
    ]);
    const rows = [...uuidRows, ...legacyRows];
    const availability = await availabilityFor(await createClient(), rows.map((product) => product.id));
    return rows.map((product) => toStorefrontProduct(mapProduct(product, availability.get(product.id))));
  },

  async getCategory(slug: string) {
    const client = await createClient();
    const { data, error } = await client
      .from("categories")
      .select("id, name, slug, description, image_url, is_active, sort_order")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(`Catalog category query failed: ${error.message}`);
    return data ? (mapCategory(data as CategoryRow) ?? undefined) : undefined;
  },

  async listCategories() {
    const client = await createClient();
    const { data, error } = await client
      .from("categories")
      .select("id, name, slug, description, image_url, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(`Catalog category query failed: ${error.message}`);
    return ((data ?? []) as CategoryRow[]).map(mapCategory).filter((category): category is CatalogCategory => Boolean(category));
  },

  async getCategoryProducts(slug: string) {
    return this.listProducts({ category: slug });
  },

  async getBrands() {
    const client = await createClient();
    const { data, error } = await client
      .from("brands")
      .select("name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw new Error(`Catalog brand query failed: ${error.message}`);
    return ((data ?? []) as Array<{ name: string }>).map((brand) => brand.name);
  },

  async getSearchSuggestions(query: string, limit = 4) {
    return (await this.listProducts({ query })).slice(0, Math.max(0, Math.min(limit, 10)));
  },
};
