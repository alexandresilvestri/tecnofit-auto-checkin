import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  CreateScheduleCommand,
  CreateScheduleGroupCommand,
  GetScheduleCommand,
  SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient, type AwsClientStub } from "aws-sdk-client-mock";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptToken } from "../../packages/core/crypto/token.js";
import { createEntities, type Entities } from "../../packages/core/db/entities.js";
import {
  addSchedule,
  ClassNotFound,
  listSchedules,
  removeSchedule,
  type AddScheduleInput,
  type ScheduleDeps,
} from "../../packages/core/domain/schedules.js";
import events from "../fixtures/tecnofit/events.json";
import { fakeJwt } from "../fixtures/tecnofit/jwt.js";
import { awsConfig, createMainTable, resetMoto } from "./setup/aws.js";

const TOKEN = fakeJwt({ user_id: 28715453, empresa_id: 161322, exp: 1900000000 });
const WORKER_ARN = "arn:aws:lambda:sa-east-1:940482447658:function:checkin-dev-worker";
const ROLE_ARN = "arn:aws:iam::940482447658:role/checkin-dev-scheduler";
const GROUP = "checkin-dev";
const [event] = events.events;

let eventsReply: Record<string, unknown>;
let requested: string[];

const server = setupServer(
  http.get("https://rest.tecnofit.com.br/v2/161322/crossfit/wod/:date/programs/calendar/events", ({ params }) => {
    requested.push(params.date as string);
    return HttpResponse.json(eventsReply);
  }),
);

const kms = new KMSClient(awsConfig);
const realScheduler = new SchedulerClient(awsConfig);
let schedulerMock: AwsClientStub<SchedulerClient>;
let e: Entities;
let keyId: string;
let n = 0;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: "bypass" });
  await resetMoto();
  e = createEntities(DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig)), await createMainTable());
  keyId = (await kms.send(new CreateKeyCommand({}))).KeyMetadata!.KeyId!;
  await realScheduler.send(new CreateScheduleGroupCommand({ Name: GROUP }));
});

afterAll(() => server.close());

const mondayEvents = {
  events: [{ ...event, start: "2026-10-19 17:15", end: "2026-10-19 18:15", weekDay: 1 }],
};

beforeEach(() => {
  requested = [];
  eventsReply = events;
});

async function seedUser() {
  n++;
  const userId = `u_${n}`;
  await e.account
    .create({
      userId,
      empresaId: "161322",
      tokenEnc: await encryptToken(kms, keyId, userId, TOKEN),
      tokenExp: 1900000000,
      boxName: "BOX CF Bombinhas",
      status: "ok",
    })
    .go();
  return userId;
}

const deps = (scheduler: SchedulerClient): ScheduleDeps => ({
  entities: e,
  kms,
  scheduler,
  group: GROUP,
  workerArn: WORKER_ARN,
  roleArn: ROLE_ARN,
});

const weekly = (userId: string): AddScheduleInput => ({
  userId,
  empresaId: 161322,
  className: "TREINO NO RANCHO",
  allowWaitingList: true,
  refDate: "2026-10-21",
  kind: "weekly",
  startTime: "07:00",
  weekdays: [3],
});

const once = (userId: string): AddScheduleInput => ({
  userId,
  empresaId: 161322,
  className: "TREINO NO RANCHO",
  allowWaitingList: false,
  refDate: "2026-10-21",
  kind: "once",
  startTime: "07:00",
  date: "2026-10-21",
});

