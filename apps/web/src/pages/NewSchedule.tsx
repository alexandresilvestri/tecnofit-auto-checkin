import { useState, type SubmitEvent } from "react";
import { errorMessage, get, guard, post } from "../api";
import { Button } from "../ui/Button";
import { Check } from "../ui/Check";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { PageHeader } from "../ui/PageHeader";
import { Pending } from "../ui/Pending";
import { WEEKDAYS } from "./Schedules";
import { ErrorText } from "../ui/Text";

type Cls = { name: string; time: string; count: number; capacity: number };

const today = () => new Date().toLocaleDateString("sv-SE");
const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay();

export function NewSchedule() {
  const [date, setDate] = useState(today);
  const [classes, setClasses] = useState<Cls[]>();
  const [selected, setSelected] = useState<Cls>();
  const [weekly, setWeekly] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  function fail(e: unknown) {
    if (!guard(e)) setError(errorMessage(e));
  }

  async function search() {
    setError("");
    setSelected(undefined);
    setClasses(undefined);
    setSearching(true);
    try {
      setClasses(await get<Cls[]>(`/api/classes?date=${date}`));
    } catch (e) {
      fail(e);
    } finally {
      setSearching(false);
    }
  }

  function toggleWeekly(on: boolean) {
    setWeekly(on);
    setWeekdays(on ? [weekdayOf(date)] : []);
  }

  function toggleDay(day: number, on: boolean) {
    setWeekdays((current) => (on ? [...current, day] : current.filter((d) => d !== day)));
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
        date,
        kind: weekly ? "weekly" : "once",
        ...(weekly && { weekdays: [...weekdays].sort() }),
        allowWaitingList: waiting,
      });
      location.assign("/app");
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeader title="Novo agendamento" />
      <div className="flex items-end gap-2">
        <Field label="Data" htmlFor="date" className="flex-1">
          <Input
            id="date"
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setWeekly(false);
              setWeekdays([]);
              setClasses(undefined);
              setSelected(undefined);
            }}
          />
        </Field>
        <Button variant="secondary" onClick={search} disabled={!date || searching}>Buscar aulas</Button>
      </div>
      {classes?.length === 0 && <p className="text-fg-muted">Nenhuma aula nesta data.</p>}
      {classes && classes.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-sm/5 text-fg">Aula</legend>
          {classes.map((c) => (
            <label
              key={`${c.time}-${c.name}`}
              className="flex h-10 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm/5 text-fg-emphasis hover:bg-interactive"
              htmlFor={`c-${c.time}-${c.name}`}
            >
              <input id={`c-${c.time}-${c.name}`} type="radio" name="class" checked={selected === c} onChange={() => setSelected(c)} />
              {c.time} — {c.name} <span className="text-fg-muted">({c.count}/{c.capacity})</span>
            </label>
          ))}
        </fieldset>
      )}
      {selected && (
        <>
          <Check id="weekly" label="Toda semana" checked={weekly} onChange={(e) => toggleWeekly(e.target.checked)} />
          {weekly && (
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-2 text-sm/5 text-fg">Dias</legend>
              {WEEKDAYS.map((label, day) => (
                <Check key={label} id={`d-${day}`} label={label} checked={weekdays.includes(day)} onChange={(e) => toggleDay(day, e.target.checked)} />
              ))}
            </fieldset>
          )}
          {!weekly && <p className="text-fg-muted">Só neste dia</p>}
          <Check id="waiting" label="Lista de espera" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} />
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" disabled={!selected || busy || (weekly && weekdays.length === 0)}>
        Salvar
      </Button>
      {searching && <Pending title="Buscando aulas" />}
      {busy && <Pending title="Salvando agendamento" />}
    </form>
  );
}
