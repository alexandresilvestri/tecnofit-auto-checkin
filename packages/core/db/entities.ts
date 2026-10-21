import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity, Service } from "electrodb";

const EXEC_STATUS = [
  "running",
  "success",
  "waitlisted",
  "failed",
  "skipped",
] as const;

export type ExecStatus = (typeof EXEC_STATUS)[number];

const service = "checkin";

export function isConditionalFailure(err: unknown): boolean {
  const e = err as { isElectroError?: boolean; cause?: { name?: string } };
  return (
    e?.isElectroError === true &&
    e.cause?.name === "ConditionalCheckFailedException"
  );
}

const INVITE_STATUS = [
  "pending",
  "used",
  "expired",
  "revoked",
  "burned",
] as const;
const ACTOR_TYPE = ["user", "anonymous", "system", "cli"] as const;
const AUDIT_RESULT = ["success", "denied", "error"] as const;

export function createEntities(
  client: DynamoDBDocumentClient,
  tables: { main: string; audit: string },
) {
  const table = tables.main;
  const profile = new Entity(
    {
      model: { entity: "profile", version: "1", service },
      attributes: {
        userId: { type: "string", required: true },
        name: { type: "string", required: true },
        tecnofitEmail: { type: "string", required: true },
        tecnofitUserId: { type: "number", required: true },
        status: { type: ["active", "suspended"] as const, required: true },
        createdAt: { type: "string", required: true },
      },
      indexes: {
        byUser: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["userId"],
            template: "USER#${userId}",
          },
          sk: {
            field: "SK",
            casing: "none",
            composite: [],
            template: "PROFILE",
          },
        },
        byEmail: {
          index: "GSI1",
          pk: {
            field: "GSI1PK",
            casing: "none",
            composite: ["tecnofitEmail"],
            template: "EMAIL#${tecnofitEmail}",
          },
          sk: {
            field: "GSI1SK",
            casing: "none",
            composite: [],
            template: "PROFILE",
          },
        },
        byCreated: {
          index: "GSI2",
          pk: {
            field: "GSI2PK",
            casing: "none",
            composite: [],
            template: "ENTITY#USER",
          },
          sk: {
            field: "GSI2SK",
            casing: "none",
            composite: ["createdAt"],
            template: "${createdAt}",
          },
        },
      },
    },
    { client, table },
  );

  const account = new Entity(
    {
      model: { entity: "account", version: "1", service },
      attributes: {
        userId: { type: "string", required: true },
        empresaId: { type: "string", required: true },
        tokenEnc: { type: "string", required: true },
        tokenExp: { type: "number", required: true },
        boxName: { type: "string", required: true },
        status: { type: ["ok", "reconnect"] as const, required: true },
      },
      indexes: {
        byUser: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["userId"],
            template: "USER#${userId}",
          },
          sk: {
            field: "SK",
            casing: "none",
            composite: ["empresaId"],
            template: "ACCOUNT#${empresaId}",
          },
        },
      },
    },
    { client, table },
  );

  const schedule = new Entity(
    {
      model: { entity: "schedule", version: "1", service },
      attributes: {
        userId: { type: "string", required: true },
        scheduleId: { type: "string", required: true },
        empresaId: { type: "string", required: true },
        className: { type: "string", required: true },
        startTime: { type: "string", required: true },
        kind: { type: ["weekly", "once"] as const, required: true },
        weekdays: { type: "list", items: { type: "number" } },
        date: { type: "string" },
        allowWaitingList: { type: "boolean", required: true },
        active: { type: "boolean", required: true },
      },
      indexes: {
        byUser: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["userId"],
            template: "USER#${userId}",
          },
          sk: {
            field: "SK",
            casing: "none",
            composite: ["scheduleId"],
            template: "SCHEDULE#${scheduleId}",
          },
        },
      },
    },
    { client, table },
  );

  const execution = new Entity(
    {
      model: { entity: "execution", version: "1", service },
      attributes: {
        scheduleId: { type: "string", required: true },
        classDate: { type: "string", required: true },
        userId: { type: "string", required: true },
        status: { type: EXEC_STATUS, required: true },
        checkInId: { type: "string" },
        attempts: { type: "number", required: true },
        latencyMs: { type: "number" },
        error: { type: "string" },
        ttl: { type: "number", required: true },
      },
      indexes: {
        bySchedule: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["scheduleId"],
            template: "SCHEDULE#${scheduleId}",
          },
          sk: {
            field: "SK",
            casing: "none",
            composite: ["classDate"],
            template: "EXEC#${classDate}",
          },
        },
        byUser: {
          index: "GSI1",
          pk: {
            field: "GSI1PK",
            casing: "none",
            composite: ["userId"],
            template: "USER#${userId}",
          },
          sk: {
            field: "GSI1SK",
            casing: "none",
            composite: ["classDate", "scheduleId"],
            template: "EXEC#${classDate}#${scheduleId}",
          },
        },
        byDate: {
          index: "GSI2",
          pk: {
            field: "GSI2PK",
            casing: "none",
            composite: ["classDate"],
            template: "EXECDATE#${classDate}",
          },
          sk: {
            field: "GSI2SK",
            casing: "none",
            composite: ["status", "userId"],
            template: "${status}#${userId}",
          },
        },
      },
    },
    { client, table },
  );

  const invite = new Entity(
    {
      model: { entity: "invite", version: "1", service },
      attributes: {
        inviteId: { type: "string", required: true },
        label: { type: "string" },
        status: { type: INVITE_STATUS, required: true },
        expiresAt: { type: "number", required: true },
        attempts: { type: "number", required: true },
        createdBy: { type: "string", required: true },
        usedBy: { type: "string" },
        usedAt: { type: "string" },
        createdAt: { type: "string", required: true },
        ttl: { type: "number", required: true },
      },
      indexes: {
        byId: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["inviteId"],
            template: "INVITE#${inviteId}",
          },
          sk: { field: "SK", casing: "none", composite: [], template: "META" },
        },
        byCreated: {
          index: "GSI2",
          pk: {
            field: "GSI2PK",
            casing: "none",
            composite: [],
            template: "ENTITY#INVITE",
          },
          sk: {
            field: "GSI2SK",
            casing: "none",
            composite: ["createdAt"],
            template: "${createdAt}",
          },
        },
      },
    },
    { client, table },
  );

  const session = new Entity(
    {
      model: { entity: "session", version: "1", service },
      attributes: {
        sessionId: { type: "string", required: true },
        userId: { type: "string", required: true },
        createdAt: { type: "string", required: true },
        lastSeenAt: { type: "string", required: true },
        ip: { type: "string", required: true },
        userAgent: { type: "string", required: true },
      },
      indexes: {
        byId: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["sessionId"],
            template: "SESSION#${sessionId}",
          },
          sk: { field: "SK", casing: "none", composite: [], template: "META" },
        },
        byUser: {
          index: "GSI1",
          pk: {
            field: "GSI1PK",
            casing: "none",
            composite: ["userId"],
            template: "USER#${userId}",
          },
          sk: {
            field: "GSI1SK",
            casing: "none",
            composite: ["createdAt"],
            template: "SESSION#${createdAt}",
          },
        },
      },
    },
    { client, table },
  );

  const loginFail = new Entity(
    {
      model: { entity: "loginFail", version: "1", service },
      attributes: {
        email: { type: "string", required: true },
        count: { type: "number", required: true },
        ttl: { type: "number", required: true },
      },
      indexes: {
        byEmail: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["email"],
            template: "LOGINFAIL#${email}",
          },
          sk: { field: "SK", casing: "none", composite: [], template: "META" },
        },
      },
    },
    { client, table },
  );

  const audit = new Entity(
    {
      model: { entity: "audit", version: "1", service },
      attributes: {
        day: { type: "string", required: true },
        at: { type: "string", required: true },
        eventId: { type: "string", required: true },
        actorType: { type: ACTOR_TYPE, required: true },
        actorId: { type: "string", required: true },
        action: { type: "string", required: true },
        targetType: { type: "string" },
        targetId: { type: "string" },
        result: { type: AUDIT_RESULT, required: true },
        ip: { type: "string" },
        userAgent: { type: "string" },
        metadata: { type: "any" },
        ttl: { type: "number", required: true },
      },
      indexes: {
        byDay: {
          pk: {
            field: "PK",
            casing: "none",
            composite: ["day"],
            template: "DAY#${day}",
          },
          sk: {
            field: "SK",
            casing: "none",
            composite: ["at", "eventId"],
            template: "${at}#${eventId}",
          },
        },
        byActor: {
          index: "GSI1",
          pk: {
            field: "GSI1PK",
            casing: "none",
            composite: ["actorId"],
            template: "ACTOR#${actorId}",
          },
          sk: {
            field: "GSI1SK",
            casing: "none",
            composite: ["at"],
            template: "${at}",
          },
        },
        byTarget: {
          index: "GSI2",
          pk: {
            field: "GSI2PK",
            casing: "none",
            composite: ["targetId"],
            template: "TARGET#${targetId}",
          },
          sk: {
            field: "GSI2SK",
            casing: "none",
            composite: ["at"],
            template: "${at}",
          },
        },
      },
    },
    { client, table: tables.audit },
  );

  const txService = new Service({ invite, profile, account, session });

  return {
    profile,
    account,
    schedule,
    execution,
    invite,
    session,
    loginFail,
    audit,
    service: txService,
  };
}

export type Entities = ReturnType<typeof createEntities>;
