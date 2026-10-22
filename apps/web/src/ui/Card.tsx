import { createElement, type HTMLAttributes } from "react";

export function Card({
  as = "div",
  title,
  compact,
  danger,
  className = "",
  children,
  ...rest
}: { as?: "div" | "article" | "section" | "form"; title?: string; compact?: boolean; danger?: boolean } & HTMLAttributes<HTMLElement>) {
  return createElement(
    as,
    { ...rest, className: `rounded-3xl border ${danger ? "border-error-6" : "border-line"} ${compact ? "p-4" : "p-6"} ${className}` },
    title && <h2 className="mb-3 text-xl/7 font-bold text-fg-emphasis">{title}</h2>,
    children,
  );
}
