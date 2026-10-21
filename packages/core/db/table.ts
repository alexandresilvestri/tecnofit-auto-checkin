import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";

const gsi = (name: string) => ({
  IndexName: name,
  KeySchema: [
    { AttributeName: `${name}PK`, KeyType: "HASH" as const },
    { AttributeName: `${name}SK`, KeyType: "RANGE" as const },
  ],
  Projection: { ProjectionType: "ALL" as const },
});

export function mainTableInput(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      "PK",
      "SK",
      "GSI1PK",
      "GSI1SK",
      "GSI2PK",
      "GSI2SK",
    ].map((AttributeName) => ({
      AttributeName,
      AttributeType: "S",
    })),
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: [gsi("GSI1"), gsi("GSI2")],
  };
}

export function auditTableInput(tableName: string): CreateTableCommandInput {
  return mainTableInput(tableName);
}
