import { randomUUID } from "node:crypto";
import type { KMSClient } from "@aws-sdk/client-kms";
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
  type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import type { EntityItem } from "electrodb";
import { decryptToken } from "../crypto/token.js";
import type { Entities } from "../db/entities.js";
import { listEvents, TecnofitUnauthorized } from "../tecnofit/client.js";
import { nextClass, scheduleExpression, TZ, type ScheduleSpec } from "./time.js";

export type ScheduleDeps = {
  entities: Entities;
  kms: KMSClient;
  scheduler: SchedulerClient;
  group: string;
  workerArn: string;
  roleArn: string;
  now: () => number;
};

export type AddScheduleInput = {
  userId: string;
  className: string;
  allowWaitingList: boolean;
  refDate: string;
} & ScheduleSpec;

export class ClassNotFound extends Error {
  constructor() {
    super("Class not found on the agenda");
    this.name = "ClassNotFound";
  }
}

export class TooLate extends Error {
  constructor() {
    super("Too late to schedule this class");
    this.name = "TooLate";
  }
}

export class ScheduleNotFound extends Error {
  constructor() {
    super("Schedule not found");
    this.name = "ScheduleNotFound";
  }
}

export class ScheduleFinished extends Error {
  constructor() {
    super("Schedule already finished");
    this.name = "ScheduleFinished";
  }
}

export class InvalidCursor extends Error {
  constructor() {
    super("Invalid cursor");
    this.name = "InvalidCursor";
  }
}

export const specOf = (row: EntityItem<Entities["schedule"]>): ScheduleSpec =>
  row.kind === "weekly"
    ? { kind: "weekly", startTime: row.startTime, weekdays: row.weekdays ?? [] }
    : { kind: "once", startTime: row.startTime, date: row.date! };

type Account = EntityItem<Entities["account"]>;

export async function withToken<T>(
  deps: ScheduleDeps,
  userId: string,
  fn: (token: string, account: Account) => Promise<T>,
): Promise<T> {
  const { entities } = deps;
  const account = (await entities.account.query.byUser({ userId }).go({ limit: 1 })).data[0];
  if (!account) throw new Error("Account not found");
  const token = await decryptToken(deps.kms, userId, account.tokenEnc);
  try {
    return await fn(token, account);
  } catch (err) {
    if (err instanceof TecnofitUnauthorized) {
      await entities.account.patch({ userId, empresaId: account.empresaId }).set({ status: "reconnect" }).go();
    }
    throw err;
  }
}

function scheduleRequest(deps: ScheduleDeps, userId: string, scheduleId: string, spec: ScheduleSpec) {
  return {
    Name: scheduleId,
    GroupName: deps.group,
    ScheduleExpression: scheduleExpression(spec),
    ScheduleExpressionTimezone: TZ,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    Target: {
      Arn: deps.workerArn,
      RoleArn: deps.roleArn,
      RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 },
      Input: JSON.stringify({ userId, scheduleId, scheduledTime: "<aws.scheduler.scheduled-time>" }),
    },
    ...(spec.kind === "once" && { ActionAfterCompletion: "DELETE" as const }),
  };
}

export async function recreateSchedule(
  deps: ScheduleDeps,
  row: EntityItem<Entities["schedule"]>,
  state: "ENABLED" | "DISABLED" | null = null,
): Promise<boolean> {
  const spec = specOf(row);
  if (spec.kind === "once" && nextClass(spec, deps.now()) === null) return false;
  const request = {
    ...scheduleRequest(deps, row.userId, row.scheduleId, spec),
    State: state ?? (row.active ? ("ENABLED" as const) : ("DISABLED" as const)),
  };
  try {
    await deps.scheduler.send(new CreateScheduleCommand(request));
  } catch (err) {
    if ((err as { name?: string }).name !== "ConflictException") throw err;
    if (state) await deps.scheduler.send(new UpdateScheduleCommand(request));
  }
  return true;
}

