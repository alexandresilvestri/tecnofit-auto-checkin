import { fromCloudFront } from "@checkin/core/http/origin";
import { expect, it } from "vitest";

it("accepts the matching secret", () => {
  expect(fromCloudFront("s3cret", "s3cret")).toBe(true);
});

it.each([["wrong"], ["s3cret-longer"], ["s3"], [""], [undefined]])("rejects %j", (header) => {
  expect(fromCloudFront(header, "s3cret")).toBe(false);
});

it("rejects an empty secret even with an empty header", () => {
  expect(fromCloudFront("", "")).toBe(false);
});
