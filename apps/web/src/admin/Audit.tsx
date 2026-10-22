import { useEffect, useState } from "react";
import { stamp } from "../pages/Schedules";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { download, errorMessage, get } from "./api";
import { ErrorText, Loading } from "../ui/Text";

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
    <section className="flex flex-col gap-4">
      <PageHeader title="Auditoria">
        <Button variant="secondary" onClick={exportCsv}>Exportar CSV</Button>
      </PageHeader>
      <form
        className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, ...draft });
        }}
      >
        <Field label="De" htmlFor="audit-from">
          <Input id="audit-from" type="date" value={filters.from} onChange={setDate("from")} />
        </Field>
        <Field label="Até" htmlFor="audit-to">
          <Input id="audit-to" type="date" value={filters.to} onChange={setDate("to")} />
        </Field>
        <Field label="Ator" htmlFor="audit-actor">
          <Input id="audit-actor" type="text" maxLength={200} value={draft.actor} onChange={setText("actor")} />
        </Field>
        <Field label="Ação" htmlFor="audit-action">
          <Input id="audit-action" type="text" maxLength={200} value={draft.action} onChange={setText("action")} />
        </Field>
        <Field label="Alvo" htmlFor="audit-target">
          <Input id="audit-target" type="text" maxLength={200} value={draft.target} onChange={setText("target")} />
        </Field>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
      {!data && !error && <Loading />}
      {data?.truncated && (
        <Alert tone="warning" role="status">Resultado truncado. Refine os filtros.</Alert>
      )}
      {data?.items.length === 0 && <EmptyState title="Nenhum evento." text="Amplie o período ou limpe os filtros." />}
      {data?.items.map((a) => (
        <Card as="article" key={`${a.at}-${a.action}-${a.actorId}-${a.targetId}`} compact className="flex flex-col gap-1">
          <h2 className="font-mono text-base/6 font-semibold text-fg-emphasis">{a.action}</h2>
          <p className="text-fg">{stamp(a.at)} · {a.result}</p>
          <p className="text-fg">Ator: {a.actorType}{a.actorId ? ` ${a.actorId}` : ""}</p>
          {a.targetId && <p className="text-fg">Alvo: {a.targetType} {a.targetId}</p>}
          {a.ip && <p className="text-fg">IP: <span className="font-mono">{a.ip}</span></p>}
          {a.metadata != null && (
            <details className="text-fg">
              <summary className="cursor-pointer">Detalhes</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs/4">{JSON.stringify(a.metadata, null, 2)}</pre>
            </details>
          )}
        </Card>
      ))}
    </section>
  );
}
