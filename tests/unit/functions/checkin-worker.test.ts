import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { fakeJwt } from "../../fixtures/tecnofit/jwt";

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

it.each([
  ["invalid response", "invalid"],
  ["network error", "network"],
  ["unauthorized", "401"],
])("tecnofit failure (%s) never leaks the token to the logs", async (_n, kind) => {
  const jwt = fakeJwt({ user_id: 1, empresa_id: 2, exp: 1900000000 });
  const tokenEnc = "TOKENENC-CIPHERTEXT-123";
  const client = await import("@checkin/core/tecnofit/client");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "DEBUG");
  vi.resetModules();
  vi.doMock("@checkin/core/domain/checkin", () => ({
    runCheckin: async () => {
      const fetchMock = vi.fn(async () =>
        kind === "network"
          ? Promise.reject(new Error(`connect failed Bearer ${jwt} ${tokenEnc}`))
          : kind === "401"
            ? new Response("denied", { status: 401 })
            : Response.json({ events: [{ id: "x" }], echo: jwt }),
      );
      vi.stubGlobal("fetch", fetchMock);
      try {
        await client.listEvents(jwt, 2, "2026-07-01");
      } finally {
        vi.unstubAllGlobals();
      }
    },
  }));
  const out: string[] = [];
  const spies = (["stdout", "stderr"] as const).map((stream) =>
    vi.spyOn(process[stream], "write").mockImplementation((chunk) => (out.push(String(chunk)), true)),
  );
  const { handler: loud } = await import("../../../apps/functions/checkin-worker/index");
  await expect(
    loud({ userId: "u1", scheduleId: "s1", scheduledTime: "2026-07-01T05:16:00-03:00" }),
  ).rejects.toThrow();
  spies.forEach((s) => s.mockRestore());
  vi.doUnmock("@checkin/core/domain/checkin");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "SILENT");
  const text = out.join("\n");
  expect(text).toContain("checkin failed");
  expect(text).not.toContain(jwt);
  expect(text).not.toContain(jwt.split(".")[1]!);
  expect(text).not.toContain("Bearer");
  expect(text).not.toContain("tokenEnc");
  expect(text).not.toContain(tokenEnc);
});
