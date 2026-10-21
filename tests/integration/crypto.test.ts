import { KMSClient } from "@aws-sdk/client-kms";
import { beforeAll, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../../packages/core/crypto/token.js";
import { awsConfig, createKey, resetMoto } from "./setup/aws.js";

const kms = new KMSClient(awsConfig);
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
let keyId: string;

beforeAll(async () => {
  await resetMoto();
  keyId = await createKey(kms);
});

it("round-trips the token for the same user", async () => {
  const blob = await encryptToken(kms, keyId, "user-1", TOKEN);
  expect(await decryptToken(kms, "user-1", blob)).toBe(TOKEN);
});

it("rejects decryption for another user", async () => {
  const blob = await encryptToken(kms, keyId, "user-1", TOKEN);
  await expect(decryptToken(kms, "user-2", blob)).rejects.toThrow();
});

it("does not expose the plaintext in the blob", async () => {
  const blob = await encryptToken(kms, keyId, "user-1", TOKEN);
  expect(blob).not.toContain(TOKEN);
  expect(Buffer.from(blob, "base64").toString("utf8")).not.toContain(TOKEN);
});
