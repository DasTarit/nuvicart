export type PromotionDiscountType = "percentage" | "fixed_amount";
export type PromotionValidation = {
  valid: boolean;
  code: string;
  reason: string | null;
  promotionId: string | null;
  eligibleSubtotal: number;
  discountAmount: number;
  minimumOrderValue: number | null;
  maximumDiscount: number | null;
};
