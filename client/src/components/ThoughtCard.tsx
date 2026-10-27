import type { Thought } from "../lib/api";
import { formatWhen } from "../lib/format";
import { useOpenThought } from "./ThoughtDialog";

export function ThoughtCard({
  thought,
  highlight = false,
  compact = false,
}: {
  thought: Thought;
  highlight?: boolean;
  compact?: boolean;
}) {
  const open = useOpenThought();
  return (
    <button
      type="button"
      onClick={() => open(thought.id)}
      className={`group block w-full cursor-pointer text-left card transition duration-150 hover:border-line-strong hover:shadow-lift ${
        compact ? "px-4 py-3" : "px-5 py-4"
      } ${highlight ? "animate-fade-up ring-4 ring-accent/10 border-accent/40" : ""}`}
    >
      <p className={`whitespace-pre-line text-ink-soft leading-relaxed ${compact ? "text-sm line-clamp-3" : "text-[15px]"}`}>
        {thought.content}
      </p>
      <p className="mt-2.5 text-xs text-faint">
        <time dateTime={thought.created_at}>{formatWhen(thought.created_at)}</time>
        {thought.updated_at && <span> · edited</span>}
      </p>
    </button>
  );
}
