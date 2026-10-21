import { useEffect, useState } from "react";
import { errorMessage, get, post, type ApiError } from "../api";

type Me = { name: string; boxName: string; accountStatus: "ok" | "reconnect" };

export function Home() {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState("");

  useEffect(() => {
    get<Me>("/api/me")
      .then(setMe)
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) location.assign("/login");
        else setError(errorMessage(e));
      });
  }, []);

  async function logout() {
    try {
      await post("/api/auth/logout");
      location.assign("/login");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!me) return <p>Carregando...</p>;

  return (
    <section>
      <h1>{me.name}</h1>
      <p>Box: {me.boxName}</p>
      <p role="status" className={me.accountStatus === "ok" ? "ok" : "error"}>
        {me.accountStatus === "ok"
          ? "Conta conectada à Tecnofit"
          : "Conexão com a Tecnofit expirada — faça login novamente"}
      </p>
      <button type="button" onClick={logout}>Sair</button>
    </section>
  );
}
