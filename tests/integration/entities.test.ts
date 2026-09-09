import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { beforeAll, expect, it } from "vitest";
import {
  createEntities,
  isConditionalFailure,
  type Entities,
} from "../../packages/core/db/entities.js";
import { awsConfig, createAuditTable, createMainTable, resetMoto } from "./setup/aws.js";

const raw = new DynamoDBClient(awsConfig);
let table: string;
let audit: string;
let e: Entities;

beforeAll(async () => {
  await resetMoto();
  table = await createMainTable();
  audit = await createAuditTable();
  e = createEntities(DynamoDBDocumentClient.from(raw), { main: table, audit });
});

it("writes raw profile keys", async () => {
  await e.profile
    .create({
      userId: "u_1",
      name: "Ana",
      tecnofitEmail: "Ana@Example.com",
      tecnofitUserId: 7,
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
    })
    .go();
  const out = await raw.send(
    new GetItemCommand({
      TableName: table,
      Key: { PK: { S: "USER#u_1" }, SK: { S: "PROFILE" } },
    }),
  );
  expect(out.Item?.PK?.S).toBe("USER#u_1");
  expect(out.Item?.SK?.S).toBe("PROFILE");
  expect(out.Item?.GSI1PK?.S).toBe("EMAIL#Ana@Example.com");
  expect(out.Item?.GSI2PK?.S).toBe("ENTITY#USER");
});

it("round-trips once and weekly schedules", async () => {
  const base = {
    userId: "u_1",
    empresaId: "e1",
    className: "CrossFit",
    startTime: "17:15",
    allowWaitingList: true,
    active: true,
  };
  const once = {
    ...base,
    scheduleId: "s_once",
    kind: "once" as const,
    date: "2026-02-02",
  };
  const weekly = {
    ...base,
    scheduleId: "s_week",
    kind: "weekly" as const,
    weekdays: [1, 3, 5],
  };
  await e.schedule.create(once).go();
  await e.schedule.create(weekly).go();
  expect(
    (await e.schedule.get({ userId: "u_1", scheduleId: "s_once" }).go()).data,
  ).toEqual(once);
  expect(
    (await e.schedule.get({ userId: "u_1", scheduleId: "s_week" }).go()).data,
  ).toEqual(weekly);
});

const exec = {
  scheduleId: "s_week",
  classDate: "2026-02-02",
  userId: "u_1",
  status: "running" as const,
  attempts: 1,
  ttl: 1_800_000_000,
};

it("rejects duplicate execution", async () => {
  await e.execution.create(exec).go();
  const err = await e.execution
    .create(exec)
    .go()
    .catch((x: unknown) => x);
  expect(isConditionalFailure(err)).toBe(true);
});

it("updates GSI2SK when status changes", async () => {
  await e.execution
    .patch({ scheduleId: "s_week", classDate: "2026-02-02" })
    .set({ status: "success", userId: "u_1" })
    .go();
  const out = await raw.send(
    new GetItemCommand({
      TableName: table,
      Key: { PK: { S: "SCHEDULE#s_week" }, SK: { S: "EXEC#2026-02-02" } },
    }),
  );
  expect(out.Item?.GSI2SK?.S).toBe("success#u_1");
  expect(out.Item?.status?.S).toBe("success");
});

it("writes raw invite keys", async () => {
  await e.invite
    .create({
      inviteId: "h1",
      status: "pending",
      expiresAt: 1000,
      attempts: 0,
      createdBy: "cli",
      createdAt: "2026-01-01T00:00:00Z",
      ttl: 2000,
    })
    .go();
  const out = await raw.send(
    new GetItemCommand({
      TableName: table,
      Key: { PK: { S: "INVITE#h1" }, SK: { S: "META" } },
    }),
  );
  expect(out.Item?.GSI2PK?.S).toBe("ENTITY#INVITE");
  expect(out.Item?.GSI2SK?.S).toBe("2026-01-01T00:00:00Z");
});

it("writes raw session keys", async () => {
  await e.session
    .create({
      sessionId: "s1",
      userId: "u_1",
      createdAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
      ip: "1.1.1.1",
      userAgent: "ua",
    })
    .go();
  const out = await raw.send(
    new GetItemCommand({
      TableName: table,
      Key: { PK: { S: "SESSION#s1" }, SK: { S: "META" } },
    }),
  );
  expect(out.Item?.GSI1PK?.S).toBe("USER#u_1");
  expect(out.Item?.GSI1SK?.S).toBe("SESSION#2026-01-01T00:00:00Z");
});

it("writes raw loginFail keys", async () => {
  await e.loginFail.create({ email: "a@b.c", count: 1, ttl: 5 }).go();
  const out = await raw.send(
    new GetItemCommand({
      TableName: table,
      Key: { PK: { S: "LOGINFAIL#a@b.c" }, SK: { S: "META" } },
    }),
  );
  expect(out.Item?.count?.N).toBe("1");
});

it("writes raw audit keys", async () => {
  await e.audit
    .create({
      day: "2026-01-01",
      at: "2026-01-01T10:00:00.000Z",
      eventId: "ev1",
      actorType: "user",
      actorId: "u_1",
      action: "user.login",
      targetId: "t1",
      result: "success",
      metadata: { reason: "x" },
      ttl: 9,
    })
    .go();
  const out = await raw.send(
    new GetItemCommand({
      TableName: audit,
      Key: {
        PK: { S: "DAY#2026-01-01" },
        SK: { S: "2026-01-01T10:00:00.000Z#ev1" },
      },
    }),
  );
  expect(out.Item?.GSI1PK?.S).toBe("ACTOR#u_1");
  expect(out.Item?.GSI1SK?.S).toBe("2026-01-01T10:00:00.000Z");
  expect(out.Item?.GSI2PK?.S).toBe("TARGET#t1");
});

it("transaction fails second time on non-pending invite", async () => {
  await e.invite
    .create({
      inviteId: "h2",
      status: "pending",
      expiresAt: 1000,
      attempts: 0,
      createdBy: "cli",
      createdAt: "2026-01-02T00:00:00Z",
      ttl: 2000,
    })
    .go();
  const redeem = () =>
    e.service.transaction
      .write(({ invite }) => [
        invite
          .patch({ inviteId: "h2" })
          .set({ status: "used", usedBy: "u_2" })
          .where((a, { eq }) => eq(a.status, "pending"))
          .commit(),
      ])
      .go();
  expect((await redeem()).canceled).toBe(false);
  expect((await redeem()).canceled).toBe(true);
});
