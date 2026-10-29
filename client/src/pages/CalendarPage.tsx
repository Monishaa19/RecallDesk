import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type CalendarEvent, type EventKind } from "../lib/api";
import { formatEventDate, formatEventTime, localDateKey, parseDateKey } from "../lib/format";
import { MicButton } from "../components/MicButton";
import { useOpenThought, useThoughtsChanged } from "../components/ThoughtDialog";
import { useToast } from "../components/Toast";
import { ErrorNotice, Spinner } from "../components/ui";

const KIND_STYLE: Record<EventKind, { label: string; dot: string; chip: string }> = {
  deadline: { label: "Deadline", dot: "bg-danger", chip: "bg-danger-soft text-danger" },
  exam: { label: "Exam", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800" },
  meeting: { label: "Meeting", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800" },
  appointment: { label: "Appointment", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-800" },
  reminder: { label: "Reminder", dot: "bg-accent", chip: "bg-accent-soft text-accent-ink" },
  event: { label: "Event", dot: "bg-accent", chip: "bg-accent-soft text-accent-ink" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The 6-week grid (Monday first) that contains the given month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i));
}

const byTime = (a: CalendarEvent, b: CalendarEvent) =>
  a.event_date.localeCompare(b.event_date) || (a.event_time ?? "").localeCompare(b.event_time ?? "");

export function CalendarPage() {
  const toast = useToast();
  const openThought = useOpenThought();
  const [params, setParams] = useSearchParams();
  const today = localDateKey();
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const [view, setView] = useState(() => {
    const d = parseDateKey(selected);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const grid = useMemo(() => monthGrid(view.year, view.month), [view]);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [upcoming, setUpcoming] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [month, next] = await Promise.all([
        api.calendar(localDateKey(grid[0]), localDateKey(grid[grid.length - 1])),
        api.upcoming(localDateKey(), 6),
      ]);
      setEvents(month.events);
      setUpcoming(next.events);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your calendar.");
    }
  }, [grid]);

  useEffect(() => {
    void load();
  }, [load]);
  // Deleting a thought also removes its dates.
  useThoughtsChanged(load);

  // Keep the visible month in step when a link opens a specific date.
  useEffect(() => {
    const d = parseDateKey(selected);
    setView((v) => (v.year === d.getFullYear() && v.month === d.getMonth() ? v : { year: d.getFullYear(), month: d.getMonth() }));
  }, [selected]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) map.set(e.event_date, [...(map.get(e.event_date) ?? []), e]);
    return map;
  }, [events]);

  const select = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("date", key);
    setParams(next, { replace: true });
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setEvents(null);
  };

  const goToday = () => {
    const d = new Date();
    setView({ year: d.getFullYear(), month: d.getMonth() });
    select(today);
  };

  const remove = async (ev: CalendarEvent) => {
    setEvents((list) => list?.filter((e) => e.id !== ev.id) ?? null);
    setUpcoming((list) => list?.filter((e) => e.id !== ev.id) ?? null);
    try {
      await api.deleteEvent(ev.id);
      toast("Removed from your calendar.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't remove that.", "error");
      void load();
    }
  };

  const added = (ev: CalendarEvent) => {
    setEvents((list) => (list ? [...list, ev].sort(byTime) : list));
    if (ev.event_date >= today) setUpcoming((list) => (list ? [...list, ev].sort(byTime).slice(0, 6) : list));
  };

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <div>
        <h1 className="page-title">Calendar</h1>
        <p className="mt-1.5 text-muted">Mention a date when you capture a thought and it shows up here.</p>
      </div>

      {error && <ErrorNotice className="mt-6" message={error} onRetry={load} />}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card p-3 sm:p-5" aria-label="Month">
          <div className="flex items-center justify-between gap-2 px-1">
            <button onClick={() => shiftMonth(-1)} className="btn-ghost p-2" aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-ink">{monthLabel}</h2>
              {!events && !error && <Spinner className="size-3.5 text-faint" />}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={goToday} className="btn-ghost px-2.5 py-1.5 text-sm">
                Today
              </button>
              <button onClick={() => shiftMonth(1)} className="btn-ghost p-2" aria-label="Next month">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-faint">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((date) => {
              const key = localDateKey(date);
              const inMonth = date.getMonth() === view.month;
              const isSel = key === selected;
              const isToday = key === today;
              const list = byDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  onClick={() => select(key)}
                  aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${
                    list.length ? `, ${list.length} ${list.length === 1 ? "item" : "items"}` : ""
                  }`}
                  aria-pressed={isSel}
                  className={`flex min-h-14 cursor-pointer flex-col rounded-xl border p-1.5 text-left transition sm:min-h-24 ${
                    isSel ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20" : "border-transparent hover:bg-subtle"
                  } ${inMonth ? "" : "opacity-40"}`}
                >
                  <span
                    className={`grid size-6 place-items-center rounded-full text-[13px] ${
                      isToday ? "bg-accent font-semibold text-white" : "text-ink-soft"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {/* Phones: dots. Larger screens: titles. */}
                  {list.length > 0 && (
                    <>
                      <span className="mt-1 flex flex-wrap gap-0.5 px-0.5 sm:hidden">
                        {list.slice(0, 4).map((e) => (
                          <span key={e.id} className={`size-1.5 rounded-full ${KIND_STYLE[e.kind].dot}`} />
                        ))}
                      </span>
                      <span className="mt-1 hidden w-full space-y-0.5 sm:block">
                        {list.slice(0, 2).map((e) => (
                          <span
                            key={e.id}
                            className={`block truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight ${KIND_STYLE[e.kind].chip} ${
                              e.thought?.done_at ? "line-through opacity-60" : ""
                            }`}
                          >
                            {e.title}
                          </span>
                        ))}
                        {list.length > 2 && <span className="block px-1.5 text-[11px] text-faint">+{list.length - 2} more</span>}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <div className="space-y-6">
          <section className="card p-4 sm:p-5" aria-label="Selected day" aria-live="polite">
            <h2 className="flex items-center gap-2 font-medium text-ink">
              <CalendarDays className="size-4 text-accent" strokeWidth={1.75} />
              {parseDateKey(selected).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            {events && dayEvents.length === 0 && <p className="mt-3 text-sm text-muted">Nothing on this day.</p>}
            {dayEvents.length > 0 && (
              <ul className="mt-3 space-y-2">
                {dayEvents.map((e) => (
                  <EventRow key={e.id} event={e} onRemove={() => remove(e)} onOpenThought={openThought} />
                ))}
              </ul>
            )}
            <AddEvent date={selected} onAdded={added} />
          </section>

          <section aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading" className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-faint">
              Coming up
            </h2>
            {upcoming && upcoming.length === 0 && (
              <p className="text-sm text-muted">
                Nothing yet. Try capturing "DBMS assignment due this Friday" and it will appear here.
              </p>
            )}
            {upcoming && upcoming.length > 0 && (
              <ul className="space-y-1.5">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => select(e.event_date)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-subtle"
                    >
                      <span className={`size-2 shrink-0 rounded-full ${KIND_STYLE[e.kind].dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm text-ink ${e.thought?.done_at ? "line-through opacity-60" : ""}`}>
                          {e.title}
                        </span>
                        <span className="block text-xs text-muted">
                          {formatEventDate(e.event_date)}
                          {e.event_time ? ` · ${formatEventTime(e.event_time)}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function EventRow({
  event: e,
  onRemove,
  onOpenThought,
}: {
  event: CalendarEvent;
  onRemove: () => void;
  onOpenThought: (id: string) => void;
}) {
  const style = KIND_STYLE[e.kind];
  return (
    <li className="group rounded-xl border border-line bg-canvas/50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium text-ink ${e.thought?.done_at ? "line-through opacity-60" : ""}`}>{e.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${style.chip}`}>{style.label}</span>
            {e.event_time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {formatEventTime(e.event_time)}
              </span>
            )}
          </div>
        </div>
        <button onClick={onRemove} className="btn-ghost -mr-1 p-1.5 text-faint hover:text-danger" aria-label={`Remove ${e.title}`}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {e.thought && (
        <button
          onClick={() => onOpenThought(e.thought!.id)}
          className="mt-2 line-clamp-2 cursor-pointer text-left text-xs text-muted hover:text-accent"
          title="Open the thought this came from"
        >
          From your thought: {e.thought.content}
        </button>
      )}
    </li>
  );
}

function AddEvent({ date, onAdded }: { date: string; onAdded: (e: CalendarEvent) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState<EventKind>("event");
  const [saving, setSaving] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const { event } = await api.addEvent({ title: title.trim(), date, time: time || null, kind });
      onAdded(event);
      toast(`Added to ${formatEventDate(date)}.`);
      setTitle("");
      setTime("");
      setOpen(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't add that.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost mt-3 -ml-2 px-2 py-1.5 text-sm text-accent">
        <Plus className="size-4" /> Add something to this day
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2 border-t border-line pt-4">
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
          placeholder="e.g. Project demo"
          aria-label="What's happening?"
          className="input min-w-0 flex-1"
        />
        <MicButton value={title} onChange={setTitle} disabled={saving} />
      </div>
      <div className="flex gap-2">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" className="input w-32" />
        <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} aria-label="Kind" className="input min-w-0 flex-1">
          {(Object.keys(KIND_STYLE) as EventKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_STYLE[k].label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!title.trim() || saving}>
          {saving && <Spinner />} Add
        </button>
      </div>
    </form>
  );
}
