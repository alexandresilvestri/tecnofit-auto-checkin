import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const invites = vi.hoisted(() => ({
  checkInvite: vi.fn(),
  redeemInvite: vi.fn(),
}));
const sessions = vi.hoisted(() => ({ loginUser: vi.fn() }));

vi.mock("@checkin/core/domain/invites", async (orig) => ({
  ...(await orig<object>()),
  ...invites,
}));
vi.mock("@checkin/core/domain/sessions", async (orig) => ({
  ...(await orig<object>()),
  ...sessions,
}));

let handler: typeof import("../../../apps/functions/api-public/index").handler;
let errors: typeof import("@checkin/core/domain/invites") & typeof import("@checkin/core/domain/sessions");
let tecnofit: typeof import("@checkin/core/tecnofit/client");

beforeAll(async () => {
  vi.stubEnv("TABLE_MAIN", "checkin-test-main");
  vi.stubEnv("TABLE_AUDIT", "checkin-test-audit");
  vi.stubEnv("KMS_KEY_ID", "key-1");
  vi.stubEnv("POWERTOOLS_LOG_LEVEL", "SILENT");
  ({ handler } = await import("../../../apps/functions/api-public/index"));
  errors = { ...(await vi.importActual<object>("@checkin/core/domain/invites")), ...(await vi.importActual<object>("@checkin/core/domain/sessions")) } as typeof errors;
  tecnofit = await import("@checkin/core/tecnofit/client");
});

beforeEach(() => vi.resetAllMocks());

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-requested-with": "fetch" }) =>
  handler({
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json", ...headers },
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "1.2.3.4", userAgent: "ua-test" },
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as never) as Promise<{ statusCode: number; body: string; cookies?: string[] }>;

const onboarding = { token: "t", email: "a@b.c", password: "pw", consentVersion: "v1" };
const login = { email: "a@b.c", password: "pw" };

it("health returns ok", async () => {
  const res = await send("GET", "/api/health", undefined, {});
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true });
});

it.each([
  ["/api/invites/check", { token: "t" }],
  ["/api/onboarding", onboarding],
  ["/api/auth/login", login],
])("POST %s without X-Requested-With returns 403", async (path, body) => {
  const res = await send("POST", path, body, {});
  expect(res.statusCode).toBe(403);
  expect(JSON.parse(res.body)).toEqual({ message: "Requisição inválida." });
  expect(invites.checkInvite).not.toHaveBeenCalled();
  expect(invites.redeemInvite).not.toHaveBeenCalled();
  expect(sessions.loginUser).not.toHaveBeenCalled();
});

it.each([
  ["/api/invites/check", {}],
  ["/api/onboarding", { ...onboarding, email: undefined }],
  ["/api/auth/login", { email: "a@b.c" }],
  ["/api/auth/login", "not json"],
])("POST %s with invalid body returns 400", async (path, body) => {
  const res = await send("POST", path, body);
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body)).toEqual({ message: "Requisição inválida." });
});

it.each([true, false])("invite check returns valid=%s", async (valid) => {
  invites.checkInvite.mockResolvedValue(valid);
  const res = await send("POST", "/api/invites/check", { token: "t" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ valid });
  expect(invites.checkInvite.mock.calls[0]![1]).toBe("t");
});

it("onboarding returns 201 with exact session cookie and request meta", async () => {
  invites.redeemInvite.mockResolvedValue({ userId: "u1", sessionToken: "tok" });
  const res = await send("POST", "/api/onboarding", onboarding);
  expect(res.statusCode).toBe(201);
  expect(JSON.parse(res.body)).toEqual({});
  expect(res.cookies).toHaveLength(1);
  expect(res.cookies![0]!.split("; ").sort()).toEqual(
    ["sid=tok", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=34560000"].sort(),
  );
  expect(invites.redeemInvite.mock.calls[0]!.slice(1)).toEqual([onboarding, { ip: "1.2.3.4", userAgent: "ua-test" }]);
});

it("login returns 204 with exact session cookie and request meta", async () => {
  sessions.loginUser.mockResolvedValue({ userId: "u1", sessionToken: "tok" });
  const res = await send("POST", "/api/auth/login", login);
  expect(res.statusCode).toBe(204);
  expect(res.cookies![0]!.split("; ").sort()).toEqual(
    ["sid=tok", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=34560000"].sort(),
  );
  expect(sessions.loginUser.mock.calls[0]!.slice(1)).toEqual([login, { ip: "1.2.3.4", userAgent: "ua-test" }]);
});

it.each([
  ["203.0.113.7:46532", "203.0.113.7"],
  ["2001:db8::7:46532", "2001:db8::7"],
  [undefined, "1.2.3.4"],
])("login takes the ip from CloudFront-Viewer-Address %s as %s", async (viewer, ip) => {
  sessions.loginUser.mockResolvedValue({ userId: "u1", sessionToken: "tok" });
  const headers = viewer ? { "x-requested-with": "fetch", "cloudfront-viewer-address": viewer } : undefined;
  await send("POST", "/api/auth/login", login, headers);
  expect(sessions.loginUser.mock.calls[0]![2]).toEqual({ ip, userAgent: "ua-test" });
});

it.each([
  ["InviteInvalid", () => new errors.InviteInvalid(), 410, "Convite inválido ou expirado."],
  ["AccountExists", () => new errors.AccountExists(), 409, "Esta conta já está cadastrada. Faça login."],
  ["InvalidCredentials", () => new errors.InvalidCredentials(), 401, "E-mail ou senha inválidos."],
  ["LoginLocked", () => new errors.LoginLocked(), 429, "Muitas tentativas. Tente novamente em 15 minutos."],
  ["Tecnofit 503", () => new tecnofit.TecnofitError(503), 502, "Tecnofit indisponível. Tente novamente em instantes."],
  ["TecnofitInvalidResponse", () => new tecnofit.TecnofitInvalidResponse(), 502, "Tecnofit indisponível. Tente novamente em instantes."],
  ["fetch failed", () => new TypeError("fetch failed"), 502, "Tecnofit indisponível. Tente novamente em instantes."],
  ["unknown", () => new Error("boom"), 500, "Erro inesperado."],
])("login maps %s", async (_n, make, status, message) => {
  sessions.loginUser.mockRejectedValue(make());
  const res = await send("POST", "/api/auth/login", login);
  expect(res.statusCode).toBe(status);
  expect(JSON.parse(res.body)).toEqual({ message });
  expect(res.cookies).toBeUndefined();
});

it("onboarding maps domain errors", async () => {
  invites.redeemInvite.mockRejectedValue(new errors.InviteInvalid());
  const res = await send("POST", "/api/onboarding", onboarding);
  expect(res.statusCode).toBe(410);
  expect(JSON.parse(res.body)).toEqual({ message: "Convite inválido ou expirado." });
});
