import { expect, it } from "vitest";
import { handler } from "../../../apps/functions/checkin-worker/index";

it("stub handler resolves ok", async () => {
  await expect(handler()).resolves.toEqual({ ok: true });
});
