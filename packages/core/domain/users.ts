import { removeSchedule, type ScheduleDeps } from "./schedules.js";

export async function deleteUser(
  deps: ScheduleDeps,
  userId: string,
): Promise<void> {
  const { entities } = deps;
  const schedules = (
    await entities.schedule.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  for (const { scheduleId } of schedules)
    await removeSchedule(deps, userId, scheduleId);

  const executions = (
    await entities.execution.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  await entities.execution
    .delete(
      executions.map(({ scheduleId, classDate }) => ({
        scheduleId,
        classDate,
      })),
    )
    .go();

  const accounts = (
    await entities.account.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  await entities.account
    .delete(accounts.map(({ empresaId }) => ({ userId, empresaId })))
    .go();

  await entities.profile.delete({ userId }).go();

  const sessions = (
    await entities.session.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  await entities.session
    .delete(sessions.map(({ sessionId }) => ({ sessionId })))
    .go();
}
