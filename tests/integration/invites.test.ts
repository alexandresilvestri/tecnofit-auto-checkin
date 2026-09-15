import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { hashSecret } from "../../packages/core/crypto/secret.js";
import { decryptToken } from "../../packages/core/crypto/token.js";
import type { Entities } from "../../packages/core/db/entities.js";
import {
  AccountExists,
  checkInvite,
  createInvite,
  InvalidCredentials,
  InviteInvalid,
  InviteNotFound,
  InviteNotPending,
  listInvites,
  redeemInvite,
  revokeInvite,
  type PublicDeps,
} from "../../packages/core/domain/invites.js";
import { TecnofitInvalidResponse } from "../../packages/core/tecnofit/client.js";
import me from "../fixtures/tecnofit/aluno-eu.json";
import { fakeJwt } from "../fixtures/tecnofit/jwt.js";
import { awsConfig, createKey, createTestEntities, resetMoto } from "./setup/aws.js";

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const PASSWORD = "Senha-Correta-123";
const WRONG = "Senha-Errada-456";
const JWT = fakeJwt({ user_id: 28715453, empresa_id: 161322, exp: 1900000000 });
const META = { ip: "203.0.113.7", userAgent: "vitest-agent" };
const AUTH = "https://rest.tecnofit.com.br/auth";

const kms = new KMSClient(awsConfig);
const raw = new DynamoDBClient(awsConfig);
let e: Entities;
let keyId: string;
let t: number;
let n = 0;
let logins: number;
let authEmail: string | undefined;
let beforeAuth: () => Promise<void>;

