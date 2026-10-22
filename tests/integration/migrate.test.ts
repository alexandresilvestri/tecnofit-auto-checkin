import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  CreateScheduleCommand,
  CreateScheduleGroupCommand,
  GetScheduleCommand,
  SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "../../packages/core/crypto/token.js";
import { createEntities, type Entities } from "../../packages/core/db/entities.js";
import { migrateUser, type MigrateDeps } from "../../packages/core/domain/migrate.js";
import { scheduleExpression } from "../../packages/core/domain/time.js";
import { listSchedules, recreateSchedule } from "../../packages/core/domain/schedules.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  awsConfig,
  createAuditTable,
  createKey,
  createMainTable,
  resetMoto,
} from "./setup/aws.js";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const PLAINTEXT = "tecnofit-secret-token";
const kms = new KMSClient(awsConfig);
const scheduler = new SchedulerClient(awsConfig);
let from: MigrateDeps;
let to: MigrateDeps;
let devKey: string;
let prodKey: string;

const mk = (e: Entities, keyId: string, env: string): MigrateDeps => ({
  entities: e,
  kms,
  scheduler,
  keyId,
  group: `checkin-${env}`,
  workerArn: `arn:aws:lambda:sa-east-1:940482447658:function:checkin-${env}-worker`,
  roleArn: `arn:aws:iam::940482447658:role/checkin-${env}-scheduler`,
  now: () => NOW,
});

const inScheduler = async (d: MigrateDeps, name: string) => {
  try {
    await scheduler.send(new GetScheduleCommand({ Name: name, GroupName: d.group }));
    return true;
  } catch {
    return false;
  }
};

const seed = async (userId: string) => {
  const e = from.entities;
  await e.profile
    .create({
      userId,
      name: "Fulano",
      tecnofitEmail: `${userId}@example.com`,
      tecnofitUserId: 1,
      status: "active",
      createdAt: new Date(NOW).toISOString(),
    })
    .go();
  await e.account
    .create({
      userId,
      empresaId: "161322",
      tokenEnc: await encryptToken(kms, devKey, userId, PLAINTEXT),
      tokenExp: 1900000000,
      boxName: "BOX",
      status: "ok",
    })
    .go();
  const base = { userId, empresaId: "161322", className: "WOD", startTime: "17:15", allowWaitingList: true };
  const rows = [
    { ...base, scheduleId: `${userId}_on`, kind: "weekly" as const, weekdays: [1], active: true },
    { ...base, scheduleId: `${userId}_off`, kind: "weekly" as const, weekdays: [2], active: false },
    { ...base, scheduleId: `${userId}_old`, kind: "once" as const, date: "2026-10-01", active: true },
    { ...base, scheduleId: `${userId}_new`, kind: "once" as const, date: "2026-12-01", active: true },
  ];
  for (const r of rows) {
    await e.schedule.create(r).go();
    if (r.scheduleId.endsWith("_old")) continue;
    await scheduler.send(
      new CreateScheduleCommand({
        Name: r.scheduleId,
        GroupName: from.group,
        ScheduleExpression: scheduleExpression(
          r.kind === "weekly"
            ? { kind: "weekly", startTime: r.startTime, weekdays: r.weekdays }
            : { kind: "once", startTime: r.startTime, date: r.date },
        ),
        ScheduleExpressionTimezone: "America/Sao_Paulo",
        FlexibleTimeWindow: { Mode: "OFF" },
        Target: { Arn: from.workerArn, RoleArn: from.roleArn, Input: "{}" },
      }),
    );
  }
  await e.execution
    .create({
      scheduleId: `${userId}_on`,
      classDate: "2026-10-12",
      userId,
      status: "success",
      attempts: 1,
      ttl: 1900000000,
    })
    .go();
};

beforeAll(async () => {
  await resetMoto();
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig));
  const dev = createEntities(doc, {
    main: await createMainTable("dev-main"),
    audit: await createAuditTable("dev-audit"),
  });
  const prod = createEntities(doc, {
    main: await createMainTable("prod-main"),
    audit: await createAuditTable("prod-audit"),
  });
  devKey = await createKey(kms);
  prodKey = await createKey(kms);
  await scheduler.send(new CreateScheduleGroupCommand({ Name: "checkin-dev" }));
  await scheduler.send(new CreateScheduleGroupCommand({ Name: "checkin-prod" }));
  from = mk(dev, devKey, "dev");
  to = mk(prod, prodKey, "prod");
});

