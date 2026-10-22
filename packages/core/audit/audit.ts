import { randomUUID } from "node:crypto";
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
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const metadataSchema = z
  .strictObject({
    consentVersion: z.string().optional(),
    reason: z.string().optional(),
    label: z.string().optional(),
  })
  .optional();

const TTL_SECONDS = 365 * 86400;

export async function writeAudit(
  entities: Entities,
  event: {
    actorType: "user" | "anonymous" | "system" | "cli";
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
