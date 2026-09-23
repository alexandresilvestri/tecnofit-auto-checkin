import type { ComponentProps, ReactNode } from "react";

export function Check({ id, label, className = "", ...rest }: { id: string; label: ReactNode; className?: string } & Omit<ComponentProps<"input">, "id" | "type" | "className">) {
  return (
    <label htmlFor={id} className={`flex items-start gap-2 text-sm/5 text-fg ${className}`}>
      <input id={id} type="checkbox" className="mt-0.5" {...rest} />
      {label}
    </label>
  );
}
