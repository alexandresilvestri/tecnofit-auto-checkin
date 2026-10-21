import { describe, expect, it } from "vitest";
import { hashSecret, newSecret } from "../../../packages/core/crypto/secret";

describe("secret", () => {
  it("makes a 43-char base64url token and matching sha-256 hex hash", () => {
    const { token, hash } = newSecret();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(token)).toBe(hash);
  });

  it("makes distinct secrets", () => {
    expect(newSecret().token).not.toBe(newSecret().token);
  });
});
