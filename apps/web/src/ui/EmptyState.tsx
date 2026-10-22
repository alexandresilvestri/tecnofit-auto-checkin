import type { ReactNode } from "react";

export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-line px-6 py-20 text-center">
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-xl/7 font-bold text-fg-emphasis">{title}</p>
        {text && <p className="text-sm/5 text-fg">{text}</p>}
      </div>
      {children}
    </div>
  );
}