describe("CreateSchedule input", () => {
  beforeEach(() => {
    schedulerMock = mockClient(SchedulerClient);
    schedulerMock.on(CreateScheduleCommand).resolves({});
  });

  afterEach(() => schedulerMock.restore());

  it("sends the weekly schedule fields", async () => {
    const userId = await seedUser();
    const scheduleId = await addSchedule(deps(schedulerMock as unknown as SchedulerClient), weekly(userId));
    expect(scheduleId).toMatch(/^s_/);
    expect(requested).toEqual(["2026-10-21"]);
    const calls = schedulerMock.commandCalls(CreateScheduleCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      Name: scheduleId,
      GroupName: GROUP,
      ScheduleExpression: "cron(1 19 ? * TUE *)",
      ScheduleExpressionTimezone: "America/Sao_Paulo",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: WORKER_ARN,
        RoleArn: ROLE_ARN,
        RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 },
        Input: JSON.stringify({ userId, scheduleId, scheduledTime: "<aws.scheduler.scheduled-time>" }),
      },
    });
    expect(calls[0].args[0].input).not.toHaveProperty("ActionAfterCompletion");
    expect((await e.schedule.get({ userId, scheduleId }).go()).data).toMatchObject({
      kind: "weekly",
      weekdays: [3],
      startTime: "07:00",
      className: "TREINO NO RANCHO",
      empresaId: "161322",
      allowWaitingList: true,
      active: true,
    });
  });

  it("deletes itself after running a once schedule", async () => {
    const userId = await seedUser();
    const scheduleId = await addSchedule(deps(schedulerMock as unknown as SchedulerClient), once(userId));
    const input = schedulerMock.commandCalls(CreateScheduleCommand)[0].args[0].input;
    expect(input).toMatchObject({
      Name: scheduleId,
      ScheduleExpression: "at(2026-10-20T19:01:00)",
      ActionAfterCompletion: "DELETE",
    });
    expect((await e.schedule.get({ userId, scheduleId }).go()).data).toMatchObject({
      kind: "once",
      date: "2026-10-21",
      allowWaitingList: false,
    });
  });

  it("removes the item when CreateSchedule fails", async () => {
    const userId = await seedUser();
    schedulerMock.on(CreateScheduleCommand).rejects(new Error("boom"));
    await expect(addSchedule(deps(schedulerMock as unknown as SchedulerClient), weekly(userId))).rejects.toThrow("boom");
    expect(await listSchedules(e, userId)).toEqual([]);
  });

  it("throws ClassNotFound without touching Scheduler or the table", async () => {
    const userId = await seedUser();
    eventsReply = { events: [{ ...event, start: "2026-10-21 08:00" }, { ...event, name: "OUTRA AULA" }] };
    await expect(addSchedule(deps(schedulerMock as unknown as SchedulerClient), weekly(userId))).rejects.toBeInstanceOf(
      ClassNotFound,
    );
    expect(schedulerMock.calls()).toHaveLength(0);
    expect(await listSchedules(e, userId)).toEqual([]);
  });
});

describe("with Moto Scheduler", () => {
  const monday = (userId: string): AddScheduleInput => ({
    userId,
    empresaId: 161322,
    className: "TREINO NO RANCHO",
    allowWaitingList: true,
    refDate: "2026-10-19",
    kind: "weekly",
    startTime: "17:15",
    weekdays: [1],
  });

  it("creates and removes the schedule and the item", async () => {
    const userId = await seedUser();
    eventsReply = mondayEvents;
    const d = deps(realScheduler);
    const scheduleId = await addSchedule(d, monday(userId));
    const got = await realScheduler.send(new GetScheduleCommand({ Name: scheduleId, GroupName: GROUP }));
    expect(got.ScheduleExpression).toBe("cron(16 5 ? * MON *)");
    expect(got.ScheduleExpressionTimezone).toBe("America/Sao_Paulo");
    expect((await listSchedules(e, userId)).map((s) => s.scheduleId)).toEqual([scheduleId]);

    await removeSchedule(d, userId, scheduleId);
    await expect(realScheduler.send(new GetScheduleCommand({ Name: scheduleId, GroupName: GROUP }))).rejects.toMatchObject({
      name: "ResourceNotFoundException",
    });
    expect(await listSchedules(e, userId)).toEqual([]);
  });

  it("removes the item when the schedule is already gone", async () => {
    const userId = await seedUser();
    eventsReply = mondayEvents;
    const d = deps(realScheduler);
    const scheduleId = await addSchedule(d, monday(userId));
    await removeSchedule(d, userId, scheduleId);
    await e.schedule
      .create({
        userId,
        scheduleId,
        empresaId: "161322",
        className: "TREINO NO RANCHO",
        startTime: "17:15",
        kind: "weekly",
        weekdays: [1],
        allowWaitingList: true,
        active: true,
      })
      .go();
    await removeSchedule(d, userId, scheduleId);
    expect(await listSchedules(e, userId)).toEqual([]);
  });

  it("lists only the user's schedules", async () => {
    const a = await seedUser();
    const b = await seedUser();
    eventsReply = mondayEvents;
    const d = deps(realScheduler);
    const idA = await addSchedule(d, monday(a));
    await addSchedule(d, monday(b));
    expect((await listSchedules(e, a)).map((s) => s.scheduleId)).toEqual([idA]);
  });
});
