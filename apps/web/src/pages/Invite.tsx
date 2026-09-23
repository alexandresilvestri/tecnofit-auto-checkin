import { useEffect, useState, type SubmitEvent } from "react";
import { errorMessage, post } from "../api";
import { CONSENT_TEXT, CONSENT_VERSION } from "../consent";
import { Button } from "../ui/Button";
import { Check } from "../ui/Check";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { ErrorText, Loading } from "../ui/Text";

const token = location.hash.replace(/^#/, "");
const INVALID = "Convite inválido ou expirado.";

export function Invite() {
  const [valid, setValid] = useState<boolean | undefined>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setValid(false);
      return;
    }
    post<{ valid: boolean }>("/api/invites/check", { token })
      .then((result) => setValid(result.valid))
      .catch((e) => {
        setValid(false);
        setError(errorMessage(e));
      });
  }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/onboarding", {
        token,
        email,
        password,
        consentVersion: CONSENT_VERSION,
      });
      location.assign("/app");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (valid === undefined) return <Loading>Verificando convite...</Loading>;
  if (!valid) return <ErrorText>{error || INVALID}</ErrorText>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeader title="Criar conta" />
      <Field label="E-mail da Tecnofit" htmlFor="email">
        <Input id="email" size="lg" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Senha da Tecnofit" htmlFor="password">
        <Input id="password" size="lg" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <section aria-label="Termo de consentimento" className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-xs/4 text-fg">
        {CONSENT_TEXT.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
      <Check id="consent" label="Li e concordo com o termo acima." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" disabled={!consent || busy}>Criar conta</Button>
    </form>
  );
}
