import type { ReactNode } from "react";

export function Stats({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-8">{children}</div>;
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs/4 text-fg-muted uppercase">{label}</span>
      <span className="text-sm/5 text-fg-emphasis">{children}</span>
    </div>
  );
}
