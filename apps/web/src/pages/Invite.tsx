import { useEffect, useState, type SubmitEvent } from "react";
import { errorMessage, post } from "../api";
import { CONSENT_TEXT, CONSENT_VERSION } from "../consent";

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

  if (valid === undefined) return <p>Verificando convite...</p>;
  if (!valid) return <p role="alert" className="error">{error || INVALID}</p>;

  return (
    <form onSubmit={submit}>
      <h1>Criar conta</h1>
      <label htmlFor="email">E-mail da Tecnofit</label>
      <input
        id="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="password">Senha da Tecnofit</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <section className="consent" aria-label="Termo de consentimento">
        {CONSENT_TEXT.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
      <label className="check" htmlFor="consent">
        <input
          id="consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Li e concordo com o termo acima.
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" disabled={!consent || busy}>Criar conta</button>
    </form>
  );
}
