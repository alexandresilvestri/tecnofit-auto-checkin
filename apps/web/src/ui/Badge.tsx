import type { ReactNode } from "react";

const TONE = {
  success: "bg-success-3 text-success-11",
  error: "bg-error-3 text-error-11",
  warning: "bg-warning-3 text-warning-11",
  info: "bg-info-3 text-info-11",
  neutral: "bg-interactive text-fg",
};

export type Tone = keyof typeof TONE;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex h-6 items-center rounded-lg px-2 text-xs/4 font-medium whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}
