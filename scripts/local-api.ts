import { createServer, type ServerResponse } from "node:http";
import { text } from "node:stream/consumers";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateAliasCommand, CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { CreateScheduleGroupCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { mainTableInput } from "@checkin/core/db/table";
import type { APIGatewayProxyResult } from "@hono/aws-lambda";
import { handler as apiAdmin } from "../apps/functions/api-admin/index.js";
import { handler as apiPublic } from "../apps/functions/api-public/index.js";
import { handler as apiUser } from "../apps/functions/api-user/index.js";
import { handler as authorizer } from "../apps/functions/authorizer-user/index.js";

const { TABLE_MAIN, TABLE_AUDIT, KMS_KEY_ID, SCHEDULE_GROUP, ORIGIN_SECRET } = process.env as Record<string, string>;
const PUBLIC = new Set(["/api/health", "/api/invites/check", "/api/onboarding", "/api/auth/login"]);
const ADMIN_CLAIMS = { sub: "local-admin", "cognito:groups": "[admin]" };

const ignore = (name: string) => (err: Error) => {
  if (err.name !== name) throw err;
};

const dynamo = new DynamoDBClient({});
for (const table of [TABLE_MAIN, TABLE_AUDIT]) {
  await dynamo.send(new CreateTableCommand(mainTableInput(table))).catch(ignore("ResourceInUseException"));
}
const kms = new KMSClient({});
const { KeyMetadata } = await kms.send(new CreateKeyCommand({}));
await kms
  .send(new CreateAliasCommand({ AliasName: KMS_KEY_ID, TargetKeyId: KeyMetadata!.KeyId }))
  .catch(ignore("AlreadyExistsException"));
await new SchedulerClient({})
  .send(new CreateScheduleGroupCommand({ Name: SCHEDULE_GROUP }))
  .catch(ignore("ConflictException"));

const send = (res: ServerResponse, status: number, headers: Record<string, string | string[]>, body?: string | Buffer) =>
  res.writeHead(status, headers).end(body);

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, { "content-type": "application/json" }, JSON.stringify(body));

createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  const path = url.pathname;
  const query = url.searchParams;
  if (path === "/cognito/oauth2/authorize") {
    const params = new URLSearchParams({ code: "local", state: query.get("state") ?? "" });
    return send(res, 302, { location: `${query.get("redirect_uri")}?${params}` });
  }
  if (path === "/cognito/oauth2/token") {
    return json(res, 200, { access_token: "local", expires_in: 3600, token_type: "Bearer" });
  }
  if (path === "/cognito/logout") return send(res, 302, { location: query.get("logout_uri") ?? "/" });
  if (!path.startsWith("/api/")) return json(res, 404, { message: "Not Found" });

  const event = {
    rawPath: path,
    rawQueryString: url.search.slice(1),
    cookies: req.headers.cookie?.split(/;\s*/),
    headers: { ...req.headers, "x-origin-verify": ORIGIN_SECRET },
    body: await text(req),
    requestContext: {
      http: { method: req.method!, sourceIp: req.socket.remoteAddress ?? "", userAgent: req.headers["user-agent"] ?? "" },
    },
  };
  const withAuthorizer = (authorizer: unknown) =>
    ({ ...event, requestContext: { ...event.requestContext, authorizer } }) as never;

  try {
    let result: APIGatewayProxyResult;
    if (path.startsWith("/api/admin/")) {
      if (!req.headers.authorization) return json(res, 401, { message: "Unauthorized" });
      result = (await apiAdmin(withAuthorizer({ jwt: { claims: ADMIN_CLAIMS } }))) as APIGatewayProxyResult;
    } else if (PUBLIC.has(path)) {
      result = (await apiPublic(event as never)) as APIGatewayProxyResult;
    } else {
      const auth = await authorizer(event as never);
      if (!("context" in auth)) return json(res, 403, { message: "Forbidden" });
      result = (await apiUser(withAuthorizer({ lambda: auth.context }))) as APIGatewayProxyResult;
    }
    send(
      res,
      result.statusCode,
      { ...result.headers, "set-cookie": result.cookies ?? [] },
      Buffer.from(result.body, result.isBase64Encoded ? "base64" : "utf8"),
    );
  } catch (err) {
    console.error(err);
    json(res, 500, { message: "Internal Server Error" });
  }
}).listen(3000, () => console.log("local api on :3000"));
