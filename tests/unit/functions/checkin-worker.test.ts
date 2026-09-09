import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);
let handler: typeof import("../../../apps/functions/checkin-worker/index").handler;

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "SILENT");
  ({ handler } = await import("../../../apps/functions/checkin-worker/index"));
});

beforeEach(() => ddb.reset());

it("rejects event without userId before calling AWS", async () => {
  await expect(
    handler({ scheduleId: "s1", scheduledTime: "2026-07-01T05:16:00-03:00" } as never),
  ).rejects.toThrow();
  expect(ddb.calls()).toHaveLength(0);
});

it("rejects event without scheduledTime before calling AWS", async () => {
  await expect(handler({ userId: "u1", scheduleId: "s1" } as never)).rejects.toThrow();
  expect(ddb.calls()).toHaveLength(0);
});

it("returns noop when schedule does not exist", async () => {
  ddb.on(GetCommand).resolves({});
  await expect(
    handler({ userId: "u1", scheduleId: "s1", scheduledTime: "2026-07-01T05:16:00-03:00" }),
  ).resolves.toBe("noop");
});
