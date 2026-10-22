import { Search } from "lucide-react";
import type { ComponentProps } from "react";

export const CONTROL = "w-full rounded-xl border border-line-interactive bg-interactive text-sm/5 text-fg-emphasis";

export function Input({ size = "md", search, className = "", ...rest }: { size?: "md" | "lg"; search?: boolean } & Omit<ComponentProps<"input">, "size">) {
  const input = <input {...rest} className={`${CONTROL} px-3 placeholder:text-fg-placeholder ${size === "lg" ? "h-10" : "h-8"} ${search ? "pl-8" : ""} ${className}`} />;
  if (!search) return input;
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-placeholder" />
      {input}
    </div>
  );
}
