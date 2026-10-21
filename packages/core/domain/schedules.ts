import { randomUUID } from "node:crypto";
import type { KMSClient } from "@aws-sdk/client-kms";
import { CreateScheduleCommand, DeleteScheduleCommand, type SchedulerClient } from "@aws-sdk/client-scheduler";
import { decryptToken } from "../crypto/token.js";
import type { Entities } from "../db/entities.js";
import { listEvents } from "../tecnofit/client.js";
import { scheduleExpression, TZ, type ScheduleSpec } from "./time.js";

export type ScheduleDeps = {
  entities: Entities;
  kms: KMSClient;
  scheduler: SchedulerClient;
  group: string;
  workerArn: string;
  roleArn: string;
};

export type AddScheduleInput = {
  userId: string;
  empresaId: number;
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

export async function addSchedule(deps: ScheduleDeps, input: AddScheduleInput): Promise<string> {
  const { entities, scheduler } = deps;
  const { userId, empresaId, className, allowWaitingList, refDate, ...spec } = input;
  const { data: account } = await entities.account.get({ userId, empresaId: String(empresaId) }).go();
  if (!account) throw new Error("Account not found");
  const token = await decryptToken(deps.kms, userId, account.tokenEnc);
  const found = (await listEvents(token, empresaId, refDate)).some(
    (e) => e.name === className && e.start === `${refDate} ${spec.startTime}`,
  );
  if (!found) throw new ClassNotFound();

  const scheduleId = `s_${randomUUID()}`;
  await entities.schedule
    .create({
      userId,
      scheduleId,
      empresaId: String(empresaId),
      className,
      startTime: spec.startTime,
      kind: spec.kind,
      ...(spec.kind === "weekly" ? { weekdays: spec.weekdays } : { date: spec.date }),
      allowWaitingList,
      active: true,
    })
    .go();

  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: scheduleId,
        GroupName: deps.group,
        ScheduleExpression: scheduleExpression(spec),
        ScheduleExpressionTimezone: TZ,
        FlexibleTimeWindow: { Mode: "OFF" },
        Target: {
          Arn: deps.workerArn,
          RoleArn: deps.roleArn,
          RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 },
          Input: JSON.stringify({ userId, scheduleId, scheduledTime: "<aws.scheduler.scheduled-time>" }),
        },
        ...(spec.kind === "once" && { ActionAfterCompletion: "DELETE" as const }),
      }),
    );
  } catch (err) {
    await entities.schedule.delete({ userId, scheduleId }).go();
    throw err;
  }
  return scheduleId;
}

export async function removeSchedule(deps: ScheduleDeps, userId: string, scheduleId: string): Promise<void> {
  const { data } = await deps.entities.schedule.get({ userId, scheduleId }).go();
  if (!data) throw new Error("Schedule not found");
  try {
    await deps.scheduler.send(new DeleteScheduleCommand({ Name: scheduleId, GroupName: deps.group }));
  } catch (err) {
    if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
  }
  await deps.entities.schedule.delete({ userId, scheduleId }).go();
}

export async function listSchedules(entities: Entities, userId: string) {
  return (await entities.schedule.query.byUser({ userId }).go({ pages: "all" })).data;
}
