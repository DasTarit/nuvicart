import { createClient } from "@/lib/supabase/server";
import type { CustomerAddress } from "@/features/customer/types";
import { listAddresses } from "@/features/customer/service";

export type CheckoutPreviewItem = {
  productId: string;
  variantId: string | null;
  productName: string;
  sku: string | null;
  variantName: string | null;
  variantSku: string | null;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
};

export type CheckoutPreview = {
  currency: "INR";
  items: CheckoutPreviewItem[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
};

export async function getCheckoutPreview(): Promise<{ preview: CheckoutPreview; addresses: CustomerAddress[] }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("UNAUTHENTICATED");

  const [{ data, error }, addresses] = await Promise.all([
    supabase.rpc("get_checkout_preview"),
    listAddresses(),
  ]);
  if (error) throw new Error(error.message);
  const preview = data as CheckoutPreview;
  return { preview, addresses };
}
