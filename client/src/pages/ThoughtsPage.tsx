import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Library, Search, SearchX, X } from "lucide-react";
import { api, ApiError, type Thought } from "../lib/api";
import { dayHeading } from "../lib/format";
import { ThoughtCard } from "../components/ThoughtCard";
import { useThoughtsChanged } from "../components/ThoughtDialog";
import { EmptyState, ErrorNotice, Skeleton, Spinner } from "../components/ui";

const PAGE = 30;

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

export function ThoughtsPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [thoughts, setThoughts] = useState<Thought[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    setThoughts(null);
    try {
      const res = await api.listThoughts({ q: debounced || undefined, limit: PAGE });
      if (id !== requestId.current) return;
      setThoughts(res.thoughts);
      setCursor(res.nextCursor);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your thoughts.");
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load]);
  useThoughtsChanged(load);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.listThoughts({ before: cursor, limit: PAGE });
      setThoughts((prev) => [...(prev ?? []), ...res.thoughts]);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load more thoughts.");
    } finally {
      setLoadingMore(false);
    }
  };

  const searching = Boolean(debounced);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <h1 className="page-title">My Thoughts</h1>
      <p className="mt-1.5 text-muted">Everything you've captured, newest first.</p>

      <div className="relative mt-7">
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
        {error && <ErrorNotice message={error} onRetry={load} />}

        {!thoughts && !error && (
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[84px] rounded-2xl" />
            ))}
          </div>
        )}

        {thoughts && thoughts.length === 0 && searching && (
          <EmptyState icon={<SearchX className="size-5" />} title="Nothing matched">
            No saved thoughts match “{debounced}”. Try different words, or{" "}
            <Link to="/ask" className="text-accent hover:underline">ask RecallDesk</Link>.
          </EmptyState>
        )}

        {thoughts && thoughts.length === 0 && !searching && (
          <EmptyState icon={<Library className="size-5" />} title="No thoughts yet">
            Whatever you capture shows up here.{" "}
            <Link to="/" className="text-accent hover:underline">Capture your first thought</Link>.
          </EmptyState>
        )}

        {thoughts && thoughts.length > 0 && searching && (
          <>
            <p className="mb-4 text-sm text-muted">
              {thoughts.length} {thoughts.length === 1 ? "thought" : "thoughts"} related to “{debounced}”
            </p>
            <ul className="space-y-3">
              {thoughts.map((t) => (
                <li key={t.id} className="animate-fade-in">
                  <ThoughtCard thought={t} />
                </li>
              ))}
            </ul>
          </>
        )}

        {thoughts && thoughts.length > 0 && !searching && (
          <div className="space-y-9">
            {groupByDay(thoughts).map((g) => (
              <section key={g.label} className="animate-fade-in">
                <h2 className="sticky top-[57px] z-10 -mx-1 mb-3 bg-canvas/90 px-1 py-1 text-xs font-medium uppercase tracking-[0.08em] text-faint backdrop-blur md:top-0">
                  {g.label}
                </h2>
                <ul className="space-y-3">
                  {g.items.map((t) => (
                    <li key={t.id}>
                      <ThoughtCard thought={t} />
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
        )}
      </div>
    </div>
  );
}
