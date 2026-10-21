import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { encryptToken } from "../../packages/core/crypto/token.js";
import { createEntities, type Entities } from "../../packages/core/db/entities.js";
import { runCheckin } from "../../packages/core/domain/checkin.js";
import checkInFixture from "../fixtures/tecnofit/check-in.json";
import eventDetail from "../fixtures/tecnofit/event-detail.json";
import events from "../fixtures/tecnofit/events.json";
import { fakeJwt } from "../fixtures/tecnofit/jwt.js";
import { awsConfig, createMainTable, resetMoto } from "./setup/aws.js";

const WOD = "https://rest.tecnofit.com.br/v2/161322/crossfit/wod/2026-10-21/programs";
const DETAIL = `${WOD}/33548/calendar/events/587887`;
const SCHEDULED = "2026-10-20T22:01:00Z";
const TOKEN = fakeJwt({ user_id: 28715453, empresa_id: 161322, exp: 1900000000 });
const FULL = { event: { ...eventDetail.event, attendance: { count: 20, capacity: 20, attendees: [] } } };

const kms = new KMSClient(awsConfig);
let e: Entities;
let keyId: string;
let n = 0;

let lists: number;
let details: number;
let posts: { url: string; auth: string | null; requestWaitingList: boolean }[];
let eventsReply: () => Response;
let detailReply: () => Response;
let postReply: (count: number, requestWaitingList: boolean) => Response | Promise<Response>;

const server = setupServer(
  http.get(`${WOD}/calendar/events`, () => {
    lists++;
    return eventsReply();
  }),
  http.get(DETAIL, () => {
    details++;
    return detailReply();
  }),
  http.post(`${DETAIL}/check-in`, async ({ request }) => {
    const body = (await request.json()) as { checkIn: { requestWaitingList: boolean } };
    posts.push({
      url: request.url,
      auth: request.headers.get("authorization"),
      requestWaitingList: body.checkIn.requestWaitingList,
    });
    return postReply(posts.length, body.checkIn.requestWaitingList);
  }),
);

beforeAll(async () => {
  server.listen({ onUnhandledFrame: "bypass" });
  await resetMoto();
  e = createEntities(DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig)), await createMainTable());
  keyId = (await kms.send(new CreateKeyCommand({}))).KeyMetadata!.KeyId!;
});

afterAll(() => server.close());

beforeEach(() => {
  lists = 0;
  details = 0;
  posts = [];
  eventsReply = () => HttpResponse.json(events);
  detailReply = () => HttpResponse.json(eventDetail);
  postReply = () => HttpResponse.json(checkInFixture);
});

type ScheduleOverrides = Partial<{
  kind: "weekly" | "once";
  date: string;
  allowWaitingList: boolean;
}>;

async function seed(schedule: ScheduleOverrides = {}, profileStatus: "active" | "suspended" = "active") {
  n++;
  const userId = `u_${n}`;
  const scheduleId = `s_${n}`;
  await e.profile
    .create({
      userId,
      name: "Aluno Teste",
      tecnofitEmail: `aluno${n}@example.com`,
      tecnofitUserId: 28715453,
      status: profileStatus,
      createdAt: "2026-10-01T00:00:00Z",
    })
    .go();
  await e.account
    .create({
      userId,
      empresaId: "161322",
      tokenEnc: await encryptToken(kms, keyId, userId, TOKEN),
      tokenExp: 1900000000,
      boxName: "BOX CF Bombinhas",
      status: "ok",
    })
    .go();
  await e.schedule
    .create({
      userId,
      scheduleId,
      empresaId: "161322",
      className: "TREINO NO RANCHO",
      startTime: "07:00",
      kind: "weekly",
      weekdays: [3],
      allowWaitingList: true,
      active: true,
      ...schedule,
    })
    .go();
  return { userId, scheduleId, scheduledTime: SCHEDULED };
}

function run(input: { userId: string; scheduleId: string; scheduledTime: string }, start = Date.parse(SCHEDULED)) {
  let t = start;
  return runCheckin(
    {
      entities: e,
      kms,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      random: () => 0.5,
    },
    input,
  );
}

const exec = async (scheduleId: string, classDate = "2026-10-21") =>
  (await e.execution.get({ scheduleId, classDate }).go()).data;

it("checks in on the first POST", async () => {
  const input = await seed();
  expect(await run(input)).toBe("success");
  const row = await exec(input.scheduleId);
  expect(row).toMatchObject({ status: "success", attempts: 1, checkInId: "210904124", userId: input.userId });
  expect(row!.latencyMs).toBeGreaterThanOrEqual(0);
  expect(row!.ttl).toBe(Math.floor(Date.parse(SCHEDULED) / 1000) + 90 * 86400);
  expect(posts).toHaveLength(1);
  expect(new URL(posts[0].url).pathname).toBe(
    "/v2/161322/crossfit/wod/2026-10-21/programs/33548/calendar/events/587887/check-in",
  );
  expect(posts[0].auth).toBe(`Bearer ${TOKEN}`);
  expect(posts[0].requestWaitingList).toBe(false);
});

