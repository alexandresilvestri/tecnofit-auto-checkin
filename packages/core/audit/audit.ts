import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";
import { z } from "zod";
import type { Entities } from "../db/entities.js";
import { zonedParts } from "../domain/time.js";

export const AUDIT_ACTIONS = [
  "invite.created",
  "invite.redeemed",
  "invite.redeem_failed",
  "invite.burned",
  "user.login",
  "user.login_failed",
  "user.login_locked",
  "user.logout",
  "schedule.created",
  "schedule.updated",
  "schedule.deleted",
  "user.self_deleted",
  "admin.login",
  "invite.revoked",
  "user.suspended",
  "user.reactivated",
  "user.sessions_revoked",
  "user.deleted",
  "audit.exported",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const metadataSchema = z
  .strictObject({
    consentVersion: z.string().optional(),
    reason: z.string().optional(),
    label: z.string().optional(),
    filter: z.string().max(500).optional(),
  })
  .optional();

const TTL_SECONDS = 365 * 86400;

export async function writeAudit(
  entities: Entities,
  event: {
    actorType: "user" | "anonymous" | "system" | "cli" | "admin";
    actorId: string;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    result: "success" | "denied" | "error";
    ip?: string;
    userAgent?: string;
    metadata?: z.infer<typeof metadataSchema>;
  },
  now: number,
): Promise<void> {
  const metadata = metadataSchema.parse(event.metadata);
  const at = new Date(now);
  await entities.audit
    .create({
      ...event,
      metadata,
      at: at.toISOString(),
      day: zonedParts(at).date,
      eventId: randomUUID(),
      ttl: Math.floor(now / 1000) + TTL_SECONDS,
    })
    .go();
}

export class InvalidAuditPeriod extends Error {
  constructor() {
    super("Invalid audit period");
    this.name = "InvalidAuditPeriod";
  }
}

const MAX_DAYS = 31;
const MAX_ITEMS = 1000;
const DAY_MS = 86400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayStart = (day: string) => new Date(`${day}T00:00:00-03:00`);

export type AuditItem = EntityItem<Entities["audit"]>;

export async function queryAudit(
  entities: Entities,
  input: { from: string; to: string; actor?: string; target?: string; action?: string },
): Promise<{ items: AuditItem[]; truncated: boolean }> {
  const { from, to, actor, target, action } = input;
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(dayStart(from).getTime()) || Number.isNaN(dayStart(to).getTime()))
    throw new InvalidAuditPeriod();
  const days = Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS) + 1;
  if (days < 1 || days > MAX_DAYS) throw new InvalidAuditPeriod();
  const start = dayStart(from).toISOString();
  const end = new Date(dayStart(to).getTime() + DAY_MS - 1).toISOString();

  let rows: AuditItem[];
  if (actor) {
    rows = (
      await entities.audit.query
        .byActor({ actorId: actor })
        .between({ at: start }, { at: end })
        .go({ pages: "all", order: "desc" })
    ).data;
  } else if (target) {
    rows = (
      await entities.audit.query
        .byTarget({ targetId: target })
        .between({ at: start }, { at: end })
        .go({ pages: "all", order: "desc" })
    ).data;
  } else {
    rows = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(dayStart(from).getTime() + i * DAY_MS + 12 * 3600_000).toISOString().slice(0, 10);
      rows.push(...(await entities.audit.query.byDay({ day }).go({ pages: "all", order: "desc" })).data);
    }
  }
  const matching = action ? rows.filter((r) => r.action === action) : rows;
  return { items: matching.slice(0, MAX_ITEMS), truncated: matching.length > MAX_ITEMS };
}

const HEADER = ["at", "actorType", "actorId", "action", "targetType", "targetId", "result", "ip", "userAgent", "metadata"] as const;

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function auditCsv(items: AuditItem[]): string {
  return [HEADER.join(","), ...items.map((item) => HEADER.map((key) => cell(item[key])).join(","))].join("\r\n");
}
