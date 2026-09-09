import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);
const sessions = vi.hoisted(() => ({ touchSession: vi.fn(), revokeSession: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));

vi.mock("@checkin/core/domain/sessions", async (orig) => ({
  ...(await orig<object>()),
  ...sessions,
}));
vi.mock("@checkin/core/audit/audit", async (orig) => ({
  ...(await orig<object>()),
  ...audit,
}));

let handler: typeof import("../../../apps/functions/api-user/index").handler;

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "SILENT");
  ({ handler } = await import("../../../apps/functions/api-user/index"));
});

beforeEach(() => {
  vi.resetAllMocks();
  ddb.reset();
});

const send = (method: string, path: string, headers: Record<string, string> = { "x-requested-with": "fetch" }) =>
  handler({
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    cookies: ["sid=tok"],
    headers,
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "1.2.3.4", userAgent: "ua-test" },
      authorizer: { lambda: { userId: "u1", sessionId: "s1" } },
    },
    isBase64Encoded: false,
  } as never) as Promise<{ statusCode: number; body: string; cookies?: string[] }>;

const profile = {
  __edb_e__: "profile",
  __edb_v__: "1",
  PK: "USER#u1",
  SK: "PROFILE",
  userId: "u1",
  name: "Ana",
  tecnofitEmail: "a@b.c",
  tecnofitUserId: 1,
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
};
const account = {
  __edb_e__: "account",
  __edb_v__: "1",
  PK: "USER#u1",
  SK: "ACCOUNT#9",
  userId: "u1",
  empresaId: "9",
  tokenEnc: "enc",
  tokenExp: 1,
  boxName: "Box X",
  status: "ok",
};

const sessionCookie = ["sid=tok", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=34560000"].sort();

it("me returns profile and account data without reissuing the cookie", async () => {
  ddb.on(GetCommand).resolves({ Item: profile });
  ddb.on(QueryCommand).resolves({ Items: [account] });
  sessions.touchSession.mockResolvedValue(false);
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ name: "Ana", boxName: "Box X", accountStatus: "ok" });
  expect(res.cookies).toBeUndefined();
  expect(sessions.touchSession.mock.calls[0]![1]).toBe("s1");
  const query = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
  expect(Object.values(query.ExpressionAttributeValues!)).toEqual(expect.arrayContaining(["USER#u1", "ACCOUNT#"]));
});

it("me reissues the exact session cookie when touchSession is true", async () => {
  ddb.on(GetCommand).resolves({ Item: profile });
  ddb.on(QueryCommand).resolves({ Items: [account] });
  sessions.touchSession.mockResolvedValue(true);
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(200);
  expect(res.cookies).toHaveLength(1);
  expect(res.cookies![0]!.split("; ").sort()).toEqual(sessionCookie);
});

it("me returns 401 when the profile is missing", async () => {
  ddb.on(GetCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(401);
  expect(JSON.parse(res.body)).toEqual({ message: "Sessão inválida." });
  expect(sessions.touchSession).not.toHaveBeenCalled();
});

it("me returns 500 on unexpected errors", async () => {
  ddb.on(GetCommand).rejects(new Error("boom"));
  const res = await send("GET", "/api/me", {});
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toEqual({ message: "Erro inesperado." });
});

it("logout without X-Requested-With returns 403", async () => {
  const res = await send("POST", "/api/auth/logout", {});
  expect(res.statusCode).toBe(403);
  expect(sessions.revokeSession).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
});

it("logout revokes the session, audits and clears the cookie", async () => {
  const res = await send("POST", "/api/auth/logout");
  expect(res.statusCode).toBe(204);
  expect(res.cookies).toHaveLength(1);
  expect(res.cookies![0]!.split("; ").sort()).toEqual(
    ["sid=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=0"].sort(),
  );
  expect(sessions.revokeSession.mock.calls[0]![1]).toBe("tok");
  expect(audit.writeAudit.mock.calls[0]![1]).toEqual({
    actorType: "user",
    actorId: "u1",
    action: "user.logout",
    result: "success",
    ip: "1.2.3.4",
    userAgent: "ua-test",
  });
});

it.each([
  ["203.0.113.7:46532", "203.0.113.7"],
  ["2001:db8::7:46532", "2001:db8::7"],
  [undefined, "1.2.3.4"],
])("logout audits the ip from CloudFront-Viewer-Address %s as %s", async (viewer, ip) => {
  const headers = viewer ? { "x-requested-with": "fetch", "cloudfront-viewer-address": viewer } : undefined;
  await send("POST", "/api/auth/logout", headers);
  expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({ ip, userAgent: "ua-test" });
});
