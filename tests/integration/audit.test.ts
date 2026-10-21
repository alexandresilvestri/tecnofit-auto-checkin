import { beforeAll, expect, it } from "vitest";
import type { Entities } from "../../packages/core/db/entities.js";
import { writeAudit } from "../../packages/core/audit/audit.js";
import { createTestEntities, resetMoto } from "./setup/aws.js";

const NOW = Date.UTC(2026, 1, 2, 15, 0, 0);
let e: Entities;

beforeAll(async () => {
  await resetMoto();
  e = await createTestEntities();
});

it("writes an event queryable by day, actor and target", async () => {
  await writeAudit(
    e,
    {
      actorType: "user",
      actorId: "u_1",
      action: "invite.redeemed",
      targetType: "invite",
      targetId: "h_1",
      result: "success",
      ip: "1.2.3.4",
      metadata: { consentVersion: "v1" },
    },
    NOW,
  );
  const day = await e.audit.query.byDay({ day: "2026-02-02" }).go();
  expect(day.data).toHaveLength(1);
  expect(day.data[0]).toMatchObject({
    action: "invite.redeemed",
    metadata: { consentVersion: "v1" },
    ttl: NOW / 1000 + 365 * 86400,
  });
  expect((await e.audit.query.byActor({ actorId: "u_1" }).go()).data).toHaveLength(1);
  expect((await e.audit.query.byTarget({ targetId: "h_1" }).go()).data).toHaveLength(1);
});

it("rejects forbidden metadata keys before writing", async () => {
  await expect(
    writeAudit(
      e,
      {
        actorType: "anonymous",
        actorId: "a_1",
        action: "user.login_failed",
        result: "denied",
        metadata: { password: "x" } as never,
      },
      NOW,
    ),
  ).rejects.toThrow();
  expect((await e.audit.query.byActor({ actorId: "a_1" }).go()).data).toHaveLength(0);
});
