import { useEffect, useState } from "react";
import { del, errorMessage, get, guard, post } from "../api";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Stat } from "../ui/Stat";
import { ErrorText, Loading } from "../ui/Text";

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
    <section className="flex flex-col gap-4">
      {error && <ErrorText>{error}</ErrorText>}
      {!me && !error && <Loading />}
      {me && (
        <>
          <PageHeader title={me.name} />
          <Stat label="Box">{me.boxName}</Stat>
          <Alert tone={me.accountStatus === "ok" ? "success" : "error"} role="status">
            {me.accountStatus === "ok"
              ? "Conta conectada à Tecnofit"
              : "Conexão com a Tecnofit expirada — faça login novamente"}
          </Alert>
          <div className="flex gap-2">
            {me.accountStatus === "reconnect" && (
              <Button disabled={busy} onClick={logout}>Reconectar</Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={logout}>Sair</Button>
          </div>
          <Card
            as="form"
            title="Zona de perigo"
            danger className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void leave(() => del("/api/me"));
            }}
          >
            <Field label="Para excluir a conta, digite EXCLUIR" htmlFor="confirm">
              <Input id="confirm" type="text" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </Field>
            <Button type="submit" variant="danger" className="self-start" disabled={busy || confirmation !== "EXCLUIR"}>Excluir conta</Button>
          </Card>
        </>
      )}
    </section>
  );
}
