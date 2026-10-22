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

  const matching: AuditItem[] = [];
  const keep = (r: AuditItem) => (!action || r.action === action) && (!actor || !target || r.targetId === target);
  const collect = async (page: (cursor?: string) => Promise<{ data: AuditItem[]; cursor: string | null }>) => {
    let cursor: string | null | undefined;
    do {
      const res = await page(cursor ?? undefined);
      matching.push(...res.data.filter(keep));
      cursor = res.cursor;
    } while (cursor && matching.length <= MAX_ITEMS);
  };
  const options = (cursor?: string) => ({ order: "desc" as const, limit: MAX_ITEMS + 1, cursor });

  if (actor) {
    await collect((cursor) =>
      entities.audit.query.byActor({ actorId: actor }).between({ at: start }, { at: end }).go(options(cursor)),
    );
  } else if (target) {
    await collect((cursor) =>
      entities.audit.query.byTarget({ targetId: target }).between({ at: start }, { at: end }).go(options(cursor)),
    );
  } else {
    for (let i = 0; i < days && matching.length <= MAX_ITEMS; i++) {
      const day = new Date(dayStart(from).getTime() + (days - 1 - i) * DAY_MS + 12 * 3600_000).toISOString().slice(0, 10);
      await collect((cursor) => entities.audit.query.byDay({ day }).go(options(cursor)));
    }
  }
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
