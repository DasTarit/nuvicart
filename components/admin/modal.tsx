"use client";
import { useEffect, type ReactNode } from "react";

/** Simple centered popup. Render it only while open. Closes on Esc or clicking outside. */
export function Modal({ title, onClose, children, size = "lg" }: {
  title: string; onClose: () => void; children: ReactNode; size?: "sm" | "lg";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title}
      className={`w-full ${size === "sm" ? "max-w-md" : "max-w-3xl"} rounded-xl border bg-surface p-5 shadow-xl sm:p-6`}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-md px-2 py-1 text-xl leading-none text-muted hover:text-foreground">×</button>
      </div>
      {children}
    </div>
  </div>;
}
