import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createEntities } from "@checkin/core/db/entities";

const REGION = "us-east-1";

export async function loadEnv() {
  const env = process.env.CHECKIN_ENV ?? "dev";
  const { Account } = await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  return {
    entities: createEntities(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION })),
      `checkin-${env}-main`,
    ),
    kms: new KMSClient({ region: REGION }),
    scheduler: new SchedulerClient({ region: REGION }),
    keyId: `alias/checkin-${env}-token`,
    group: `checkin-${env}`,
    workerArn: `arn:aws:lambda:${REGION}:${Account}:function:checkin-${env}-checkin-worker`,
    roleArn: `arn:aws:iam::${Account}:role/checkin-${env}-scheduler-invoke`,
  };
}
