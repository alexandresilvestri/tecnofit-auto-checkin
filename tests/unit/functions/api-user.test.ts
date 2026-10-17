import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { ClassNotFound, InvalidCursor, ScheduleFinished, ScheduleNotFound, TooLate } from "@checkin/core/domain/schedules";
import { TecnofitError, TecnofitInvalidResponse, TecnofitUnauthorized } from "@checkin/core/tecnofit/client";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);
const sessions = vi.hoisted(() => ({ touchSession: vi.fn(), revokeSession: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));
const sched = vi.hoisted(() => ({
  addSchedule: vi.fn(),
  listClasses: vi.fn(),
  updateSchedule: vi.fn(),
  removeSchedule: vi.fn(),
  dropSchedule: vi.fn(),
  listSchedules: vi.fn(),
  listExecutions: vi.fn(),
}));
const users = vi.hoisted(() => ({ deleteUser: vi.fn() }));

vi.mock("@checkin/core/domain/sessions", async (orig) => ({
  ...(await orig<object>()),
  ...sessions,
}));
vi.mock("@checkin/core/audit/audit", async (orig) => ({
  ...(await orig<object>()),
  ...audit,
}));

vi.mock("@checkin/core/domain/schedules", async (orig) => ({
  ...(await orig<object>()),
  ...sched,
}));
vi.mock("@checkin/core/domain/users", async (orig) => ({
  ...(await orig<object>()),
  ...users,
}));

let handler: typeof import("../../../apps/functions/api-user/index").handler;

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  vi.stubEnv("SCHEDULE_GROUP", "grp");
  vi.stubEnv("WORKER_ARN", "arn:worker");
  vi.stubEnv("SCHEDULER_ROLE_ARN", "arn:role");
  vi.stubEnv("ORIGIN_SECRET", "s3cret");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "SILENT");
  ({ handler } = await import("../../../apps/functions/api-user/index"));
});

beforeEach(() => {
  vi.resetAllMocks();
  ddb.reset();
});

const send = (
  method: string,
  path: string,
  headers: Record<string, string> = { "x-requested-with": "fetch" },
  extra: { query?: string; body?: unknown } = {},
) =>
  handler({
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: extra.query ?? "",
    cookies: ["sid=tok"],
    headers: { "x-origin-verify": "s3cret", ...headers },
    body: extra.body === undefined ? undefined : JSON.stringify(extra.body),
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "1.2.3.4", userAgent: "ua-test" },
      authorizer: { lambda: { userId: "u1", sessionId: "s1" } },
    },
    isBase64Encoded: false,
  } as never) as Promise<{ statusCode: number; body: string; cookies?: string[] }>;

it.each([[{ "x-origin-verify": "wrong" }], [{ "x-origin-verify": "" }]])("rejects origin header %j with 403", async (headers) => {
  const res = await send("GET", "/api/me", headers);
  expect(res.statusCode).toBe(403);
  expect(JSON.parse(res.body)).toEqual({ message: "Acesso negado." });
  expect(ddb.calls()).toHaveLength(0);
});

const profile = {
  __edb_e__: "profile",
  __edb_v__: "1",
  PK: "USER#u1",
  SK: "PROFILE",
  userId: "u1",
  name: "Ana",
  tecnofitEmail: "a@b.c",
  tecnofitUserId: 1,
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
};
const account = {
  __edb_e__: "account",
  __edb_v__: "1",
  PK: "USER#u1",
  SK: "ACCOUNT#9",
  userId: "u1",
  empresaId: "9",
  tokenEnc: "enc",
  tokenExp: 1,
  boxName: "Box X",
  status: "ok",
};

const sessionCookie = ["sid=tok", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=34560000"].sort();

it("me returns profile and account data without reissuing the cookie", async () => {
  ddb.on(GetCommand).resolves({ Item: profile });
  ddb.on(QueryCommand).resolves({ Items: [account] });
  sessions.touchSession.mockResolvedValue(false);
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ name: "Ana", boxName: "Box X", accountStatus: "ok" });
  expect(res.cookies).toBeUndefined();
  expect(sessions.touchSession.mock.calls[0]![1]).toBe("s1");
  const query = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
  expect(Object.values(query.ExpressionAttributeValues!)).toEqual(expect.arrayContaining(["USER#u1", "ACCOUNT#"]));
});

it("me reissues the exact session cookie when touchSession is true", async () => {
  ddb.on(GetCommand).resolves({ Item: profile });
  ddb.on(QueryCommand).resolves({ Items: [account] });
  sessions.touchSession.mockResolvedValue(true);
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(200);
  expect(res.cookies).toHaveLength(1);
  expect(res.cookies![0]!.split("; ").sort()).toEqual(sessionCookie);
});

