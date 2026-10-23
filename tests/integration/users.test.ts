import { KMSClient } from "@aws-sdk/client-kms";
import {
  CreateScheduleGroupCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptToken } from "../../packages/core/crypto/token.js";
import type { Entities } from "../../packages/core/db/entities.js";
import {
  addSchedule,
  listExecutionsByDate,
  listSchedules,
  updateSchedule,
  type ScheduleDeps,
} from "../../packages/core/domain/schedules.js";
import { createSession } from "../../packages/core/domain/sessions.js";
import {
  deleteUser,
  reactivateUser,
  revokeUserSessions,
  suspendUser,
  UserNotFound,
} from "../../packages/core/domain/users.js";
import events from "../fixtures/tecnofit/events.json";
import { fakeJwt } from "../fixtures/tecnofit/jwt.js";
import {
  awsConfig,
  createKey,
  createTestEntities,
  resetMoto,
} from "./setup/aws.js";

const TOKEN = fakeJwt({
  user_id: 28715453,
  empresa_id: 161322,
  exp: 1900000000,
});
const GROUP = "checkin-dev";
const NOW = Date.parse("2026-10-19T12:00:00Z");
const [event] = events.events;
const mondayEvents = {
  events: [
    {
      ...event,
      start: "2026-10-19 17:15",
      end: "2026-10-19 18:15",
      weekDay: 1,
    },
  ],
};

const server = setupServer(
  http.get(
    "https://rest.tecnofit.com.br/v2/161322/crossfit/wod/:date/programs/calendar/events",
    () => HttpResponse.json(mondayEvents),
  ),
);

const kms = new KMSClient(awsConfig);
const scheduler = new SchedulerClient(awsConfig);
let e: Entities;
let deps: ScheduleDeps;
let seed: (userId: string) => Promise<void>;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: "bypass" });
  await resetMoto();
  e = await createTestEntities();
  const keyId = await createKey(kms);
  await scheduler.send(new CreateScheduleGroupCommand({ Name: GROUP }));
  deps = {
    entities: e,
    kms,
    scheduler,
    group: GROUP,
    workerArn:
      "arn:aws:lambda:sa-east-1:940482447658:function:checkin-dev-worker",
    roleArn: "arn:aws:iam::940482447658:role/checkin-dev-scheduler",
    now: () => NOW,
  };
  seed = async (userId) => {
    await e.profile
      .create({
        userId,
        name: "Fulano",
        tecnofitEmail: `${userId}@example.com`,
        tecnofitUserId: 1,
        status: "active",
        createdAt: new Date(NOW).toISOString(),
      })
      .go();
    await e.account
      .create({
        userId,
        empresaId: "161322",
        tokenEnc: await encryptToken(kms, keyId, userId, TOKEN),
        tokenExp: 1900000000,
        boxName: "BOX",
        status: "ok",
      })
      .go();
  };
});

afterAll(() => server.close());

const monday = (userId: string) => ({
  userId,
  className: "TREINO NO RANCHO",
  refDate: "2026-10-19",
  kind: "weekly" as const,
  startTime: "17:15",
  weekdays: [1],
});

const mainItems = async (pk: string) =>
  (
    await DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig)).send(
      new QueryCommand({
        TableName: "checkin-test-main",
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
      }),
    )
  ).Items;

