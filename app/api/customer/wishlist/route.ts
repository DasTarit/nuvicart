import { NextResponse } from "next/server";
import { addWishlist, removeWishlist, getWishlist } from "@/features/customer/service";
export async function GET(){ return NextResponse.json({ wishlist: await getWishlist() }); }
export async function POST(request: Request){ const body=await request.json().catch(()=>null); if(!body || typeof body.productId!=="string") return NextResponse.json({error:"INVALID_INPUT"},{status:400}); await addWishlist(body.productId); return NextResponse.json({wishlist:await getWishlist()}); }
export async function DELETE(request: Request){ const body=await request.json().catch(()=>null); if(!body || typeof body.productId!=="string") return NextResponse.json({error:"INVALID_INPUT"},{status:400}); await removeWishlist(body.productId); return NextResponse.json({wishlist:await getWishlist()}); }
