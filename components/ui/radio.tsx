import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Radio({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="radio" className={cn("size-4 border-input accent-primary", className)} {...props} />;
}