it("retries after 3 failures", async () => {
  const input = await seed();
  postReply = (count) => (count <= 3 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(checkInFixture));
  expect(await run(input)).toBe("success");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "success", attempts: 4 });
});

it("joins the waiting list right away when full and allowed", async () => {
  const input = await seed();
  detailReply = () => HttpResponse.json(FULL);
  postReply = (_, requestWaitingList) =>
    requestWaitingList
      ? HttpResponse.json({ ...checkInFixture, waitingList: true })
      : HttpResponse.json({ message: "full" }, { status: 400 });
  expect(await run(input)).toBe("waitlisted");
  expect(posts.map((p) => p.requestWaitingList)).toEqual([false, true]);
  expect(await exec(input.scheduleId)).toMatchObject({ status: "waitlisted", attempts: 2, latencyMs: 0 });
});

it("fails as full without waiting list", async () => {
  const input = await seed({ allowWaitingList: false });
  detailReply = () => HttpResponse.json(FULL);
  postReply = () => HttpResponse.json({ message: "full" }, { status: 400 });
  expect(await run(input)).toBe("failed");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "failed", error: "full", attempts: 1 });
});

it("marks the account for reconnect on 401", async () => {
  const input = await seed();
  postReply = () => new HttpResponse(null, { status: 401 });
  expect(await run(input)).toBe("failed");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "failed", error: "unauthorized", attempts: 1 });
  expect((await e.account.get({ userId: input.userId, empresaId: "161322" }).go()).data?.status).toBe("reconnect");
});

it("times out after 90 s of failures", async () => {
  const input = await seed();
  postReply = () => HttpResponse.json({ message: "closed" }, { status: 400 });
  expect(await run(input)).toBe("failed");
  const row = await exec(input.scheduleId);
  expect(row).toMatchObject({ status: "failed", error: "timeout" });
  expect(row!.attempts).toBeGreaterThan(150);
  expect(details).toBeLessThanOrEqual(46);
});

it("does nothing on a duplicate invocation", async () => {
  const input = await seed();
  expect(await run(input)).toBe("success");
  expect(await run(input)).toBe("noop");
  expect(posts).toHaveLength(1);
  expect((await exec(input.scheduleId))?.status).toBe("success");
});

it("skips a suspended profile without calling Tecnofit", async () => {
  const input = await seed({}, "suspended");
  expect(await run(input)).toBe("skipped");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "skipped", attempts: 0 });
  expect([lists, details, posts.length]).toEqual([0, 0, 0]);
});

it("fails when the class is not listed", async () => {
  const input = await seed();
  const [event] = events.events;
  eventsReply = () =>
    HttpResponse.json({ events: [{ ...event, start: "2026-10-21 08:00" }, { ...event, name: "OUTRA AULA" }] });
  expect(await run(input)).toBe("failed");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "failed", error: "class_not_found" });
  expect(posts).toHaveLength(0);
});

it("fails on malformed events", async () => {
  const input = await seed();
  eventsReply = () => HttpResponse.json({ nope: [] });
  expect(await run(input)).toBe("failed");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "failed", error: "invalid_response" });
});

it("rejects a scheduledTime one hour early", async () => {
  const input = { ...(await seed()), scheduledTime: "2026-10-20T21:01:00Z" };
  expect(await run(input, Date.parse(input.scheduledTime))).toBe("failed");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "failed", error: "window_mismatch" });
  expect(lists).toBe(0);
});

it("rejects a once schedule invoked for another date", async () => {
  const input = await seed({ kind: "once", date: "2026-10-22" });
  expect(await run(input)).toBe("failed");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "failed", error: "window_mismatch" });
  expect(lists).toBe(0);
});

it("keeps the class date and posts at once when the clock runs 50 s late", async () => {
  const input = await seed();
  expect(await run(input, Date.parse(SCHEDULED) + 50_000)).toBe("success");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "success", attempts: 1, latencyMs: 50_000 });
  expect(new URL(posts[0].url).pathname).toContain("/wod/2026-10-21/");
});

it("counts a timed-out POST as an attempt", async () => {
  const input = await seed();
  postReply = async (count) => {
    if (count === 1) await delay(6000);
    return HttpResponse.json(checkInFixture);
  };
  expect(await run(input)).toBe("success");
  expect(await exec(input.scheduleId)).toMatchObject({ status: "success", attempts: 2 });
});
