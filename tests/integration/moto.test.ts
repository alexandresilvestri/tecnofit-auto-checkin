import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";
import { awsConfig, resetMoto } from "./setup/aws.js";

it("resets moto and lists no tables", async () => {
  await resetMoto();
  const out = await new DynamoDBClient(awsConfig).send(new ListTablesCommand({}));
  expect(out.TableNames).toEqual([]);
});
