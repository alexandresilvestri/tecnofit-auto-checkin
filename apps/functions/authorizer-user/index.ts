import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createEntities } from "@checkin/core/db/entities";
import { fromCloudFront } from "@checkin/core/http/origin";
import { resolveSession } from "@checkin/core/domain/sessions";
import { withSentry } from "@checkin/core/observability/sentry";
import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";

const entities = createEntities(DynamoDBDocumentClient.from(new DynamoDBClient({})), {
  main: process.env.TABLE_MAIN!,
  audit: process.env.TABLE_AUDIT!,
});

const denied = { isAuthorized: false } as const;

export const handler = withSentry(async (event: APIGatewayRequestAuthorizerEventV2) => {
  if (!fromCloudFront(event.headers?.["x-origin-verify"], process.env.ORIGIN_SECRET!)) return denied;
  const token = event.cookies?.find((c) => c.startsWith("sid="))?.slice(4);
  if (!token) return denied;
  const session = await resolveSession(entities, token);
  if (!session) return denied;
  return { isAuthorized: true, context: { userId: session.userId, sessionId: session.sessionId } };
});
