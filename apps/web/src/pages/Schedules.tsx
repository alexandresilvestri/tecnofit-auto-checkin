import { useEffect, useState } from "react";
import { del, errorMessage, get, guard, patch } from "../api";
import { Nav } from "../Nav";

type Schedule = {
  scheduleId: string;
  className: string;
  startTime: string;
  kind: "weekly" | "once";
  weekdays?: number[];
  date?: string;
  allowWaitingList: boolean;
  active: boolean;
  finished: boolean;
  nextClass: string | null;
  last: { classDate: string; status: string } | null;
};

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const STATUS_LABEL: Record<string, string> = {
  success: "Check-in feito",
  waitlisted: "Lista de espera",
  failed: "Falhou",
  skipped: "Ignorado",
  running: "Em andamento",
};

export const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const fullDate = (iso: string) => `${shortDate(iso)}/${iso.slice(0, 4)}`;

export const stamp = (iso: string) => new Date(iso).toLocaleString("pt-BR");

const nextLabel = (value: string) => `${shortDate(value)} ${value.slice(11, 16)}`;

export function Schedules() {
  const [items, setItems] = useState<Schedule[]>();
  const [reconnect, setReconnect] = useState(false);
  const [error, setError] = useState("");

  function load() {
    get<Schedule[]>("/api/schedules")
      .then(setItems)
      .catch(fail);
  }

  function fail(e: unknown) {
    if (!guard(e)) setError(errorMessage(e));
  }

  useEffect(() => {
    load();
    get<{ accountStatus: string }>("/api/me")
      .then((me) => setReconnect(me.accountStatus === "reconnect"))
      .catch(fail);
  }, []);

  async function change(id: string, body: { active?: boolean; allowWaitingList?: boolean }) {
    setError("");
    try {
      await patch(`/api/schedules/${id}`, body);
      load();
    } catch (e) {
      fail(e);
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir este agendamento?")) return;
    setError("");
    try {
      await del(`/api/schedules/${id}`);
      load();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <section>
      <Nav />
      {reconnect && (
        <p role="status" className="banner">
          Conexão com a Tecnofit expirada. <a href="/app/conta">Reconectar</a>
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {!items && !error && <p>Carregando...</p>}
      {items?.length === 0 && <p>Nenhum agendamento.</p>}
      {items?.map((s) => (
        <article key={s.scheduleId} className="item">
          <h2>{s.startTime} — {s.className}</h2>
          <p>
            {s.kind === "weekly"
              ? [...(s.weekdays ?? [])].sort().map((d) => WEEKDAYS[d]).join(", ")
              : s.date && fullDate(s.date)}
            {" · "}
            {s.finished ? "Encerrado" : s.active ? "Ativo" : "Pausado"}
          </p>
          <p>Próxima aula: {s.nextClass ? nextLabel(s.nextClass) : "—"}</p>
          <p>
            Último: {s.last
              ? `${shortDate(s.last.classDate)} ${STATUS_LABEL[s.last.status] ?? s.last.status}`
              : "—"}
          </p>
          {!s.finished && (
            <label className="check" htmlFor={`wl-${s.scheduleId}`}>
              <input
                id={`wl-${s.scheduleId}`}
                type="checkbox"
                checked={s.allowWaitingList}
                onChange={(e) => change(s.scheduleId, { allowWaitingList: e.target.checked })}
              />
              Lista de espera
            </label>
          )}
          <div className="actions">
            {!s.finished && (
              <button type="button" onClick={() => change(s.scheduleId, { active: !s.active })}>
                {s.active ? "Pausar" : "Retomar"}
              </button>
            )}
            <button type="button" className="danger-btn" onClick={() => remove(s.scheduleId)}>
              Excluir
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
