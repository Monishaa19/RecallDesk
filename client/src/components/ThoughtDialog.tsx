import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Trash2, X } from "lucide-react";
import { api, ApiError, type Thought } from "../lib/api";
import { formatFull } from "../lib/format";
import { useToast } from "./Toast";
import { ErrorNotice, Skeleton, Spinner } from "./ui";

/** Lists listen for this to refresh after an edit/delete/capture. */
export const THOUGHTS_CHANGED = "recalldesk:thoughts-changed";
export const notifyThoughtsChanged = () => window.dispatchEvent(new Event(THOUGHTS_CHANGED));

export function useThoughtsChanged(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(THOUGHTS_CHANGED, handler);
    return () => window.removeEventListener(THOUGHTS_CHANGED, handler);
  }, []);
}

/** Open any saved thought in a dialog via the ?thought=<id> URL param (shareable, back-button friendly). */
export function useOpenThought() {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set("thought", id);
      setParams(next);
    },
    [params, setParams],
  );
}

export function ThoughtDialog() {
  const [params, setParams] = useSearchParams();
  const id = params.get("thought");
  const toast = useToast();
  const [thought, setThought] = useState<Thought | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("thought");
    setParams(next);
  }, [params, setParams]);

  const load = useCallback(async () => {
    if (!id) return;
    setThought(null);
    setError(null);
    try {
      const { thought } = await api.getThought(id);
      setThought(thought);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this thought.");
    }
  }, [id]);

  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [id, close]);

  if (!id) return null;

  const save = async () => {
    if (!thought || !draft.trim()) return;
    setBusy("save");
    try {
      const { thought: updated } = await api.updateThought(thought.id, draft.trim());
      setThought(updated);
      setEditing(false);
      notifyThoughtsChanged();
      toast("Thought updated.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save changes.", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!thought) return;
    setBusy("delete");
    try {
      await api.deleteThought(thought.id);
      notifyThoughtsChanged();
      toast("Thought deleted.");
      close();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't delete this thought.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={close} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Saved thought"
        className="animate-fade-up relative w-full max-w-lg rounded-t-3xl bg-surface p-6 shadow-lift outline-none sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-faint">Saved thought</p>
          <button onClick={close} className="btn-ghost -mr-2 p-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {error && <ErrorNotice message={error} onRetry={load} />}
        {!error && !thought && (
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-4 h-3 w-40" />
          </div>
        )}

        {thought && !editing && (
          <>
            <p className="whitespace-pre-line font-serif text-[21px] leading-[1.5] text-ink">{thought.content}</p>
            <p className="mt-4 text-sm text-muted">
              Captured {formatFull(thought.created_at)}
              {thought.updated_at && <span className="text-faint"> · edited</span>}
            </p>
            <div className="mt-6 flex items-center justify-end gap-1 border-t border-line pt-4">
              {confirmDelete ? (
                <>
                  <span className="mr-auto text-sm text-muted">Delete this thought?</span>
                  <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button className="btn bg-danger text-white hover:bg-danger/90" onClick={remove} disabled={busy === "delete"}>
                    {busy === "delete" ? <Spinner /> : <Trash2 className="size-4" />} Delete
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-4" /> Delete
                  </button>
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setDraft(thought.content);
                      setEditing(true);
                    }}
                  >
                    <Pencil className="size-4" /> Edit
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {thought && editing && (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              autoFocus
              maxLength={4000}
              className="input resize-none leading-relaxed"
              aria-label="Edit thought"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={busy === "save" || !draft.trim()}>
                {busy === "save" && <Spinner />} Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
