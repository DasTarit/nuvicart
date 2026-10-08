import { NextResponse } from "next/server";
import { getProductsByIds } from "@/features/catalog/service";

export async function GET(request: Request) {
  const rawIds = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(rawIds.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (!ids.length) return NextResponse.json({ products: [] });

  try {
    const products = await getProductsByIds(ids);
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { products: [], error: "Catalog data is temporarily unavailable." },
      { status: 503 },
    );
  }
}
