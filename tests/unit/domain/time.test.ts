import { describe, expect, it } from "vitest";
import { classSlotFor, scheduleExpression, type ScheduleSpec } from "../../../packages/core/domain/time";

describe("scheduleExpression", () => {
  it.each<[ScheduleSpec, string]>([
    [{ kind: "weekly", startTime: "17:15", weekdays: [1] }, "cron(16 5 ? * MON *)"],
    [{ kind: "weekly", startTime: "07:00", weekdays: [1, 3, 5] }, "cron(1 19 ? * SUN,TUE,THU *)"],
    [{ kind: "weekly", startTime: "11:59", weekdays: [2] }, "cron(0 0 ? * TUE *)"],
    [{ kind: "weekly", startTime: "11:58", weekdays: [0] }, "cron(59 23 ? * SAT *)"],
    [{ kind: "once", startTime: "17:15", date: "2026-10-22" }, "at(2026-10-22T05:16:00)"],
    [{ kind: "once", startTime: "07:00", date: "2026-11-01" }, "at(2026-10-31T19:01:00)"],
  ])("%j", (spec, expected) => {
    expect(scheduleExpression(spec)).toBe(expected);
  });
});

describe("classSlotFor", () => {
  it("maps fire time to class slot", () => {
    expect(classSlotFor("2026-10-22T08:16:00Z")).toEqual({ date: "2026-10-22", time: "17:15" });
    expect(classSlotFor("2026-10-20T22:01:00Z")).toEqual({ date: "2026-10-21", time: "07:00" });
  });
});
