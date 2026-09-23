import type { ReactNode } from "react";

export function Field({ label, htmlFor, children, className = "" }: { label: ReactNode; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm/5 text-fg">{label}</label>
      {children}
    </div>
  );
}
