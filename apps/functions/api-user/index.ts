import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { writeAudit } from "@checkin/core/audit/audit";
import { createEntities } from "@checkin/core/db/entities";
import { revokeSession, touchSession } from "@checkin/core/domain/sessions";
import { handle } from "@hono/aws-lambda";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

type Env = {
  Bindings: {
    event: {
      requestContext: {
        http: { sourceIp: string; userAgent: string };
        authorizer: { lambda: { userId: string; sessionId: string } };
      };
    };
  };
};

const logger = new Logger({ serviceName: "api-user" });
const entities = createEntities(DynamoDBDocumentClient.from(new DynamoDBClient({})), {
  main: process.env.TABLE_MAIN!,
  audit: process.env.TABLE_AUDIT!,
});

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  if (c.req.method === "POST" && c.req.header("x-requested-with") !== "fetch") {
    logger.info("request", { route: c.req.path, status: 403 });
    return c.json({ message: "Requisição inválida." }, 403);
  }
  await next();
  logger.info("request", { route: c.req.path, status: c.res.status });
});

app.onError((err, c) => {
  logger.warn("request failed", { route: c.req.path, status: 500, error: err.name });
  return c.json({ message: "Erro inesperado." }, 500);
});

const session = (c: Context<Env>) => c.env.event.requestContext.authorizer.lambda;

const cookieOptions = { httpOnly: true, secure: true, sameSite: "Strict", path: "/api" } as const;

app.get("/api/me", async (c) => {
  const { userId, sessionId } = session(c);
  const { data: profile } = await entities.profile.get({ userId }).go();
  if (!profile) return c.json({ message: "Sessão inválida." }, 401);
  const {
    data: [account],
  } = await entities.account.query.byUser({ userId }).go({ limit: 1 });
  const token = getCookie(c, "sid");
  if (token && (await touchSession(entities, sessionId, Date.now())))
    setCookie(c, "sid", token, { ...cookieOptions, maxAge: 34560000 });
  return c.json({ name: profile.name, boxName: account?.boxName, accountStatus: account?.status });
});

app.post("/api/auth/logout", async (c) => {
  const { userId } = session(c);
  const token = getCookie(c, "sid");
  if (token) await revokeSession(entities, token);
  const { sourceIp, userAgent } = c.env.event.requestContext.http;
  await writeAudit(
    entities,
    { actorType: "user", actorId: userId, action: "user.logout", result: "success", ip: sourceIp, userAgent },
    Date.now(),
  );
  deleteCookie(c, "sid", cookieOptions);
  return c.body(null, 204);
});

export const handler = handle(app);
