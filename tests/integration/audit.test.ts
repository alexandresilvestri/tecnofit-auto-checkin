import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createEntities } from "../../packages/core/db/entities.js";
import type { Entities } from "../../packages/core/db/entities.js";
import { auditCsv, InvalidAuditPeriod, queryAudit, writeAudit } from "../../packages/core/audit/audit.js";
import { awsConfig, createTestEntities, resetMoto } from "./setup/aws.js";

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

describe("queryAudit", () => {
  const at = (iso: string) => Date.parse(iso);
  const write = (iso: string, extra: Partial<Parameters<typeof writeAudit>[1]> = {}) =>
    writeAudit(
      e,
      { actorType: "admin", actorId: "adm_q", action: "user.suspended", targetType: "user", targetId: "u_q", result: "success", ...extra },
      at(iso),
    );

  beforeAll(async () => {
    await write("2026-03-10T02:30:00Z");
    await write("2026-03-10T15:00:00Z", { action: "user.reactivated" });
    await write("2026-03-12T15:00:00Z", { actorId: "adm_other", targetId: "u_other" });
    await write("2026-03-15T15:00:00Z", { actorId: "adm_far", targetId: "u_far" });
    await write("2026-03-13T15:00:00Z", { targetId: "u_mix" });
  });

  it("queries by day range, newest first, with São Paulo day boundaries", async () => {
    const { items, truncated } = await queryAudit(e, { from: "2026-03-10", to: "2026-03-12" });
    expect(truncated).toBe(false);
    expect(items.map((i) => i.at)).toEqual([
      "2026-03-12T15:00:00.000Z",
      "2026-03-10T15:00:00.000Z",
    ]);
    const day9 = await queryAudit(e, { from: "2026-03-09", to: "2026-03-09" });
    expect(day9.items.map((i) => i.at)).toEqual(["2026-03-10T02:30:00.000Z"]);
  });

  it("queries by actor and by target within the period", async () => {
    const byActor = await queryAudit(e, { from: "2026-03-09", to: "2026-03-11", actor: "adm_q" });
    expect(byActor.items.map((i) => i.at)).toEqual(["2026-03-10T15:00:00.000Z", "2026-03-10T02:30:00.000Z"]);
    const byTarget = await queryAudit(e, { from: "2026-03-01", to: "2026-03-20", target: "u_far" });
    expect(byTarget.items).toHaveLength(1);
    const outside = await queryAudit(e, { from: "2026-03-01", to: "2026-03-11", target: "u_far" });
    expect(outside.items).toEqual([]);
  });

  it("applies actor and target together", async () => {
    const both = await queryAudit(e, { from: "2026-03-09", to: "2026-03-14", actor: "adm_q", target: "u_mix" });
    expect(both.items.map((i) => i.at)).toEqual(["2026-03-13T15:00:00.000Z"]);
    const none = await queryAudit(e, { from: "2026-03-09", to: "2026-03-14", actor: "adm_q", target: "u_far" });
    expect(none.items).toEqual([]);
  });

  it("filters by action", async () => {
    const { items } = await queryAudit(e, { from: "2026-03-09", to: "2026-03-12", action: "user.reactivated" });
    expect(items.map((i) => i.action)).toEqual(["user.reactivated"]);
    const actor = await queryAudit(e, { from: "2026-03-09", to: "2026-03-12", actor: "adm_q", action: "user.suspended" });
    expect(actor.items).toHaveLength(1);
  });

  it("caps at 1000 items and flags truncation", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => i);
    for (let i = 0; i < many.length; i += 25) {
      await Promise.all(
        many.slice(i, i + 25).map((n) => write(`2026-04-05T12:00:00.${String(n).padStart(3, "0")}Z`, { actorId: "adm_bulk", targetId: `u_${n}` })),
      );
    }
    const { items, truncated } = await queryAudit(e, { from: "2026-04-05", to: "2026-04-05" });
    expect(items).toHaveLength(1000);
    expect(truncated).toBe(true);
    expect(items[0].at > items[999].at).toBe(true);
    const exact = await queryAudit(e, { from: "2026-04-05", to: "2026-04-05", actor: "adm_bulk", action: "user.suspended" });
    expect(exact.items).toHaveLength(1000);
    expect(exact.truncated).toBe(true);
  }, 120_000);

  it("stops reading once more than 1000 items match", async () => {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig));
    const send = vi.spyOn(client, "send");
    const counted = createEntities(client, { main: "checkin-test-main", audit: "checkin-test-audit" });
    const { items, truncated } = await queryAudit(counted, { from: "2026-04-01", to: "2026-04-05" });
    expect(items).toHaveLength(1000);
    expect(truncated).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid or oversized periods", async () => {
    await expect(queryAudit(e, { from: "2026-03-01", to: "2026-04-01" })).rejects.toBeInstanceOf(InvalidAuditPeriod);
    await expect(queryAudit(e, { from: "2026-03-05", to: "2026-03-01" })).rejects.toBeInstanceOf(InvalidAuditPeriod);
    await expect(queryAudit(e, { from: "bad", to: "2026-03-01" })).rejects.toBeInstanceOf(InvalidAuditPeriod);
    await expect(queryAudit(e, { from: "2026-03-01", to: "2026-03-31" })).resolves.toBeDefined();
  });
});

describe("auditCsv", () => {
  const item = (over: Record<string, unknown>) =>
    ({
      at: "2026-03-10T15:00:00.000Z",
      actorType: "admin",
      actorId: "adm",
      action: "user.suspended",
      result: "success",
      ...over,
    }) as never;

  it("writes the header and quotes per RFC 4180", () => {
    const csv = auditCsv([
      item({ userAgent: 'a,"b"', ip: "1.1.1.1", metadata: { label: "x,y" }, targetId: "line1\nline2" }),
    ]);
    const [header, ...rest] = csv.split("\r\n");
    expect(header).toBe("at,actorType,actorId,action,targetType,targetId,result,ip,userAgent,metadata");
    expect(rest.join("\r\n")).toBe(
      '2026-03-10T15:00:00.000Z,admin,adm,user.suspended,,"line1\nline2",success,1.1.1.1,"a,""b""","{""label"":""x,y""}"',
    );
  });

  it("prefixes formula-looking cells", () => {
    const row = auditCsv([item({ actorId: "=SUM(A1)", ip: "+1", userAgent: "-2", targetId: "@x" })]).split("\r\n")[1];
    expect(row).toBe("2026-03-10T15:00:00.000Z,admin,'=SUM(A1),user.suspended,,'@x,success,'+1,'-2,");
  });

  it("returns only the header for no items", () => {
    expect(auditCsv([])).toBe("at,actorType,actorId,action,targetType,targetId,result,ip,userAgent,metadata");
  });
});
