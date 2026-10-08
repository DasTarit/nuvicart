import { NextResponse } from "next/server";
import { z } from "zod";
import { validatePromotion } from "@/features/promotions/service";
const schema=z.object({code:z.string().trim().min(1).max(64)});
export async function POST(request:Request){try{const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"INVALID_PROMOTION_CODE"},{status:400});const result=await validatePromotion(parsed.data.code);if(!result.valid)return NextResponse.json(result,{status:422});return NextResponse.json(result);}catch(error){const message=error instanceof Error?error.message:"PROMOTION_VALIDATION_FAILED";return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:400});}}
