import { dropSchedule, type ScheduleDeps } from "./schedules.js";

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

  const sessions = (
    await entities.session.query.byUser({ userId }).go({ pages: "all" })
  ).data;
  assertDeleted(
    await entities.session
      .delete(sessions.map(({ sessionId }) => ({ sessionId })))
      .go(),
  );
}
