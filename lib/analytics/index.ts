import "server-only";
import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAnalyticsRange } from "./range";
import type { AnalyticsPreset, AnalyticsRange, AnalyticsSummary } from "./types";

export async function getAnalyticsSummary(range: AnalyticsRange): Promise<AnalyticsSummary> {
  await requireAdmin();
  const db = createAdminClient();
  const { data, error } = await db.rpc("get_analytics_summary", { p_start_at: range.startAt, p_end_at: range.endAt });
  if (error) throw new Error("ANALYTICS_QUERY_FAILED");
  return data as AnalyticsSummary;
}

export async function getAnalyticsReport(preset: AnalyticsPreset, customStart?: string, customEnd?: string) {
  const range = resolveAnalyticsRange(preset, customStart, customEnd);
  return { range, summary: await getAnalyticsSummary(range) };
}

export { resolveAnalyticsRange } from "./range";
export type { AnalyticsPreset, AnalyticsRange, AnalyticsSummary } from "./types";
