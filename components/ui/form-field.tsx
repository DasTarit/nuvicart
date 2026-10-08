import type { ReactNode } from "react";

export function FormField({ id, label, description, error, children }: { id: string; label: string; description?: string; error?: string; children: ReactNode }) {
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">{label}</label>{description && <p className="text-xs text-muted">{description}</p>}{children}{error && <p id={`${id}-error`} role="alert" className="text-xs text-error">{error}</p>}</div>;
}
