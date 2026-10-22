import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));
vi.mock("@checkin/core/audit/audit", async (orig) => ({ ...(await orig<object>()), ...audit }));

let handler: typeof import("../../../apps/functions/cognito-post-auth/index").handler;

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  ({ handler } = await import("../../../apps/functions/cognito-post-auth/index"));
});

beforeEach(() => vi.resetAllMocks());

const event = { triggerSource: "PostAuthentication_Authentication", request: { userAttributes: { sub: "adm1" } } };

it("writes admin.login and returns the event unchanged", async () => {
  audit.writeAudit.mockResolvedValue(undefined);
  const res = await handler(event);
  expect(res).toBe(event);
  const [, written] = audit.writeAudit.mock.calls[0]!;
  expect(written).toEqual({ actorType: "admin", actorId: "adm1", action: "admin.login", result: "success" });
});

it("propagates audit failures", async () => {
  audit.writeAudit.mockRejectedValue(new Error("boom"));
  await expect(handler(event)).rejects.toThrow("boom");
});
