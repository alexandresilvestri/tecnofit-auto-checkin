import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { beforeAll, expect, it } from "vitest";
import {
  createEntities,
  isConditionalFailure,
  type Entities,
} from "../../packages/core/db/entities.js";
import { awsConfig, createMainTable, resetMoto } from "./setup/aws.js";

const raw = new DynamoDBClient(awsConfig);
let table: string;
let e: Entities;

beforeAll(async () => {
  await resetMoto();
  table = await createMainTable();
  e = createEntities(DynamoDBDocumentClient.from(raw), table);
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
