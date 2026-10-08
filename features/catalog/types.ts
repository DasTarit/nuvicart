export type ProductBadge = "New" | "Bestseller" | "Deal" | "Limited";

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type CatalogBrand = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
};

export type CatalogImage = {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

export type CatalogVariant = {
  id: string;
  sku: string;
  name: string;
  optionValues: Record<string, string>;
  priceOverride: number | null;
  isActive: boolean;
};

export type CatalogInventoryAvailability = {
  inStock: boolean;
  availableQuantity: number;
};

export type CatalogProduct = {
  /** Production products.id; kept separate from the legacy-compatible storefront id. */
  catalogId: string;
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  shortDescription: string | null;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  status: "draft" | "active" | "archived";
  isFeatured: boolean;
  isActive: boolean;
  rating: number;
  reviewCount: number;
  category: CatalogCategory | null;
  brand: CatalogBrand | null;
  images: CatalogImage[];
  variants: CatalogVariant[];
  requiresVariantSelection: boolean;
  availability: CatalogInventoryAvailability;
  tags: string[];
};

/**
 * Product is the existing storefront DTO. It intentionally hides database
 * row structure so Client Components remain independent from Supabase.
 */
export type Product = {
  /** Stable production catalog row ID when backed by the production repository. */
  catalogId?: string;
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  categorySlug: string;
  price: number;
  originalPrice?: number;
  rating: number;
  reviews: number;
  stock: number;
  badge?: ProductBadge;
  description: string;
  image: string;
  secondaryImage: string;
  tags: string[];
  /** True when an active variant must be selected before adding to cart. */
  requiresVariantSelection: boolean;
  colors?: string[];
};
