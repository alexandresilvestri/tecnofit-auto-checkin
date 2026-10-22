import { useEffect, useState } from "react";
import { Audit } from "./Audit";
import { Executions } from "./Executions";
import { Invites } from "./Invites";
import { UserDetail } from "./UserDetail";
import { Users } from "./Users";
import { callback, logout } from "./auth";

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
      <p role="alert" className="error">
        {error} <a href="/admin">Tentar novamente</a>
      </p>
    );
  }
  return <p>Entrando...</p>;
}

function AdminNav() {
  return (
    <nav className="nav">
      <a href="/admin/convites">Convites</a>
      <a href="/admin/usuarios">Usuários</a>
      <a href="/admin/execucoes">Execuções</a>
      <a href="/admin/auditoria">Auditoria</a>
      <a
        href="/admin"
        onClick={(e) => {
          e.preventDefault();
          logout();
        }}
      >
        Sair
      </a>
    </nav>
  );
}

function Screen() {
  const path = location.pathname.replace(/\/$/, "");
  if (path === "/admin/callback") return <Callback />;
  const userId = /^\/admin\/usuarios\/([^/]+)$/.exec(path)?.[1];
  return (
    <>
      <AdminNav />
      {userId ? (
        <UserDetail id={decodeURIComponent(userId)} />
      ) : path === "/admin/usuarios" ? (
        <Users />
      ) : path === "/admin/execucoes" ? (
        <Executions />
      ) : path === "/admin/auditoria" ? (
        <Audit />
      ) : (
        <Invites />
      )}
    </>
  );
}

export default function Admin() {
  return (
    <main className="card wide">
      <Screen />
    </main>
  );
}
