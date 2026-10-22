import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { InvalidAuditPeriod, auditCsv, queryAudit, writeAudit } from "@checkin/core/audit/audit";
import type { AuditAction } from "@checkin/core/audit/audit";
import { createEntities } from "@checkin/core/db/entities";
import {
  InviteNotFound,
  InviteNotPending,
  createInvite,
  listInvites,
  requestMeta,
  revokeInvite,
} from "@checkin/core/domain/invites";
import { listExecutions, listExecutionsByDate, listSchedules } from "@checkin/core/domain/schedules";
import {
  UserNotFound,
  deleteUser,
  reactivateUser,
  revokeUserSessions,
  suspendUser,
} from "@checkin/core/domain/users";
import { handle } from "@hono/aws-lambda";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

type Env = {
  Bindings: {
    event: {
      requestContext: {
        http: { sourceIp: string; userAgent: string };
        authorizer: { jwt: { claims: Record<string, unknown> } };
      };
    };
  };
};

const logger = new Logger({ serviceName: "api-admin" });
const entities = createEntities(DynamoDBDocumentClient.from(new DynamoDBClient({})), {
  main: process.env.TABLE_MAIN!,
  audit: process.env.TABLE_AUDIT!,
});
const deps = {
  entities,
  kms: new KMSClient({}),
  scheduler: new SchedulerClient({}),
  group: process.env.SCHEDULE_GROUP!,
  workerArn: process.env.WORKER_ARN!,
  roleArn: process.env.SCHEDULER_ROLE_ARN!,
  now: Date.now,
};
const publicDeps = { entities, kms: deps.kms, keyId: "", now: Date.now };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().min(1).max(200);
const inviteBody = z.object({ label: z.string().min(1).max(60).optional() });
const reasonBody = z.object({ reason: z.string().trim().min(1).max(200) });
const idParam = z.string().min(1).max(128);
const executionsQuery = z.object({ date: day });
const auditQuery = z.object({
  from: day,
  to: day,
  actor: text.optional(),
  action: text.optional(),
  target: text.optional(),
});

const invalidRequest = { message: "Requisição inválida." };

const mapError = (err: unknown): [400 | 404 | 409 | 500, string] => {
  if (err instanceof InvalidAuditPeriod) return [400, invalidRequest.message];
  if (err instanceof InviteNotFound) return [404, "Convite não encontrado."];
  if (err instanceof InviteNotPending) return [409, "Só convites pendentes podem ser revogados."];
  if (err instanceof UserNotFound) return [404, "Usuário não encontrado."];
  return [500, "Erro inesperado."];
};

const isAdmin = (groups: unknown) => {
  const list = Array.isArray(groups)
    ? groups
    : typeof groups === "string"
      ? groups.replace(/^\[|\]$/g, "").split(/\s+/)
      : [];
  return list.includes("admin");
};

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  if (!isAdmin(claims(c)["cognito:groups"])) {
    logger.info("request", { route: c.req.path, status: 403 });
    return c.json({ message: "Acesso negado." }, 403);
  }
  await next();
  logger.info("request", { route: c.req.path, status: c.res.status });
});

app.onError((err, c) => {
  const [status, message] = mapError(err);
  logger.warn("request failed", { route: c.req.path, status, error: err.name });
  return c.json({ message }, status);
});

function claims(c: Context<Env>) {
  return c.env.event.requestContext.authorizer?.jwt?.claims ?? {};
}

const adminId = (c: Context<Env>) => String(claims(c).sub);

const auditAdmin = (
  c: Context<Env>,
  action: AuditAction,
  targetType?: "invite" | "user",
  targetId?: string,
  metadata?: { reason?: string; filter?: string },
) => {
  const { sourceIp, userAgent } = c.env.event.requestContext.http;
  return writeAudit(
    entities,
    {
      actorType: "admin",
      actorId: adminId(c),
      action,
      result: "success",
      targetType,
      targetId,
      metadata,
      ...requestMeta(c.req.header("cloudfront-viewer-address"), sourceIp, userAgent),
    },
    Date.now(),
  );
};

const body = async <S extends z.ZodType>(c: Context<Env>, schema: S) => {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? parsed.data : null;
};

const userView = (p: { userId: string; name: string; tecnofitEmail: string; status: string; createdAt: string }) => ({
  userId: p.userId,
  name: p.name,
  email: p.tecnofitEmail,
  status: p.status,
  createdAt: p.createdAt,
});

app.post("/api/admin/invites", async (c) => {
  const raw = await c.req.text();
  const input = inviteBody.safeParse(raw ? await c.req.json().catch(() => undefined) : {});
  if (!input.success) return c.json(invalidRequest, 400);
  const { token, expiresAt } = await createInvite(publicDeps, { label: input.data.label, createdBy: adminId(c) });
  return c.json({ token, expiresAt }, 201);
});

app.get("/api/admin/invites", async (c) => {
  const items = await listInvites(entities, Date.now());
  return c.json(
    items.map(({ inviteId, label, status, createdAt, expiresAt, usedBy, usedAt }) => ({
      inviteId,
      label,
      status,
      createdAt,
      expiresAt,
      usedBy,
      usedAt,
    })),
  );
});

