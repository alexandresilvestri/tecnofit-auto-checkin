import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { hashSecret } from "@checkin/core/crypto/secret";
import { mockClient } from "aws-sdk-client-mock";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);
let handler: typeof import("../../../apps/functions/authorizer-user/index").handler;

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  vi.stubEnv("ORIGIN_SECRET", "s3cret");
  ({ handler } = await import("../../../apps/functions/authorizer-user/index"));
});

beforeEach(() => ddb.reset());

const call = (cookies?: string[], headers: Record<string, string> = { "x-origin-verify": "s3cret" }) =>
  handler({ cookies, headers } as never);

it.each([[undefined], [[]], [["other=1"]]])("denies without sid cookie (%j)", async (cookies) => {
  await expect(call(cookies)).resolves.toEqual({ isAuthorized: false });
  expect(ddb.calls()).toHaveLength(0);
});

it("denies when the session does not exist", async () => {
  ddb.on(GetCommand).resolves({});
  await expect(call(["sid=tok"])).resolves.toEqual({ isAuthorized: false });
});

it("authorizes a valid session with userId and sessionId", async () => {
  const hash = hashSecret("tok");
  ddb.on(GetCommand).resolves({
    Item: {
      PK: `SESSION#${hash}`,
      SK: "META",
      __edb_e__: "session",
      __edb_v__: "1",
      sessionId: hash,
      userId: "u1",
      createdAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-01T00:00:00.000Z",
      ip: "1.2.3.4",
      userAgent: "ua",
    },
  });
  await expect(call(["a=b", "sid=tok"])).resolves.toEqual({
    isAuthorized: true,
    context: { userId: "u1", sessionId: hash },
  });
  expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({ PK: `SESSION#${hash}`, SK: "META" });
});

it.each([[{ "x-origin-verify": "wrong" }], [{ "x-origin-verify": "" }], [{}]])("denies origin header %j even with a valid session", async (headers) => {
  await expect(call(["sid=tok"], headers)).resolves.toEqual({ isAuthorized: false });
  expect(ddb.calls()).toHaveLength(0);
});
