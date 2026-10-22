import { useEffect, useState } from "react";
import { STATUS_LABEL, STATUS_TONE } from "../pages/Schedules";
import { Stat, Stats } from "../ui/Stat";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Select } from "../ui/Select";
import { Table } from "../ui/Table";
import { errorMessage, get } from "./api";
import { ErrorText, Loading } from "../ui/Text";

type Execution = {
  userId: string;
  scheduleId: string;
  className: string;
  startTime: string;
  status: string;
  attempts: number;
  error?: string;
};

export function Executions() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [user, setUser] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<Execution[]>();
  const [names, setNames] = useState(new Map<string, string>());
  const [error, setError] = useState("");

  useEffect(() => {
    get<{ userId: string; name: string }[]>("/api/admin/users")
      .then((users) => setNames(new Map(users.map((u) => [u.userId, u.name]))))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(undefined);
    setError("");
    get<Execution[]>(`/api/admin/executions?${new URLSearchParams({ date })}`)
      .then((d) => !cancelled && setItems(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const nameOf = (id: string) => names.get(id) ?? id;

  const counts = new Map<string, number>();
  for (const i of items ?? []) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  const term = user.trim().toLowerCase();
  const shown = items?.filter((i) => (!status || i.status === status) && (!term || nameOf(i.userId).toLowerCase().includes(term)));

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Execuções" />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Data" htmlFor="exec-date" className="w-44">
          <Input id="exec-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="Usuário" htmlFor="exec-user" className="min-w-60 flex-1">
          <Input id="exec-user" type="text" search value={user} onChange={(e) => setUser(e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="exec-status" className="w-48">
          <Select id="exec-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {!items && !error && <Loading />}
      {items && items.length > 0 && (
        <Stats>
          {[...counts].map(([key, n]) => (
            <Stat key={key} label={STATUS_LABEL[key] ?? key}>{n}</Stat>
          ))}
        </Stats>
      )}
      {items?.length === 0 && <EmptyState title="Nenhuma execução." text="Nada rodou nesta data." />}
      {shown && shown.length > 0 && (
        <Table head={["Aula", "Usuário", "Status", "Tentativas", "Erro"]}>
          {shown.map((i) => (
            <tr key={`${i.userId}-${i.scheduleId}`}>
              <td className="text-fg-emphasis">{i.startTime} — {i.className}</td>
              <td><a href={`/admin/usuarios/${i.userId}`}>{nameOf(i.userId)}</a></td>
              <td><Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{STATUS_LABEL[i.status] ?? i.status}</Badge></td>
              <td>{i.attempts}</td>
              <td className="text-error-11">{i.error ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
