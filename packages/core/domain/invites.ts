import { randomUUID } from "node:crypto";
import type { KMSClient } from "@aws-sdk/client-kms";
import { writeAudit } from "../audit/audit.js";
import { hashSecret, newSecret } from "../crypto/secret.js";
import { encryptToken } from "../crypto/token.js";
import { isConditionalFailure, type Entities } from "../db/entities.js";
import { getMe, isCredentialRejection, login } from "../tecnofit/client.js";
import { normalizeEmail } from "./sessions.js";

export type PublicDeps = { entities: Entities; kms: KMSClient; keyId: string; now: () => number };

export type RequestMeta = { ip: string; userAgent: string };

export const requestMeta = (viewerAddress: string | undefined, sourceIp: string, userAgent: string): RequestMeta => ({
  ip: viewerAddress?.replace(/:[^:]*$/, "") ?? sourceIp,
  userAgent,
});

export class InviteInvalid extends Error {
  constructor() {
    super("Invite invalid or expired");
    this.name = "InviteInvalid";
  }
}

export class AccountExists extends Error {
  constructor() {
    super("Account already registered");
    this.name = "AccountExists";
  }
}

export class InvalidCredentials extends Error {
  constructor() {
    super("Invalid credentials");
    this.name = "InvalidCredentials";
  }
}

export class InviteNotFound extends Error {
  constructor() {
    super("Invite not found");
    this.name = "InviteNotFound";
  }
}

export class InviteNotPending extends Error {
  constructor() {
    super("Invite is not pending");
    this.name = "InviteNotPending";
  }
}

const INVITE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

export async function createInvite(
  deps: PublicDeps,
  input: { label?: string; createdBy: string },
): Promise<{ token: string; inviteId: string; expiresAt: number }> {
  const { token, hash: inviteId } = newSecret();
  const now = deps.now();
  const expiresAt = now + INVITE_TTL_MS;
  await deps.entities.invite
    .create({
      inviteId,
      label: input.label,
      status: "pending",
      expiresAt,
      attempts: 0,
      createdBy: input.createdBy,
      createdAt: new Date(now).toISOString(),
      ttl: Math.floor(expiresAt / 1000) + 7 * 86400,
    })
    .go();
  await writeAudit(
    deps.entities,
    {
      actorType: input.createdBy === "cli" ? "cli" : "admin",
      actorId: input.createdBy,
      action: "invite.created",
      targetType: "invite",
      targetId: inviteId,
      result: "success",
      ...(input.label !== undefined && { metadata: { label: input.label } }),
    },
    now,
  );
  return { token, inviteId, expiresAt };
}

export async function listInvites(entities: Entities, now: number) {
  const { data } = await entities.invite.query.byCreated({}).go({ pages: "all", order: "desc" });
  return data.map((invite) =>
    invite.status === "pending" && invite.expiresAt <= now ? { ...invite, status: "expired" as const } : invite,
  );
}

export async function revokeInvite(entities: Entities, inviteId: string): Promise<void> {
  try {
    await entities.invite
      .patch({ inviteId })
      .set({ status: "revoked" })
      .where((a, { eq }) => eq(a.status, "pending"))
      .go();
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    const { data } = await entities.invite.get({ inviteId }).go();
    throw data ? new InviteNotPending() : new InviteNotFound();
  }
}

async function isPending(deps: PublicDeps, inviteId: string): Promise<boolean> {
  const { data } = await deps.entities.invite.get({ inviteId }).go();
  return data?.status === "pending" && data.expiresAt > deps.now();
}

export async function checkInvite(deps: PublicDeps, token: string): Promise<boolean> {
  return isPending(deps, hashSecret(token));
}

export async function redeemInvite(
  deps: PublicDeps,
  input: { token: string; email: string; password: string; consentVersion: string },
  meta: RequestMeta,
): Promise<{ userId: string; sessionToken: string }> {
  const { entities, now } = deps;
  const inviteId = hashSecret(input.token);
  const audit = (event: Pick<Parameters<typeof writeAudit>[1], "actorType" | "actorId" | "action" | "result" | "metadata">) =>
    writeAudit(
      entities,
      { ...event, targetType: "invite", targetId: inviteId, ip: meta.ip, userAgent: meta.userAgent },
      now(),
    );
  const anonymous = { actorType: "anonymous", actorId: "anonymous", result: "denied" } as const;
  const denied = (reason: string) => audit({ ...anonymous, action: "invite.redeem_failed", metadata: { reason } });
  const email = normalizeEmail(input.email);

  if (!(await isPending(deps, inviteId))) {
    await denied("invalid_invite");
    throw new InviteInvalid();
  }
  const { data: existing } = await entities.profile.query.byEmail({ tecnofitEmail: email }).go();
  if (existing.length > 0) {
    await denied("account_exists");
    throw new AccountExists();
  }

  const tecnofit = await login(email, input.password).catch(async (err: unknown) => {
    if (!isCredentialRejection(err)) throw err;
    const { data } = await entities.invite.patch({ inviteId }).add({ attempts: 1 }).go({ response: "all_new" });
    if (data.attempts >= MAX_ATTEMPTS) {
      const burned = await entities.invite
        .patch({ inviteId })
        .set({ status: "burned" })
        .where((a, { eq }) => eq(a.status, "pending"))
        .go()
        .catch((err: unknown) => {
          if (!isConditionalFailure(err)) throw err;
        });
      if (burned) await audit({ actorType: "system", actorId: "system", action: "invite.burned", result: "success" });
    }
    await denied("invalid_credentials");
    throw new InvalidCredentials();
  });

  const userId = `u_${randomUUID()}`;
  const [me, tokenEnc] = await Promise.all([
    getMe(tecnofit.token),
    encryptToken(deps.kms, deps.keyId, userId, tecnofit.token),
  ]);
  const sessionSecret = newSecret();
  const redeemedAt = now();
  const at = new Date(redeemedAt).toISOString();
  const { canceled } = await entities.service.transaction
    .write(({ invite, profile, account, session }) => [
      invite
        .patch({ inviteId })
        .set({ status: "used", usedBy: userId, usedAt: at })
        .where((a, { eq, gt }) => `${eq(a.status, "pending")} AND ${gt(a.expiresAt, redeemedAt)}`)
        .commit(),
      profile
        .create({
          userId,
          name: me.name,
          tecnofitEmail: email,
          tecnofitUserId: tecnofit.userId,
          status: "active",
          createdAt: at,
        })
        .commit(),
      account
        .create({
          userId,
          empresaId: String(tecnofit.empresaId),
          tokenEnc,
          tokenExp: tecnofit.exp,
          boxName: me.companies.find((c) => c.id === tecnofit.empresaId)?.name ?? String(tecnofit.empresaId),
          status: "ok",
        })
        .commit(),
      session
        .create({
          sessionId: sessionSecret.hash,
          userId,
          createdAt: at,
          lastSeenAt: at,
          ip: meta.ip,
          userAgent: meta.userAgent,
        })
        .commit(),
    ])
    .go();
  if (canceled) {
    await denied("invalid_invite");
    throw new InviteInvalid();
  }

  await audit({
    actorType: "user",
    actorId: userId,
    action: "invite.redeemed",
    result: "success",
    metadata: { consentVersion: input.consentVersion },
  });
  return { userId, sessionToken: sessionSecret.token };
}
