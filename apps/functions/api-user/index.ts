import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { writeAudit } from "@checkin/core/audit/audit";
import { createEntities } from "@checkin/core/db/entities";
import { fromCloudFront } from "@checkin/core/http/origin";
import { requestMeta } from "@checkin/core/domain/invites";
import { SESSION_COOKIE, revokeSession, touchSession } from "@checkin/core/domain/sessions";
import {
  ClassNotFound,
  InvalidCursor,
  ScheduleFinished,
  ScheduleNotFound,
  TooLate,
  addSchedule,
  listClasses,
  listExecutions,
  listSchedules,
  removeSchedule,
  specOf,
  updateSchedule,
} from "@checkin/core/domain/schedules";
import { nextClass } from "@checkin/core/domain/time";
import { deleteUser } from "@checkin/core/domain/users";
import { TecnofitError, TecnofitInvalidResponse, TecnofitUnauthorized } from "@checkin/core/tecnofit/client";
import { handle } from "@hono/aws-lambda";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";

type Env = {
  Bindings: {
    event: {
      requestContext: {
        http: { sourceIp: string; userAgent: string };
        authorizer: { lambda: { userId: string; sessionId: string } };
      };
    };
  };
};

const logger = new Logger({ serviceName: "api-user" });
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

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const startTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const common = { className: z.string().min(1).max(100), startTime, date, allowWaitingList: z.boolean() };
const createSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("weekly"),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).refine((days) => new Set(days).size === days.length),
  }),
  z.object({ ...common, kind: z.literal("once") }),
]);
const patchSchema = z
  .object({ active: z.boolean().optional(), allowWaitingList: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0);
const classesQuery = z.object({ date });
const executionsQuery = z.object({ cursor: z.string().min(1).max(2048).optional() });
const scheduleId = z.string().min(1).max(64);

const invalidRequest = { message: "Requisição inválida." };

const mapError = (err: unknown): [400 | 404 | 409 | 422 | 500 | 502, string] => {
  if (err instanceof InvalidCursor) return [400, invalidRequest.message];
  if (err instanceof ClassNotFound) return [422, "Aula não encontrada na agenda."];
  if (err instanceof TooLate) return [422, "O check-in desta aula já foi liberado. Faça pelo app da Tecnofit."];
  if (err instanceof ScheduleNotFound) return [404, "Agendamento não encontrado."];
  if (err instanceof ScheduleFinished) return [409, "Este agendamento já foi executado."];
  if (err instanceof TecnofitUnauthorized) return [409, "Conexão com a Tecnofit expirada. Reconecte a conta."];
  if (err instanceof TecnofitError || err instanceof TecnofitInvalidResponse)
    return [502, "Tecnofit indisponível. Tente novamente em instantes."];
  return [500, "Erro inesperado."];
};

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  if (!fromCloudFront(c.req.header("x-origin-verify"), process.env.ORIGIN_SECRET!)) {
    logger.info("request", { route: c.req.path, status: 403 });
    return c.json({ message: "Acesso negado." }, 403);
  }
  if (!["GET", "HEAD"].includes(c.req.method) && c.req.header("x-requested-with") !== "fetch") {
    logger.info("request", { route: c.req.path, status: 403 });
    return c.json(invalidRequest, 403);
  }
  await next();
  logger.info("request", { route: c.req.path, status: c.res.status });
});

app.onError((err, c) => {
  const [status, message] = mapError(err);
  logger.warn("request failed", { route: c.req.path, status, error: err.name });
  return c.json({ message }, status);
});

const session = (c: Context<Env>) => c.env.event.requestContext.authorizer.lambda;

const auditUser = (
  c: Context<Env>,
  action: "schedule.created" | "schedule.updated" | "schedule.deleted" | "user.self_deleted" | "user.logout",
  targetType?: "schedule" | "user",
  targetId?: string,
) => {
  const { sourceIp, userAgent } = c.env.event.requestContext.http;
  return writeAudit(
    entities,
    {
      actorType: "user",
      actorId: session(c).userId,
      action,
      result: "success",
      targetType,
      targetId,
      ...requestMeta(c.req.header("cloudfront-viewer-address"), sourceIp, userAgent),
    },
    Date.now(),
  );
};

const body = async <S extends z.ZodType>(c: Context<Env>, schema: S) => {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? parsed.data : null;
};