describe("deleteUser", () => {
  it("removes everything of the user and nothing of others", async () => {
    await seed("u_del");
    await seed("u_keep");
    const ids = [
      await addSchedule(deps, monday("u_del")),
      await addSchedule(deps, monday("u_del")),
    ];
    const keepId = await addSchedule(deps, monday("u_keep"));
    for (const userId of ["u_del", "u_keep"]) {
      await e.execution
        .create({
          scheduleId: `s_${userId}`,
          classDate: "2026-10-12",
          userId,
          status: "success",
          attempts: 1,
          ttl: 1,
        })
        .go();
      await createSession(e, userId, { ip: "1.1.1.1", userAgent: "ua" }, NOW);
    }

    await deleteUser(deps, "u_del");

    expect(await mainItems("USER#u_del")).toEqual([]);
    for (const id of ids) {
      await expect(
        scheduler.send(new GetScheduleCommand({ Name: id, GroupName: GROUP })),
      ).rejects.toMatchObject({
        name: "ResourceNotFoundException",
      });
    }
    expect(
      (await e.execution.query.byUser({ userId: "u_del" }).go()).data,
    ).toEqual([]);
    expect(
      (await e.session.query.byUser({ userId: "u_del" }).go()).data,
    ).toEqual([]);

    expect((await mainItems("USER#u_keep"))!.length).toBeGreaterThan(0);
    await expect(
      scheduler.send(
        new GetScheduleCommand({ Name: keepId, GroupName: GROUP }),
      ),
    ).resolves.toBeDefined();
    expect(
      (await e.execution.query.byUser({ userId: "u_keep" }).go()).data,
    ).toHaveLength(1);
    expect(
      (await e.session.query.byUser({ userId: "u_keep" }).go()).data,
    ).toHaveLength(1);
  });

  it("is idempotent", async () => {
    await seed("u_twice");
    await addSchedule(deps, monday("u_twice"));
    await deleteUser(deps, "u_twice");
    await expect(deleteUser(deps, "u_twice")).resolves.toBeUndefined();
    expect(await mainItems("USER#u_twice")).toEqual([]);
  });

  it("throws when a batch delete leaves unprocessed items", async () => {
    await seed("u_unproc");
    const stub = {
      ...e,
      execution: {
        query: e.execution.query,
        delete: () => ({ go: async () => ({ data: [], unprocessed: [{}] }) }),
      },
    } as unknown as Entities;
    await expect(deleteUser({ ...deps, entities: stub }, "u_unproc")).rejects.toThrow("unprocessed");
    await expect(deleteUser(deps, "u_unproc")).resolves.toBeUndefined();
  });
});

const state = async (id: string) =>
  (await scheduler.send(new GetScheduleCommand({ Name: id, GroupName: GROUP }))).State;

