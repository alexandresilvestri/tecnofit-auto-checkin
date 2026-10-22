import { useEffect, useState } from "react";
import { del, errorMessage, get, post } from "./api";

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

const stamp = (iso: string) => new Date(iso).toLocaleString("pt-BR");

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
    <div className="banner">
      <p className="mono">{url}</p>
      <p>{left > 0 ? `Expira em ${clock(left)}` : "Expirado"}</p>
      {failed && <p role="alert" className="error">Não foi possível copiar. Copie o link manualmente.</p>}
      <button type="button" onClick={copy}>{copied ? "Copiado" : "Copiar link"}</button>
    </div>
  );
}

export function Invites() {
  const [items, setItems] = useState<Invite[]>();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ token: string; expiresAt: string }>();
  const [error, setError] = useState("");

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
    if (!confirm("Revogar este convite?")) return;
    setError("");
    try {
      await del(`/api/admin/invites/${encodeURIComponent(id)}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <h1>Convites</h1>
      <form onSubmit={create}>
        <label htmlFor="invite-label">Rótulo (opcional)</label>
        <input
          id="invite-label"
          type="text"
          maxLength={60}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit">Gerar convite</button>
      </form>
      {created && <Link key={created.token} {...created} />}
      {error && <p role="alert" className="error">{error}</p>}
      {!items && !error && <p>Carregando...</p>}
      {items?.length === 0 && <p>Nenhum convite.</p>}
      {items && items.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Status</th>
                <th>Criado</th>
                <th>Expira</th>
                <th>Usado por</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.inviteId}>
                  <td>{i.label ?? "—"}</td>
                  <td>{STATUS[i.status] ?? i.status}</td>
                  <td>{stamp(i.createdAt)}</td>
                  <td>{stamp(i.expiresAt)}</td>
                  <td>{i.usedBy ? <a href={`/admin/usuarios/${i.usedBy}`}>{i.usedBy}</a> : "—"}</td>
                  <td>
                    {i.status === "pending" && (
                      <button type="button" className="danger-btn" onClick={() => revoke(i.inviteId)}>
                        Revogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
