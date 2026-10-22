import { useState, type SubmitEvent } from "react";
import { errorMessage, get, guard, post } from "../api";
import { Nav } from "../Nav";
import { WEEKDAYS } from "./Schedules";

type Cls = { name: string; time: string; count: number; capacity: number };

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
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

  function fail(e: unknown) {
    if (!guard(e)) setError(errorMessage(e));
  }

  async function search() {
    setError("");
    setSelected(undefined);
    setClasses(undefined);
    try {
      setClasses(await get<Cls[]>(`/api/classes?date=${date}`));
    } catch (e) {
      fail(e);
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
    <form onSubmit={submit}>
      <Nav />
      <h1>Novo agendamento</h1>
      <label htmlFor="date">Data</label>
      <input
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
      <button type="button" onClick={search} disabled={!date}>Buscar aulas</button>
      {classes?.length === 0 && <p>Nenhuma aula nesta data.</p>}
      {classes && classes.length > 0 && (
        <fieldset>
          <legend>Aula</legend>
          {classes.map((c) => (
            <label key={`${c.time}-${c.name}`} className="check" htmlFor={`c-${c.time}-${c.name}`}>
              <input
                id={`c-${c.time}-${c.name}`}
                type="radio"
                name="class"
                checked={selected === c}
                onChange={() => setSelected(c)}
              />
              {c.time} — {c.name} ({c.count}/{c.capacity})
            </label>
          ))}
        </fieldset>
      )}
      {selected && (
        <>
          <label className="check" htmlFor="weekly">
            <input
              id="weekly"
              type="checkbox"
              checked={weekly}
              onChange={(e) => toggleWeekly(e.target.checked)}
            />
            Toda semana
          </label>
          {weekly && (
            <fieldset>
              <legend>Dias</legend>
              {WEEKDAYS.map((label, day) => (
                <label key={label} className="check" htmlFor={`d-${day}`}>
                  <input
                    id={`d-${day}`}
                    type="checkbox"
                    checked={weekdays.includes(day)}
                    onChange={(e) => toggleDay(day, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {!weekly && <p>Só neste dia</p>}
          <label className="check" htmlFor="waiting">
            <input
              id="waiting"
              type="checkbox"
              checked={waiting}
              onChange={(e) => setWaiting(e.target.checked)}
            />
            Lista de espera
          </label>
        </>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" disabled={!selected || busy || (weekly && weekdays.length === 0)}>
        Salvar
      </button>
    </form>
  );
}
