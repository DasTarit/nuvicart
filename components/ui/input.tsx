import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-10 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted focus-visible:border-ring focus-visible:outline-none", className)} {...props} />;
}
