import { useEffect, useState } from "react";
import { AdminShell } from "../shell/Shell";
import { Button } from "../ui/Button";
import { Audit } from "./Audit";
import { Executions } from "./Executions";
import { Invites } from "./Invites";
import { UserDetail } from "./UserDetail";
import { Users } from "./Users";
import { callback, logout } from "./auth";
import { ErrorText, Loading } from "../ui/Text";

function Callback() {
  const [error, setError] = useState("");
  useEffect(() => {
    callback()
      .then(() => {
        history.replaceState(null, "", "/admin/callback");
        location.replace("/admin/convites");
      })
      .catch((e: Error) => {
        history.replaceState(null, "", "/admin/callback");
        setError(e.message);
      });
  }, []);
  if (error) {
    return (
      <ErrorText>
        {error} <a href="/admin">Tentar novamente</a>
      </ErrorText>
    );
  }
  return <Loading>Entrando...</Loading>;
}

function Screen() {
  const path = location.pathname.replace(/\/$/, "");
  if (path === "/admin/callback") return <Callback />;
  const userId = /^\/admin\/usuarios\/([^/]+)$/.exec(path)?.[1];
  if (userId) return <UserDetail id={decodeURIComponent(userId)} />;
  if (path === "/admin/usuarios") return <Users />;
  if (path === "/admin/execucoes") return <Executions />;
  if (path === "/admin/auditoria") return <Audit />;
  return <Invites />;
}

export default function Admin() {
  return (
    <AdminShell right={<Button variant="ghost" onClick={logout}>Sair</Button>}>
      <Screen />
    </AdminShell>
  );
}
