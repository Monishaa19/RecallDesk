import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCheck, Library, Mic, Search, SearchX, Sparkles, X } from "lucide-react";
import { api, ApiError, type Thought } from "../lib/api";
import { dayHeading } from "../lib/format";
import { CompletedSection, splitDone, ThoughtCard } from "../components/ThoughtCard";
import { ReorganizePanel } from "../components/ReorganizePanel";
import { useThoughtsChanged } from "../components/ThoughtDialog";
import { EmptyState, ErrorNotice, Skeleton, Spinner } from "../components/ui";

const PAGE = 50;
const COMPLETED_LIMIT = 100;

function groupByDay(thoughts: Thought[]) {
  const groups: { label: string; items: Thought[] }[] = [];
  for (const t of thoughts) {
    const label = dayHeading(t.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(t);
    else groups.push({ label, items: [t] });
  }
  return groups;
}

const byNewest = (a: Thought, b: Thought) => b.created_at.localeCompare(a.created_at);

const UNSORTED = "Not sorted yet";

/** Group by each thought's main topic; topics with the most recent thought come first. */
function groupByTopic(thoughts: Thought[]) {
  const groups = new Map<string, Thought[]>();
  for (const t of [...thoughts].sort(byNewest)) {
    const topic = t.topics?.[0] ?? UNSORTED;
    groups.set(topic, [...(groups.get(topic) ?? []), t]);
  }
  const entries = [...groups.entries()].map(([label, items]) => ({ label, items }));
  return [...entries.filter((g) => g.label !== UNSORTED), ...entries.filter((g) => g.label === UNSORTED)];
}

type View = "topics" | "timeline";
const VIEW_KEY = "recalldesk:thoughts-view";
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "timeline" ? "timeline" : "topics";
  } catch {
    return "topics";
  }
};

