import { createHash, randomBytes } from "node:crypto";

export function hashSecret(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSecret(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecret(token) };
}