const server = setupServer(
  http.post(AUTH, async ({ request }) => {
    logins++;
    await beforeAuth();
    const body = (await request.json()) as { email: string; password: string };
    authEmail = body.email;
    return body.password === PASSWORD ? HttpResponse.json({ token: JWT }) : new HttpResponse(null, { status: 401 });
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
  authEmail = undefined;
  beforeAuth = async () => {};
  server.resetHandlers();
});

const deps = (): PublicDeps => ({ entities: e, kms, keyId, now: () => t });
const nextEmail = () => `aluno${++n}@example.com`;
const input = (token: string, email: string, password = PASSWORD) => ({
  token,
  email,
  password,
  consentVersion: "2026-10-21",
});
const invite = async (inviteId: string) => (await e.invite.get({ inviteId }).go()).data;
const events = async (targetId: string) => (await e.audit.query.byTarget({ targetId }).go()).data;
const failures = async (targetId: string) =>
  (await events(targetId)).filter((ev) => ev.action === "invite.redeem_failed").map((ev) => ev.metadata?.reason);

it("redeems an invite into a profile, account, session and event", async () => {
  const { token, inviteId, expiresAt } = await createInvite(deps(), { label: "amigo", createdBy: "cli" });
  expect(inviteId).toBe(hashSecret(token));
  expect(expiresAt).toBe(NOW + 15 * 60_000);
  expect(await invite(inviteId)).toMatchObject({
    status: "pending",
    attempts: 0,
    label: "amigo",
    createdBy: "cli",
    createdAt: new Date(NOW).toISOString(),
    expiresAt,
    ttl: Math.floor(expiresAt / 1000) + 7 * 86400,
  });
  expect(await checkInvite(deps(), token)).toBe(true);

  t = NOW + 60_000;
  const at = new Date(t).toISOString();
  const email = nextEmail();
  const { userId, sessionToken } = await redeemInvite(deps(), input(token, ` ${email.toUpperCase()} `), META);
  expect(userId).toMatch(/^u_/);
  expect(authEmail).toBe(email);
  expect((await e.profile.get({ userId }).go()).data).toMatchObject({
    name: "Aluno Teste",
    tecnofitEmail: email,
    tecnofitUserId: 28715453,
    status: "active",
    createdAt: at,
  });
  const account = (await e.account.get({ userId, empresaId: "161322" }).go()).data;
  expect(account).toMatchObject({ tokenExp: 1900000000, boxName: "BOX CF Bombinhas", status: "ok" });
  expect(await decryptToken(kms, userId, account!.tokenEnc)).toBe(JWT);
  expect((await e.session.get({ sessionId: hashSecret(sessionToken) }).go()).data).toMatchObject({
    userId,
    createdAt: at,
    lastSeenAt: at,
    ...META,
  });
  expect(await invite(inviteId)).toMatchObject({ status: "used", usedBy: userId, usedAt: at });
  expect(await checkInvite(deps(), token)).toBe(false);

  const [created, redeemed] = await events(inviteId);
  expect(created).toMatchObject({
    action: "invite.created",
    actorType: "cli",
    actorId: "cli",
    targetType: "invite",
    result: "success",
    metadata: { label: "amigo" },
  });
  expect(redeemed).toMatchObject({
    action: "invite.redeemed",
    actorType: "user",
    actorId: userId,
    targetType: "invite",
    result: "success",
    metadata: { consentVersion: "2026-10-21" },
    ...META,
  });
});

it("rejects a second redeem", async () => {
  const { token, inviteId } = await createInvite(deps(), { createdBy: "cli" });
  await redeemInvite(deps(), input(token, nextEmail()), META);
  await expect(redeemInvite(deps(), input(token, nextEmail()), META)).rejects.toBeInstanceOf(InviteInvalid);
  const [failed] = (await events(inviteId)).filter((ev) => ev.action === "invite.redeem_failed");
  expect(failed).toMatchObject({
    actorType: "anonymous",
    actorId: "anonymous",
    targetType: "invite",
    result: "denied",
    metadata: { reason: "invalid_invite" },
    ...META,
  });
});

it("lets exactly one of two concurrent redeems through", async () => {
  const { token } = await createInvite(deps(), { createdBy: "cli" });
  const email = nextEmail();
  let release!: () => void;
  const both = new Promise<void>((r) => (release = r));
  beforeAuth = () => {
    if (logins === 2) release();
    return both;
  };
  const results = await Promise.all(
    [0, 1].map(() => redeemInvite(deps(), input(token, email), META).catch((err: unknown) => err)),
  );
  expect(logins).toBe(2);
  expect(results.filter((r) => r instanceof InviteInvalid)).toHaveLength(1);
  expect(results.filter((r) => !(r instanceof Error))).toHaveLength(1);
  expect((await e.profile.query.byEmail({ tecnofitEmail: email }).go()).data).toHaveLength(1);
});

it("rejects an expired invite that is still stored", async () => {
  const { token, inviteId, expiresAt } = await createInvite(deps(), { createdBy: "cli" });
  t = expiresAt + 1;
  await expect(redeemInvite(deps(), input(token, nextEmail()), META)).rejects.toBeInstanceOf(InviteInvalid);
  expect(await checkInvite(deps(), token)).toBe(false);
  expect((await invite(inviteId))?.status).toBe("pending");
  expect(logins).toBe(0);
  expect(await failures(inviteId)).toEqual(["invalid_invite"]);
});

it("rejects an invite that expires during the Tecnofit login", async () => {
  const { token, inviteId, expiresAt } = await createInvite(deps(), { createdBy: "cli" });
  const email = nextEmail();
  beforeAuth = async () => {
    t = expiresAt;
  };
  await expect(redeemInvite(deps(), input(token, email), META)).rejects.toBeInstanceOf(InviteInvalid);
  expect((await invite(inviteId))?.status).toBe("pending");
  expect((await e.profile.query.byEmail({ tecnofitEmail: email }).go()).data).toHaveLength(0);
  expect(await failures(inviteId)).toEqual(["invalid_invite"]);
});

it("refuses an existing account without consuming the invite", async () => {
  const email = nextEmail();
  await e.profile
    .create({
      userId: `u_existing_${n}`,
      name: "Aluno Teste",
      tecnofitEmail: email,
      tecnofitUserId: 28715453,
      status: "active",
      createdAt: new Date(NOW).toISOString(),
    })
    .go();
  const { token, inviteId } = await createInvite(deps(), { createdBy: "cli" });
  await expect(redeemInvite(deps(), input(token, `  ${email.toUpperCase()}`), META)).rejects.toBeInstanceOf(
    AccountExists,
  );
  expect(await invite(inviteId)).toMatchObject({ status: "pending", attempts: 0 });
  expect(await checkInvite(deps(), token)).toBe(true);
  expect(logins).toBe(0);
  expect(await failures(inviteId)).toEqual(["account_exists"]);
});

it("burns the invite on the 5th wrong password", async () => {
  const { token, inviteId } = await createInvite(deps(), { createdBy: "cli" });
  const email = nextEmail();
  for (let i = 1; i <= 5; i++) {
    await expect(redeemInvite(deps(), input(token, email, WRONG), META)).rejects.toBeInstanceOf(InvalidCredentials);
    expect(await invite(inviteId)).toMatchObject({ attempts: i, status: i < 5 ? "pending" : "burned" });
  }
  const log = await events(inviteId);
  const failed = log.filter((ev) => ev.action === "invite.redeem_failed");
  expect(failed).toHaveLength(5);
  expect(failed[0]).toMatchObject({
    actorType: "anonymous",
    actorId: "anonymous",
    result: "denied",
    metadata: { reason: "invalid_credentials" },
    ...META,
  });
  const burned = log.filter((ev) => ev.action === "invite.burned");
  expect(burned).toHaveLength(1);
  expect(burned[0]).toMatchObject({ actorType: "system", actorId: "system", result: "success" });
  await expect(redeemInvite(deps(), input(token, email), META)).rejects.toBeInstanceOf(InviteInvalid);
});

it("keeps a used invite when the 5th wrong password races a redeem", async () => {
  const { token, inviteId } = await createInvite(deps(), { createdBy: "cli" });
  await e.invite.patch({ inviteId }).set({ attempts: 4 }).go();
  beforeAuth = async () => {
    await e.invite.patch({ inviteId }).set({ status: "used", usedBy: "u_other" }).go();
  };
  await expect(redeemInvite(deps(), input(token, nextEmail(), WRONG), META)).rejects.toBeInstanceOf(
    InvalidCredentials,
  );
  expect(await invite(inviteId)).toMatchObject({ status: "used", attempts: 5 });
  expect((await events(inviteId)).filter((ev) => ev.action === "invite.burned")).toHaveLength(0);
  expect(await failures(inviteId)).toEqual(["invalid_credentials"]);
});

it("propagates a Tecnofit 500 without counting an attempt", async () => {
  server.use(http.post(AUTH, () => new HttpResponse(null, { status: 500 })));
  const { token, inviteId } = await createInvite(deps(), { createdBy: "cli" });
  await expect(redeemInvite(deps(), input(token, nextEmail()), META)).rejects.toMatchObject({
    name: "TecnofitError",
    status: 500,
  });
  expect(await invite(inviteId)).toMatchObject({ status: "pending", attempts: 0 });
  expect(await failures(inviteId)).toEqual([]);
});

it("propagates a token that is not a JWT without counting an attempt", async () => {
  server.use(http.post(AUTH, () => HttpResponse.json({ token: "not-a-jwt" })));
  const { token, inviteId } = await createInvite(deps(), { createdBy: "cli" });
  await expect(redeemInvite(deps(), input(token, nextEmail()), META)).rejects.toBeInstanceOf(
    TecnofitInvalidResponse,
  );
  expect(await invite(inviteId)).toMatchObject({ status: "pending", attempts: 0 });
});

it("omits metadata from invite.created without a label", async () => {
  const { inviteId } = await createInvite(deps(), { createdBy: "cli" });
  const [created] = await events(inviteId);
  expect(created.action).toBe("invite.created");
  expect(Object.keys(created)).not.toContain("metadata");
});

it("never stores the password or raw secrets", async () => {
  const { token } = await createInvite(deps(), { label: "amigo", createdBy: "cli" });
  const email = nextEmail();
  await expect(redeemInvite(deps(), input(token, email, WRONG), META)).rejects.toBeInstanceOf(InvalidCredentials);
  const { sessionToken } = await redeemInvite(deps(), input(token, email), META);
  const dump = async (TableName: string) => JSON.stringify((await raw.send(new ScanCommand({ TableName }))).Items);
  const audit = await dump("checkin-test-audit");
  const main = await dump("checkin-test-main");
  for (const secret of [PASSWORD, WRONG, JWT, token, sessionToken]) {
    expect(audit).not.toContain(secret);
    expect(main).not.toContain(secret);
  }
  expect(audit).not.toContain(hashSecret(sessionToken));
});

it("audits invites created by an admin as admin", async () => {
  const { inviteId } = await createInvite(deps(), { createdBy: "admin@example.com" });
  const [created] = await events(inviteId);
  expect(created).toMatchObject({ actorType: "admin", actorId: "admin@example.com" });
});

it("revokes only pending invites", async () => {
  const pending = await createInvite(deps(), { createdBy: "cli" });
  await revokeInvite(e, pending.inviteId);
  expect((await invite(pending.inviteId))?.status).toBe("revoked");
  await expect(revokeInvite(e, pending.inviteId)).rejects.toBeInstanceOf(InviteNotPending);

  const used = await createInvite(deps(), { createdBy: "cli" });
  await redeemInvite(deps(), input(used.token, nextEmail()), META);
  await expect(revokeInvite(e, used.inviteId)).rejects.toBeInstanceOf(InviteNotPending);
  expect((await invite(used.inviteId))?.status).toBe("used");

  const burned = await createInvite(deps(), { createdBy: "cli" });
  await e.invite.patch({ inviteId: burned.inviteId }).set({ status: "burned" }).go();
  await expect(revokeInvite(e, burned.inviteId)).rejects.toBeInstanceOf(InviteNotPending);

  await expect(revokeInvite(e, "missing")).rejects.toBeInstanceOf(InviteNotFound);
  expect((await e.invite.get({ inviteId: "missing" }).go()).data).toBeNull();
});

it("lists invites newest first and shows lapsed pending ones as expired", async () => {
  t = NOW + 10 * 3600_000;
  const old = await createInvite(deps(), { createdBy: "cli" });
  t += 60_000;
  const fresh = await createInvite(deps(), { createdBy: "cli" });
  const list = await listInvites(e, old.expiresAt + 1000);
  const ids = list.map((i) => i.inviteId);
  expect(ids.indexOf(fresh.inviteId)).toBeLessThan(ids.indexOf(old.inviteId));
  expect(list.find((i) => i.inviteId === old.inviteId)?.status).toBe("expired");
  expect(list.find((i) => i.inviteId === fresh.inviteId)?.status).toBe("pending");
  const soon = await listInvites(e, t);
  expect(soon.find((i) => i.inviteId === old.inviteId)?.status).toBe("pending");
  expect((await invite(old.inviteId))?.status).toBe("pending");
});
