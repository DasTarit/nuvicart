"use client";
import { useState } from "react";
export function ShippingActions({ fulfillmentId, status }: { fulfillmentId: string; status: string }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  if (status !== "ready_to_ship") return null;
  async function create() { setBusy(true); setMessage("Creating…"); const r = await fetch("/api/shipping/shiprocket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fulfillmentId }) }); const d = await r.json().catch(() => ({})); setMessage(r.ok ? "Shipment created." : String(d.error ?? "Shipment creation failed.")); setBusy(false); }
  return <button disabled={busy} onClick={create} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Working…" : "Create Shiprocket shipment"}</button>;
}
