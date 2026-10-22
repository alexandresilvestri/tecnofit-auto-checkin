import { useEffect, useState } from "react";
import { stamp } from "../pages/Schedules";
import { download, errorMessage, get } from "./api";

type Item = {
  at: string;
  actorType: string;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  result: string;
  ip?: string;
  metadata?: unknown;
};

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("sv-SE");
};

export function Audit() {
  const [filters, setFilters] = useState({ from: day(-6), to: day(0), actor: "", action: "", target: "" });
  const [draft, setDraft] = useState({ actor: "", action: "", target: "" });
  const [data, setData] = useState<{ items: Item[]; truncated: boolean }>();
  const [error, setError] = useState("");

  const query = () =>
    new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError("");
    get<{ items: Item[]; truncated: boolean }>(`/api/admin/audit?${query()}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const setDate = (key: "from" | "to") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) setFilters({ ...filters, [key]: e.target.value });
  };
  const setText = (key: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [key]: e.target.value });

  async function exportCsv() {
    setError("");
    try {
      await download(`/api/admin/audit/export?${query()}`, `auditoria-${filters.from}-${filters.to}.csv`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section>
      <h1>Auditoria</h1>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, ...draft });
        }}
      >
        <label htmlFor="audit-from">De</label>
        <input id="audit-from" type="date" value={filters.from} onChange={setDate("from")} />
        <label htmlFor="audit-to">Até</label>
        <input id="audit-to" type="date" value={filters.to} onChange={setDate("to")} />
        <label htmlFor="audit-actor">Ator</label>
        <input id="audit-actor" type="text" maxLength={200} value={draft.actor} onChange={setText("actor")} />
        <label htmlFor="audit-action">Ação</label>
        <input id="audit-action" type="text" maxLength={200} value={draft.action} onChange={setText("action")} />
        <label htmlFor="audit-target">Alvo</label>
        <input id="audit-target" type="text" maxLength={200} value={draft.target} onChange={setText("target")} />
        <button type="submit">Filtrar</button>
        <button type="button" onClick={exportCsv}>Exportar CSV</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {!data && !error && <p>Carregando...</p>}
      {data?.truncated && (
        <p role="status" className="banner">Resultado truncado. Refine os filtros.</p>
      )}
      {data?.items.length === 0 && <p>Nenhum evento.</p>}
      {data?.items.map((a) => (
        <article key={`${a.at}-${a.action}-${a.actorId}-${a.targetId}`} className="item">
          <h2>{a.action}</h2>
          <p>{stamp(a.at)} · {a.result}</p>
          <p>Ator: {a.actorType}{a.actorId ? ` ${a.actorId}` : ""}</p>
          {a.targetId && <p>Alvo: {a.targetType} {a.targetId}</p>}
          {a.ip && <p>IP: {a.ip}</p>}
          {a.metadata != null && (
            <details>
              <summary>Detalhes</summary>
              <pre>{JSON.stringify(a.metadata, null, 2)}</pre>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
