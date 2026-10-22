import { useState, type SubmitEvent } from "react";
import { errorMessage, post } from "../api";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Pending } from "../ui/Pending";
import { ErrorText } from "../ui/Text";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { email, password });
      location.assign("/app");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="E-mail" htmlFor="email">
        <Input id="email" size="lg" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Senha da Tecnofit" htmlFor="password">
        <Input id="password" size="lg" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" disabled={busy}>Entrar</Button>
      {busy && <Pending title="Entrando" />}
    </form>
  );
}
