export const TZ = "America/Sao_Paulo";
export const FIRE_BEFORE_CLASS_MIN = 719;

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_MIN = 1440;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function zonedParts(at: Date): { date: string; time: string } {
  const p = Object.fromEntries(formatter.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export type ScheduleSpec =
  | { kind: "weekly"; startTime: string; weekdays: number[] }
  | { kind: "once"; startTime: string; date: string };

const pad = (n: number) => String(n).padStart(2, "0");

export function scheduleExpression(spec: ScheduleSpec): string {
  const [h, m] = spec.startTime.split(":").map(Number);
  const total = h * 60 + m - FIRE_BEFORE_CLASS_MIN;
  const dayDelta = Math.floor(total / DAY_MIN);
  const minOfDay = total - dayDelta * DAY_MIN;
  const hour = Math.floor(minOfDay / 60);
  const minute = minOfDay % 60;
  if (spec.kind === "weekly") {
    const days = spec.weekdays
      .map((d) => (((d + dayDelta) % 7) + 7) % 7)
      .sort((a, b) => a - b)
      .map((d) => DAYS[d]);
    return `cron(${minute} ${hour} ? * ${days.join(",")} *)`;
  }
  const [y, mo, d] = spec.date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + dayDelta)).toISOString().slice(0, 10);
  return `at(${shifted}T${pad(hour)}:${pad(minute)}:00)`;
}

export function classSlotFor(scheduledTime: string): { date: string; time: string } {
  return zonedParts(new Date(Date.parse(scheduledTime) + FIRE_BEFORE_CLASS_MIN * 60_000));
}
