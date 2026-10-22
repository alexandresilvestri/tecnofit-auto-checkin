import { useEffect, useState } from "react";
import { errorMessage, get, guard } from "../api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { STATUS_LABEL, STATUS_TONE, fullDate } from "./Schedules";
import { ErrorText, Loading } from "../ui/Text";

type Execution = {
  scheduleId: string;
  classDate: string;
  className?: string;
  startTime?: string;
  status: string;
  attempts: number;
  error?: string;
};

const REASONS: Record<string, string> = {
  full: "lotada",
  class_not_found: "aula não encontrada",
  unauthorized: "conexão expirada",
  timeout: "tempo esgotado",
};

export function History() {
  const [items, setItems] = useState<Execution[]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(next?: string | null) {
    setError("");
    setLoading(true);
    try {
      const path = next ? `/api/executions?cursor=${encodeURIComponent(next)}` : "/api/executions";
      const page = await get<{ items: Execution[]; cursor: string | null }>(path);
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.cursor);
    } catch (e) {
      if (!guard(e)) setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <PageHeader title="Histórico" />
      {error && <ErrorText>{error}</ErrorText>}
      {!items && !error && <Loading />}
      {items?.length === 0 && <EmptyState title="Nenhuma execução." text="Os check-ins feitos aparecem aqui." />}
      {items?.map((x) => (
        <Card as="article" key={`${x.scheduleId}-${x.classDate}`} compact className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base/6 font-semibold text-fg-emphasis">{fullDate(x.classDate)} {x.startTime} — {x.className ?? "Aula"}</h2>
            <p className="text-sm/5 text-fg">
              {STATUS_LABEL[x.status] ?? x.status}
              {x.status === "failed" && ` (${REASONS[x.error ?? ""] ?? "erro"})`}
              {" · "}
              {x.attempts} {x.attempts === 1 ? "tentativa" : "tentativas"}
            </p>
          </div>
          <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{STATUS_LABEL[x.status] ?? x.status}</Badge>
        </Card>
      ))}
      {cursor && <Button variant="secondary" disabled={loading} onClick={() => load(cursor)}>Carregar mais</Button>}
    </section>
  );
}
