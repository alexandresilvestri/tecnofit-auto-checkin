import { useEffect, useState } from "react";
import { del, errorMessage, get, guard, patch } from "../api";
import { Alert } from "../ui/Alert";
import { Badge, type Tone } from "../ui/Badge";
import { Button, LinkButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Check } from "../ui/Check";
import { Confirm } from "../ui/Confirm";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Stat, Stats } from "../ui/Stat";
import { ErrorText, Loading } from "../ui/Text";

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

export const STATUS_TONE: Record<string, Tone> = {
  success: "success",
  waitlisted: "info",
  failed: "error",
  skipped: "neutral",
  running: "warning",
};

export const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const fullDate = (iso: string) => `${shortDate(iso)}/${iso.slice(0, 4)}`;

export const stamp = (iso: string) => new Date(iso).toLocaleString("pt-BR");

const nextLabel = (value: string) => `${shortDate(value)} ${value.slice(11, 16)}`;

export function Schedules() {
  const [items, setItems] = useState<Schedule[]>();
  const [reconnect, setReconnect] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string>();

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
    setRemoving(undefined);
    setError("");
    try {
      await del(`/api/schedules/${id}`);
      load();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Agendamentos" />
      {reconnect && (
        <Alert tone="warning" role="status">
          Conexão com a Tecnofit expirada. <a href="/app/conta">Reconectar</a>
        </Alert>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {!items && !error && <Loading />}
      {items?.length === 0 && (
        <EmptyState title="Nenhum agendamento." text="Escolha uma aula e o check-in acontece sozinho.">
          <LinkButton href="/app/novo">Agendar aula</LinkButton>
        </EmptyState>
      )}
      {items?.map((s) => (
        <Card as="article" key={s.scheduleId} className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base/6 font-semibold text-fg-emphasis">{s.startTime} — {s.className}</h2>
              <p className="text-sm/5 text-fg">
                {s.kind === "weekly"
                  ? [...(s.weekdays ?? [])].sort().map((d) => WEEKDAYS[d]).join(", ")
                  : s.date && fullDate(s.date)}
              </p>
            </div>
            <Badge tone={s.finished ? "neutral" : s.active ? "success" : "neutral"}>
              {s.finished ? "Encerrado" : s.active ? "Ativo" : "Pausado"}
            </Badge>
          </div>
          <Stats>
            <Stat label="Próxima aula">{s.nextClass ? nextLabel(s.nextClass) : "—"}</Stat>
            <Stat label="Último">
              {s.last ? `${shortDate(s.last.classDate)} ${STATUS_LABEL[s.last.status] ?? s.last.status}` : "—"}
            </Stat>
          </Stats>
          {!s.finished && (
            <Check
              id={`wl-${s.scheduleId}`}
              label="Lista de espera"
              checked={s.allowWaitingList}
              onChange={(e) => change(s.scheduleId, { allowWaitingList: e.target.checked })}
            />
          )}
          <div className="flex gap-2">
            {!s.finished && (
              <Button variant="secondary" onClick={() => change(s.scheduleId, { active: !s.active })}>
                {s.active ? "Pausar" : "Retomar"}
              </Button>
            )}
            <Button variant="danger" onClick={() => setRemoving(s.scheduleId)}>Excluir</Button>
          </div>
        </Card>
      ))}
      <Confirm
        open={removing !== undefined}
        title="Excluir agendamento?"
        text="O check-in automático desta aula deixa de acontecer."
        action="Excluir"
        onConfirm={() => removing && remove(removing)}
        onClose={() => setRemoving(undefined)}
      />
    </section>
  );
}
