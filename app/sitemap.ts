import type { MetadataRoute } from "next";
import { getCategoryProducts, listCategories } from "@/features/catalog/service";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nuvicart.com";
  const categories = await listCategories();
  const categoryProducts = await Promise.all(categories.map((category) => getCategoryProducts(category.slug)));
  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/shop`, priority: 0.9 },
    { url: `${baseUrl}/categories`, priority: 0.8 },
    ...categories.map((category) => ({ url: `${baseUrl}/category/${category.slug}`, priority: 0.7 })),
    ...categoryProducts.flat().map((product) => ({ url: `${baseUrl}/product/${product.slug}`, priority: 0.6 })),
  ];
}
