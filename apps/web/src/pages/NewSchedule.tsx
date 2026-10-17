import { useState, type SubmitEvent } from "react";
import { errorMessage, get, guard, post } from "../api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Pending } from "../ui/Pending";
import { WEEKDAYS, checkinLabel, checkinTime, dayList, shortDate } from "./Schedules";
import { ErrorText } from "../ui/Text";

type Cls = { name: string; time: string; count: number; capacity: number };

const DAY_NAME = ["no domingo", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado"];
const TOO_LATE = "O check-in desta aula já foi liberado. Faça pelo app da Tecnofit.";
const CHOICE =
  "relative flex h-8 items-center justify-center rounded-lg text-sm/5 font-semibold text-fg hover:text-fg-emphasis has-checked:bg-accent has-checked:text-fg-on-accent";
const CHOICE_INPUT = "absolute inset-0 size-full cursor-pointer appearance-none rounded-[inherit]";

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};
const dateFor = (day: number, week: number) => addDays(((day - new Date().getDay() + 7) % 7) + week * 7);
const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay();

function nextSlot(days: number[], time: string) {
  for (let i = 0; i < 8; i++) {
    const date = addDays(i);
    const slot = `${date} ${time}`;
    if (days.includes(weekdayOf(date)) && checkinTime(slot) > Date.now()) return slot;
  }
  return "";
}

export function NewSchedule() {
  const [weekly, setWeekly] = useState(false);
  const [date, setDate] = useState(() => addDays(0));
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [refDate, setRefDate] = useState("");
  const [missing, setMissing] = useState<number>();
  const [classes, setClasses] = useState<Cls[]>();
  const [selected, setSelected] = useState<Cls>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  function fail(e: unknown) {
    if (!guard(e)) setError(errorMessage(e));
  }

  function reset() {
    setClasses(undefined);
    setSelected(undefined);
    setMissing(undefined);
  }

  async function searchWeekly() {
    const found = await Promise.all(
      weekdays.map(async (day) => {
        for (const date of [dateFor(day, 0), dateFor(day, 1)]) {
          const list = await get<Cls[]>(`/api/classes?date=${date}`);
          if (list.length) return { date, list };
        }
      }),
    );
    const empty = found.indexOf(undefined);
    if (empty >= 0) return setMissing(weekdays[empty]);
    const [first, ...rest] = found as { date: string; list: Cls[] }[];
    setRefDate(first.date);
    setClasses(first.list.filter((c) => rest.every((r) => r.list.some((o) => o.name === c.name && o.time === c.time))));
  }

  async function search() {
    setError("");
    reset();
    setSearching(true);
    try {
      if (weekly) await searchWeekly();
      else setClasses(await get<Cls[]>(`/api/classes?date=${date}`));
    } catch (e) {
      fail(e);
    } finally {
      setSearching(false);
    }
  }

  function chooseFrequency(on: boolean) {
    setWeekly(on);
    setWeekdays([]);
    reset();
  }

  function toggleDay(day: number, on: boolean) {
    setWeekdays((current) => (on ? [...current, day].sort() : current.filter((d) => d !== day)));
    reset();
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/schedules", {
        className: selected.name,
        startTime: selected.time,
        date: weekly ? refDate : date,
        kind: weekly ? "weekly" : "once",
        ...(weekly && { weekdays }),
      });
      location.assign("/app");
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  const slot = selected && (weekly ? nextSlot(weekdays, selected.time) : `${date} ${selected.time}`);
  const tooLate = !weekly && !!slot && checkinTime(slot) <= Date.now();

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeader title="Novo agendamento" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm/5 text-fg">Com que frequência?</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line-interactive bg-interactive p-1">
          {([[false, "Uma vez"], [true, "Toda semana"]] as const).map(([value, label]) => (
            <label key={label} className={CHOICE}>
              <input type="radio" name="frequency" className={CHOICE_INPUT} checked={weekly === value} onChange={() => chooseFrequency(value)} />
              {label}
            </label>
          ))}
        </div>
        <p className="text-sm/5 text-fg-muted">
          {weekly ? "Repete nos dias marcados, até você pausar ou excluir." : "Check-in só na data escolhida."}
        </p>
      </fieldset>
      {weekly ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm/5 text-fg">Dias</legend>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((label, day) => (
              <label key={label} className={`${CHOICE} border border-line-interactive`}>
                <input type="checkbox" className={CHOICE_INPUT} checked={weekdays.includes(day)} onChange={(e) => toggleDay(day, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <Button variant="secondary" className="self-start" onClick={search} disabled={!weekdays.length || searching}>
            Buscar aulas
          </Button>
        </fieldset>
      ) : (
        <div className="flex items-end gap-2">
          <Field label="Data" htmlFor="date" className="min-w-0 flex-1">
            <Input
              id="date"
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                reset();
              }}
            />
          </Field>
          <Button variant="secondary" onClick={search} disabled={!date || searching}>Buscar aulas</Button>
        </div>
      )}
      {missing !== undefined && (
        <p className="text-fg-muted">Sem aulas publicadas {DAY_NAME[missing]}. Desmarque o dia ou tente mais tarde.</p>
      )}
      {classes?.length === 0 && (
        <p className="text-fg-muted">{weekly ? "Nenhuma aula em comum nesses dias." : "Nenhuma aula nesta data."}</p>
      )}
      {classes && classes.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-sm/5 text-fg">{weekly ? `Aulas em ${dayList(weekdays)}` : "Aula"}</legend>
          {classes.map((c) => (
            <label
              key={`${c.time}-${c.name}`}
              className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm/5 text-fg-emphasis hover:bg-interactive"
              htmlFor={`c-${c.time}-${c.name}`}
            >
              <input id={`c-${c.time}-${c.name}`} type="radio" name="class" checked={selected === c} onChange={() => setSelected(c)} />
              {c.time} — {c.name}
              {!weekly && <span className="text-fg-muted">({c.count}/{c.capacity})</span>}
            </label>
          ))}
        </fieldset>
      )}
      {selected && slot && (
        <Card compact className="flex flex-col items-start gap-2">
          <Badge tone="neutral">{weekly ? "Toda semana" : "Uma vez"}</Badge>
          <p className="font-semibold text-fg-emphasis">
            {selected.name}, {weekly ? dayList(weekdays) : `${WEEKDAYS[weekdayOf(date)].toLowerCase()} ${shortDate(date)}`}, {selected.time}
          </p>
          <p className={`text-sm/5 ${tooLate ? "text-warning-11" : "text-fg"}`}>
            {tooLate ? TOO_LATE : `${weekly ? "Próximo check-in" : "Check-in"}: ${checkinLabel(slot)}`}
          </p>
        </Card>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" disabled={!selected || busy || tooLate}>
        {weekly ? "Agendar toda semana" : "Agendar uma vez"}
      </Button>
      {searching && <Pending title="Buscando aulas" />}
      {busy && <Pending title="Salvando agendamento" />}
    </form>
  );
}
