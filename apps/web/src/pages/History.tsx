import { useEffect, useState } from "react";
import { errorMessage, get, guard } from "../api";
import { Nav } from "../Nav";
import { STATUS_LABEL } from "./Schedules";

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

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

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
    <section>
      <Nav />
      {error && <p role="alert" className="error">{error}</p>}
      {!items && !error && <p>Carregando...</p>}
      {items?.length === 0 && <p>Nenhuma execução.</p>}
      {items?.map((x) => (
        <article key={`${x.scheduleId}-${x.classDate}`} className="item">
          <h2>{dmy(x.classDate)} {x.startTime} — {x.className ?? "Aula"}</h2>
          <p>
            {STATUS_LABEL[x.status] ?? x.status}
            {x.status === "failed" && ` (${REASONS[x.error ?? ""] ?? "erro"})`}
            {" · "}
            {x.attempts} {x.attempts === 1 ? "tentativa" : "tentativas"}
          </p>
        </article>
      ))}
      {cursor && <button type="button" disabled={loading} onClick={() => load(cursor)}>Carregar mais</button>}
    </section>
  );
}
