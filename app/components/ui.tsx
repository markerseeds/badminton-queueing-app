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
    <div {...props} className={cn("bg-white border rounded-xl", className)}>
      {children}
    </div>
  );
}

export function Button({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={cn(
        "px-3 py-1 rounded-lg bg-black text-white hover:opacity-80 disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn("border rounded-lg px-2 py-1 w-full", className)}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn("border rounded-lg px-2 py-1 w-full", className)}
    />
  );
}
