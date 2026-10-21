import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createEntities } from "@checkin/core/db/entities";
import { AccountExists, InvalidCredentials, InviteInvalid, checkInvite, redeemInvite, requestMeta } from "@checkin/core/domain/invites";
import { LoginLocked, SESSION_COOKIE, loginUser } from "@checkin/core/domain/sessions";
import { TecnofitError, TecnofitInvalidResponse } from "@checkin/core/tecnofit/client";
import { handle } from "@hono/aws-lambda";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";

type Env = { Bindings: { event: { requestContext: { http: { sourceIp: string; userAgent: string } } } } };

const logger = new Logger({ serviceName: "api-public" });
const deps = {
  entities: createEntities(DynamoDBDocumentClient.from(new DynamoDBClient({})), {
    main: process.env.TABLE_MAIN!,
    audit: process.env.TABLE_AUDIT!,
  }),
  kms: new KMSClient({}),
  keyId: process.env.KMS_KEY_ID!,
  now: Date.now,
};

const token = z.string().min(1).max(128);
const email = z.email().max(254);
const password = z.string().min(1).max(256);
const checkSchema = z.object({ token });
const onboardingSchema = z.object({
  token,
  email,
  password,
  consentVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const loginSchema = z.object({ email, password });

const invalidRequest = { message: "Requisição inválida." };

const mapError = (err: unknown): [400 | 401 | 409 | 410 | 429 | 500 | 502, string] => {
  if (err instanceof InviteInvalid) return [410, "Convite inválido ou expirado."];
  if (err instanceof AccountExists) return [409, "Esta conta já está cadastrada. Faça login."];
  if (err instanceof InvalidCredentials) return [401, "E-mail ou senha inválidos."];
  if (err instanceof LoginLocked) return [429, "Muitas tentativas. Tente novamente em 15 minutos."];
  if ((err instanceof TecnofitError && err.status >= 500) || err instanceof TecnofitInvalidResponse)
    return [502, "Tecnofit indisponível. Tente novamente em instantes."];
  return [500, "Erro inesperado."];
};

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  if (c.req.method === "POST" && c.req.header("x-requested-with") !== "fetch") {
    logger.info("request", { route: c.req.path, status: 403 });
    return c.json(invalidRequest, 403);
  }
  await next();
  logger.info("request", { route: c.req.path, status: c.res.status });
});

app.onError((err, c) => {
  const [status, message] = mapError(err);
  logger.warn("request failed", { route: c.req.path, status, error: err.name });
  return c.json({ message }, status);
});

const parse = async <S extends z.ZodType>(c: Context<Env>, schema: S) => {
  const body = schema.safeParse(await c.req.json().catch(() => undefined));
  return body.success ? body.data : null;
};

const meta = (c: Context<Env>) => {
  const { sourceIp, userAgent } = c.env.event.requestContext.http;
  return requestMeta(c.req.header("cloudfront-viewer-address"), sourceIp, userAgent);
};

const setSession = (c: Context<Env>, token: string) =>
  setCookie(c, "sid", token, SESSION_COOKIE);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/invites/check", async (c) => {
  const input = await parse(c, checkSchema);
  if (!input) return c.json(invalidRequest, 400);
  return c.json({ valid: await checkInvite(deps, input.token) });
});

app.post("/api/onboarding", async (c) => {
  const input = await parse(c, onboardingSchema);
  if (!input) return c.json(invalidRequest, 400);
  const { sessionToken } = await redeemInvite(deps, input, meta(c));
  setSession(c, sessionToken);
  return c.json({}, 201);
});

app.post("/api/auth/login", async (c) => {
  const input = await parse(c, loginSchema);
  if (!input) return c.json(invalidRequest, 400);
  const { sessionToken } = await loginUser(deps, input, meta(c));
  setSession(c, sessionToken);
  return c.body(null, 204);
});

export const handler = handle(app);
