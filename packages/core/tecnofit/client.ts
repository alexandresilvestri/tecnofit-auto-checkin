import { z } from "zod";

const HOST = "https://rest.tecnofit.com.br";
const USER_AGENT = "Tecnofit Box/43.7.5 (Android 13; WayDroid x86_64 Device; waydroid_x86_64; x86_64)";
const TIMEOUT_MS = 5000;

export class TecnofitError extends Error {
  constructor(
    public status: number,
    message = `Tecnofit responded ${status}`,
  ) {
    super(message);
    this.name = "TecnofitError";
  }
}

export class TecnofitUnauthorized extends TecnofitError {
  constructor() {
    super(401, "Tecnofit responded 401");
    this.name = "TecnofitUnauthorized";
  }
}

export class TecnofitInvalidResponse extends Error {
  constructor(message = "Invalid Tecnofit response") {
    super(message);
    this.name = "TecnofitInvalidResponse";
  }
}

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init: { token?: string; body?: unknown } = {},
): Promise<z.infer<S>> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${HOST}${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new TecnofitUnauthorized();
  if (!res.ok) throw new TecnofitError(res.status);
  const json = await res.json().catch(() => {
    throw new TecnofitInvalidResponse("Tecnofit body is not JSON");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new TecnofitInvalidResponse(parsed.error.message);
  return parsed.data;
}

const claimsSchema = z.object({ user_id: z.number(), empresa_id: z.number(), exp: z.number() });

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; userId: number; empresaId: number; exp: number }> {
  const { token } = await request(z.object({ token: z.string() }), "/auth", { body: { email, password } });
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
  } catch {
    throw new TecnofitInvalidResponse("Tecnofit token is not a JWT");
  }
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) throw new TecnofitInvalidResponse("Tecnofit token lacks claims");
  return { token, userId: claims.data.user_id, empresaId: claims.data.empresa_id, exp: claims.data.exp };
}

const meSchema = z.object({
  customer: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    companies: z.array(
      z.object({ id: z.number(), name: z.string(), customerStatus: z.string(), hasAccess: z.boolean() }),
    ),
  }),
});

export async function getMe(token: string) {
  return (await request(meSchema, "/aluno/eu", { token })).customer;
}

const eventSchema = z.object({
  id: z.number(),
  classId: z.number(),
  name: z.string(),
  start: z.string(),
  count: z.number(),
  capacity: z.number(),
  checkInId: z.number().nullable(),
});

export type TecnofitEvent = z.infer<typeof eventSchema>;

const wod = (empresaId: number, date: string) => `/v2/${empresaId}/crossfit/wod/${date}/programs`;

export async function listEvents(token: string, empresaId: number, date: string): Promise<TecnofitEvent[]> {
  const body = await request(
    z.object({ events: z.array(eventSchema) }),
    `${wod(empresaId, date)}/calendar/events?realtime=2`,
    { token },
  );
  return body.events;
}

const eventDetailSchema = z.object({
  event: z.object({
    attendance: z.object({ count: z.number(), capacity: z.number() }),
    checkIn: z.unknown().nullable(),
    onTimeToCheckIn: z.boolean(),
  }),
});

const eventPath = (empresaId: number, date: string, classId: number, eventId: number) =>
  `${wod(empresaId, date)}/${classId}/calendar/events/${eventId}`;

export async function getEvent(token: string, empresaId: number, date: string, classId: number, eventId: number) {
  const { event } = await request(eventDetailSchema, eventPath(empresaId, date, classId, eventId), { token });
  return {
    count: event.attendance.count,
    capacity: event.attendance.capacity,
    checkedIn: event.checkIn !== null,
    onTimeToCheckIn: event.onTimeToCheckIn,
  };
}

export async function checkIn(
  token: string,
  empresaId: number,
  date: string,
  classId: number,
  eventId: number,
  requestWaitingList: boolean,
): Promise<{ id: number; waitingList: boolean }> {
  return request(
    z.object({ id: z.number(), waitingList: z.boolean() }),
    `${eventPath(empresaId, date, classId, eventId)}/check-in`,
    { token, body: { checkIn: { requestWaitingList } } },
  );
}
