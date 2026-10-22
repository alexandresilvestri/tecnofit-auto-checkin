import { migrateUser } from "@checkin/core/domain/migrate";
import { loadEnv } from "./env.js";

const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some((a) => a !== "--apply")) {
  console.error("Usage:\n  migrate [--apply]");
  process.exit(1);
}

const [dev, prod] = await Promise.all([loadEnv("dev"), loadEnv("prod")]);
const users = (await dev.entities.profile.query.byCreated({}).go({ pages: "all" })).data;

let schedulesTotal = 0;
let executionsTotal = 0;
const failures: string[] = [];
let migrated = 0;

for (const { userId, name } of users) {
  const schedules = (await dev.entities.schedule.query.byUser({ userId }).go({ pages: "all" })).data.length;
  const executions = (await dev.entities.execution.query.byUser({ userId }).go({ pages: "all" })).data.length;
  schedulesTotal += schedules;
  executionsTotal += executions;
  console.log(`${userId}  ${name}  schedules=${schedules}  executions=${executions}`);
  if (!apply) continue;
  try {
    await migrateUser({ ...dev, now: Date.now }, { ...prod, now: Date.now }, userId, Date.now());
    migrated++;
  } catch (err) {
    failures.push(userId);
    console.error(`FAILED ${userId}: ${(err as Error).name}`);
  }
}

console.log(`${apply ? "Migrated" : "Would migrate"} ${apply ? migrated : users.length}/${users.length} users, ${schedulesTotal} schedules, ${executionsTotal} executions`);
if (failures.length) {
  console.error(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
