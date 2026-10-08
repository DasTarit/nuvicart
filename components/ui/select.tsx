import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-10 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none", className)} {...props} />;
}
