import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const REGION = "sa-east-1";

export async function loadEnv() {
  const env = process.env.CHECKIN_ENV ?? "dev";
  const { Account } = await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  return {
    table: `checkin-${env}-main`,
    keyId: `alias/checkin-${env}-token`,
    group: `checkin-${env}`,
    workerArn: `arn:aws:lambda:${REGION}:${Account}:function:checkin-${env}-checkin-worker`,
    roleArn: `arn:aws:iam::${Account}:role/checkin-${env}-scheduler-invoke`,
    region: REGION,
  };
}
