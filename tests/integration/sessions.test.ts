import { KMSClient } from "@aws-sdk/client-kms";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { hashSecret } from "../../packages/core/crypto/secret.js";
import { decryptToken } from "../../packages/core/crypto/token.js";
import type { Entities } from "../../packages/core/db/entities.js";
import { InvalidCredentials, redeemInvite, createInvite, type PublicDeps } from "../../packages/core/domain/invites.js";
import {
  createSession,
  LoginLocked,
  loginUser,
  resolveSession,
  revokeSession,
  touchSession,
} from "../../packages/core/domain/sessions.js";
import me from "../fixtures/tecnofit/aluno-eu.json";
import { fakeJwt } from "../fixtures/tecnofit/jwt.js";
import { awsConfig, createKey, createTestEntities, resetMoto } from "./setup/aws.js";

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const PASSWORD = "Senha-Correta-123";
const OLD_JWT = fakeJwt({ user_id: 28715453, empresa_id: 161322, exp: 1900000000 });
const NEW_JWT = fakeJwt({ user_id: 28715453, empresa_id: 161322, exp: 1950000000 });
const META = { ip: "203.0.113.7", userAgent: "vitest-agent" };

const kms = new KMSClient(awsConfig);
let e: Entities;
let keyId: string;
let t: number;
let n = 0;
let logins: number;
let jwt: string;

const server = setupServer(
  http.post("https://rest.tecnofit.com.br/auth", async ({ request }) => {
    logins++;
    const body = (await request.json()) as { password: string };
    return body.password === PASSWORD ? HttpResponse.json({ token: jwt }) : new HttpResponse(null, { status: 401 });
  }),
  http.get("https://rest.tecnofit.com.br/aluno/eu", () => HttpResponse.json(me)),
);

beforeAll(async () => {
  server.listen({ onUnhandledFrame: "bypass" });
  await resetMoto();
  e = await createTestEntities();
  keyId = await createKey(kms);
});

afterAll(() => server.close());

beforeEach(() => {
  t = NOW;
  logins = 0;
  jwt = OLD_JWT;
});

afterEach(() => server.resetHandlers());

const deps = (): PublicDeps => ({ entities: e, kms, keyId, now: () => t });
const signup = async () => {
  const email = `aluno${++n}@example.com`;
  const { token } = await createInvite(deps(), { createdBy: "cli" });
  const { userId } = await redeemInvite(
    deps(),
    { token, email, password: PASSWORD, consentVersion: "2026-10-21" },
    META,
  );
  logins = 0;
  jwt = NEW_JWT;
  return { email, userId };
};
const actions = async (actorId: string) => (await e.audit.query.byActor({ actorId }).go()).data;

it("logs in, swaps the account token, creates a session and clears failures", async () => {
  const { email, userId } = await signup();
  await e.account.patch({ userId, empresaId: "161322" }).set({ status: "reconnect" }).go();
  await e.loginFail.create({ email, count: 2, ttl: Math.floor(NOW / 1000) + 600 }).go();

  const result = await loginUser(deps(), { email: ` ${email.toUpperCase()} `, password: PASSWORD }, META);
  expect(result.userId).toBe(userId);
  const account = (await e.account.get({ userId, empresaId: "161322" }).go()).data;
  expect(account).toMatchObject({ status: "ok", tokenExp: 1950000000 });
  expect(await decryptToken(kms, userId, account!.tokenEnc)).toBe(NEW_JWT);
  expect(await resolveSession(e, result.sessionToken)).toMatchObject({ userId });
  expect((await e.loginFail.get({ email }).go()).data).toBeNull();
  const login = (await actions(userId)).find((ev) => ev.action === "user.login");
  expect(login).toMatchObject({ actorType: "user", targetType: "user", targetId: userId, result: "success", ...META });
});

it("locks after 5 failures without calling Tecnofit and expires after 15 minutes", async () => {
  const { email } = await signup();
  for (let i = 0; i < 5; i++) {
    await expect(loginUser(deps(), { email, password: "x" }, META)).rejects.toBeInstanceOf(InvalidCredentials);
  }
  expect(logins).toBe(5);
  const item = (await e.loginFail.get({ email }).go()).data;
  expect(item).toMatchObject({ count: 5, ttl: Math.floor(NOW / 1000) + 900 });

  await expect(loginUser(deps(), { email, password: PASSWORD }, META)).rejects.toBeInstanceOf(LoginLocked);
  expect(logins).toBe(5);
  const events = (await e.audit.query.byDay({ day: "2026-10-21" }).go()).data;
  expect(events.filter((ev) => ev.action === "user.login_locked")).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(PASSWORD);

  t = NOW + 901_000;
  await expect(loginUser(deps(), { email, password: PASSWORD }, META)).resolves.toMatchObject({ userId: expect.any(String) });
  expect(logins).toBe(6);
});

