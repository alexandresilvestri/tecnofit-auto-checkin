import { useEffect, useState } from "react";
import { STATUS_LABEL } from "../pages/Schedules";
import { errorMessage, get } from "./api";

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
  const [error, setError] = useState("");

  useEffect(() => {
    setItems(undefined);
    setError("");
    get<Execution[]>(`/api/admin/executions?${new URLSearchParams({ date })}`)
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, [date]);

  const counts = new Map<string, number>();
  for (const i of items ?? []) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  const term = user.trim().toLowerCase();
  const shown = items?.filter((i) => (!status || i.status === status) && (!term || i.userId.toLowerCase().includes(term)));

  return (
    <section>
      <h1>Execuções</h1>
      <div className="filters">
        <label htmlFor="exec-date">Data</label>
        <input id="exec-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <label htmlFor="exec-user">Usuário (ID)</label>
        <input id="exec-user" type="text" value={user} onChange={(e) => setUser(e.target.value)} />
        <label htmlFor="exec-status">Status</label>
        <select id="exec-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(STATUS_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!items && !error && <p>Carregando...</p>}
      {items && (
        <p>
          {[...counts].map(([key, n]) => `${STATUS_LABEL[key] ?? key}: ${n}`).join(" · ") || "Nenhuma execução."}
        </p>
      )}
      {shown?.map((i) => (
        <article key={`${i.userId}-${i.scheduleId}`} className="item">
          <h2>{i.startTime} — {i.className}</h2>
          <p>
            <a href={`/admin/usuarios/${i.userId}`}>{i.userId}</a> · {STATUS_LABEL[i.status] ?? i.status} · tentativas: {i.attempts}
          </p>
          {i.error && <p className="error">{i.error}</p>}
        </article>
      ))}
    </section>
  );
}
