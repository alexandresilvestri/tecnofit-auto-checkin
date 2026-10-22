import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  checkIn,
  getEvent,
  getMe,
  listEvents,
  login,
  TecnofitError,
  TecnofitInvalidResponse,
  TecnofitUnauthorized,
} from "../../../packages/core/tecnofit/client";
import alunoEu from "../../fixtures/tecnofit/aluno-eu.json";
import checkInFixture from "../../fixtures/tecnofit/check-in.json";
import eventDetail from "../../fixtures/tecnofit/event-detail.json";
import events from "../../fixtures/tecnofit/events.json";
import { fakeJwt } from "../../fixtures/tecnofit/jwt";

const HOST = "https://rest.tecnofit.com.br";
const USER_AGENT = "Tecnofit Box/43.7.5 (Android 13; WayDroid x86_64 Device; waydroid_x86_64; x86_64)";
const EVENTS_PATH = `${HOST}/v2/161322/crossfit/wod/2026-10-21/programs/calendar/events`;
const EVENT_PATH = `${HOST}/v2/161322/crossfit/wod/2026-10-21/programs/33548/calendar/events/587887`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("login", () => {
  it("decodes the jwt claims", async () => {
    const token = fakeJwt({ user_id: 28715453, empresa_id: 161322, exp: 1900000000 });
    let body: unknown;
    let auth: string | null = null;
    server.use(
      http.post(`${HOST}/auth`, async ({ request }) => {
        body = await request.json();
        auth = request.headers.get("authorization");
        return HttpResponse.json({ token });
      }),
    );

    await expect(login("aluno@example.com", "secret")).resolves.toEqual({
      token,
      userId: 28715453,
      empresaId: 161322,
      exp: 1900000000,
    });
    expect(body).toEqual({ email: "aluno@example.com", password: "secret" });
    expect(auth).toBeNull();
  });

  it("rejects a token without claims", async () => {
    server.use(http.post(`${HOST}/auth`, () => HttpResponse.json({ token: fakeJwt({ uuid: "x" }) })));
    await expect(login("a@b.c", "p")).rejects.toBeInstanceOf(TecnofitInvalidResponse);
  });

  it("maps 401 to TecnofitUnauthorized", async () => {
    server.use(http.post(`${HOST}/auth`, () => new HttpResponse(null, { status: 401 })));
    await expect(login("a@b.c", "p")).rejects.toBeInstanceOf(TecnofitUnauthorized);
  });
});

describe("getMe", () => {
  it("returns the customer with Bearer auth", async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${HOST}/aluno/eu`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json(alunoEu);
      }),
    );

    const me = await getMe("tok");
    expect(auth).toBe("Bearer tok");
    expect(me.id).toBe(28715453);
    expect(me.companies[1]).toEqual({ id: 161322, name: "BOX CF Bombinhas", customerStatus: "active", hasAccess: true });
  });
});

describe("listEvents", () => {
  it("calls the calendar endpoint with the exact User-Agent", async () => {
    let url: URL | undefined;
    let userAgent: string | null = null;
    server.use(
      http.get(EVENTS_PATH, ({ request }) => {
        url = new URL(request.url);
        userAgent = request.headers.get("user-agent");
        return HttpResponse.json(events);
      }),
    );

    const result = await listEvents("tok", 161322, "2026-10-21");
    expect(url?.pathname).toBe("/v2/161322/crossfit/wod/2026-10-21/programs/calendar/events");
    expect(url?.search).toBe("?realtime=2");
    expect(userAgent).toBe(USER_AGENT);
    expect(result).toEqual([
      { id: 587887, classId: 33548, name: "TREINO NO RANCHO", start: "2026-10-21 07:00", count: 5, capacity: 20, checkInId: null },
    ]);
  });

  it("rejects JSON without events", async () => {
    server.use(http.get(EVENTS_PATH, () => HttpResponse.json({ nope: [] })));
    await expect(listEvents("tok", 161322, "2026-10-21")).rejects.toBeInstanceOf(TecnofitInvalidResponse);
  });

  it("rejects a non-JSON body", async () => {
    server.use(http.get(EVENTS_PATH, () => new HttpResponse("<html>", { status: 200 })));
    await expect(listEvents("tok", 161322, "2026-10-21")).rejects.toBeInstanceOf(TecnofitInvalidResponse);
  });

  it("drains the body of an error response", async () => {
    let drained = false;
    const body = new ReadableStream(
      {
        pull: (c) => {
          drained = true;
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body, { status: 500 }));
    await expect(listEvents("tok", 161322, "2026-10-21")).rejects.toMatchObject({ status: 500 });
    expect(drained).toBe(true);
  });

  it("propagates a body read failure unchanged", async () => {
    const reset = new Error("socket reset");
    const body = new ReadableStream({ start: (c) => c.error(reset) });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body));
    await expect(listEvents("tok", 161322, "2026-10-21")).rejects.toBe(reset);
  });

  it("rejects by timeout when the response is slow", { timeout: 10000 }, async () => {
    server.use(
      http.get(EVENTS_PATH, async () => {
        await delay(6000);
        return HttpResponse.json(events);
      }),
    );
    await expect(listEvents("tok", 161322, "2026-10-21")).rejects.toMatchObject({ name: "TecnofitError", status: 503 });
  });
});

describe("getEvent", () => {
  it("maps attendance and check-in state", async () => {
    server.use(http.get(EVENT_PATH, () => HttpResponse.json(eventDetail)));
    await expect(getEvent("tok", 161322, "2026-10-21", 33548, 587887)).resolves.toEqual({
      count: 5,
      capacity: 20,
      checkedIn: false,
      onTimeToCheckIn: true,
    });
  });

  it("reports checkedIn when checkIn is present", async () => {
    server.use(http.get(EVENT_PATH, () => HttpResponse.json({ event: { ...eventDetail.event, checkIn: { id: 1 } } })));
    const result = await getEvent("tok", 161322, "2026-10-21", 33548, 587887);
    expect(result.checkedIn).toBe(true);
  });
});

describe("checkIn", () => {
  it("posts requestWaitingList false and returns id", async () => {
    let raw = "";
    let contentType: string | null = null;
    server.use(
      http.post(`${EVENT_PATH}/check-in`, async ({ request }) => {
        raw = await request.text();
        contentType = request.headers.get("content-type");
        return HttpResponse.json(checkInFixture);
      }),
    );

    await expect(checkIn("tok", 161322, "2026-10-21", 33548, 587887)).resolves.toEqual({
      id: 210904124,
      waitingList: false,
    });
    expect(raw).toBe('{"checkIn":{"requestWaitingList":false}}');
    expect(contentType).toContain("application/json");
  });

  it("maps 401 to TecnofitUnauthorized", async () => {
    server.use(http.post(`${EVENT_PATH}/check-in`, () => new HttpResponse(null, { status: 401 })));
    await expect(checkIn("tok", 161322, "2026-10-21", 33548, 587887)).rejects.toBeInstanceOf(TecnofitUnauthorized);
  });

  it("maps 409 to TecnofitError with status", async () => {
    server.use(http.post(`${EVENT_PATH}/check-in`, () => HttpResponse.json({ message: "full" }, { status: 409 })));
    const error = await checkIn("tok", 161322, "2026-10-21", 33548, 587887).catch((e) => e);
    expect(error).toBeInstanceOf(TecnofitError);
    expect(error).not.toBeInstanceOf(TecnofitUnauthorized);
    expect(error.status).toBe(409);
  });
});