it("gives the same error for unknown user, wrong password and suspended user", async () => {
  const { email, userId } = await signup();
  const unknown = `ghost${++n}@example.com`;
  const errors = [
    await loginUser(deps(), { email: unknown, password: PASSWORD }, META).catch((err: unknown) => err),
    await loginUser(deps(), { email, password: "wrong" }, META).catch((err: unknown) => err),
  ];
  await e.profile.patch({ userId }).set({ status: "suspended" }).go();
  const before = logins;
  errors.push(await loginUser(deps(), { email, password: PASSWORD }, META).catch((err: unknown) => err));
  expect(logins).toBe(before);
  for (const err of errors) expect(err).toBeInstanceOf(InvalidCredentials);
  expect(new Set(errors.map((err) => (err as Error).message)).size).toBe(1);
  expect((await e.loginFail.get({ email: unknown }).go()).data).toMatchObject({ count: 1 });
  const failed = (await actions("anonymous")).filter((ev) => ev.action === "user.login_failed");
  expect(failed.some((ev) => ev.targetId === userId)).toBe(true);
  expect(failed.some((ev) => ev.targetId === undefined)).toBe(true);
});

it("does not count Tecnofit outages as failures", async () => {
  const { email } = await signup();
  server.use(http.post("https://rest.tecnofit.com.br/auth", () => new HttpResponse(null, { status: 503 })));
  await expect(loginUser(deps(), { email, password: PASSWORD }, META)).rejects.toMatchObject({ status: 503 });
  expect((await e.loginFail.get({ email }).go()).data).toBeNull();
});

it("updates only the account of the empresa in the JWT, encrypted for the user", async () => {
  const { email, userId } = await signup();
  const sibling = { userId, empresaId: "999", tokenEnc: "keep", tokenExp: 1, boxName: "Other", status: "ok" } as const;
  await e.account.create(sibling).go();
  await loginUser(deps(), { email, password: PASSWORD }, META);
  expect((await e.account.get({ userId, empresaId: "999" }).go()).data).toMatchObject(sibling);
  const account = (await e.account.get({ userId, empresaId: "161322" }).go()).data;
  expect(await decryptToken(kms, userId, account!.tokenEnc)).toBe(NEW_JWT);
  await expect(decryptToken(kms, "u_other", account!.tokenEnc)).rejects.toThrow();
});

it("fails closed when the empresa in the JWT has no account", async () => {
  const { email, userId } = await signup();
  jwt = fakeJwt({ user_id: 28715453, empresa_id: 777, exp: 1950000000 });
  await expect(loginUser(deps(), { email, password: PASSWORD }, META)).rejects.toBeDefined();
  expect((await e.account.get({ userId, empresaId: "777" }).go()).data).toBeNull();
});

it("keeps the lockout window anchored at the first failure", async () => {
  const { email } = await signup();
  await loginUser(deps(), { email, password: "x" }, META).catch(() => {});
  t = NOW + 60_000;
  await loginUser(deps(), { email, password: "x" }, META).catch(() => {});
  expect((await e.loginFail.get({ email }).go()).data).toMatchObject({ count: 2, ttl: Math.floor(NOW / 1000) + 900 });
});

it("touches a session only after 24 hours, resolves and revokes it", async () => {
  const token = await createSession(e, "u_touch", META, NOW);
  const sessionId = hashSecret(token);
  expect(await resolveSession(e, token)).toEqual({ userId: "u_touch", sessionId });
  expect(await touchSession(e, sessionId, NOW + 24 * 3600_000)).toBe(false);
  expect(await touchSession(e, sessionId, NOW + 24 * 3600_000 + 1)).toBe(true);
  expect((await e.session.get({ sessionId }).go()).data?.lastSeenAt).toBe(new Date(NOW + 24 * 3600_000 + 1).toISOString());
  expect(await touchSession(e, sessionId, NOW + 24 * 3600_000 + 2)).toBe(false);
  await revokeSession(e, token);
  expect(await resolveSession(e, token)).toBeNull();
  expect(await touchSession(e, sessionId, NOW + 99 * 3600_000)).toBe(false);
});
