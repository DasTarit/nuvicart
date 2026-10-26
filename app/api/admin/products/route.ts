import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Image links may come from any website (https) or be a /path inside public/.
const imageUrl = z.string().trim().min(1).max(2000)
  .refine((u) => /^https:\/\/\S+$/i.test(u) || /^\/[^\s/]\S*$/.test(u), "INVALID_IMAGE_URL");

const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(10000).nullable().optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  price: z.coerce.number().finite().nonnegative(),
  compareAtPrice: z.coerce.number().finite().nonnegative().nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  tags: z.array(z.string().trim().max(50)).max(50).optional(),
  imageUrls: z.array(imageUrl).min(2).max(10),
  isActive: z.boolean().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  stock: z.coerce.number().int().nonnegative().max(1000000).optional(),
});

function err(e: unknown) {
  if (e instanceof Error && e.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  if (e instanceof Error && e.message === "FORBIDDEN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  console.error("Admin product operation failed", e);

  return NextResponse.json(
    { error: "ADMIN_OPERATION_FAILED" },
    { status: 500 },
  );
}

function invalidInput(error: z.ZodError) {
  const issue = error.issues[0];
  let code = "INVALID_PRODUCT_INPUT";
  if (issue?.path[0] === "imageUrls") code = issue.path.length === 1 ? "PRODUCT_NEEDS_TWO_IMAGES" : "INVALID_IMAGE_URL";
  return NextResponse.json({ error: code }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const u = new URL(request.url);
    const q = (u.searchParams.get("q")?.trim() ?? "").replace(/[,%()]/g, " ");
    const category = u.searchParams.get("category");
    const active = u.searchParams.get("active");
    const page = Math.max(1, Number(u.searchParams.get("page") ?? 1));
    const size = Math.min(50, Math.max(1, Number(u.searchParams.get("pageSize") ?? 25)));
    const db = createAdminClient();
    let query = db.from("products")
      .select("id,name,slug,sku,price,compare_at_price,category_id,brand_id,is_active,status,stock,image_url,created_at,updated_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * size, page * size - 1);
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,slug.ilike.%${q}%`);
    if (category) query = query.eq("category_id", category);
    if (active === "true") query = query.eq("is_active", true);
    if (active === "false") query = query.eq("is_active", false);
    const { data, error, count } = await query;
    if (error) throw error;
    return NextResponse.json({ products: data ?? [], page, pageSize: size, total: count ?? 0 });
  } catch (e) { return err(e); }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = productSchema.safeParse(await request.json());
    if (!parsed.success) return invalidInput(parsed.error);
    const v = parsed.data;
    const db = await createClient();
    const { data, error } = await db.rpc("admin_create_product", {
      p_name: v.name, p_slug: v.slug, p_description: v.description ?? null, p_short_description: v.shortDescription ?? null,
      p_brand_id: v.brandId ?? null, p_category_id: v.categoryId ?? null, p_price: v.price, p_compare_at_price: v.compareAtPrice ?? null,
      p_sku: v.sku ?? null, p_tags: v.tags ?? [], p_image_urls: v.imageUrls, p_initial_stock: v.stock ?? 0,
    });
    if (error) throw error;
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (e) { return err(e); }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    if (typeof body?.id !== "string") return NextResponse.json({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const v = parsed.data;
    const db = await createClient();
    const { data, error } = await db.rpc("admin_update_product", {
      p_product_id: body.id, p_name: v.name, p_slug: v.slug, p_description: v.description ?? null, p_short_description: v.shortDescription ?? null,
      p_brand_id: v.brandId ?? null, p_category_id: v.categoryId ?? null, p_price: v.price, p_compare_at_price: v.compareAtPrice ?? null,
      p_sku: v.sku ?? null, p_tags: v.tags ?? [], p_image_urls: v.imageUrls, p_is_active: v.isActive ?? true, p_status: v.status ?? "active",
      p_stock: v.stock ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ product: data });
  } catch (e) { return err(e); }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
    const db = await createClient();
    const { data, error } = await db.rpc("admin_delete_product", { p_product_id: id });
    if (error) throw error;
    return NextResponse.json({ result: data });
  } catch (e) { return err(e); }
}
