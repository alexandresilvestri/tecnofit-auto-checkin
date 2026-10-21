import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

export type ExecStatus =
  "running" | "success" | "waitlisted" | "failed" | "skipped";

const service = "checkin";

export function isConditionalFailure(err: unknown): boolean {
  const e = err as { isElectroError?: boolean; cause?: { name?: string } };
  return (
    e?.isElectroError === true &&
    e.cause?.name === "ConditionalCheckFailedException"
  );
}

export function createEntities(client: DynamoDBDocumentClient, table: string) {
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
        status: {
          type: [
            "running",
            "success",
            "waitlisted",
            "failed",
            "skipped",
          ] as const,
          required: true,
        },
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

  return { profile, account, schedule, execution };
}

export type Entities = ReturnType<typeof createEntities>;
