import { parseArgs } from "node:util";
import { migrateUser } from "@checkin/core/domain/migrate";
import { listSchedules } from "@checkin/core/domain/schedules";
import { loadEnv } from "./env.js";

const USAGE = `Usage:
  migrate [--apply]`;

let apply = false;
try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { apply: { type: "boolean" } },
    allowPositionals: true,
  });
  if (positionals.length) throw new Error("usage");
  apply = values.apply ?? false;
} catch {
  console.error(USAGE);
  process.exit(1);
}

const [dev, prod] = await Promise.all([loadEnv("dev"), loadEnv("prod")]);
const users = (await dev.entities.profile.query.byCreated({}).go({ pages: "all" })).data;

let schedulesTotal = 0;
let executionsTotal = 0;
const failures: string[] = [];
let migrated = 0;

for (const { userId, name } of users) {
  const schedules = (await listSchedules(dev.entities, userId)).length;
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
