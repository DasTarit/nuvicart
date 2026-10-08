import { NextResponse } from "next/server";
import { getCart, setCartItem, removeCartItem, clearCart } from "@/features/customer/service";
export async function GET(){return NextResponse.json({cart:await getCart()});}
export async function POST(request:Request){const b=await request.json().catch(()=>null);if(!b||typeof b.productId!=="string"||!Number.isInteger(b.quantity))return NextResponse.json({error:"INVALID_INPUT"},{status:400});return NextResponse.json({cart:await setCartItem({productId:b.productId,variantId:typeof b.variantId==="string"?b.variantId:null,quantity:b.quantity})});}
export async function DELETE(request:Request){const b=await request.json().catch(()=>null);if(!b||typeof b.productId!=="string")return NextResponse.json({error:"INVALID_INPUT"},{status:400});return NextResponse.json({cart:await removeCartItem(b.productId,typeof b.variantId==="string"?b.variantId:null)});}
export async function PUT(){await clearCart();return NextResponse.json({ok:true});}
