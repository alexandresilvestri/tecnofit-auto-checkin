import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createEntities } from "../../../packages/core/db/entities.js";
import { mainTableInput } from "../../../packages/core/db/table.js";

export const MOTO_ENDPOINT =
  process.env.MOTO_ENDPOINT ?? "http://localhost:5000";

export const awsConfig = {
  endpoint: MOTO_ENDPOINT,
  region: "sa-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

export async function resetMoto(): Promise<void> {
  await fetch(`${MOTO_ENDPOINT}/moto-api/reset`, { method: "POST" });
}

export async function createMainTable(): Promise<string> {
  const name = "checkin-test-main";
  await new DynamoDBClient(awsConfig).send(
    new CreateTableCommand(mainTableInput(name)),
  );
  return name;
}

export async function createTestEntities() {
  return createEntities(DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig)), await createMainTable());
}

export async function createKey(kms: KMSClient): Promise<string> {
  return (await kms.send(new CreateKeyCommand({}))).KeyMetadata!.KeyId!;
}
