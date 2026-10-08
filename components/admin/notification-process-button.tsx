"use client";
import { useState } from "react";
export function NotificationProcessButton() {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await fetch("/api/admin/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 10 }) }); window.location.reload(); } finally { setBusy(false); } };
  return <button type="button" onClick={run} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Processing…" : "Process pending"}</button>;
}
