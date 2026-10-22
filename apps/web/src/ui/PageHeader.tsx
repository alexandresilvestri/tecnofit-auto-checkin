import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-[28px]/[34px] font-medium text-fg-emphasis">{title}</h1>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
