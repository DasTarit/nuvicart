import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/admin";
import { processPendingNotifications } from "@/lib/email/worker";
import { recordAdminAudit } from "@/lib/auth/admin-audit";

export async function GET(request: Request) {
  try { const { role } = await requireAdmin(); if (role !== "admin" && role !== "super_admin") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403 }); }
  const admin = createAdminClient();
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 25)));
  const { data, error, count } = await admin
    .from("notification_events")
    .select("id,event_type,order_id,delivery_status,provider,provider_message_id,attempt_count,last_attempted_at,sent_at,failure_kind,failure_code,failure_reason,created_at,updated_at", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return NextResponse.json({ error: "NOTIFICATION_LIST_FAILED" }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [], page, pageSize, total: count ?? 0 });
}

export async function POST(request: Request) {
  try { const { role } = await requireAdmin(); if (role !== "admin" && role !== "super_admin") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403 }); }
  const body = await request.json().catch(() => null) as { limit?: unknown } | null;
  const limit = typeof body?.limit === "number" ? body.limit : 10;
  try {
    const results = await processPendingNotifications(limit);
    if (results.length) await recordAdminAudit("notification_delivery_processed", "notification", null, { processed: results.length }, `notification:process:${new Date().toISOString().slice(0,13)}`);
    return NextResponse.json({ processed: results.length, results });
  } catch {
    return NextResponse.json({ error: "NOTIFICATION_PROCESSING_FAILED" }, { status: 503 });
  }
}

export async function DELETE() { return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { allow: "GET, POST" } }); }