app.get("/api/me", async (c) => {
  const { userId, sessionId } = session(c);
  const [{ data: profile }, accounts] = await Promise.all([
    entities.profile.get({ userId }).go(),
    entities.account.query.byUser({ userId }).go({ limit: 1 }),
  ]);
  if (!profile) return c.json({ message: "Sessão inválida." }, 401);
  const [account] = accounts.data;
  const token = getCookie(c, "sid");
  if (token && (await touchSession(entities, sessionId, Date.now())))
    setCookie(c, "sid", token, SESSION_COOKIE);
  return c.json({ name: profile.name, boxName: account?.boxName, accountStatus: account?.status });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, "sid");
  if (token) await revokeSession(entities, token);
  await auditUser(c, "user.logout");
  deleteCookie(c, "sid", { ...SESSION_COOKIE, maxAge: 0 });
  return c.body(null, 204);
});

app.delete("/api/me", async (c) => {
  const { userId } = session(c);
  await deleteUser(deps, userId);
  await auditUser(c, "user.self_deleted", "user", userId);
  deleteCookie(c, "sid", { ...SESSION_COOKIE, maxAge: 0 });
  return c.body(null, 204);
});

app.get("/api/classes", async (c) => {
  const query = classesQuery.safeParse(c.req.query());
  if (!query.success) return c.json(invalidRequest, 400);
  return c.json(await listClasses(deps, session(c).userId, query.data.date));
});

app.get("/api/schedules", async (c) => {
  const schedules = await listSchedules(entities, session(c).userId);
  const now = Date.now();
  const cards = await Promise.all(
    schedules.map(async (item) => {
      const [last] = (
        await entities.execution.query.bySchedule({ scheduleId: item.scheduleId }).go({ order: "desc", limit: 1 })
      ).data;
      const next = nextClass(specOf(item), now);
      return {
        scheduleId: item.scheduleId,
        className: item.className,
        startTime: item.startTime,
        kind: item.kind,
        weekdays: item.weekdays,
        date: item.date,
        allowWaitingList: item.allowWaitingList,
        active: item.active,
        finished: item.kind === "once" && next === null,
        nextClass: item.active ? next : null,
        last: last ? { classDate: last.classDate, status: last.status } : null,
      };
    }),
  );
  const order = (card: (typeof cards)[number]) =>
    card.kind === "weekly"
      ? `0 ${Math.min(...(card.weekdays ?? []))} ${card.startTime}`
      : `1 ${card.date} ${card.startTime}`;
  return c.json(cards.sort((a, b) => order(a).localeCompare(order(b))));
});

app.post("/api/schedules", async (c) => {
  const input = await body(c, createSchema);
  if (!input) return c.json(invalidRequest, 400);
  const base = {
    userId: session(c).userId,
    className: input.className,
    allowWaitingList: input.allowWaitingList,
    startTime: input.startTime,
    refDate: input.date,
  };
  const id = await addSchedule(
    deps,
    input.kind === "weekly"
      ? { ...base, kind: "weekly", weekdays: input.weekdays }
      : { ...base, kind: "once", date: input.date },
  );
  await auditUser(c, "schedule.created", "schedule", id);
  return c.json({ scheduleId: id }, 201);
});

app.patch("/api/schedules/:id", async (c) => {
  const id = scheduleId.safeParse(c.req.param("id"));
  const input = await body(c, patchSchema);
  if (!id.success || !input) return c.json(invalidRequest, 400);
  await updateSchedule(deps, session(c).userId, id.data, input);
  await auditUser(c, "schedule.updated", "schedule", id.data);
  return c.body(null, 204);
});

app.delete("/api/schedules/:id", async (c) => {
  const id = scheduleId.safeParse(c.req.param("id"));
  if (!id.success) return c.json(invalidRequest, 400);
  await removeSchedule(deps, session(c).userId, id.data);
  await auditUser(c, "schedule.deleted", "schedule", id.data);
  return c.body(null, 204);
});

app.get("/api/executions", async (c) => {
  const query = executionsQuery.safeParse(c.req.query());
  if (!query.success) return c.json(invalidRequest, 400);
  const { items, cursor } = await listExecutions(entities, session(c).userId, query.data.cursor);
  return c.json({
    items: items.map(({ scheduleId, classDate, className, startTime, status, attempts, error }) => ({
      scheduleId,
      classDate,
      className,
      startTime,
      status,
      attempts,
      error,
    })),
    cursor,
  });
});

export const handler = handle(app);
