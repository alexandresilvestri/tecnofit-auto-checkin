import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { runCheckin } from "@checkin/core/domain/checkin";
import { createEntities } from "@checkin/core/db/entities";
import { z } from "zod";

const logger = new Logger({ serviceName: "checkin-worker" });
const kms = new KMSClient({});
const entities = createEntities(
  DynamoDBDocumentClient.from(new DynamoDBClient({})),
  { main: process.env.TABLE_MAIN!, audit: process.env.TABLE_AUDIT! },
);

const eventSchema = z.object({
  userId: z.string().min(1),
  scheduleId: z.string().min(1),
  scheduledTime: z.string().min(1),
});

const deps = {
  entities,
  kms,
  now: Date.now,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export const handler = async (event: z.infer<typeof eventSchema>) => {
  const input = eventSchema.parse(event);
  try {
    const status = await runCheckin(deps, input);
    logger.info("checkin", { ...input, status });
    return status;
  } catch (err) {
    logger.error("checkin failed", { ...input, error: err instanceof Error ? err.name : "unknown" });
    throw err;
  }
};
