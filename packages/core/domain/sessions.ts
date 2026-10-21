import { writeAudit } from "../audit/audit.js";
import { hashSecret, newSecret } from "../crypto/secret.js";
import { encryptToken } from "../crypto/token.js";
import { isConditionalFailure, type Entities } from "../db/entities.js";
import { login, TecnofitError } from "../tecnofit/client.js";
import { InvalidCredentials, type PublicDeps, type RequestMeta } from "./invites.js";

export class LoginLocked extends Error {
  constructor() {
    super("Too many login attempts");
    this.name = "LoginLocked";
  }
}

const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;
const TOUCH_AFTER_MS = 24 * 3600_000;

export async function createSession(entities: Entities, userId: string, meta: RequestMeta, now: number): Promise<string> {
  const { token, hash } = newSecret();
  const at = new Date(now).toISOString();
  await entities.session
    .create({ sessionId: hash, userId, createdAt: at, lastSeenAt: at, ip: meta.ip, userAgent: meta.userAgent })
    .go();
  return token;
}

export async function resolveSession(
  entities: Entities,
  token: string,
): Promise<{ userId: string; sessionId: string; lastSeenAt: string } | null> {
  const { data } = await entities.session.get({ sessionId: hashSecret(token) }).go();
  return data && { userId: data.userId, sessionId: data.sessionId, lastSeenAt: data.lastSeenAt };
}

export async function touchSession(entities: Entities, sessionId: string, now: number): Promise<boolean> {
  const cutoff = new Date(now - TOUCH_AFTER_MS).toISOString();
  return entities.session
    .patch({ sessionId })
    .set({ lastSeenAt: new Date(now).toISOString() })
    .where((a, { lt }) => lt(a.lastSeenAt, cutoff))
    .go()
    .then(() => true)
    .catch((err: unknown) => {
      if (!isConditionalFailure(err)) throw err;
      return false;
    });
}

export async function revokeSession(entities: Entities, token: string): Promise<void> {
  await entities.session.delete({ sessionId: hashSecret(token) }).go();
}

export async function loginUser(
  deps: PublicDeps,
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<{ userId: string; sessionToken: string }> {
  const { entities, now } = deps;
  const email = input.email.trim().toLowerCase();
  const audit = (
    event: Pick<Parameters<typeof writeAudit>[1], "actorType" | "actorId" | "action" | "result" | "targetId">,
  ) => writeAudit(entities, { ...event, targetType: "user", ip: meta.ip, userAgent: meta.userAgent }, now());
  const anonymous = { actorType: "anonymous", actorId: "anonymous", result: "denied" } as const;

  const { data: fail } = await entities.loginFail.get({ email }).go();
  if (fail && fail.ttl <= Math.floor(now() / 1000)) await entities.loginFail.delete({ email }).go();
  else if (fail && fail.count >= MAX_FAILURES) {
    await audit({ ...anonymous, action: "user.login_locked" });
    throw new LoginLocked();
  }

  const failed = async (userId?: string) => {
    await entities.loginFail
      .update({ email })
      .add({ count: 1 })
      .data(({ ttl }, { ifNotExists }) => ifNotExists(ttl, Math.floor(now() / 1000) + LOCK_SECONDS))
      .go();
    await audit({ ...anonymous, action: "user.login_failed", targetId: userId });
    throw new InvalidCredentials();
  };

  const {
    data: [profile],
  } = await entities.profile.query.byEmail({ tecnofitEmail: email }).go();
  if (!profile || profile.status === "suspended") return failed(profile?.userId);

  const tecnofit = await login(email, input.password).catch((err: unknown) => {
    if (!(err instanceof TecnofitError && err.status >= 400 && err.status < 500)) throw err;
    return failed(profile.userId);
  });

  const { userId } = profile;
  const tokenEnc = await encryptToken(deps.kms, deps.keyId, userId, tecnofit.token);
  await entities.account
    .patch({ userId, empresaId: String(tecnofit.empresaId) })
    .set({ tokenEnc, tokenExp: tecnofit.exp, status: "ok" })
    .go();
  const sessionToken = await createSession(entities, userId, meta, now());
  await entities.loginFail.delete({ email }).go();
  await audit({ actorType: "user", actorId: userId, action: "user.login", result: "success", targetId: userId });
  return { userId, sessionToken };
}
