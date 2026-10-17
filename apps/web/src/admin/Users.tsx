import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Select } from "../ui/Select";
import { Table } from "../ui/Table";
import { errorMessage, get } from "./api";
import { ErrorText, Loading } from "../ui/Text";

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
    <section className="flex flex-col gap-4">
      <PageHeader title="Usuários" />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Buscar por nome ou e-mail" htmlFor="user-search" className="min-w-60 flex-1">
          <Input id="user-search" type="text" search value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="user-status" className="w-48">
          <Select id="user-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(USER_STATUS).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {!items && !error && <Loading />}
      {shown?.length === 0 && <EmptyState title="Nenhum usuário." />}
      {shown && shown.length > 0 && (
        <Table head={["Nome", "E-mail", "Status", "Criado em"]}>
          {shown.map((u) => (
            <tr key={u.userId}>
              <td className="text-fg-emphasis"><a href={`/admin/usuarios/${u.userId}`}>{u.name}</a></td>
              <td>{u.email}</td>
              <td><Badge tone={u.status === "active" ? "success" : "neutral"}>{USER_STATUS[u.status] ?? u.status}</Badge></td>
              <td className="tabular-nums">{new Date(u.createdAt).toLocaleDateString("pt-BR")}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
