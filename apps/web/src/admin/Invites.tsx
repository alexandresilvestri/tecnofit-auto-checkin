import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { stamp } from "../pages/Schedules";
import { Alert } from "../ui/Alert";
import { Badge, type Tone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Confirm } from "../ui/Confirm";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Table } from "../ui/Table";
import { del, errorMessage, get, post } from "./api";
import { ErrorText, Loading } from "../ui/Text";

type Invite = {
  inviteId: string;
  label?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
};

const STATUS: Record<string, string> = {
  pending: "Pendente",
  used: "Usado",
  expired: "Expirado",
  revoked: "Revogado",
};

const TONE: Record<string, Tone> = {
  pending: "info",
  used: "success",
  expired: "neutral",
  revoked: "error",
};

const clock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

function Link({ token, expiresAt }: { token: string; expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = `${location.origin}/convite#${token}`;
  const left = new Date(expiresAt).getTime() - now;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Alert tone="success" className="flex flex-col gap-3">
      <p className="font-mono text-fg-emphasis break-all">{url}</p>
      <p>{left > 0 ? `Expira em ${clock(left)}` : "Expirado"}</p>
      {failed && <ErrorText>Não foi possível copiar. Copie o link manualmente.</ErrorText>}
      <Button variant="secondary" className="self-start" onClick={copy}>
        <Copy />
        {copied ? "Copiado" : "Copiar link"}
      </Button>
    </Alert>
  );
}

export function Invites() {
  const [items, setItems] = useState<Invite[]>();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ token: string; expiresAt: string }>();
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string>();

  function load() {
    get<Invite[]>("/api/admin/invites")
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }

  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setCreated(await post("/api/admin/invites", label ? { label } : {}));
      setLabel("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function revoke(id: string) {
    setRevoking(undefined);
    setError("");
    try {
      await del(`/api/admin/invites/${encodeURIComponent(id)}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Convites" />
      <form onSubmit={create} className="flex items-end gap-2">
        <Field label="Rótulo (opcional)" htmlFor="invite-label" className="max-w-sm flex-1">
          <Input id="invite-label" type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Button type="submit">Gerar convite</Button>
      </form>
      {created && <Link key={created.token} {...created} />}
      {error && <ErrorText>{error}</ErrorText>}
      {!items && !error && <Loading />}
      {items?.length === 0 && <EmptyState title="Nenhum convite." text="Gere um link e envie para o aluno." />}
      {items && items.length > 0 && (
        <Table head={["Rótulo", "Status", "Criado", "Expira", "Usado por", ""]}>
          {items.map((i) => (
            <tr key={i.inviteId}>
              <td className="text-fg-emphasis">{i.label ?? "—"}</td>
              <td><Badge tone={TONE[i.status] ?? "neutral"}>{STATUS[i.status] ?? i.status}</Badge></td>
              <td className="tabular-nums">{stamp(i.createdAt)}</td>
              <td className="tabular-nums">{stamp(i.expiresAt)}</td>
              <td>{i.usedBy ? <a href={`/admin/usuarios/${i.usedBy}`}>{i.usedBy}</a> : "—"}</td>
              <td className="text-right">
                {i.status === "pending" && (
                  <Button variant="danger" onClick={() => setRevoking(i.inviteId)}>Revogar</Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Confirm
        open={revoking !== undefined}
        title="Revogar convite?"
        text="O link deixa de funcionar na hora."
        action="Revogar"
        onConfirm={() => revoking && revoke(revoking)}
        onClose={() => setRevoking(undefined)}
      />
    </section>
  );
}
