import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { CONTROL } from "./Input";

export function Select({ className = "", ...rest }: ComponentProps<"select">) {
  return (
    <div className={`relative ${className}`}>
      <select {...rest} className={`${CONTROL} h-8 cursor-pointer appearance-none pr-8 pl-3`} />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-fg" />
    </div>
  );
}
