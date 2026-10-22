import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { callback, login, token } from "../../../apps/web/src/admin/auth";

const data = new Map<string, string>();

beforeEach(() => {
  data.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const b64url = (buf: ArrayBuffer) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

it("login redirects with a PKCE S256 challenge of the stored verifier", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { origin: "https://app.test", assign });
  await login();
  const url = new URL(assign.mock.calls[0][0], "https://app.test");
  expect(url.pathname).toBe("/oauth2/authorize");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/admin/callback");
  expect(url.searchParams.get("state")).toBe(data.get("admin_state"));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.get("admin_verifier")));
  expect(url.searchParams.get("code_challenge")).toBe(b64url(digest));
});

it("callback rejects a mismatched state without calling fetch", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { origin: "https://app.test", search: "?code=abc&state=evil" });
  data.set("admin_state", "good");
  data.set("admin_verifier", "v");
  await expect(callback()).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(token()).toBeNull();
});

it("callback rejects a missing state", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { origin: "https://app.test", search: "?code=abc" });
  await expect(callback()).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("callback exchanges the code and stores the token", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { origin: "https://app.test", search: "?code=abc&state=good" });
  data.set("admin_state", "good");
  data.set("admin_verifier", "v");
  await callback();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(token()).toBe("t");
});

it("token is null when expired", () => {
  data.set("admin_token", "t");
  data.set("admin_exp", String(Date.now() - 1));
  expect(token()).toBeNull();
});
