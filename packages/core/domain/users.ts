import type { Entities } from "../db/entities.js";
import { dropSchedule, listSchedules, ScheduleFinished, updateSchedule, type ScheduleDeps } from "./schedules.js";

export class UserNotFound extends Error {
  constructor() {
    super("User not found");
    this.name = "UserNotFound";
  }
}

const assertDeleted = ({ unprocessed }: { unprocessed: unknown[] }) => {
  if (unprocessed.length > 0) throw new Error("Batch delete left unprocessed items");
};

export async function deleteUser(
  deps: ScheduleDeps,
  userId: string,
): Promise<void> {
  const { entities } = deps;
  const schedules = (
    await entities.schedule.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  await Promise.all(
    schedules.map(({ scheduleId }) => dropSchedule(deps, userId, scheduleId)),
  );

  const executions = (
    await entities.execution.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  assertDeleted(
    await entities.execution
      .delete(
        executions.map(({ scheduleId, classDate }) => ({
          scheduleId,
          classDate,
        })),
      )
      .go(),
  );

  const accounts = (
    await entities.account.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  assertDeleted(
    await entities.account
      .delete(accounts.map(({ empresaId }) => ({ userId, empresaId })))
      .go(),
  );

  await entities.profile.delete({ userId }).go();

  await revokeUserSessions(entities, userId);
}

export async function revokeUserSessions(entities: Entities, userId: string): Promise<void> {
  const sessions = (await entities.session.query.byUser({ userId }).go({ pages: "all" })).data;
  assertDeleted(await entities.session.delete(sessions.map(({ sessionId }) => ({ sessionId }))).go());
}

async function requireProfile(entities: Entities, userId: string) {
  const { data } = await entities.profile.get({ userId }).go();
  if (!data) throw new UserNotFound();
}

export async function suspendUser(deps: ScheduleDeps, userId: string): Promise<void> {
  const { entities } = deps;
  await requireProfile(entities, userId);
  await entities.profile.patch({ userId }).set({ status: "suspended" }).go();
  await revokeUserSessions(entities, userId);
  const schedules = await listSchedules(entities, userId);
  for (const { scheduleId, active } of schedules) {
    if (!active) continue;
    try {
      await updateSchedule(deps, userId, scheduleId, { active: false, pausedBySuspension: true });
    } catch (err) {
      if (!(err instanceof ScheduleFinished)) throw err;
    }
  }
}

export async function reactivateUser(deps: ScheduleDeps, userId: string): Promise<void> {
  const { entities } = deps;
  await requireProfile(entities, userId);
  await entities.profile.patch({ userId }).set({ status: "active" }).go();
  const schedules = await listSchedules(entities, userId);
  for (const { scheduleId, pausedBySuspension } of schedules) {
    if (pausedBySuspension !== true) continue;
    try {
      await updateSchedule(deps, userId, scheduleId, { active: true, pausedBySuspension: false });
    } catch (err) {
      if (!(err instanceof ScheduleFinished)) throw err;
      await entities.schedule.patch({ userId, scheduleId }).set({ pausedBySuspension: false }).go();
    }
  }
}
