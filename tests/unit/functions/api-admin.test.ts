import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { InvalidAuditPeriod } from "@checkin/core/audit/audit";
import { InviteNotFound, InviteNotPending } from "@checkin/core/domain/invites";
import { UserNotFound } from "@checkin/core/domain/users";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);
const audit = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  queryAudit: vi.fn(),
  auditCsv: vi.fn(),
}));
const invites = vi.hoisted(() => ({
  createInvite: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
}));
const users = vi.hoisted(() => ({
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
  revokeUserSessions: vi.fn(),
  deleteUser: vi.fn(),
}));
const sched = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listExecutions: vi.fn(),
  listExecutionsByDate: vi.fn(),
}));

vi.mock("@checkin/core/audit/audit", async (orig) => ({
  ...(await orig<object>()),
  ...audit,
}));
vi.mock("@checkin/core/domain/invites", async (orig) => ({
  ...(await orig<object>()),
  ...invites,
}));
vi.mock("@checkin/core/domain/users", async (orig) => ({
  ...(await orig<object>()),
  ...users,
}));
vi.mock("@checkin/core/domain/schedules", async (orig) => ({
  ...(await orig<object>()),
  ...sched,
}));

let handler: typeof import("../../../apps/functions/api-admin/index").handler;

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  vi.stubEnv("SCHEDULE_GROUP", "grp");
  vi.stubEnv("WORKER_ARN", "arn:worker");
  vi.stubEnv("SCHEDULER_ROLE_ARN", "arn:role");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "SILENT");
  ({ handler } = await import("../../../apps/functions/api-admin/index"));
});

beforeEach(() => {
  vi.resetAllMocks();
  ddb.reset();
  audit.writeAudit.mockResolvedValue(undefined);
});

const send = (
  method: string,
  path: string,
  extra: { query?: string; body?: unknown; groups?: unknown } = {},
) =>
  handler({
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: extra.query ?? "",
    headers: { "cloudfront-viewer-address": "9.9.9.9:1234" },
    body: extra.body === undefined ? undefined : JSON.stringify(extra.body),
    requestContext: {
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "1.2.3.4",
        userAgent: "ua-test",
      },
      authorizer: {
        jwt: {
          claims: {
            sub: "adm1",
            "cognito:groups": "groups" in extra ? extra.groups : ["admin"],
          },
        },
      },
    },
    isBase64Encoded: false,
  } as never) as Promise<{
    statusCode: number;
    body: string;
    headers?: Record<string, string>;
  }>;

const expectError = async (
  res:
    | { statusCode: number; body: string }
    | Promise<{ statusCode: number; body: string }>,
  status: number,
  message: string,
) => {
  const r = await res;
  expect(r.statusCode).toBe(status);
  expect(JSON.parse(r.body)).toEqual({ message });
};

const written = (i = 0) => audit.writeAudit.mock.calls[i]![1];

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

it.each([
  ["GET", "/api/admin/invites"],
  ["POST", "/api/admin/invites"],
  ["DELETE", "/api/admin/invites/i1"],
  ["GET", "/api/admin/users"],
  ["GET", "/api/admin/users/u1"],
  ["POST", "/api/admin/users/u1/suspend"],
  ["DELETE", "/api/admin/users/u1"],
  ["GET", "/api/admin/executions"],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/admin/audit/export"],
])("%s %s is 403 without the admin group", async (method, path) => {
  for (const groups of [
    undefined,
    [],
    ["other"],
    "[other]",
    "[administrator]",
  ]) {
    const res = await send(method, path, { groups });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ message: "Acesso negado." });
  }
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("accepts the string group form", async () => {
  invites.listInvites.mockResolvedValue([]);
  expect(
    (await send("GET", "/api/admin/invites", { groups: "[other admin]" }))
      .statusCode,
  ).toBe(200);
  expect(
    (await send("GET", "/api/admin/invites", { groups: "[admin]" })).statusCode,
  ).toBe(200);
});

