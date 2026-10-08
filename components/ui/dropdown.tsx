"use client";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "./cn";

export function Dropdown({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="relative inline-block"><button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{trigger}</button>{open && <div role="menu" className={cn("absolute right-0 z-20 mt-2 min-w-44 rounded-md border border-border bg-surface p-1 shadow-md")} onClick={() => setOpen(false)}>{children}</div>}</div>;
}
