import { parseArgs } from "node:util";
import { decryptToken } from "@checkin/core/crypto/token";
import { addSchedule, ClassNotFound, listSchedules, removeSchedule, TooLate } from "@checkin/core/domain/schedules";
import { scheduleExpression, type ScheduleSpec } from "@checkin/core/domain/time";
import { listEvents } from "@checkin/core/tecnofit/client";
import { loadEnv } from "./env.js";

const USAGE = `Usage:
  schedule classes --user <u> --date YYYY-MM-DD
  schedule add --user <u> --class-name <name> --start HH:mm --date YYYY-MM-DD [--weekdays 1,3,5] [--waiting-list]
  schedule list --user <u>
  schedule remove --user <u> --schedule <s>`;

const REQUIRED: Record<string, string[]> = {
  classes: ["user", "date"],
  add: ["user", "class-name", "start", "date"],
  list: ["user"],
  remove: ["user", "schedule"],
};

const [command = "", ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    user: { type: "string" },
    date: { type: "string" },
    "class-name": { type: "string" },
    start: { type: "string" },
    weekdays: { type: "string" },
    "waiting-list": { type: "boolean" },
    schedule: { type: "string" },
  },
});
const required = REQUIRED[command];
if (!required || required.some((flag) => !values[flag as keyof typeof values])) {
  console.error(USAGE);
  process.exit(1);
}
const userId = values.user!;

const deps = { ...(await loadEnv()), now: Date.now };
const { entities, kms } = deps;

async function accountOf() {
  const account = (await entities.account.query.byUser({ userId }).go({ limit: 1 })).data[0];
  if (!account) {
    console.error(`No account for ${userId}`);
    process.exit(1);
  }
  return account;
}

if (command === "classes") {
  const account = await accountOf();
  const token = await decryptToken(kms, userId, account.tokenEnc);
  for (const e of await listEvents(token, Number(account.empresaId), values.date!)) {
    console.log(`${e.name} · ${e.start} · ${e.count}/${e.capacity}`);
  }
} else if (command === "add") {
  const startTime = values.start!;
  const date = values.date!;
  const spec: ScheduleSpec = values.weekdays
    ? { kind: "weekly", startTime, weekdays: values.weekdays.split(",").map(Number) }
    : { kind: "once", startTime, date };
  try {
    const scheduleId = await addSchedule(deps, {
      userId,
      className: values["class-name"]!,
      allowWaitingList: values["waiting-list"] ?? false,
      refDate: date,
      ...spec,
    });
    console.log(`${scheduleId} · ${scheduleExpression(spec)}`);
  } catch (err) {
    if (err instanceof TooLate) console.error("Check-in already open for that class");
    else if (err instanceof ClassNotFound) console.error("Class not found on that date and time");
    else throw err;
    process.exit(1);
  }
} else if (command === "list") {
  for (const s of await listSchedules(entities, userId)) {
    const when = s.kind === "weekly" ? (s.weekdays ?? []).join(",") : s.date;
    console.log(`${s.scheduleId} · ${s.className} · ${s.startTime} · ${when} · ${s.allowWaitingList ? "waitlist" : "no waitlist"}`);
  }
} else {
  await removeSchedule(deps, userId, values.schedule!);
  console.log("removed");
}
