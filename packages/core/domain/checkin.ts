import type { KMSClient } from "@aws-sdk/client-kms";
import { decryptToken } from "../crypto/token.js";
import { isConditionalFailure, type Entities, type ExecStatus } from "../db/entities.js";
import {
  checkIn,
  getEvent,
  listEvents,
  TecnofitInvalidResponse,
  TecnofitUnauthorized,
  type TecnofitEvent,
} from "../tecnofit/client.js";
import { classSlotFor } from "./time.js";

export type CheckinInput = { userId: string; scheduleId: string; scheduledTime: string };

export type CheckinDeps = {
  entities: Entities;
  kms: KMSClient;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

type Outcome = { status: ExecStatus; checkInId?: string; latencyMs?: number; error?: string };

const failed = (error: string): Outcome => ({ status: "failed", error });

export async function runCheckin(deps: CheckinDeps, input: CheckinInput): Promise<ExecStatus | "noop"> {
  const { entities, now } = deps;
  const { userId, scheduleId, scheduledTime } = input;
  const { data: schedule } = await entities.schedule.get({ userId, scheduleId }).go();
  if (!schedule?.active) return "noop";
  const [{ data: profile }, { data: account }] = await Promise.all([
    entities.profile.get({ userId }).go(),
    entities.account.get({ userId, empresaId: schedule.empresaId }).go(),
  ]);
  if (!profile || !account) return "noop";
  const { date: classDate, time } = classSlotFor(scheduledTime);
  const key = { scheduleId, classDate };

  const claim = async (status: "running" | "skipped") => {
    try {
      const ttl = Math.floor(now() / 1000) + 90 * 86400;
      await entities.execution.create({ ...key, userId, status, attempts: 0, ttl }).go();
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  };

  if (profile.status === "suspended" || account.status === "reconnect") {
    return (await claim("skipped")) ? "skipped" : "noop";
  }
  if (!(await claim("running"))) return "noop";

  let attempts = 0;

  const work = async (): Promise<Outcome> => {
    if (
      time !== schedule.startTime ||
      (schedule.kind === "once" && classDate !== schedule.date) ||
      (schedule.kind === "weekly" && !schedule.weekdays?.includes(new Date(classDate).getUTCDay()))
    ) {
      return failed("window_mismatch");
    }
    const token = await decryptToken(deps.kms, userId, account.tokenEnc);
    const empresaId = Number(schedule.empresaId);
    const deadline = now() + 90_000;
    let list: TecnofitEvent[] | undefined;
    while (!list) {
      try {
        list = await listEvents(token, empresaId, classDate);
      } catch (err) {
        if (err instanceof TecnofitUnauthorized || err instanceof TecnofitInvalidResponse) throw err;
        await deps.sleep(300 + deps.random() * 200);
        if (now() > deadline) return failed("timeout");
      }
    }
    const event = list.find((e) => e.name === schedule.className && e.start === `${classDate} ${schedule.startTime}`);
    if (!event) return failed("class_not_found");
    if (event.checkInId !== null) return { status: "success", checkInId: String(event.checkInId) };

    let waitingList = false;
    let lastDetail = -Infinity;
    while (now() <= deadline) {
      attempts++;
      try {
        const res = await checkIn(token, empresaId, classDate, event.classId, event.id, waitingList);
        return {
          status: res.waitingList ? "waitlisted" : "success",
          checkInId: String(res.id),
          latencyMs: now() - Date.parse(scheduledTime),
        };
      } catch (err) {
        if (err instanceof TecnofitUnauthorized) throw err;
      }
      if (now() - lastDetail >= 2000) {
        lastDetail = now();
        let detail;
        try {
          detail = await getEvent(token, empresaId, classDate, event.classId, event.id);
        } catch (err) {
          if (err instanceof TecnofitUnauthorized) throw err;
        }
        if (detail?.checkedIn) return { status: "success" };
        if (detail?.onTimeToCheckIn && detail.count >= detail.capacity) {
          if (!schedule.allowWaitingList) return failed("full");
          if (!waitingList) {
            waitingList = true;
            continue;
          }
        }
      }
      await deps.sleep(300 + deps.random() * 200);
    }
    return failed("timeout");
  };

  const finish = async (outcome: Outcome) => {
    await entities.execution.patch(key).set({ ...outcome, userId, attempts }).go();
    return outcome.status;
  };

  let outcome: Outcome;
  try {
    outcome = await work();
  } catch (err) {
    if (err instanceof TecnofitUnauthorized) {
      const status = await finish(failed("unauthorized"));
      await entities.account.patch({ userId, empresaId: schedule.empresaId }).set({ status: "reconnect" }).go();
      return status;
    }
    if (!(err instanceof TecnofitInvalidResponse)) {
      await finish(failed("unexpected"));
      throw err;
    }
    outcome = failed("invalid_response");
  }
  return finish(outcome);
}
