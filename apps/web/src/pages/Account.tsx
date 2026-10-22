import { useEffect, useState } from "react";
import { del, errorMessage, get, guard, post } from "../api";
import { Nav } from "../Nav";

type Me = { name: string; boxName: string; accountStatus: "ok" | "reconnect" };

export function Account() {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Me>("/api/me")
      .then(setMe)
      .catch((e) => {
        if (!guard(e)) setError(errorMessage(e));
      });
  }, []);

  async function leave(call: () => Promise<unknown>) {
    setBusy(true);
    try {
      await call();
      location.assign("/login");
    } catch (e) {
      if (!guard(e)) setError(errorMessage(e));
      setBusy(false);
    }
  }

  const logout = () => leave(() => post("/api/auth/logout"));

  return (
    <section>
      <Nav />
      {error && <p role="alert" className="error">{error}</p>}
      {!me && !error && <p>Carregando...</p>}
      {me && (
        <>
          <h1>{me.name}</h1>
          <p>Box: {me.boxName}</p>
          <p role="status" className={me.accountStatus === "ok" ? "ok" : "error"}>
            {me.accountStatus === "ok"
              ? "Conta conectada à Tecnofit"
              : "Conexão com a Tecnofit expirada — faça login novamente"}
          </p>
          {me.accountStatus === "reconnect" && (
            <button type="button" disabled={busy} onClick={logout}>Reconectar</button>
          )}
          <button type="button" disabled={busy} onClick={logout}>Sair</button>
          <form
            className="danger"
            onSubmit={(e) => {
              e.preventDefault();
              void leave(() => del("/api/me"));
            }}
          >
            <label htmlFor="confirm">Para excluir a conta, digite EXCLUIR</label>
            <input
              id="confirm"
              type="text"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <button type="submit" disabled={busy || confirmation !== "EXCLUIR"}>Excluir conta</button>
          </form>
        </>
      )}
    </section>
  );
}
