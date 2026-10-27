import { scrub } from "@checkin/core/observability/scrub";
import { expect, it } from "vitest";

it("keeps exception type, stack and event message but drops exception values and request data", () => {
  const stacktrace = { frames: [{ filename: "index.mjs", lineno: 1 }] };
  const input = {
    level: "error",
    message: "Possible function timeout",
    request: { url: "https://example.com/convite?token=abc" },
    user: { email: "a@b.c" },
    extra: { body: "x" },
    breadcrumbs: [{ message: "GET /api/schedules" }],
    exception: { values: [{ type: "TecnofitError", value: "login failed for a@b.c", stacktrace }] },
  };
  expect(scrub(input)).toEqual({
    level: "error",
    message: "Possible function timeout",
    exception: { values: [{ type: "TecnofitError", stacktrace }] },
  });
});
