"use client";
import type { ReactNode } from "react";

export function Toast({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "error" }) {
  return <div role="status" className={`rounded-md border px-4 py-3 text-sm ${tone === "success" ? "border-success/30 bg-success/10" : tone === "error" ? "border-error/30 bg-error/10" : "border-border bg-surface"}`}>{children}</div>;
}
