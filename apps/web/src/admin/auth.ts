const domain = import.meta.env.VITE_COGNITO_DOMAIN ?? "";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

const store = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      return;
    }
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      return;
    }
  },
};

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

const redirectUri = () => `${location.origin}/admin/callback`;

export async function login(): Promise<void> {
  const verifier = random();
  const state = random();
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  store.set("admin_verifier", verifier);
  store.set("admin_state", state);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: "openid email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  location.assign(`${domain}/oauth2/authorize?${query}`);
}

export async function callback(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  const expected = store.get("admin_state");
  const verifier = store.get("admin_verifier");
  store.remove("admin_state");
  store.remove("admin_verifier");
  if (!code || !state || !expected || state !== expected || !verifier) {
    throw new Error("Estado de login inválido.");
  }
  const response = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error("Falha ao entrar.");
  const { access_token, expires_in } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  store.set("admin_token", access_token);
  store.set("admin_exp", String(Date.now() + expires_in * 1000));
  store.set("admin_fresh", "1");
}

export function token(): string | null {
  const value = store.get("admin_token");
  const exp = Number(store.get("admin_exp"));
  return value && exp > Date.now() ? value : null;
}

export function clear() {
  store.remove("admin_token");
  store.remove("admin_exp");
}

export function consumeFresh(): boolean {
  const fresh = store.get("admin_fresh") === "1";
  store.remove("admin_fresh");
  return fresh;
}

export function logout() {
  clear();
  location.assign(`${domain}/logout?${new URLSearchParams({ client_id: clientId, logout_uri: `${location.origin}/admin` })}`);
}
