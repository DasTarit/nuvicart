import { NextResponse } from "next/server";
import { getAnalyticsReport } from "@/lib/analytics";
import type { AnalyticsPreset } from "@/lib/analytics";

const PRESETS = new Set<AnalyticsPreset>(["today","yesterday","last7","last30","currentMonth","previousMonth","custom"]);

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const preset = (params.get("preset") ?? "last30") as AnalyticsPreset;
    if (!PRESETS.has(preset)) return NextResponse.json({ error: "INVALID_ANALYTICS_PRESET" }, { status: 400 });
    const customStart = params.get("start") ?? undefined;
    const customEnd = params.get("end") ?? undefined;
    if (customStart && customStart.length > 40 || customEnd && customEnd.length > 40) return NextResponse.json({ error: "INVALID_ANALYTICS_DATE_RANGE" }, { status: 400 });
    const report = await getAnalyticsReport(preset, customStart, customEnd);
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ANALYTICS_FAILED";
    const status = message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? 403 : 400;
    return NextResponse.json({ error: status === 403 ? "FORBIDDEN" : message }, { status });
  }
}
