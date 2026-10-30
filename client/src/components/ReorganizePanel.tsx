import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, RotateCcw, Sparkles, X } from "lucide-react";
import { api, ApiError, type TopicChange } from "../lib/api";
import { useToast } from "./Toast";
import { ErrorNotice, Spinner } from "./ui";
import { MicButton } from "./MicButton";

const EXAMPLES = [
  "Move the teammate UI one from Team Updates to Databases",
  "Combine Team Updates, Databases and DSA into Placement Prep",
  "Rename Personal to Life Admin",
];

function Chips({ topics, muted = false }: { topics: string[]; muted?: boolean }) {
  if (!topics.length) return <span className="text-xs italic text-faint">no topic</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {topics.map((t, i) => (
        <span
          key={t}
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            muted ? "bg-subtle text-faint line-through" : i === 0 ? "bg-accent-soft font-medium text-accent-ink" : "bg-subtle text-muted"
          }`}
        >
          {t}
        </span>
      ))}
    </span>
  );
}

/**
 * Lets the person reorganize topics in their own words (typed, spoken via the mic, or dictated with Wispr Flow):
 * instruction -> AI preview -> Apply -> optional Undo. Only topics ever change.
 */
export function ReorganizePanel({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const toast = useToast();
  const [instruction, setInstruction] = useState("");
  const [thinking, setThinking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ reply: string; changes: TopicChange[] } | null>(null);
  const [undo, setUndo] = useState<{ id: string; topics: string[] }[] | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const plan = async () => {
    if (!instruction.trim() || thinking) return;
    setThinking(true);
    setError(null);
    setPreview(null);
    setUndo(null);
    try {
      setPreview(await api.reorganizePreview(instruction.trim()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't work that out. Please try again.");
    } finally {
      setThinking(false);
    }
  };

  const apply = async () => {
    if (!preview?.changes.length) return;
    setApplying(true);
    try {
      await api.reorganizeApply(preview.changes.map((c) => ({ id: c.id, topics: c.to })));
      setUndo(preview.changes.map((c) => ({ id: c.id, topics: c.from })));
      const n = preview.changes.length;
      toast(`Reorganized ${n} ${n === 1 ? "thought" : "thoughts"}.`);
      setPreview(null);
      setInstruction("");
      onApplied();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't apply those changes.", "error");
    } finally {
      setApplying(false);
    }
  };

  const revert = async () => {
    if (!undo) return;
    setApplying(true);
    try {
      await api.reorganizeApply(undo);
      setUndo(null);
      toast("Undone.");
      onApplied();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't undo.", "error");
    } finally {
      setApplying(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void plan();
    }
  };

  return (
    <section className="card animate-fade-up mb-8 overflow-hidden" aria-label="Reorganize topics">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="flex items-center gap-2 font-medium text-ink">
            <Sparkles className="size-4 text-accent" /> Reorganize in your own words
          </h2>
          <p className="mt-1 text-sm text-muted">Say how you'd like things grouped. You'll see a preview before anything changes.</p>
        </div>
        <button onClick={onClose} className="btn-ghost -mr-2 p-2" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="px-5 pt-3">
        <textarea
          ref={ref}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={2000}
          disabled={thinking}
          placeholder="e.g. Move the caching one into DSA"
          aria-label="How should your thoughts be reorganized?"
          className="input min-h-[72px] resize-none leading-relaxed"
        />
        {!instruction && !preview && !undo && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setInstruction(ex)}
                className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent/40 hover:text-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 bg-canvas/40 px-5 py-3">
        <div className="flex items-center gap-3">
          <MicButton value={instruction} onChange={setInstruction} disabled={thinking} />
          <p className="text-xs text-faint">Only topics change, never your thoughts.</p>
        </div>
        <button onClick={plan} disabled={!instruction.trim() || thinking} className="btn-outline">
          {thinking ? <Spinner /> : <Sparkles className="size-4" />} {thinking ? "Working it out…" : "Preview changes"}
        </button>
      </div>

      {error && <ErrorNotice className="m-4" message={error} onRetry={plan} />}

      {preview && (
        <div className="animate-fade-in border-t border-line px-5 py-4">
          <p className="text-[15px] leading-relaxed text-ink">{preview.reply}</p>
          {preview.changes.length > 0 && (
            <>
              <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                {preview.changes.map((c) => (
                  <li key={c.id} className="rounded-xl border border-line bg-canvas/50 px-3 py-2.5">
                    <p className="line-clamp-2 text-sm text-ink-soft">{c.content}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Chips topics={c.from} muted />
                      <ArrowRight className="size-3.5 text-faint" />
                      <Chips topics={c.to} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => setPreview(null)}>Cancel</button>
                <button className="btn-primary" onClick={apply} disabled={applying}>
                  {applying && <Spinner />} Apply {preview.changes.length} {preview.changes.length === 1 ? "change" : "changes"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {undo && !preview && (
        <div className="animate-fade-in flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
          Done. Not what you meant?
          <button className="btn-ghost px-3 py-1.5" onClick={revert} disabled={applying}>
            {applying ? <Spinner /> : <RotateCcw className="size-4" />} Undo
          </button>
        </div>
      )}
    </section>
  );
}