it("me returns 401 when the profile is missing", async () => {
  ddb.on(GetCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(401);
  expect(JSON.parse(res.body)).toEqual({ message: "Sessão inválida." });
  expect(sessions.touchSession).not.toHaveBeenCalled();
});

it("me returns 500 on unexpected errors", async () => {
  ddb.on(GetCommand).rejects(new Error("boom"));
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toEqual({ message: "Erro inesperado." });
});

it("logout without X-Requested-With returns 403", async () => {
  const res = await send("POST", "/api/auth/logout", {});
  expect(res.statusCode).toBe(403);
  expect(sessions.revokeSession).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("logout revokes the session, audits and clears the cookie", async () => {
  const res = await send("POST", "/api/auth/logout");
  expect(res.statusCode).toBe(204);
  expect(res.cookies).toHaveLength(1);
  expect(res.cookies![0]!.split("; ").sort()).toEqual(
    ["sid=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=0"].sort(),
  );
  expect(sessions.revokeSession.mock.calls[0]![1]).toBe("tok");
  expect(audit.writeAudit.mock.calls[0]![1]).toEqual({
    actorType: "user",
    actorId: "u1",
    action: "user.logout",
    result: "success",
    ip: "1.2.3.4",
    userAgent: "ua-test",
  });
});

it.each([
  ["203.0.113.7:46532", "203.0.113.7"],
  ["2001:db8::7:46532", "2001:db8::7"],
  [undefined, "1.2.3.4"],
])("logout audits the ip from CloudFront-Viewer-Address %s as %s", async (viewer, ip) => {
  const headers = viewer ? { "x-requested-with": "fetch", "cloudfront-viewer-address": viewer } : undefined;
  await send("POST", "/api/auth/logout", headers);
  expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({ ip, userAgent: "ua-test" });
});

const fetchHeaders = { "x-requested-with": "fetch" };
const meta = { ip: "1.2.3.4", userAgent: "ua-test" };
const invalid = { message: "Requisição inválida." };
const weekly = { className: "Cross", startTime: "18:30", date: "2026-08-03", kind: "weekly", weekdays: [1, 3] };
const once = { className: "Cross", startTime: "18:30", date: "2026-08-03", kind: "once" };

it.each(["PATCH", "DELETE"])("%s without X-Requested-With returns 403", async (method) => {
  const res = await send(method, "/api/schedules/sc1", {}, { body: { active: true } });
  expect(res.statusCode).toBe(403);
  expect(sched.updateSchedule).not.toHaveBeenCalled();
  expect(sched.removeSchedule).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("DELETE /api/me without X-Requested-With returns 403", async () => {
  const res = await send("DELETE", "/api/me", {});
  expect(res.statusCode).toBe(403);
  expect(users.deleteUser).not.toHaveBeenCalled();
});

it("classes returns the domain list", async () => {
  const list = [{ name: "Cross", time: "18:30", count: 3, capacity: 10 }];
  sched.listClasses.mockResolvedValue(list);
  const res = await send("GET", "/api/classes", {}, { query: "date=2026-08-03" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual(list);
  expect(sched.listClasses.mock.calls[0]!.slice(1)).toEqual(["u1", "2026-08-03"]);
});

it.each([undefined, "date=2026-8-3", "date=abc"])("classes with query %s returns 400", async (query) => {
  const res = await send("GET", "/api/classes", {}, { query });
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body)).toEqual(invalid);
  expect(sched.listClasses).not.toHaveBeenCalled();
});

it("schedules lists cards with nextClass and last", async () => {
  const base = { userId: "u1", empresaId: "9", className: "Cross", startTime: "18:30" };
  sched.listSchedules.mockResolvedValue([
    { ...base, scheduleId: "a", kind: "weekly", weekdays: [1], active: true },
    { ...base, scheduleId: "b", kind: "once", date: "2099-01-05", active: false },
  ]);
  ddb.on(QueryCommand).callsFake((input) =>
    Object.values(input.ExpressionAttributeValues).includes("SCHEDULE#a")
      ? { Items: [{ __edb_e__: "execution", __edb_v__: "1", scheduleId: "a", classDate: "2026-07-27", userId: "u1", status: "success", attempts: 1, ttl: 1 }] }
      : { Items: [] },
  );
  const res = await send("GET", "/api/schedules", {});
  expect(res.statusCode).toBe(200);
  const [a, b] = JSON.parse(res.body);
  expect(a).toMatchObject({ scheduleId: "a", kind: "weekly", weekdays: [1], active: true, finished: false, last: { classDate: "2026-07-27", status: "success" } });
  expect(typeof a.nextClass).toBe("string");
  expect(b).toMatchObject({ scheduleId: "b", kind: "once", date: "2099-01-05", active: false, finished: false, nextClass: null, last: null });
  expect(a.userId).toBeUndefined();
  expect(a.empresaId).toBeUndefined();
});

it("schedules marks fired once schedules as finished and sorts weekly first", async () => {
  const base = { userId: "u1", empresaId: "9", className: "Cross", active: true };
  sched.listSchedules.mockResolvedValue([
    { ...base, scheduleId: "o2", kind: "once", date: "2099-01-06", startTime: "07:00" },
    { ...base, scheduleId: "o1", kind: "once", date: "2020-01-05", startTime: "18:30" },
    { ...base, scheduleId: "w2", kind: "weekly", weekdays: [3, 5], startTime: "07:00" },
    { ...base, scheduleId: "w1", kind: "weekly", weekdays: [1], startTime: "18:30" },
    { ...base, scheduleId: "w0", kind: "weekly", weekdays: [1], startTime: "07:00" },
  ]);
  ddb.on(QueryCommand).resolves({ Items: [] });
  const res = await send("GET", "/api/schedules", {});
  const cards = JSON.parse(res.body);
  expect(cards.map((x: { scheduleId: string }) => x.scheduleId)).toEqual(["w0", "w1", "w2", "o1", "o2"]);
  expect(cards.map((x: { finished: boolean }) => x.finished)).toEqual([false, false, false, true, false]);
  expect(cards[3].nextClass).toBeNull();
  expect(sched.dropSchedule).not.toHaveBeenCalled();
});

it("schedules drops finished once schedules whose run ended or that were paused", async () => {
  const base = { userId: "u1", empresaId: "9", className: "Cross", kind: "once", date: "2020-01-05", startTime: "18:30" };
  sched.listSchedules.mockResolvedValue([
    { ...base, scheduleId: "done", active: true },
    { ...base, scheduleId: "paused", active: false },
    { ...base, scheduleId: "running", active: true },
  ]);
  const exec = (scheduleId: string, status: string) => ({
    Items: [{ __edb_e__: "execution", __edb_v__: "1", scheduleId, classDate: "2020-01-05", userId: "u1", status, attempts: 1, ttl: 1 }],
  });
  ddb.on(QueryCommand).callsFake((input) => {
    const values = Object.values(input.ExpressionAttributeValues);
    if (values.includes("SCHEDULE#done")) return exec("done", "success");
    if (values.includes("SCHEDULE#running")) return exec("running", "running");
    return { Items: [] };
  });
  const res = await send("GET", "/api/schedules", {});
  expect(JSON.parse(res.body).map((x: { scheduleId: string }) => x.scheduleId)).toEqual(["running"]);
  expect(sched.dropSchedule.mock.calls.map((call) => call.slice(1))).toEqual([
    ["u1", "done"],
    ["u1", "paused"],
  ]);
});

it.each([
  [weekly, { userId: "u1", className: "Cross", refDate: "2026-08-03", kind: "weekly", startTime: "18:30", weekdays: [1, 3] }],
  [once, { userId: "u1", className: "Cross", refDate: "2026-08-03", kind: "once", startTime: "18:30", date: "2026-08-03" }],
])("create schedule returns 201 and audits", async (body, expected) => {
  sched.addSchedule.mockResolvedValue("sc1");
  const res = await send("POST", "/api/schedules", fetchHeaders, { body });
  expect(res.statusCode).toBe(201);
  expect(JSON.parse(res.body)).toEqual({ scheduleId: "sc1" });
  expect(sched.addSchedule.mock.calls[0]![1]).toEqual(expected);
  expect(audit.writeAudit.mock.calls[0]![1]).toEqual({
    actorType: "user",
    actorId: "u1",
    action: "schedule.created",
    result: "success",
    targetType: "schedule",
    targetId: "sc1",
    ...meta,
  });
});

it.each([
  ["empty className", { ...weekly, className: "" }],
  ["long className", { ...weekly, className: "x".repeat(101) }],
  ["bad startTime", { ...weekly, startTime: "25:00" }],
  ["bad startTime format", { ...weekly, startTime: "9:30" }],
  ["bad date", { ...weekly, date: "03/08/2026" }],
  ["bad kind", { ...weekly, kind: "daily" }],
  ["weekly without weekdays", { ...weekly, weekdays: undefined }],
  ["empty weekdays", { ...weekly, weekdays: [] }],
  ["repeated weekdays", { ...weekly, weekdays: [1, 1] }],
  ["weekday out of range", { ...weekly, weekdays: [7] }],
])("create schedule with %s returns 400", async (_n, body) => {
  const res = await send("POST", "/api/schedules", fetchHeaders, { body });
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body)).toEqual(invalid);
  expect(sched.addSchedule).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("create schedule with non-json body returns 400", async () => {
  const res = await send("POST", "/api/schedules", fetchHeaders);
  expect(res.statusCode).toBe(400);
});

it.each([
  [{ active: false }, { active: false }],
  [{ active: true, allowWaitingList: false }, { active: true }],
])("patch schedule passes only active and audits", async (body, expected) => {
  const res = await send("PATCH", "/api/schedules/sc1", fetchHeaders, { body });
  expect(res.statusCode).toBe(204);
  expect(sched.updateSchedule.mock.calls[0]!.slice(1)).toEqual(["u1", "sc1", expected]);
  expect(audit.writeAudit.mock.calls[0]![1]).toEqual({
    actorType: "user",
    actorId: "u1",
    action: "schedule.updated",
    result: "success",
    targetType: "schedule",
    targetId: "sc1",
    ...meta,
  });
});

it.each([{}, { active: "yes" }, { allowWaitingList: 1 }])("patch schedule with %j returns 400", async (body) => {
  const res = await send("PATCH", "/api/schedules/sc1", fetchHeaders, { body });
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body)).toEqual(invalid);
  expect(sched.updateSchedule).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("delete schedule returns 204 and audits", async () => {
  const res = await send("DELETE", "/api/schedules/sc1", fetchHeaders);
  expect(res.statusCode).toBe(204);
  expect(sched.removeSchedule.mock.calls[0]!.slice(1)).toEqual(["u1", "sc1"]);
  expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({
    action: "schedule.deleted",
    targetType: "schedule",
    targetId: "sc1",
    result: "success",
  });
});

it("executions returns items and cursor", async () => {
  const items = [{ scheduleId: "a", classDate: "2026-07-27", className: "Cross", startTime: "18:30", status: "success", attempts: 1 }];
  sched.listExecutions.mockResolvedValue({ items: [{ ...items[0], userId: "u1", ttl: 1 }], cursor: "next" });
  const res = await send("GET", "/api/executions", {}, { query: "cursor=abc" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ items, cursor: "next" });
  expect(sched.listExecutions.mock.calls[0]!.slice(1)).toEqual(["u1", "abc"]);
});

it("executions without cursor returns null cursor", async () => {
  sched.listExecutions.mockResolvedValue({ items: [], cursor: null });
  const res = await send("GET", "/api/executions", {});
  expect(JSON.parse(res.body)).toEqual({ items: [], cursor: null });
  expect(sched.listExecutions.mock.calls[0]![2]).toBeUndefined();
});

it("executions with oversized cursor returns 400", async () => {
  const res = await send("GET", "/api/executions", {}, { query: `cursor=${"a".repeat(2049)}` });
  expect(res.statusCode).toBe(400);
  expect(sched.listExecutions).not.toHaveBeenCalled();
});

it("executions with unparseable cursor returns 400", async () => {
  sched.listExecutions.mockRejectedValue(new InvalidCursor());
  const res = await send("GET", "/api/executions", {}, { query: "cursor=abc" });
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body)).toEqual(invalid);
});

it("executions rethrows other listing failures as 500", async () => {
  sched.listExecutions.mockRejectedValue(new Error("boom"));
  const res = await send("GET", "/api/executions", {}, { query: "cursor=abc" });
  expect(res.statusCode).toBe(500);
});

it("delete me removes the user, audits and clears the cookie", async () => {
  const res = await send("DELETE", "/api/me", fetchHeaders);
  expect(res.statusCode).toBe(204);
  expect(users.deleteUser.mock.calls[0]![1]).toBe("u1");
  expect(res.cookies![0]!.split("; ").sort()).toEqual(
    ["sid=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=0"].sort(),
  );
  expect(audit.writeAudit.mock.calls[0]![1]).toEqual({
    actorType: "user",
    actorId: "u1",
    action: "user.self_deleted",
    result: "success",
    targetType: "user",
    targetId: "u1",
    ...meta,
  });
});

it.each([
  [new ClassNotFound(), 422, "Aula não encontrada na agenda."],
  [new TooLate(), 422, "O check-in desta aula já foi liberado. Faça pelo app da Tecnofit."],
  [new ScheduleNotFound(), 404, "Agendamento não encontrado."],
  [new ScheduleFinished(), 409, "Este agendamento já foi executado."],
  [new TecnofitUnauthorized(), 409, "Conexão com a Tecnofit expirada. Reconecte a conta."],
  [new TecnofitError(500, "x"), 502, "Tecnofit indisponível. Tente novamente em instantes."],
  [new TecnofitInvalidResponse(), 502, "Tecnofit indisponível. Tente novamente em instantes."],
  [new Error("Account not found"), 500, "Erro inesperado."],
])("maps domain error %s to %s", async (err, status, message) => {
  sched.addSchedule.mockRejectedValue(err);
  const res = await send("POST", "/api/schedules", fetchHeaders, { body: weekly });
  expect(res.statusCode).toBe(status);
  expect(JSON.parse(res.body)).toEqual({ message });
  expect(audit.writeAudit).not.toHaveBeenCalled();
});