describe("migrateUser", () => {
  it("moves a user to prod and empties dev", async () => {
    await seed("u_a");
    await migrateUser(from, to, "u_a", NOW);

    const account = (await to.entities.account.query.byUser({ userId: "u_a" }).go()).data[0]!;
    expect(await decryptToken(kms, "u_a", account.tokenEnc)).toBe(PLAINTEXT);
    const blob = Buffer.from(account.tokenEnc, "base64");
    const dec = (KeyId: string, userId: string) =>
      kms.send(new DecryptCommand({ CiphertextBlob: blob, KeyId, EncryptionContext: { userId } }));
    expect(Buffer.from((await dec(prodKey, "u_a")).Plaintext!).toString()).toBe(PLAINTEXT);
    await expect(dec(devKey, "u_a")).rejects.toThrow();
    await expect(dec(prodKey, "u_other")).rejects.toThrow();

    expect((await to.entities.profile.get({ userId: "u_a" }).go()).data?.name).toBe("Fulano");
    expect((await listSchedules(to.entities, "u_a")).map((s) => s.scheduleId).sort()).toEqual([
      "u_a_new",
      "u_a_off",
      "u_a_old",
      "u_a_on",
    ]);

    const on = await scheduler.send(new GetScheduleCommand({ Name: "u_a_on", GroupName: "checkin-prod" }));
    const off = await scheduler.send(new GetScheduleCommand({ Name: "u_a_off", GroupName: "checkin-prod" }));
    expect(on.State).toBe("ENABLED");
    expect(off.State).toBe("DISABLED");
    expect(await inScheduler(to, "u_a_new")).toBe(true);
    expect(await inScheduler(to, "u_a_old")).toBe(false);

    expect((await to.entities.execution.query.byUser({ userId: "u_a" }).go()).data).toHaveLength(1);

    const audits = await to.entities.audit.query.byDay({ day: "2026-10-19" }).go({ pages: "all" });
    expect(audits.data.filter((a) => a.targetId === "u_a").map((a) => a.action)).toEqual(["user.migrated"]);

    expect((await from.entities.profile.get({ userId: "u_a" }).go()).data).toBeNull();
    expect(await listSchedules(from.entities, "u_a")).toEqual([]);
    expect((await from.entities.account.query.byUser({ userId: "u_a" }).go()).data).toEqual([]);
    expect((await from.entities.execution.query.byUser({ userId: "u_a" }).go()).data).toEqual([]);
    for (const id of ["u_a_on", "u_a_off", "u_a_new"]) expect(await inScheduler(from, id)).toBe(false);
  });

  it("finishes dev cleanup when prod profile already exists without duplicating", async () => {
    await seed("u_b");
    await migrateUser(from, to, "u_b", NOW);
    await seed("u_b");
    await migrateUser(from, to, "u_b", NOW);

    expect(await listSchedules(to.entities, "u_b")).toHaveLength(4);
    expect((await to.entities.execution.query.byUser({ userId: "u_b" }).go()).data).toHaveLength(1);
    expect((await from.entities.profile.get({ userId: "u_b" }).go()).data).toBeNull();
    expect(await listSchedules(from.entities, "u_b")).toEqual([]);
  });

  const stateOf = async (id: string) =>
    (await scheduler.send(new GetScheduleCommand({ Name: id, GroupName: "checkin-prod" }))).State;

  it("resumes when prod has account and schedules but no profile", async () => {
    await seed("u_c");
    const [acc] = (await from.entities.account.query.byUser({ userId: "u_c" }).go()).data;
    await to.entities.account.put({ ...acc!, tokenEnc: await encryptToken(kms, prodKey, "u_c", PLAINTEXT) }).go();
    const [first] = await listSchedules(from.entities, "u_c");
    await to.entities.schedule.put(first!).go();
    await recreateSchedule(to, first!);

    await migrateUser(from, to, "u_c", NOW);

    expect(await listSchedules(to.entities, "u_c")).toHaveLength(4);
    expect((await to.entities.account.query.byUser({ userId: "u_c" }).go()).data).toHaveLength(1);
    expect((await to.entities.execution.query.byUser({ userId: "u_c" }).go()).data).toHaveLength(1);
    expect(await stateOf("u_c_on")).toBe("ENABLED");
    expect(await stateOf("u_c_new")).toBe("ENABLED");
    expect(await stateOf("u_c_off")).toBe("DISABLED");
    expect((await from.entities.profile.get({ userId: "u_c" }).go()).data).toBeNull();
    expect(await listSchedules(from.entities, "u_c")).toEqual([]);
  });

  it("enables prod schedules and cleans dev when prod profile exists but dev remains", async () => {
    await seed("u_d");
    const del = from.scheduler.send.bind(from.scheduler);
    const spy = vi.spyOn(from.scheduler, "send").mockImplementation(((cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === "DeleteScheduleCommand") return Promise.reject(new Error("boom"));
      return del(cmd as never);
    }) as never);
    await expect(migrateUser(from, to, "u_d", NOW)).rejects.toThrow("boom");
    spy.mockRestore();
    expect((await from.entities.profile.get({ userId: "u_d" }).go()).data).not.toBeNull();
    expect(await stateOf("u_d_on")).toBe("ENABLED");

    await migrateUser(from, to, "u_d", NOW);

    expect(await stateOf("u_d_on")).toBe("ENABLED");
    expect(await listSchedules(to.entities, "u_d")).toHaveLength(4);
    expect((await from.entities.profile.get({ userId: "u_d" }).go()).data).toBeNull();
    expect(await listSchedules(from.entities, "u_d")).toEqual([]);
  });

  it("leaves no prod schedule enabled and dev intact when the copy fails", async () => {
    await seed("u_e");
    const spy = vi.spyOn(to.entities.execution, "put").mockImplementationOnce((() => {
      throw new Error("copy failed");
    }) as never);
    await expect(migrateUser(from, to, "u_e", NOW)).rejects.toThrow("copy failed");
    spy.mockRestore();

    expect(await stateOf("u_e_on")).toBe("DISABLED");
    expect(await stateOf("u_e_new")).toBe("DISABLED");
    expect((await to.entities.profile.get({ userId: "u_e" }).go()).data).toBeNull();
    expect((await from.entities.profile.get({ userId: "u_e" }).go()).data).not.toBeNull();
    expect(await listSchedules(from.entities, "u_e")).toHaveLength(4);
    expect(await inScheduler(from, "u_e_on")).toBe(true);

    await migrateUser(from, to, "u_e", NOW);
    expect(await stateOf("u_e_on")).toBe("ENABLED");
    expect(await listSchedules(from.entities, "u_e")).toEqual([]);
  });
});
