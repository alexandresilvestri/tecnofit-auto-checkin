import type { ReactNode } from "react";

export function ErrorText({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-error-11">{children}</p>;
}

export function Loading({ children = "Carregando..." }: { children?: ReactNode }) {
  return <p className="text-fg-muted">{children}</p>;
}
