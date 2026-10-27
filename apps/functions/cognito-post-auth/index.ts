import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { writeAudit } from "@checkin/core/audit/audit";
import { createEntities } from "@checkin/core/db/entities";
import { withSentry } from "@checkin/core/observability/sentry";

const entities = createEntities(DynamoDBDocumentClient.from(new DynamoDBClient({})), {
  main: process.env.TABLE_MAIN!,
  audit: process.env.TABLE_AUDIT!,
});

export const handler = withSentry(async <E extends { request: { userAttributes: { sub: string } } }>(event: E): Promise<E> => {
  await writeAudit(
    entities,
    { actorType: "admin", actorId: event.request.userAttributes.sub, action: "admin.login", result: "success" },
    Date.now(),
  );
  return event;
});
