import { timingSafeEqual } from "node:crypto";

export const fromCloudFront = (header: string | undefined, secret: string): boolean => {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};