export async function enableSchedule(deps: ScheduleDeps, row: EntityItem<Entities["schedule"]>): Promise<void> {
  const spec = specOf(row);
  if (spec.kind === "once" && nextClass(spec, deps.now()) === null) return;
  try {
    await deps.scheduler.send(
      new UpdateScheduleCommand({
        ...scheduleRequest(deps, row.userId, row.scheduleId, spec),
        State: "ENABLED",
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
  }
}

export async function addSchedule(deps: ScheduleDeps, input: AddScheduleInput): Promise<string> {
  const { entities, scheduler } = deps;
  const { userId, className, allowWaitingList, refDate, ...spec } = input;
  if (spec.kind === "once" && nextClass(spec, deps.now()) === null) throw new TooLate();
  const empresaId = await withToken(deps, userId, async (token, account) => {
    const found = (await listEvents(token, Number(account.empresaId), refDate)).some(
      (e) => e.name === className && e.start === `${refDate} ${spec.startTime}`,
    );
    if (!found) throw new ClassNotFound();
    return account.empresaId;
  });

  const scheduleId = `s_${randomUUID()}`;
  await entities.schedule
    .create({
      userId,
      scheduleId,
      empresaId,
      className,
      startTime: spec.startTime,
      kind: spec.kind,
      ...(spec.kind === "weekly" ? { weekdays: spec.weekdays } : { date: spec.date }),
      allowWaitingList,
      active: true,
    })
    .go();

  try {
    await scheduler.send(new CreateScheduleCommand(scheduleRequest(deps, userId, scheduleId, spec)));
  } catch (err) {
    await entities.schedule.delete({ userId, scheduleId }).go();
    throw err;
  }
  return scheduleId;
}

export async function listClasses(deps: ScheduleDeps, userId: string, date: string) {
  const events = await withToken(deps, userId, (token, account) => listEvents(token, Number(account.empresaId), date));
  return events
    .filter((e) => e.start.startsWith(`${date} `))
    .map((e) => ({ name: e.name, time: e.start.slice(11), count: e.count, capacity: e.capacity }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export async function updateSchedule(
  deps: ScheduleDeps,
  userId: string,
  scheduleId: string,
  patch: { active?: boolean; allowWaitingList?: boolean; pausedBySuspension?: boolean },
): Promise<void> {
  const { entities } = deps;
  const { data: current } = await entities.schedule.get({ userId, scheduleId }).go();
  if (!current) throw new ScheduleNotFound();
  const spec = specOf(current);
  if (patch.active === true && spec.kind === "once" && nextClass(spec, deps.now()) === null)
    throw new ScheduleFinished();
  await entities.schedule.patch({ userId, scheduleId }).set(patch).go();
  if (patch.active === undefined || patch.active === current.active) return;
  try {
    await deps.scheduler.send(
      new UpdateScheduleCommand({
        ...scheduleRequest(deps, userId, scheduleId, spec),
        State: patch.active ? "ENABLED" : "DISABLED",
      }),
    );
  } catch (err) {
    await entities.schedule
      .patch({ userId, scheduleId })
      .set({
        active: current.active,
        allowWaitingList: current.allowWaitingList,
        pausedBySuspension: current.pausedBySuspension ?? false,
      })
      .go();
    if ((err as { name?: string }).name === "ResourceNotFoundException") throw new ScheduleFinished();
    throw err;
  }
}

export async function dropSchedule(deps: ScheduleDeps, userId: string, scheduleId: string): Promise<void> {
  try {
    await deps.scheduler.send(new DeleteScheduleCommand({ Name: scheduleId, GroupName: deps.group }));
  } catch (err) {
    if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
  }
  await deps.entities.schedule.delete({ userId, scheduleId }).go();
}

export async function removeSchedule(deps: ScheduleDeps, userId: string, scheduleId: string): Promise<void> {
  const { data } = await deps.entities.schedule.get({ userId, scheduleId }).go();
  if (!data) throw new ScheduleNotFound();
  await dropSchedule(deps, userId, scheduleId);
}

export async function listSchedules(entities: Entities, userId: string) {
  return (await entities.schedule.query.byUser({ userId }).go({ pages: "all" })).data;
}

export async function listExecutions(entities: Entities, userId: string, cursor?: string) {
  try {
    const { data, cursor: next } = await entities.execution.query
      .byUser({ userId })
      .go({ order: "desc", limit: 20, cursor });
    return { items: data, cursor: next };
  } catch (err) {
    if ((err as { code?: number }).code === 4001) throw new InvalidCursor();
    throw err;
  }
}

export async function listExecutionsByDate(entities: Entities, date: string) {
  return (await entities.execution.query.byDate({ classDate: date }).go({ pages: "all" })).data;
}
