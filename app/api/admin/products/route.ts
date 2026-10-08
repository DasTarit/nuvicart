import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const productSchema=z.object({
  name:z.string().trim().min(1).max(200), slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description:z.string().max(10000).nullable().optional(), shortDescription:z.string().max(500).nullable().optional(),
  brandId:z.string().uuid().nullable().optional(), categoryId:z.string().uuid().nullable().optional(),
  price:z.coerce.number().finite().nonnegative(), compareAtPrice:z.coerce.number().finite().nonnegative().nullable().optional(),
  sku:z.string().trim().max(100).nullable().optional(), tags:z.array(z.string().trim().max(50)).max(50).optional(),
  imageUrl:z.string().url().max(2000).nullable().optional(), isActive:z.boolean().optional(), status:z.enum(["draft","active","archived"]).optional()
});
function err(e:unknown){return NextResponse.json({error:e instanceof Error?e.message:"ADMIN_OPERATION_FAILED"},{status:400});}
export async function GET(request:Request){
  try{await requireAdmin();const u=new URL(request.url),q=(u.searchParams.get("q")?.trim()??"").replace(/[,%()]/g," "),category=u.searchParams.get("category"),active=u.searchParams.get("active"),page=Math.max(1,Number(u.searchParams.get("page")??1)),size=Math.min(50,Math.max(1,Number(u.searchParams.get("pageSize")??25)));
    const db=createAdminClient();let query=db.from("products").select("id,name,slug,sku,price,compare_at_price,category_id,brand_id,is_active,status,stock,image_url,created_at,updated_at",{count:"exact"}).order("created_at",{ascending:false}).range((page-1)*size,page*size-1);
    if(q) query=query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,slug.ilike.%${q}%`); if(category) query=query.eq("category_id",category); if(active==="true") query=query.eq("is_active",true); if(active==="false") query=query.eq("is_active",false);
    const {data,error,count}=await query;if(error)throw error;return NextResponse.json({products:data??[],page,pageSize:size,total:count??0});
  }catch(e){return err(e);}
}
export async function POST(request:Request){
  try{await requireAdmin();const parsed=productSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"INVALID_PRODUCT_INPUT"},{status:400});const v=parsed.data;const db=await createClient();
    const {data,error}=await db.rpc("admin_create_product",{p_name:v.name,p_slug:v.slug,p_description:v.description??null,p_short_description:v.shortDescription??null,p_brand_id:v.brandId??null,p_category_id:v.categoryId??null,p_price:v.price,p_compare_at_price:v.compareAtPrice??null,p_sku:v.sku??null,p_tags:v.tags??[],p_image_url:v.imageUrl??null});if(error)throw error;return NextResponse.json({product:data},{status:201});
  }catch(e){return err(e);}
}
export async function PATCH(request:Request){
  try{await requireAdmin();const body=await request.json();if(typeof body?.id!=="string")return NextResponse.json({error:"INVALID_PRODUCT_ID"},{status:400});const parsed=productSchema.safeParse(body);if(!parsed.success)return NextResponse.json({error:"INVALID_PRODUCT_INPUT"},{status:400});const v=parsed.data;const db=await createClient();
    const {data,error}=await db.rpc("admin_update_product",{p_product_id:body.id,p_name:v.name,p_slug:v.slug,p_description:v.description??null,p_short_description:v.shortDescription??null,p_brand_id:v.brandId??null,p_category_id:v.categoryId??null,p_price:v.price,p_compare_at_price:v.compareAtPrice??null,p_sku:v.sku??null,p_tags:v.tags??[],p_image_url:v.imageUrl??null,p_is_active:v.isActive??true,p_status:v.status??"active"});if(error)throw error;return NextResponse.json({product:data});
  }catch(e){return err(e);}
}
export async function DELETE(request:Request){
  try{await requireAdmin();const id=new URL(request.url).searchParams.get("id");if(!id)return NextResponse.json({error:"INVALID_PRODUCT_ID"},{status:400});const db=await createClient();const {data,error}=await db.rpc("admin_archive_product",{p_product_id:id});if(error)throw error;return NextResponse.json({product:data});
  }catch(e){return err(e);}
}
