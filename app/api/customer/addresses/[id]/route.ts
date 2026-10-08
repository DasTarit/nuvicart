import { NextResponse } from "next/server";
import { updateAddress, deleteAddress, setDefaultAddress } from "@/features/customer/service";
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const b=await request.json().catch(()=>null);if(!b||typeof b!=="object")return NextResponse.json({error:"INVALID_INPUT"},{status:400});if(b.isDefault===true)return NextResponse.json({address:await setDefaultAddress(id)});return NextResponse.json({address:await updateAddress(id,b)});}
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;await deleteAddress(id);return NextResponse.json({ok:true});}
