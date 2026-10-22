import { afterEach, expect, it, vi } from "vitest";
import { del, guard, patch, post } from "../../../apps/web/src/api";

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

it("maps API Gateway throttling to a Portuguese message", async () => {
  reply(429, { message: "Too Many Requests" });
  await expect(post("/api/auth/login")).rejects.toEqual({
    status: 429,
    message: "Muitas tentativas. Tente novamente em instantes.",
  });
});

it("keeps the API's own 429 message", async () => {
  reply(429, { message: "Muitas tentativas. Tente novamente em 15 minutos." });
  await expect(post("/api/auth/login")).rejects.toEqual({
    status: 429,
    message: "Muitas tentativas. Tente novamente em 15 minutos.",
  });
});

it.each([401, 403])("guard redirects to /login on %i", (status) => {
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  expect(guard({ status, message: "x" })).toBe(true);
  expect(assign).toHaveBeenCalledWith("/login");
});

it("guard ignores other errors", () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  expect(guard({ status: 500, message: "x" })).toBe(false);
  expect(guard(new Error("x"))).toBe(false);
  expect(assign).not.toHaveBeenCalled();
});

it("patch and del send method and the fetch header", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await patch("/api/schedules/1", { active: false });
  await del("/api/schedules/1");
  const [, patchInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const [, delInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(patchInit.method).toBe("PATCH");
  expect(patchInit.body).toBe(JSON.stringify({ active: false }));
  expect(patchInit.headers).toMatchObject({ "X-Requested-With": "fetch", "Content-Type": "application/json" });
  expect(delInit.method).toBe("DELETE");
  expect(delInit.headers).toMatchObject({ "X-Requested-With": "fetch" });
});
