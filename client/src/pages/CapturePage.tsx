import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { api, ApiError, type Thought } from "../lib/api";
import { greeting } from "../lib/format";
import { ThoughtCard } from "../components/ThoughtCard";
import { MicButton } from "../components/MicButton";
import { notifyThoughtsChanged, useThoughtsChanged } from "../components/ThoughtDialog";
import { useToast } from "../components/Toast";
import { ErrorNotice, Skeleton, Spinner } from "../components/ui";

const RECENT_COUNT = 5;

export function CapturePage() {
  const toast = useToast();
  const [text, setText] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [recent, setRecent] = useState<Thought[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadRecent = useCallback(async () => {
    setRecentError(null);
    try {
      const { thoughts } = await api.listThoughts({ limit: RECENT_COUNT });
      setRecent(thoughts);
    } catch (e) {
      setRecentError(e instanceof ApiError ? e.message : "Couldn't load your recent thoughts.");
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);
  useThoughtsChanged(loadRecent);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`;
  }, [text]);

  const capture = async () => {
    if (!text.trim() || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      const { thought } = await api.capture(text);
      // Only now has the database confirmed the save.
      setText("");
      setJustSaved(thought.id);
      setRecent((r) => [thought, ...(r ?? [])].slice(0, RECENT_COUNT));
      toast("Thought captured.");
      notifyThoughtsChanged();
      textareaRef.current?.focus();
    } catch (e) {
      setCaptureError(e instanceof ApiError ? e.message : "Couldn't capture that thought. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void capture();
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const { saved, failed } = await api.seedDemo();
      toast(failed ? `Added ${saved.length} sample thoughts (${failed} failed).` : `Added ${saved.length} sample thoughts.`);
      notifyThoughtsChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't add sample thoughts.", "error");
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6 md:pt-20">
      <header className="animate-fade-up">
        <p className="text-sm text-muted">{greeting()}</p>
        <h1 className="mt-1 font-serif text-[40px] leading-[1.1] tracking-[-0.015em] sm:text-[46px]">Your thoughts, remembered.</h1>
        <p className="mt-3 text-[16px] text-muted">Capture anything now. Find it whenever you need it.</p>
      </header>

      <section
        className="card mt-9 overflow-hidden transition focus-within:border-accent/50 focus-within:shadow-lift focus-within:ring-4 focus-within:ring-accent/10"
        aria-label="Capture a thought"
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What's on your mind?"
          rows={4}
          maxLength={8000}
          autoFocus
          disabled={capturing}
          aria-label="What's on your mind?"
          className="block min-h-[136px] w-full resize-none bg-transparent px-5 pt-5 pb-2 text-[17px] leading-relaxed text-ink placeholder:text-faint focus:outline-none disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 bg-canvas/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <MicButton value={text} onChange={setText} disabled={capturing} showLabel />
            <p className="hidden text-xs text-faint sm:block">Tap to speak, or use Wispr Flow.</p>
          </div>
          <div className="flex items-center gap-3">
            <kbd className="hidden text-[11px] text-faint sm:inline">Ctrl + Enter</kbd>
            <button onClick={capture} disabled={!text.trim() || capturing} className="btn-primary min-w-[118px]">
              {capturing ? (
                <>
                  <Spinner /> Capturing…
                </>
              ) : (
                "Capture"
              )}
            </button>
          </div>
        </div>
      </section>

      {captureError && <ErrorNotice className="mt-4" message={captureError} onRetry={capture} />}

      <section className="mt-14" aria-labelledby="recent-heading">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="recent-heading" className="text-xs font-medium uppercase tracking-[0.08em] text-faint">
            Recent thoughts
          </h2>
          {recent && recent.length > 0 && (
            <Link to="/thoughts" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
              View all <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>

        {recentError && <ErrorNotice message={recentError} onRetry={loadRecent} />}
        {!recent && !recentError && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[84px] rounded-2xl" />
            ))}
          </div>
        )}
        {recent && recent.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
            <p className="text-sm text-muted">Nothing here yet. Your captured thoughts will appear here.</p>
            <button onClick={seed} disabled={seeding} className="btn-ghost mt-3 text-accent">
              {seeding ? <Spinner /> : <Sparkles className="size-4" />}
              {seeding ? "Capturing sample thoughts…" : "Try it with sample thoughts"}
            </button>
          </div>
        )}
        {recent && recent.length > 0 && (
          <ul className="space-y-3">
            {recent.map((t) => (
              <li key={t.id}>
                <ThoughtCard thought={t} highlight={t.id === justSaved} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
