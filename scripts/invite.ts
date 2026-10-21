import { parseArgs } from "node:util";
import { createInvite } from "@checkin/core/domain/invites";
import { TZ, zonedParts } from "@checkin/core/domain/time";
import { loadEnv } from "./env.js";

const USAGE = `Usage:
  invite [--label <text>]`;

let label: string | undefined;
try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { label: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help || positionals.length) throw new Error("usage");
  label = values.label;
} catch {
  console.error(USAGE);
  process.exit(1);
}

const env = await loadEnv();
const base = await env.webUrl();
const { token, expiresAt } = await createInvite({ ...env, now: Date.now }, { label, createdBy: "cli" });
const { date, time } = zonedParts(new Date(expiresAt));
console.log(`${base}/convite#${token}`);
console.log(`Expires ${date} ${time} (${TZ})`);