app.delete("/api/admin/invites/:id", async (c) => {
  const id = idParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json(invalidRequest, 400);
  await revokeInvite(entities, id.data);
  await auditAdmin(c, "invite.revoked", "invite", id.data);
  return c.body(null, 204);
});

app.get("/api/admin/users", async (c) => {
  const { data } = await entities.profile.query.byCreated({}).go({ pages: "all", order: "desc" });
  return c.json(data.map(userView));
});

app.get("/api/admin/users/:id", async (c) => {
  const id = idParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json(invalidRequest, 400);
  const userId = id.data;
  const { data: profile } = await entities.profile.get({ userId }).go();
  if (!profile) return c.json({ message: "Usuário não encontrado." }, 404);
  const [accounts, schedules, executions, sessions, auditRows] = await Promise.all([
    entities.account.query.byUser({ userId }).go({ limit: 1 }),
    listSchedules(entities, userId),
    listExecutions(entities, userId),
    entities.session.query.byUser({ userId }).go({ pages: "all" }),
    entities.audit.query.byTarget({ targetId: userId }).go({ order: "desc", limit: 50 }),
  ]);
  const [account] = accounts.data;
  return c.json({
    profile: userView(profile),
    account: account ? { boxName: account.boxName, status: account.status } : null,
    schedules: schedules.map(
      ({ scheduleId, className, startTime, kind, weekdays, date, allowWaitingList, active, pausedBySuspension }) => ({
        scheduleId,
        className,
        startTime,
        kind,
        weekdays,
        date,
        allowWaitingList,
        active,
        pausedBySuspension,
      }),
    ),
    executions: executions.items.map(
      ({ scheduleId, classDate, className, startTime, status, attempts, error }) => ({
        scheduleId,
        classDate,
        className,
        startTime,
        status,
        attempts,
        error,
      }),
    ),
    sessions: sessions.data.map(({ createdAt, lastSeenAt, ip, userAgent }) => ({
      createdAt,
      lastSeenAt,
      ip,
      userAgent,
    })),
    audit: auditRows.data.map(
      ({ at, actorType, actorId, action, targetType, targetId, result, ip, userAgent, metadata }) => ({
        at,
        actorType,
        actorId,
        action,
        targetType,
        targetId,
        result,
        ip,
        userAgent,
        metadata,
      }),
    ),
  });
});

app.post("/api/admin/users/:id/suspend", async (c) => {
  const id = idParam.safeParse(c.req.param("id"));
  const input = await body(c, reasonBody);
  if (!id.success || !input) return c.json(invalidRequest, 400);
  await suspendUser(deps, id.data);
  await auditAdmin(c, "user.suspended", "user", id.data, { reason: input.reason });
  return c.body(null, 204);
});

app.post("/api/admin/users/:id/reactivate", async (c) => {
  const id = idParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json(invalidRequest, 400);
  await reactivateUser(deps, id.data);
  await auditAdmin(c, "user.reactivated", "user", id.data);
  return c.body(null, 204);
});

app.post("/api/admin/users/:id/revoke-sessions", async (c) => {
  const id = idParam.safeParse(c.req.param("id"));
  if (!id.success) return c.json(invalidRequest, 400);
  const { data: profile } = await entities.profile.get({ userId: id.data }).go();
  if (!profile) throw new UserNotFound();
  await revokeUserSessions(entities, id.data);
  await auditAdmin(c, "user.sessions_revoked", "user", id.data);
  return c.body(null, 204);
});

app.delete("/api/admin/users/:id", async (c) => {
  const id = idParam.safeParse(c.req.param("id"));
  const input = await body(c, reasonBody);
  if (!id.success || !input) return c.json(invalidRequest, 400);
  const { data: profile } = await entities.profile.get({ userId: id.data }).go();
  if (!profile) throw new UserNotFound();
  await deleteUser(deps, id.data);
  await auditAdmin(c, "user.deleted", "user", id.data, { reason: input.reason });
  return c.body(null, 204);
});

app.get("/api/admin/executions", async (c) => {
  const query = executionsQuery.safeParse(c.req.query());
  if (!query.success) return c.json(invalidRequest, 400);
  const items = await listExecutionsByDate(entities, query.data.date);
  return c.json(
    items.map(({ userId, scheduleId, className, startTime, status, attempts, error }) => ({
      userId,
      scheduleId,
      className,
      startTime,
      status,
      attempts,
      error,
    })),
  );
});

app.get("/api/admin/audit", async (c) => {
  const query = auditQuery.safeParse(c.req.query());
  if (!query.success) return c.json(invalidRequest, 400);
  return c.json(await queryAudit(entities, query.data));
});

app.get("/api/admin/audit/export", async (c) => {
  const query = auditQuery.safeParse(c.req.query());
  if (!query.success) return c.json(invalidRequest, 400);
  const { items } = await queryAudit(entities, query.data);
  const csv = `\uFEFF${auditCsv(items)}`;
  await auditAdmin(c, "audit.exported", undefined, undefined, {
    filter: JSON.stringify(query.data).slice(0, 500),
  });
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="auditoria-${query.data.from}-${query.data.to}.csv"`,
  });
});

export const handler = handle(app, {
  isContentTypeBinary: (contentType) => contentType.startsWith("text/csv"),
});