it("creates an invite with the admin sub", async () => {
  invites.createInvite.mockResolvedValue({
    token: "tok",
    inviteId: "i1",
    expiresAt: 123,
  });
  const res = await send("POST", "/api/admin/invites", {
    body: { label: "Joao" },
  });
  expect(res.statusCode).toBe(201);
  expect(JSON.parse(res.body)).toEqual({ token: "tok", expiresAt: 123 });
  expect(invites.createInvite.mock.calls[0]![1]).toEqual({
    label: "Joao",
    createdBy: "adm1",
  });
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("creates an invite without a body", async () => {
  invites.createInvite.mockResolvedValue({
    token: "tok",
    inviteId: "i1",
    expiresAt: 123,
  });
  expect((await send("POST", "/api/admin/invites")).statusCode).toBe(201);
  expect(invites.createInvite.mock.calls[0]![1]).toEqual({
    label: undefined,
    createdBy: "adm1",
  });
});

it("rejects a label over 60 chars", async () => {
  const res = await send("POST", "/api/admin/invites", {
    body: { label: "x".repeat(61) },
  });
  expect(res.statusCode).toBe(400);
  expect(invites.createInvite).not.toHaveBeenCalled();
});

it("rejects a malformed invite body", async () => {
  const res = await handler({
    version: "2.0",
    routeKey: "$default",
    rawPath: "/api/admin/invites",
    rawQueryString: "",
    headers: {},
    body: "{bad",
    requestContext: {
      http: {
        method: "POST",
        path: "/api/admin/invites",
        protocol: "HTTP/1.1",
        sourceIp: "1.2.3.4",
        userAgent: "ua",
      },
      authorizer: {
        jwt: { claims: { sub: "adm1", "cognito:groups": ["admin"] } },
      },
    },
    isBase64Encoded: false,
  } as never);
  expect((res as { statusCode: number }).statusCode).toBe(400);
});

it("lists invites without internals", async () => {
  invites.listInvites.mockResolvedValue([
    {
      inviteId: "i1",
      label: "L",
      status: "expired",
      createdAt: "c",
      expiresAt: 5,
      usedBy: "u",
      usedAt: "t",
      attempts: 2,
      createdBy: "adm1",
      ttl: 9,
    },
  ]);
  const res = await send("GET", "/api/admin/invites");
  expect(JSON.parse(res.body)).toEqual([
    {
      inviteId: "i1",
      label: "L",
      status: "expired",
      createdAt: "c",
      expiresAt: 5,
      usedBy: "u",
      usedAt: "t",
    },
  ]);
});

it("revokes an invite and audits", async () => {
  invites.revokeInvite.mockResolvedValue(undefined);
  const res = await send("DELETE", "/api/admin/invites/i1");
  expect(res.statusCode).toBe(204);
  expect(invites.revokeInvite.mock.calls[0]![1]).toBe("i1");
  expect(written()).toMatchObject({
    actorType: "admin",
    actorId: "adm1",
    action: "invite.revoked",
    targetType: "invite",
    targetId: "i1",
    result: "success",
    ip: "9.9.9.9",
    userAgent: "ua-test",
  });
});

it("maps invite errors to 404 and 409 without auditing", async () => {
  invites.revokeInvite.mockRejectedValueOnce(new InviteNotFound());
  await expectError(
    await send("DELETE", "/api/admin/invites/i1"),
    404,
    "Convite não encontrado.",
  );
  invites.revokeInvite.mockRejectedValueOnce(new InviteNotPending());
  await expectError(
    await send("DELETE", "/api/admin/invites/i1"),
    409,
    "Só convites pendentes podem ser revogados.",
  );
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("lists users mapping tecnofitEmail to email", async () => {
  ddb.on(QueryCommand).resolves({ Items: [profile] });
  const res = await send("GET", "/api/admin/users");
  expect(JSON.parse(res.body)).toEqual([
    {
      userId: "u1",
      name: "Ana",
      email: "a@b.c",
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ]);
});

it("returns the user detail without secrets", async () => {
  ddb.on(GetCommand).resolves({ Item: profile });
  ddb.on(QueryCommand).callsFake((input) => {
    const pk = Object.values(
      input.ExpressionAttributeValues as Record<string, string>,
    )[0];
    if (!input.IndexName)
      return {
        Items: [
          {
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
          },
        ],
      };
    if (String(pk).startsWith("TARGET#"))
      return {
        Items: [
          {
            __edb_e__: "audit",
            __edb_v__: "1",
            day: "2026-07-01",
            at: "2026-07-01T10:00:00.000Z",
            eventId: "e1",
            actorType: "admin",
            actorId: "adm1",
            action: "user.suspended",
            targetType: "user",
            targetId: "u1",
            result: "success",
            ttl: 1,
          },
        ],
      };
    return {
      Items: [
        {
          __edb_e__: "session",
          __edb_v__: "1",
          sessionId: "hash",
          userId: "u1",
          createdAt: "c",
          lastSeenAt: "l",
          ip: "1.1.1.1",
          userAgent: "ua",
          expiresAt: 1,
          ttl: 1,
        },
      ],
    };
  });
  sched.listSchedules.mockResolvedValue([
    {
      scheduleId: "s1",
      userId: "u1",
      className: "Cross",
      startTime: "06:00",
      kind: "weekly",
      weekdays: [1],
      active: true,
    },
  ]);
  sched.listExecutions.mockResolvedValue({
    items: [
      {
        scheduleId: "s1",
        classDate: "2026-07-01",
        userId: "u1",
        status: "success",
        attempts: 1,
        ttl: 5,
      },
    ],
    cursor: null,
  });
  const res = await send("GET", "/api/admin/users/u1");
  expect(res.statusCode).toBe(200);
  const json = JSON.parse(res.body);
  expect(json.profile).toEqual({
    userId: "u1",
    name: "Ana",
    email: "a@b.c",
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  expect(json.account).toEqual({ boxName: "Box X", status: "ok" });
  expect(json.sessions).toEqual([
    { createdAt: "c", lastSeenAt: "l", ip: "1.1.1.1", userAgent: "ua" },
  ]);
  expect(json.executions).toHaveLength(1);
  expect(json.schedules).toHaveLength(1);
  expect(json.audit).toHaveLength(1);
  expect(json.audit[0]).toMatchObject({
    action: "user.suspended",
    targetId: "u1",
  });
  expect(res.body).not.toContain("tokenEnc");
  expect(res.body).not.toContain("hash");
});

it("detail account is null and 404 for missing profile", async () => {
  ddb.on(GetCommand).resolves({});
  await expectError(
    await send("GET", "/api/admin/users/u1"),
    404,
    "Usuário não encontrado.",
  );
});

it("suspends with reason and audits", async () => {
  users.suspendUser.mockResolvedValue(undefined);
  const res = await send("POST", "/api/admin/users/u1/suspend", {
    body: { reason: "abuso" },
  });
  expect(res.statusCode).toBe(204);
  expect(users.suspendUser.mock.calls[0]![1]).toBe("u1");
  expect(written()).toMatchObject({
    actorType: "admin",
    actorId: "adm1",
    action: "user.suspended",
    targetType: "user",
    targetId: "u1",
    metadata: { reason: "abuso" },
  });
});

it.each([{}, { reason: "" }, { reason: "x".repeat(201) }, { reason: 1 }])(
  "rejects suspend body %j",
  async (body) => {
    expect(
      (await send("POST", "/api/admin/users/u1/suspend", { body })).statusCode,
    ).toBe(400);
    expect(users.suspendUser).not.toHaveBeenCalled();
  },
);

it("suspend maps UserNotFound to 404", async () => {
  users.suspendUser.mockRejectedValue(new UserNotFound());
  await expectError(
    await send("POST", "/api/admin/users/u1/suspend", {
      body: { reason: "r" },
    }),
    404,
    "Usuário não encontrado.",
  );
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("reactivates and audits", async () => {
  users.reactivateUser.mockResolvedValue(undefined);
  expect(
    (await send("POST", "/api/admin/users/u1/reactivate")).statusCode,
  ).toBe(204);
  expect(written()).toMatchObject({
    action: "user.reactivated",
    targetType: "user",
    targetId: "u1",
  });
});

it("reactivate maps UserNotFound to 404", async () => {
  users.reactivateUser.mockRejectedValue(new UserNotFound());
  await expectError(
    await send("POST", "/api/admin/users/u1/reactivate"),
    404,
    "Usuário não encontrado.",
  );
});

it("revokes sessions and audits", async () => {
  users.revokeUserSessions.mockResolvedValue(undefined);
  expect(
    (await send("POST", "/api/admin/users/u1/revoke-sessions")).statusCode,
  ).toBe(204);
  expect(users.revokeUserSessions.mock.calls[0]![1]).toBe("u1");
  expect(written()).toMatchObject({
    action: "user.sessions_revoked",
    targetType: "user",
    targetId: "u1",
  });
});

it("deletes a user with reason and audits", async () => {
  ddb.on(GetCommand).resolves({ Item: profile });
  users.deleteUser.mockResolvedValue(undefined);
  const res = await send("DELETE", "/api/admin/users/u1", {
    body: { reason: "pedido" },
  });
  expect(res.statusCode).toBe(204);
  expect(users.deleteUser.mock.calls[0]![1]).toBe("u1");
  expect(written()).toMatchObject({
    action: "user.deleted",
    targetId: "u1",
    metadata: { reason: "pedido" },
  });
});

it("delete requires reason and an existing user", async () => {
  expect(
    (await send("DELETE", "/api/admin/users/u1", { body: {} })).statusCode,
  ).toBe(400);
  ddb.on(GetCommand).resolves({});
  await expectError(
    await send("DELETE", "/api/admin/users/u1", { body: { reason: "r" } }),
    404,
    "Usuário não encontrado.",
  );
  expect(users.deleteUser).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("lists executions by date", async () => {
  sched.listExecutionsByDate.mockResolvedValue([
    {
      userId: "u1",
      scheduleId: "s1",
      classDate: "2026-07-01",
      className: "Cross",
      startTime: "06:00",
      status: "failed",
      attempts: 2,
      error: "x",
      checkInId: "c",
      ttl: 1,
    },
  ]);
  const res = await send("GET", "/api/admin/executions", {
    query: "date=2026-07-01",
  });
  expect(sched.listExecutionsByDate.mock.calls[0]![1]).toBe("2026-07-01");
  expect(JSON.parse(res.body)).toEqual([
    {
      userId: "u1",
      scheduleId: "s1",
      className: "Cross",
      startTime: "06:00",
      status: "failed",
      attempts: 2,
      error: "x",
    },
  ]);
});

it.each(["", "date=2026-7-1", "date=abc"])(
  "rejects executions query %j",
  async (query) => {
    expect(
      (await send("GET", "/api/admin/executions", { query })).statusCode,
    ).toBe(400);
  },
);

it("queries audit", async () => {
  audit.queryAudit.mockResolvedValue({
    items: [{ action: "a" }],
    truncated: false,
  });
  const res = await send("GET", "/api/admin/audit", {
    query: "from=2026-07-01&to=2026-07-02&actor=a1&action=user.login&target=t1",
  });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({
    items: [{ action: "a" }],
    truncated: false,
  });
  expect(audit.queryAudit.mock.calls[0]![1]).toEqual({
    from: "2026-07-01",
    to: "2026-07-02",
    actor: "a1",
    action: "user.login",
    target: "t1",
  });
});

it("audit validation and period errors are 400", async () => {
  expect(
    (await send("GET", "/api/admin/audit", { query: "from=2026-07-01" }))
      .statusCode,
  ).toBe(400);
  expect(
    (await send("GET", "/api/admin/audit", { query: "from=x&to=y" }))
      .statusCode,
  ).toBe(400);
  audit.queryAudit.mockRejectedValue(new InvalidAuditPeriod());
  expect(
    (
      await send("GET", "/api/admin/audit", {
        query: "from=2026-01-01&to=2026-07-02",
      })
    ).statusCode,
  ).toBe(400);
});

it("exports csv with headers and audits", async () => {
  audit.queryAudit.mockResolvedValue({
    items: [{ action: "a" }],
    truncated: false,
  });
  audit.auditCsv.mockReturnValue("h\r\nrow");
  const res = await send("GET", "/api/admin/audit/export", {
    query: "from=2026-07-01&to=2026-07-02&actor=a1",
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe("h\r\nrow");
  expect(res.headers).toMatchObject({
    "content-type": "text/csv; charset=utf-8",
    "content-disposition":
      'attachment; filename="auditoria-2026-07-01-2026-07-02.csv"',
  });
  expect(audit.auditCsv.mock.calls[0]![0]).toEqual([{ action: "a" }]);
  const entry = written();
  expect(entry).toMatchObject({
    actorType: "admin",
    actorId: "adm1",
    action: "audit.exported",
    result: "success",
  });
  expect(JSON.parse(entry.metadata.filter)).toEqual({
    from: "2026-07-01",
    to: "2026-07-02",
    actor: "a1",
  });
});

it("export rejects invalid query and period without auditing", async () => {
  expect(
    (await send("GET", "/api/admin/audit/export", { query: "to=2026-07-02" }))
      .statusCode,
  ).toBe(400);
  audit.queryAudit.mockRejectedValue(new InvalidAuditPeriod());
  expect(
    (
      await send("GET", "/api/admin/audit/export", {
        query: "from=2026-01-01&to=2026-07-02",
      })
    ).statusCode,
  ).toBe(400);
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("unexpected errors are 500", async () => {
  invites.listInvites.mockRejectedValue(new Error("boom"));
  expect((await send("GET", "/api/admin/invites")).statusCode).toBe(500);
});
