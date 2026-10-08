import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

export function Button({ className, variant = "primary", size = "md", asChild, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; asChild?: boolean; children?: ReactNode }) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
    variant === "secondary" && "bg-secondary text-secondary-foreground hover:opacity-90",
    variant === "outline" && "border border-border bg-transparent hover:bg-surface-muted",
    variant === "ghost" && "hover:bg-surface-muted",
    variant === "destructive" && "bg-error text-white hover:opacity-90",
    size === "sm" && "h-9 px-3 text-sm",
    size === "md" && "h-10 px-4 text-sm",
    size === "lg" && "h-11 px-5",
    className,
  );
  if (asChild) return <span className={classes}>{children}</span>;
  return <button className={classes} {...props}>{children}</button>;
}
