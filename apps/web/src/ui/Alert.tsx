import type { ComponentProps } from "react";

const TONE = {
  success: "border-success-6 from-success-3 text-success-11",
  warning: "border-warning-6 from-warning-3 text-warning-11",
  error: "border-error-6 from-error-3 text-error-11",
};

export function Alert({ tone, className = "", ...rest }: { tone: keyof typeof TONE } & ComponentProps<"div">) {
  return <div {...rest} className={`rounded-2xl border bg-gradient-to-r to-transparent p-4 text-sm/5 ${TONE[tone]} ${className}`} />;
}
