import { useEffect, useState } from "react";
import { errorMessage, get } from "./api";

type User = { userId: string; name: string; email: string; status: string; createdAt: string };

export const USER_STATUS: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
};

export function Users() {
  const [items, setItems] = useState<User[]>();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    get<User[]>("/api/admin/users")
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const term = search.trim().toLowerCase();
  const shown = items?.filter(
    (u) =>
      (!status || u.status === status) &&
      (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)),
  );

  return (
    <section>
      <h1>Usuários</h1>
      <div className="filters">
        <label htmlFor="user-search">Buscar por nome ou e-mail</label>
        <input id="user-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label htmlFor="user-status">Status</label>
        <select id="user-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(USER_STATUS).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!items && !error && <p>Carregando...</p>}
      {shown?.length === 0 && <p>Nenhum usuário.</p>}
      {shown?.map((u) => (
        <article key={u.userId} className="item">
          <h2><a href={`/admin/usuarios/${u.userId}`}>{u.name}</a></h2>
          <p>{u.email} · {USER_STATUS[u.status] ?? u.status}</p>
          <p>Criado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}</p>
        </article>
      ))}
    </section>
  );
}
