import { useEffect, useState } from "react";
import { STATUS_LABEL, STATUS_TONE, WEEKDAYS, fullDate, stamp } from "../pages/Schedules";
import { Stat, Stats } from "../ui/Stat";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Table } from "../ui/Table";
import { del, errorMessage, get, post } from "./api";
import { USER_STATUS } from "./Users";
import { ErrorText, Loading } from "../ui/Text";

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

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} title={`${label} usuário`} onClose={() => setOpen(false)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              onConfirm(trimmed).finally(() => {
                setBusy(false);
                setOpen(false);
              });
            }}
          >
            <Field label={`Digite o nome do usuário: ${name}`} htmlFor={`name-${label}`}>
              <Input id={`name-${label}`} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
            <Field label="Motivo (até 200 caracteres)" htmlFor={`reason-${label}`}>
              <Input id={`reason-${label}`} type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={!ready}>Confirmar {label.toLowerCase()}</Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            </div>
          </form>
      </Dialog>
    </>
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
    return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  }
  const { profile, account } = data;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={profile.name}>
        {profile.status === "suspended" ? (
          <Button variant="secondary" onClick={() => run(() => post(`${base}/reactivate`))}>Reativar</Button>
        ) : (
          <Destructive
            label="Suspender"
            name={profile.name}
            onConfirm={(reason) => run(() => post(`${base}/suspend`, { reason }))}
          />
        )}
        <Button variant="secondary" onClick={() => run(() => post(`${base}/revoke-sessions`))}>Encerrar sessões</Button>
      </PageHeader>
      {error && <ErrorText>{error}</ErrorText>}
      <p className="text-fg">
        {USER_STATUS[profile.status] ?? profile.status} · criado em {stamp(profile.createdAt)}
      </p>
      <Stats>
        <Stat label="E-mail">{profile.email}</Stat>
        <Stat label="Conta Tecnofit">{account ? `${account.boxName} (${account.status})` : "—"}</Stat>
      </Stats>

      <Card title="Agendamentos">
        {data.schedules.length === 0 && <p className="text-fg">Nenhum agendamento.</p>}
        {data.schedules.length > 0 && (
          <Table head={["Aula", "Quando", "Estado"]}>
            {data.schedules.map((s) => (
              <tr key={s.scheduleId}>
                <td className="text-fg-emphasis">{s.startTime} — {s.className}</td>
                <td>
                  {s.kind === "weekly"
                    ? [...(s.weekdays ?? [])].sort().map((d) => WEEKDAYS[d]).join(", ")
                    : s.date && fullDate(s.date)}
                </td>
                <td>
                  <Badge tone={s.active ? "success" : "neutral"}>
                    {s.active ? "Ativo" : s.pausedBySuspension ? "Pausado pela suspensão" : "Pausado"}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Execuções">
        {data.executions.length === 0 && <p className="text-fg">Nenhuma execução.</p>}
        {data.executions.length > 0 && (
          <Table head={["Data", "Aula", "Status", "Erro"]}>
            {data.executions.map((x) => (
              <tr key={`${x.scheduleId}-${x.classDate}`}>
                <td>{fullDate(x.classDate)} {x.startTime}</td>
                <td className="text-fg-emphasis">{x.className}</td>
                <td><Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{STATUS_LABEL[x.status] ?? x.status}</Badge></td>
                <td>{x.error ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Sessões">
        {data.sessions.length === 0 && <p className="text-fg">Nenhuma sessão.</p>}
        {data.sessions.length > 0 && (
          <Table head={["Criada", "Vista", "IP"]}>
            {data.sessions.map((s) => (
              <tr key={s.createdAt}>
                <td>{stamp(s.createdAt)}</td>
                <td>{stamp(s.lastSeenAt)}</td>
                <td className="font-mono text-fg-emphasis">{s.ip ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Auditoria">
        {data.audit.length === 0 && <p className="text-fg">Nenhum evento.</p>}
        {data.audit.length > 0 && (
          <Table head={["Quando", "Ação", "Ator", "Resultado", "Detalhes"]}>
            {data.audit.map((a) => (
              <tr key={`${a.at}-${a.action}`}>
                <td>{stamp(a.at)}</td>
                <td className="font-mono text-fg-emphasis">{a.action}</td>
                <td>{a.actorType}</td>
                <td>{a.result}</td>
                <td className="font-mono text-xs whitespace-normal break-all">{a.metadata ? JSON.stringify(a.metadata) : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Zona de perigo" danger>
        <p className="mb-4 text-fg">Exclui o usuário, os agendamentos e a conta Tecnofit vinculada.</p>
        <Destructive
          label="Excluir"
          name={profile.name}
          onConfirm={(reason) =>
            run(() => del(base, { reason }), () => location.assign("/admin/usuarios"))
          }
        />
      </Card>
    </section>
  );
}
