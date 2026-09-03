import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";

export async function encryptToken(kms: KMSClient, keyId: string, userId: string, plaintext: string): Promise<string> {
  const out = await kms.send(
    new EncryptCommand({
      KeyId: keyId,
      Plaintext: Buffer.from(plaintext, "utf8"),
      EncryptionContext: { userId },
    }),
  );
  return Buffer.from(out.CiphertextBlob!).toString("base64");
}

export async function decryptToken(kms: KMSClient, userId: string, blob: string): Promise<string> {
  const out = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(blob, "base64"),
      EncryptionContext: { userId },
    }),
  );
  return Buffer.from(out.Plaintext!).toString("utf8");
}
