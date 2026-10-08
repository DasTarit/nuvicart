import { categories, demoProducts } from "./data";
import type { CatalogCategory, CatalogProduct, Product } from "./types";
import { discount } from "./pricing";

export type ProductQuery = {
  query?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStock?: boolean;
  minDiscount?: number;
  sort?: string;
};

function toCatalogProduct(product: Product): CatalogProduct {
  const category: CatalogCategory = {
    id: `demo-category-${product.categorySlug}`,
    name: product.category,
    slug: product.categorySlug,
    description: null,
    imageUrl: product.image,
    isActive: true,
    sortOrder: 0,
  };
  return {
    catalogId: product.id,
    id: product.id,
    slug: product.slug,
    name: product.name,
    sku: null,
    shortDescription: product.description,
    description: product.description,
    price: product.price,
    compareAtPrice: product.originalPrice ?? null,
    status: "active",
    isFeatured: Boolean(product.badge),
    isActive: true,
    rating: product.rating,
    reviewCount: product.reviews,
    category,
    brand: {
      id: `demo-brand-${product.brand.toLowerCase().replaceAll(" ", "-")}`,
      name: product.brand,
      slug: product.brand.toLowerCase().replaceAll(" ", "-"),
      description: null,
      logoUrl: null,
      isActive: true,
    },
    images: [
      { id: `${product.id}-primary`, url: product.image, altText: product.name, sortOrder: 0, isPrimary: true },
      { id: `${product.id}-secondary`, url: product.secondaryImage, altText: `${product.name} alternate view`, sortOrder: 1, isPrimary: false },
    ],
    variants: [],
    requiresVariantSelection: false,
    availability: { inStock: product.stock > 0, availableQuantity: product.stock },
    tags: product.tags,
  };
}

function fromCatalogProduct(product: CatalogProduct): Product {
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
    requiresVariantSelection: product.requiresVariantSelection,
  };
}

export const demoRepository = {
  async listProducts(input: ProductQuery = {}) {
    let products = demoProducts.map(toCatalogProduct);
    const query = input.query?.trim().toLowerCase();

    if (input.category) products = products.filter((product) => product.category?.slug === input.category);
    if (input.brand) products = products.filter((product) => product.brand?.name === input.brand);
    if (query) {
      products = products.filter((product) =>
        [product.name, product.brand?.name, product.category?.name, ...product.tags]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }

    const minPrice = Number.isFinite(input.minPrice) && input.minPrice! >= 0 ? input.minPrice : undefined;
    const maxPrice = Number.isFinite(input.maxPrice) && input.maxPrice! >= 0 ? input.maxPrice : undefined;
    const minRating = Number.isFinite(input.minRating) && input.minRating! >= 0 && input.minRating! <= 5 ? input.minRating : undefined;
    const minDiscount = Number.isFinite(input.minDiscount) && input.minDiscount! >= 0 && input.minDiscount! <= 100 ? input.minDiscount : undefined;

    if (minPrice !== undefined) products = products.filter((product) => product.price >= minPrice);
    if (maxPrice !== undefined) products = products.filter((product) => product.price <= maxPrice);
    if (minRating !== undefined) products = products.filter((product) => product.rating >= minRating);
    if (input.inStock) products = products.filter((product) => product.availability.inStock);
    if (minDiscount !== undefined) products = products.filter((product) => discount(fromCatalogProduct(product)) >= minDiscount);

    switch (input.sort) {
      case "price-asc": products.sort((a, b) => a.price - b.price); break;
      case "price-desc": products.sort((a, b) => b.price - a.price); break;
      case "rating": products.sort((a, b) => b.rating - a.rating); break;
      case "discount": products.sort((a, b) => discount(fromCatalogProduct(b)) - discount(fromCatalogProduct(a))); break;
      case "newest": products.sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured)); break;
      case "popular": products.sort((a, b) => b.reviewCount - a.reviewCount); break;
    }

    return products.map(fromCatalogProduct);
  },

  async getCatalogProduct(slug: string) {
    const product = demoProducts.find((item) => item.slug === slug);
    return product ? toCatalogProduct(product) : undefined;
  },

  async getProduct(slug: string) {
    const product = await this.getCatalogProduct(slug);
    return product ? fromCatalogProduct(product) : undefined;
  },

  async getProductsByIds(ids: string[]) {
    const wanted = new Set(ids);
    return demoProducts.filter((product) => wanted.has(product.id)).map((product) => fromCatalogProduct(toCatalogProduct(product)));
  },

  async getCategory(slug: string) {
    const category = categories.find((item) => item.slug === slug);
    if (!category) return undefined;
    return {
      id: `demo-category-${category.slug}`,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.image,
      isActive: true,
      sortOrder: 0,
    } satisfies CatalogCategory;
  },

  async listCategories() {
    return categories.map((category, index) => ({
      id: `demo-category-${category.slug}`,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.image,
      isActive: true,
      sortOrder: index * 10,
    } satisfies CatalogCategory));
  },

  async getCategoryProducts(slug: string) {
    return this.listProducts({ category: slug });
  },

  async getBrands() {
    return [...new Map(demoProducts.map((product) => [product.brand, product.brand])).values()];
  },

  async getSearchSuggestions(query: string, limit = 4) {
    const products = await this.listProducts({ query });
    return products.slice(0, Math.max(0, Math.min(limit, 10)));
  },
};
