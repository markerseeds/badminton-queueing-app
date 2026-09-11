"use client";

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

export function Card({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...props} className={cn("card", className)}>
      {children}
    </div>
  );
}

// Variants replace the old pattern of passing a raw colour
// (`<Button className="bg-red-600">`), which spread five different greys and
// two different reds across the app for what were really three intents.
// `btn-variant` is registered with tailwind-merge in lib/cn.ts, so a variant
// passed through `className` still beats the one set here.
const VARIANTS = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  quiet: "btn-quiet",
  // Tinted — for a destructive action sitting inline beside others.
  danger: "btn-danger",
  // Solid — for when destructive is the primary action of a confirmation.
  dangerSolid: "btn-danger-solid",
} as const;

const SIZES = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  block = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "btn",
        VARIANTS[variant],
        SIZES[size],
        block && "btn-block",
        className,
      )}
    >
      {children}
    </button>
  );
}

// Square, icon-only control. Always give it an aria-label — the icons inside
// are aria-hidden, so without one it announces as an empty button.
export function IconButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" {...props} className={cn("icon-btn", className)}>
      {children}
    </button>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("field", className)} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("field", className)} />;
}
