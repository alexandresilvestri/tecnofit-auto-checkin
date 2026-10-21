import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
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
