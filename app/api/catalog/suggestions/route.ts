import { NextResponse } from "next/server";
import { getSearchSuggestions } from "@/features/catalog/service";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ products: [] });

  try {
    const products = await getSearchSuggestions(query, 4);
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { products: [], error: "Catalog search is temporarily unavailable." },
      { status: 503 },
    );
  }
}
