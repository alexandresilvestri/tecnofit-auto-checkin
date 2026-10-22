import { useEffect, useState } from "react";
import { STATUS_LABEL, WEEKDAYS, fullDate, stamp } from "../pages/Schedules";
import { del, errorMessage, get, post } from "./api";
import { USER_STATUS } from "./Users";

type Detail = {
  profile: { userId: string; name: string; email: string; status: string; createdAt: string };
  account: { boxName: string; status: string } | null;
  schedules: {
    scheduleId: string;
    className: string;
    startTime: string;
    kind: "weekly" | "once";
    weekdays?: number[];
    date?: string;
    active: boolean;
    pausedBySuspension?: boolean;
  }[];
  executions: { scheduleId: string; classDate: string; className: string; startTime: string; status: string; error?: string }[];
  sessions: { createdAt: string; lastSeenAt: string; ip?: string; userAgent?: string }[];
  audit: { at: string; action: string; actorType: string; result: string; metadata?: unknown }[];
};


function Destructive({
  label,
  name,
  onConfirm,
}: {
  label: string;
  name: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const ready = !busy && typed === name && trimmed.length >= 1 && trimmed.length <= 200;

  if (!open) {
    return (
      <button type="button" className="danger-btn" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="danger"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        onConfirm(trimmed).finally(() => setBusy(false));
      }}
    >
      <label htmlFor={`name-${label}`}>Digite o nome do usuário: {name}</label>
      <input id={`name-${label}`} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} />
      <label htmlFor={`reason-${label}`}>Motivo (até 200 caracteres)</label>
      <input
        id={`reason-${label}`}
        type="text"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="actions">
        <button type="submit" disabled={!ready}>Confirmar {label.toLowerCase()}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}

export function UserDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail>();
  const [error, setError] = useState("");
  const base = `/api/admin/users/${encodeURIComponent(id)}`;

  function load() {
    get<Detail>(base)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }

  useEffect(load, [id]);

  async function run(action: () => Promise<unknown>, after: () => void = load) {
    setError("");
    try {
      await action();
      after();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!data) {
    return error ? <p role="alert" className="error">{error}</p> : <p>Carregando...</p>;
  }
  const { profile, account } = data;

  return (
    <section>
      <h1>{profile.name}</h1>
      {error && <p role="alert" className="error">{error}</p>}
      <p>{profile.email}</p>
      <p>
        {USER_STATUS[profile.status] ?? profile.status} · criado em {stamp(profile.createdAt)}
      </p>
      <p>Conta Tecnofit: {account ? `${account.boxName} (${account.status})` : "—"}</p>
      <div className="actions">
        {profile.status === "suspended" ? (
          <button type="button" onClick={() => run(() => post(`${base}/reactivate`))}>Reativar</button>
        ) : (
          <Destructive
            label="Suspender"
            name={profile.name}
            onConfirm={(reason) => run(() => post(`${base}/suspend`, { reason }))}
          />
        )}
        <button type="button" onClick={() => run(() => post(`${base}/revoke-sessions`))}>Encerrar sessões</button>
      </div>

      <h2>Agendamentos</h2>
      {data.schedules.length === 0 && <p>Nenhum agendamento.</p>}
      {data.schedules.map((s) => (
        <p key={s.scheduleId}>
          {s.startTime} — {s.className} ·{" "}
          {s.kind === "weekly"
            ? [...(s.weekdays ?? [])].sort().map((d) => WEEKDAYS[d]).join(", ")
            : s.date && fullDate(s.date)}
          {" · "}
          {s.active ? "Ativo" : s.pausedBySuspension ? "Pausado pela suspensão" : "Pausado"}
        </p>
      ))}

      <h2>Execuções</h2>
      {data.executions.length === 0 && <p>Nenhuma execução.</p>}
      {data.executions.map((x) => (
        <p key={`${x.scheduleId}-${x.classDate}`}>
          {fullDate(x.classDate)} {x.startTime} — {x.className} · {STATUS_LABEL[x.status] ?? x.status}
          {x.error ? ` (${x.error})` : ""}
        </p>
      ))}

      <h2>Sessões</h2>
      {data.sessions.length === 0 && <p>Nenhuma sessão.</p>}
      {data.sessions.map((s) => (
        <p key={s.createdAt}>
          {stamp(s.createdAt)} · visto {stamp(s.lastSeenAt)} · {s.ip ?? "—"}
        </p>
      ))}

      <h2>Auditoria</h2>
      {data.audit.length === 0 && <p>Nenhum evento.</p>}
      {data.audit.map((a) => (
        <p key={`${a.at}-${a.action}`}>
          {stamp(a.at)} · {a.action} · {a.actorType} · {a.result}
          {a.metadata ? ` · ${JSON.stringify(a.metadata)}` : ""}
        </p>
      ))}

      <div className="danger">
        <Destructive
          label="Excluir"
          name={profile.name}
          onConfirm={(reason) =>
            run(() => del(base, { reason }), () => location.assign("/admin/usuarios"))
          }
        />
      </div>
    </section>
  );
}
