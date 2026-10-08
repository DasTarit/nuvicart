import type { AnalyticsPreset, AnalyticsRange } from "./types";

const DAY = 86_400_000;

function utcDayStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function resolveAnalyticsRange(preset: AnalyticsPreset, customStart?: string, customEnd?: string, now = new Date()): AnalyticsRange {
  const today = utcDayStart(now);
  let start: Date;
  let end: Date;
  switch (preset) {
    case "today": start = today; end = new Date(today.getTime() + DAY); break;
    case "yesterday": end = today; start = new Date(today.getTime() - DAY); break;
    case "last7": end = new Date(today.getTime() + DAY); start = new Date(end.getTime() - 7 * DAY); break;
    case "last30": end = new Date(today.getTime() + DAY); start = new Date(end.getTime() - 30 * DAY); break;
    case "currentMonth": start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)); break;
    case "previousMonth": end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)); break;
    case "custom":
      if (!customStart || !customEnd) throw new Error("CUSTOM_DATE_RANGE_REQUIRED");
      start = new Date(customStart); end = new Date(customEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("INVALID_ANALYTICS_DATE_RANGE");
      break;
    default: throw new Error("INVALID_ANALYTICS_PRESET");
  }
  if (start >= end) throw new Error("INVALID_ANALYTICS_DATE_RANGE");
  if (end.getTime() - start.getTime() > 366 * DAY) throw new Error("ANALYTICS_DATE_RANGE_TOO_LARGE");
  return { startAt: start.toISOString(), endAt: end.toISOString(), timezone: "UTC" };
}
