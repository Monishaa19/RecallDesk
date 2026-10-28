import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api, ApiError, type SummaryResponse, type Thought } from "../lib/api";
import { localDateKey, localMonthKey } from "../lib/format";
import { CompletedSection, splitDone, ThoughtCard } from "../components/ThoughtCard";
import { useThoughtsChanged } from "../components/ThoughtDialog";
import { EmptyState, ErrorNotice, RichText, Skeleton, Spinner } from "../components/ui";

type Mode = "day" | "month";

const parseDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shiftDay = (key: string, n: number) => {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return localDateKey(d);
};
const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  return localMonthKey(new Date(y, m - 1 + n, 1));
};

function WeekStrip({ selected, onSelect }: { selected: string; onSelect: (key: string) => void }) {
  const today = localDateKey();
  // Seven days ending at the selected day (or today, if selected is within the last week).
  const end = selected > shiftDay(today, -4) ? today : shiftDay(selected, 3);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(end, i - 6));
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const [activity, setActivity] = useState<Record<string, number>>({});

  const monthsKey = months.join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(monthsKey.split(",").map((m) => api.activity(m)))
      .then((rs) => alive && setActivity(Object.assign({}, ...rs.map((r) => r.days))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [monthsKey]);

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((d) => {
        const date = parseDay(d);
        const isSel = d === selected;
        const future = d > today;
        const count = activity[d] ?? 0;
        return (
          <button
            key={d}
            disabled={future}
            onClick={() => onSelect(d)}
            aria-pressed={isSel}
            aria-label={`${date.toDateString()}${count ? `, ${count} thoughts` : ""}`}
            className={`flex cursor-pointer flex-col items-center rounded-xl py-2.5 transition disabled:cursor-default disabled:opacity-35 ${
              isSel ? "bg-accent text-white shadow-card" : "hover:bg-subtle text-ink-soft"
            }`}
          >
            <span className={`text-[11px] ${isSel ? "text-white/80" : "text-faint"}`}>
              {date.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
            <span className="mt-0.5 text-[15px] font-medium">{date.getDate()}</span>
            <span className={`mt-1 size-1.5 rounded-full ${count ? (isSel ? "bg-white" : "bg-accent/70") : "bg-transparent"}`} />
          </button>
        );
      })}
    </div>
  );
}

export function SummariesPage() {
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(localDateKey());
  const [month, setMonth] = useState(localMonthKey());
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = mode === "day" ? day : month;
  const today = localDateKey();
  const thisMonth = localMonthKey();

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      if (!refresh) setData(null);
      try {
        setData(await api.summary(mode, key, refresh));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't generate the summary.");
      } finally {
        setLoading(false);
      }
    },
    [mode, key],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useThoughtsChanged(() => void load());

  const title = useMemo(() => {
    if (mode === "day") {
      if (day === today) return "Today";
      if (day === shiftDay(today, -1)) return "Yesterday";
      return parseDay(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [mode, day, month, today]);

  const prev = () => (mode === "day" ? setDay(shiftDay(day, -1)) : setMonth(shiftMonth(month, -1)));
  const next = () => (mode === "day" ? setDay(shiftDay(day, 1)) : setMonth(shiftMonth(month, 1)));
  const atLatest = mode === "day" ? day >= today : month >= thisMonth;
  const count = data?.thoughts.length ?? 0;
  const sources = data ? splitDone(data.thoughts) : null;

  // Ticking a thought here only changes its status; the summary text stays as generated.
  const onToggled = (updated: Thought) =>
    setData((d) => (d ? { ...d, thoughts: d.thoughts.map((t) => (t.id === updated.id ? updated : t)) } : d));

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Summaries</h1>
          <p className="mt-1.5 text-muted">A gentle look back at what you captured.</p>
        </div>
        <div className="grid grid-cols-2 rounded-xl bg-subtle p-1 text-sm" role="tablist" aria-label="Summary period">
          {(["day", "month"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`cursor-pointer rounded-lg px-4 py-1.5 transition ${mode === m ? "bg-surface font-medium text-ink shadow-card" : "text-muted"}`}
            >
              {m === "day" ? "Daily" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      <div className="card mt-8 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <button onClick={prev} className="btn-ghost p-2" aria-label={mode === "day" ? "Previous day" : "Previous month"}>
            <ChevronLeft className="size-4" />
          </button>
          <label className="relative flex items-center gap-2 rounded-lg px-2 py-1 font-medium hover:bg-subtle cursor-pointer">
            <CalendarDays className="size-4 text-accent" strokeWidth={1.75} />
            {title}
            <input
              type={mode === "day" ? "date" : "month"}
              value={key}
              max={mode === "day" ? today : thisMonth}
              onChange={(e) => e.target.value && (mode === "day" ? setDay(e.target.value) : setMonth(e.target.value))}
              onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={mode === "day" ? "Choose a day" : "Choose a month"}
            />
          </label>
          <button onClick={next} disabled={atLatest} className="btn-ghost p-2" aria-label={mode === "day" ? "Next day" : "Next month"}>
            <ChevronRight className="size-4" />
          </button>
        </div>
        {mode === "day" && (
          <div className="mt-4 border-t border-line pt-4">
            <WeekStrip selected={day} onSelect={setDay} />
          </div>
        )}
      </div>

      <section className="mt-6" aria-live="polite">
        {error && <ErrorNotice message={error} onRetry={() => load()} />}

        {!data && !error && (
          <div className="card space-y-3 p-6">
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-3.5" /> Reading your thoughts…
            </p>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}

        {data && !data.summary && (
          <div className="card">
            <EmptyState icon={<CalendarDays className="size-5" />} title="A quiet one">
              No thoughts were captured {mode === "day" ? "on this day" : "this month"}.
            </EmptyState>
          </div>
        )}

        {data?.summary && (
          <article className="card animate-fade-up p-6 sm:p-7">
            <RichText text={data.summary} className="font-serif text-[19px] leading-[1.6] text-ink" />
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-sm text-muted">
                Based on {count} {count === 1 ? "thought" : "thoughts"}
              </p>
              <button onClick={() => load(true)} disabled={loading} className="btn-ghost -mr-2 px-3 py-1.5 text-xs text-muted">
                {loading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />} Regenerate
              </button>
            </div>
          </article>
        )}

        {data?.summary && sources && (
          <div className="animate-fade-in mt-8">
            <h2 className="mb-3 flex items-baseline justify-between text-xs font-medium uppercase tracking-[0.08em] text-faint">
              <span>{mode === "day" ? "Thoughts from this day" : "Thoughts from this month"}</span>
              <span className="normal-case tracking-normal">
                {sources.open.length} open · {sources.done.length} done
              </span>
            </h2>
            <ul className="space-y-2.5">
              {sources.open.map((t) => (
                <li key={t.id}>
                  <ThoughtCard thought={t} compact onToggled={onToggled} />
                </li>
              ))}
            </ul>
            {sources.open.length === 0 && (
              <p className="px-1 text-sm text-muted">Everything from {mode === "day" ? "this day" : "this month"} is ticked off.</p>
            )}
            <CompletedSection thoughts={sources.done} onToggled={onToggled} compact />
          </div>
        )}
      </section>
    </div>
  );
}