describe("suspendUser / reactivateUser", () => {
  it("pauses only active schedules, revokes sessions and restores only those", async () => {
    await seed("u_susp");
    await seed("u_other");
    const a = await addSchedule(deps, monday("u_susp"));
    const b = await addSchedule(deps, monday("u_susp"));
    await updateSchedule(deps, "u_susp", b, { active: false });
    await createSession(e, "u_susp", { ip: "1.1.1.1", userAgent: "ua" }, NOW);
    await createSession(e, "u_other", { ip: "1.1.1.1", userAgent: "ua" }, NOW);

    await suspendUser(deps, "u_susp");

    expect((await e.profile.get({ userId: "u_susp" }).go()).data?.status).toBe("suspended");
    const rows = await listSchedules(e, "u_susp");
    expect(rows.find((r) => r.scheduleId === a)).toMatchObject({ active: false, pausedBySuspension: true });
    expect(rows.find((r) => r.scheduleId === b)).toMatchObject({ active: false });
    expect(rows.find((r) => r.scheduleId === b)?.pausedBySuspension).toBeUndefined();
    expect(await state(a)).toBe("DISABLED");
    expect(await state(b)).toBe("DISABLED");
    expect((await e.session.query.byUser({ userId: "u_susp" }).go()).data).toEqual([]);
    expect((await e.session.query.byUser({ userId: "u_other" }).go()).data).toHaveLength(1);

    await reactivateUser(deps, "u_susp");

    expect((await e.profile.get({ userId: "u_susp" }).go()).data?.status).toBe("active");
    const after = await listSchedules(e, "u_susp");
    expect(after.find((r) => r.scheduleId === a)).toMatchObject({ active: true, pausedBySuspension: false });
    expect(after.find((r) => r.scheduleId === b)?.active).toBe(false);
    expect(await state(a)).toBe("ENABLED");
    expect(await state(b)).toBe("DISABLED");
  });

  it("only clears the flag of a finished one-off schedule on reactivation", async () => {
    await seed("u_fin");
    const id = await addSchedule({ ...deps, now: () => NOW - 86400_000 }, {
      ...monday("u_fin"),
      kind: "once",
      date: "2026-10-19",
      weekdays: undefined,
    } as never);
    await suspendUser(deps, "u_fin");
    await reactivateUser({ ...deps, now: () => NOW + 86400_000 }, "u_fin");
    const [row] = await listSchedules(e, "u_fin");
    expect(row).toMatchObject({ scheduleId: id, active: false, pausedBySuspension: false });
    expect((await e.profile.get({ userId: "u_fin" }).go()).data?.status).toBe("active");
  });

  it("revokes sessions and restores the row when the Scheduler fails", async () => {
    await seed("u_fail");
    const id = await addSchedule(deps, monday("u_fail"));
    await createSession(e, "u_fail", { ip: "1.1.1.1", userAgent: "ua" }, NOW);
    const failing = {
      send: async () => {
        throw Object.assign(new Error("boom"), { name: "InternalServerException" });
      },
    } as unknown as SchedulerClient;

    await expect(suspendUser({ ...deps, scheduler: failing }, "u_fail")).rejects.toThrow("boom");

    expect((await e.session.query.byUser({ userId: "u_fail" }).go()).data).toEqual([]);
    expect((await e.profile.get({ userId: "u_fail" }).go()).data?.status).toBe("suspended");
    const [row] = await listSchedules(e, "u_fail");
    expect(row.scheduleId).toBe(id);
    expect(row.active).toBe(true);
    expect(row.pausedBySuspension).toBeFalsy();
  });

  it("skips a finished one-off during suspension without flagging it", async () => {
    await seed("u_skip");
    const id = await addSchedule({ ...deps, now: () => NOW - 86400_000 }, {
      ...monday("u_skip"),
      kind: "once",
      date: "2026-10-19",
      weekdays: undefined,
    } as never);
    await scheduler.send(new DeleteScheduleCommand({ Name: id, GroupName: GROUP }));
    await createSession(e, "u_skip", { ip: "1.1.1.1", userAgent: "ua" }, NOW);

    await suspendUser(deps, "u_skip");

    const [row] = await listSchedules(e, "u_skip");
    expect(row.pausedBySuspension).toBeFalsy();
    expect((await e.session.query.byUser({ userId: "u_skip" }).go()).data).toEqual([]);
  });

  it("throws UserNotFound for an unknown user", async () => {
    await expect(suspendUser(deps, "u_nope")).rejects.toBeInstanceOf(UserNotFound);
    await expect(reactivateUser(deps, "u_nope")).rejects.toBeInstanceOf(UserNotFound);
  });
});

describe("revokeUserSessions", () => {
  it("removes only the user's sessions", async () => {
    await createSession(e, "u_rs1", { ip: "1.1.1.1", userAgent: "ua" }, NOW);
    await createSession(e, "u_rs2", { ip: "1.1.1.1", userAgent: "ua" }, NOW);
    await revokeUserSessions(e, "u_rs1");
    expect((await e.session.query.byUser({ userId: "u_rs1" }).go()).data).toEqual([]);
    expect((await e.session.query.byUser({ userId: "u_rs2" }).go()).data).toHaveLength(1);
  });
});

describe("listExecutionsByDate", () => {
  it("returns every execution of the date", async () => {
    for (const [userId, classDate] of [["u_x1", "2026-11-01"], ["u_x2", "2026-11-01"], ["u_x3", "2026-11-02"]]) {
      await e.execution
        .create({ scheduleId: `s_${userId}`, classDate, userId, status: "success", attempts: 1, ttl: 1 })
        .go();
    }
    const rows = await listExecutionsByDate(e, "2026-11-01");
    expect(rows.map((r) => r.userId).sort()).toEqual(["u_x1", "u_x2"]);
  });
});
