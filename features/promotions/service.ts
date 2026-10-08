import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PromotionValidation } from "./types";

export async function validatePromotion(code: string): Promise<PromotionValidation> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("PROMOTION_CODE_REQUIRED");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_promotion_for_cart", { p_code: normalized });
  if (error) throw new Error(error.message);
  return data as PromotionValidation;
}
