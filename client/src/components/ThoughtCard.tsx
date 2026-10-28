import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { api, ApiError, type Thought } from "../lib/api";
import { formatWhen } from "../lib/format";
import { useOpenThought } from "./ThoughtDialog";
import { useToast } from "./Toast";

/** How long a just-checked thought stays in place (struck through) before moving down. */
const SETTLE_MS = 450;

export function ThoughtCard({
  thought,
  highlight = false,
  compact = false,
  onToggled,
  hideTopic,
}: {
  thought: Thought;
  highlight?: boolean;
  compact?: boolean;
  /** Don't repeat this topic as a chip (it's already the section heading). */
  hideTopic?: string;
  /** When provided, the card shows a checkbox; called with the saved thought once the toggle settles. */
  onToggled?: (updated: Thought) => void;
}) {
  const open = useOpenThought();
  const toast = useToast();
  const [checked, setChecked] = useState(Boolean(thought.done_at));
  const [busy, setBusy] = useState(false);

  useEffect(() => setChecked(Boolean(thought.done_at)), [thought.done_at]);

  const toggle = async () => {
    if (busy) return;
    const next = !checked;
    setChecked(next);
    setBusy(true);
    try {
      const [{ thought: updated }] = await Promise.all([
        api.setDone(thought.id, next),
        new Promise((r) => setTimeout(r, SETTLE_MS)),
      ]);
      onToggled?.(updated);
    } catch (e) {
      setChecked(!next);
      toast(e instanceof ApiError ? e.message : "Couldn't update this thought.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`group flex items-start card transition duration-150 hover:border-line-strong hover:shadow-lift ${
        highlight ? "animate-fade-up ring-4 ring-accent/10 border-accent/40" : ""
      } ${checked ? "bg-surface/70" : ""}`}
    >
      {onToggled && (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={checked ? "Mark as not done" : "Mark as done"}
          onClick={toggle}
          className={`group/check shrink-0 cursor-pointer ${compact ? "py-3 pl-3.5 pr-1" : "py-4 pl-4 pr-1"}`}
        >
          <span
            className={`grid size-5 place-items-center rounded-full border-2 transition duration-200 ${
              checked
                ? "border-accent bg-accent text-white"
                : "border-line-strong text-transparent group-hover/check:border-accent group-hover/check:text-accent/60"
            }`}
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => open(thought.id)}
        className={`min-w-0 flex-1 cursor-pointer text-left ${compact ? "px-4 py-3" : "px-5 py-4"} ${onToggled ? "pl-2.5" : ""}`}
      >
        <p
          className={`whitespace-pre-line leading-relaxed transition-colors duration-200 ${
            compact ? "text-sm line-clamp-3" : "text-[15px]"
          } ${checked ? "text-faint line-through decoration-faint/70" : "text-ink-soft"}`}
        >
          {thought.content}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-faint">
          <time dateTime={thought.created_at}>{formatWhen(thought.created_at)}</time>
          {thought.updated_at && <span>· edited</span>}
          {(thought.topics ?? [])
            .filter((t) => t !== hideTopic)
            .map((t) => (
              <span key={t} className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-muted">
                {t}
              </span>
            ))}
        </div>
      </button>
    </div>
  );
}

/** Collapsible "Completed (n)" section at the bottom of a list, like Google Tasks. */
export function CompletedSection({
  thoughts,
  total,
  onToggled,
  compact = false,
}: {
  thoughts: Thought[];
  total?: number;
  onToggled: (updated: Thought) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = total ?? thoughts.length;
  if (!count) return null;
  return (
    <section className="mt-6 border-t border-line pt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-muted hover:text-ink"
      >
        <ChevronDown className={`size-4 transition ${open ? "" : "-rotate-90"}`} />
        Completed ({count})
      </button>
      {open && (
        <ul className="animate-fade-in mt-3 space-y-2.5">
          {thoughts.map((t) => (
            <li key={t.id}>
              <ThoughtCard thought={t} compact={compact} onToggled={onToggled} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Split a list into open (original order) and checked-off thoughts (most recently checked first). */
export function splitDone(thoughts: Thought[]) {
  const open = thoughts.filter((t) => !t.done_at);
  const done = thoughts
    .filter((t) => t.done_at)
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
  return { open, done };
}
