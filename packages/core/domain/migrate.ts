import { writeAudit } from "../audit/audit.js";
import { decryptToken, encryptToken } from "../crypto/token.js";
import { enableSchedule, listSchedules, recreateSchedule, type ScheduleDeps } from "./schedules.js";
import { deleteUser } from "./users.js";

export type MigrateDeps = ScheduleDeps & { keyId: string };

const assertWritten = ({ unprocessed }: { unprocessed: unknown[] }) => {
  if (unprocessed.length > 0) throw new Error("Batch write left unprocessed items");
};

export async function migrateUser(from: MigrateDeps, to: MigrateDeps, userId: string, now: number): Promise<void> {
  const { data: existing } = await to.entities.profile.get({ userId }).go();
  if (!existing) {
    const { data: profile } = await from.entities.profile.get({ userId }).go();
    if (!profile) throw new Error("User not found in source");

    const accounts = (await from.entities.account.query.byUser({ userId }).go({ pages: "all" })).data;
    for (const account of accounts) {
      const token = await decryptToken(from.kms, userId, account.tokenEnc);
      const tokenEnc = await encryptToken(to.kms, to.keyId, userId, token);
      await to.entities.account.put({ ...account, tokenEnc }).go();
    }

    const schedules = await listSchedules(from.entities, userId);
    for (const row of schedules) {
      await to.entities.schedule.put(row).go();
      await recreateSchedule(to, row, "DISABLED");
    }

    const executions = (await from.entities.execution.query.byUser({ userId }).go({ pages: "all" })).data;
    if (executions.length > 0) assertWritten(await to.entities.execution.put(executions).go());

    await writeAudit(
      to.entities,
      { actorType: "cli", actorId: "cli", action: "user.migrated", targetType: "user", targetId: userId, result: "success" },
      now,
    );
    await to.entities.profile.put(profile).go();
  }
  if ((await from.entities.profile.get({ userId }).go()).data) {
    for (const row of await listSchedules(to.entities, userId)) if (row.active) await enableSchedule(to, row);
  }
  await deleteUser(from, userId);
}