export function ThoughtsPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // List mode: open thoughts (paged) + checked-off thoughts. Search mode: mixed results in `thoughts`.
  const [thoughts, setThoughts] = useState<Thought[] | null>(null);
  const [completed, setCompleted] = useState<Thought[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [organizing, setOrganizing] = useState(false);
  const [reorganizing, setReorganizing] = useState(false);
  const triedOrganize = useRef(false);
  const requestId = useRef(0);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-viewer preference only */
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async (quiet = false) => {
    const id = ++requestId.current;
    setError(null);
    if (!quiet) setThoughts(null);
    try {
      if (debounced) {
        const res = await api.listThoughts({ q: debounced });
        if (id !== requestId.current) return;
        setThoughts(res.thoughts);
        setCursor(null);
        return;
      }
      const [open, done] = await Promise.all([
        api.listThoughts({ status: "active", limit: PAGE }),
        api.listThoughts({ status: "done", limit: COMPLETED_LIMIT }),
      ]);
      if (id !== requestId.current) return;
      setThoughts(open.thoughts);
      setCursor(open.nextCursor);
      setCompleted(done.thoughts);
      setCompletedTotal(done.total);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your thoughts.");
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load]);
  useThoughtsChanged(() => {
    triedOrganize.current = false; // an edit clears a thought's topics; organize it again
    void load();
  });

  // Thoughts saved before topics existed (or just edited) get organized once, in the background.
  useEffect(() => {
    if (debounced || !thoughts || triedOrganize.current) return;
    if (![...thoughts, ...completed].some((t) => !t.topics?.length)) return;
    triedOrganize.current = true;
    setOrganizing(true);
    api
      .categorize()
      .then(({ organized }) => (organized ? load(true) : undefined))
      .catch(() => undefined) // grouping is a nicety; the list still works without it
      .finally(() => setOrganizing(false));
  }, [debounced, thoughts, completed, load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.listThoughts({ status: "active", before: cursor, limit: PAGE });
      setThoughts((prev) => [...(prev ?? []), ...res.thoughts]);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load more thoughts.");
    } finally {
      setLoadingMore(false);
    }
  };

  const searching = Boolean(debounced);

  /** Move a thought between the open list and Completed once its checkbox settles. */
  const onToggled = (updated: Thought) => {
    if (searching) {
      setThoughts((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev);
      return;
    }
    if (updated.done_at) {
      setThoughts((prev) => prev?.filter((t) => t.id !== updated.id) ?? prev);
      setCompleted((prev) => [updated, ...prev.filter((t) => t.id !== updated.id)]);
      setCompletedTotal((n) => n + 1);
    } else {
      setCompleted((prev) => prev.filter((t) => t.id !== updated.id));
      setCompletedTotal((n) => Math.max(0, n - 1));
      setThoughts((prev) => (prev ? [...prev.filter((t) => t.id !== updated.id), updated].sort(byNewest) : prev));
    }
  };

  const nothingAtAll = thoughts !== null && thoughts.length === 0 && completedTotal === 0;
  const search = searching && thoughts ? splitDone(thoughts) : null;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">My Thoughts</h1>
        </div>
        <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setReorganizing((r) => !r);
            chooseView("topics");
          }}
          aria-pressed={reorganizing}
          className={`btn-outline px-3 py-2 ${reorganizing ? "border-accent/40 text-accent" : ""}`}
          title="Tell RecallDesk how to regroup your thoughts"
        >
          <Mic className="size-4" /> Reorganize
        </button>
        <div className="grid grid-cols-2 rounded-xl bg-subtle p-1 text-sm" role="tablist" aria-label="View">
          {(["topics", "timeline"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => chooseView(v)}
              className={`cursor-pointer rounded-lg px-4 py-1.5 transition ${view === v ? "bg-surface font-medium text-ink shadow-card" : "text-muted"}`}
            >
              {v === "topics" ? "Topics" : "Timeline"}
            </button>
          ))}
        </div>
        </div>
      </div>

      {reorganizing && (
        <div className="mt-7">
          <ReorganizePanel onClose={() => setReorganizing(false)} onApplied={() => void load(true)} />
        </div>
      )}

      <div className={`relative ${reorganizing ? "" : "mt-7"}`}>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by word or meaning, e.g. “rendering performance”"
          aria-label="Search thoughts"
          className="input pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint hover:bg-subtle hover:text-ink cursor-pointer"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="mt-8">
        {error && <ErrorNotice message={error} onRetry={() => load()} />}

        {!thoughts && !error && (
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[84px] rounded-2xl" />
            ))}
          </div>
        )}

        {/* ---- Search results ---- */}
        {search && thoughts!.length === 0 && (
          <EmptyState icon={<SearchX className="size-5" />} title="Nothing matched">
            No saved thoughts match “{debounced}”. Try different words, or{" "}
            <Link to="/ask" className="text-accent hover:underline">ask RecallDesk</Link>.
          </EmptyState>
        )}
        {search && thoughts!.length > 0 && (
          <>
            <p className="mb-4 text-sm text-muted">
              {thoughts!.length} {thoughts!.length === 1 ? "thought" : "thoughts"} related to “{debounced}”
            </p>
            <ul className="space-y-3">
              {search.open.map((t) => (
                <li key={t.id} className="animate-fade-in">
                  <ThoughtCard thought={t} onToggled={onToggled} />
                </li>
              ))}
            </ul>
            <CompletedSection thoughts={search.done} onToggled={onToggled} />
          </>
        )}

        {/* ---- Full list ---- */}
        {!searching && nothingAtAll && (
          <EmptyState icon={<Library className="size-5" />} title="No thoughts yet">
            Whatever you capture shows up here.{" "}
            <Link to="/" className="text-accent hover:underline">Capture your first thought</Link>.
          </EmptyState>
        )}

        {!searching && thoughts && !nothingAtAll && (
          <>
            {thoughts.length === 0 && (
              <div className="animate-fade-in flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-5 py-6 text-sm text-muted">
                <CheckCheck className="size-5 text-accent" />
                All caught up. Everything you've captured is ticked off.
              </div>
            )}
            {organizing && (
              <p className="animate-fade-in mb-5 flex items-center gap-2 text-sm text-muted">
                <Sparkles className="size-4 text-accent" /> Organizing your thoughts by topic…
              </p>
            )}
            <div className="space-y-9">
              {(view === "topics" ? groupByTopic(thoughts) : groupByDay(thoughts)).map((g) => (
                <section key={g.label} className="animate-fade-in">
                  <h2 className="sticky top-[57px] z-10 -mx-1 mb-3 flex items-baseline gap-2 bg-canvas/90 px-1 py-1 backdrop-blur md:top-0">
                    {view === "topics" ? (
                      <>
                        <span className="font-serif text-lg text-ink">{g.label}</span>
                        <span className="text-xs text-faint">{g.items.length}</span>
                      </>
                    ) : (
                      <span className="text-xs font-medium uppercase tracking-[0.08em] text-faint">{g.label}</span>
                    )}
                  </h2>
                  <ul className="space-y-3">
                    {g.items.map((t) => (
                      <li key={t.id}>
                        <ThoughtCard thought={t} onToggled={onToggled} hideTopic={view === "topics" ? g.label : undefined} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {cursor && (
                <div className="text-center">
                  <button className="btn-outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore && <Spinner />} Load older thoughts
                  </button>
                </div>
              )}
            </div>
            <CompletedSection thoughts={completed} total={completedTotal} onToggled={onToggled} />
          </>
        )}
      </div>
    </div>
  );
}
