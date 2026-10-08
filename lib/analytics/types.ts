export type AnalyticsPreset = "today" | "yesterday" | "last7" | "last30" | "currentMonth" | "previousMonth" | "custom";

export type AnalyticsRange = { startAt: string; endAt: string; timezone: "UTC" };

export type AnalyticsSummary = {
  date_range: { start_at: string; end_at: string; timezone: "UTC"; max_days: number };
  definitions: Record<string, string | number>;
  sales: { gross_order_value: number; paid_revenue: number; order_count: number; average_order_value: number; cancelled_orders: number; delivered_orders: number };
  orders: Record<string, number>;
  products: { top_by_revenue: Array<Record<string, unknown>>; low_stock_count: number; out_of_stock_count: number; low_stock: Array<Record<string, unknown>> };
  categories: { rows: Array<Record<string, unknown>>; attribution: string };
  customers: Record<string, number>;
  payments: Record<string, number>;
  fulfillment: Record<string, number>;
  notifications: Record<string, number>;
};
