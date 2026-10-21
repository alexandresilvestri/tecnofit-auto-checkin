import { afterEach, expect, it, vi } from "vitest";
import { post } from "../../../apps/web/src/api";

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
