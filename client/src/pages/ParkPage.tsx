import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronDown, KeyRound, Lock, LockOpen, ShieldCheck, Trash2, Wind } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatWhen } from "../lib/format";
import {
  createParkKeys,
  openThought,
  sealThought,
  unlockParkKey,
  WrongCodeError,
  type ParkKeys,
  type SealedThought,
} from "../lib/parkCrypto";
import { useToast } from "../components/Toast";
import { ErrorNotice, Skeleton, Spinner } from "../components/ui";
import { MicButton } from "../components/MicButton";

interface ParkedMeta {
  id: string;
  created_at: string;
}

const MIN_CODE = 6;

/**
 * "Park it": a place to set a thought down without having to look at it again.
 * Talks to Supabase directly with the user's session (RLS-protected); the text is
 * encrypted in the browser first, so neither the RecallDesk server nor the AI ever sees it.
 */
export function ParkPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ParkKeys | null | undefined>(undefined);
  const [parked, setParked] = useState<ParkedMeta[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoadError(null);
    const [k, p] = await Promise.all([
      supabase.from("park_keys").select("public_key, wrapped_private_key, wrap_iv, salt, iterations").maybeSingle(),
      // Only ids and dates: the encrypted text isn't even downloaded until the person unlocks.
      supabase.from("parked_thoughts").select("id, created_at").order("created_at", { ascending: false }).limit(500),
    ]);
    if (k.error || p.error) {
      setLoadError("Couldn't open your parked thoughts. Please try again.");
      return;
    }
    setKeys((k.data as ParkKeys | null) ?? null);
    setParked((p.data ?? []) as ParkedMeta[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <h1 className="page-title">Park it</h1>
      <p className="mt-1.5 text-muted">Set a thought down so you don't have to carry it. It's locked with a code only you know.</p>

      <div className="mt-8">
        {loadError && <ErrorNotice message={loadError} onRetry={load} />}
        {keys === undefined && !loadError && <Skeleton className="h-48 rounded-2xl" />}
        {keys === null && <SetupCode onReady={(k) => setKeys(k)} />}
        {keys && (
          <>
            <ParkBox keys={keys} onParked={(m) => setParked((p) => [m, ...p])} />
            <ParkedList
              keys={keys}
              parked={parked}
              onRemoved={(id) => setParked((p) => p.filter((x) => x.id !== id))}
              onReset={() => {
                setKeys(null);
                setParked([]);
                toast("Everything parked has been let go.");
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function SetupCode({ onReady }: { onReady: (keys: ParkKeys) => void }) {
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (code.length < MIN_CODE) return setError(`Use at least ${MIN_CODE} characters.`);
    if (code !== confirm) return setError("The two codes don't match.");
    setBusy(true);
    setError(null);
    try {
      const keys = await createParkKeys(code);
      const { error } = await supabase.from("park_keys").insert(keys);
      if (error) throw new Error("save");
      setCode("");
      setConfirm("");
      onReady(keys);
    } catch (err) {
      setError(err instanceof Error && err.message !== "save" ? err.message : "Couldn't set up your secret code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card animate-fade-up space-y-5 p-6 sm:p-7">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <KeyRound className="size-5" />
        </div>
        <div>
          <h2 className="font-serif text-xl">Choose a secret code</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Parked thoughts are encrypted on this device before they're saved. You won't need the code to park something,
            only if you ever want to read it again.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">Secret code</span>
          <input className="input" type="password" autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">Type it again</span>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-subtle px-3.5 py-3 text-sm text-ink-soft">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>
          I understand that if I forget this code, my parked thoughts <strong className="font-medium">can't be recovered</strong> by anyone,
          including RecallDesk.
        </span>
      </label>
      {error && <ErrorNotice message={error} />}
      <button type="submit" className="btn-primary w-full py-3 sm:w-auto" disabled={busy || !understood || !code || !confirm}>
        {busy ? <Spinner /> : <ShieldCheck className="size-4" />} {busy ? "Creating your lock…" : "Set my code"}
      </button>
    </form>
  );
}

function ParkBox({ keys, onParked }: { keys: ParkKeys; onParked: (m: ParkedMeta) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justParked, setJustParked] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [text]);

  const park = async () => {
    if (!supabase || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sealed = await sealThought(text.trim(), keys.public_key);
      const { data, error } = await supabase.from("parked_thoughts").insert(sealed).select("id, created_at").single();
      if (error || !data) throw new Error();
      setText("");
      setJustParked(true);
      setTimeout(() => setJustParked(false), 4000);
      onParked(data as ParkedMeta);
    } catch {
      setError("Couldn't park that right now. Your text is still here, so please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void park();
    }
  };

  return (
    <section className="card overflow-hidden transition focus-within:border-accent/50 focus-within:shadow-lift focus-within:ring-4 focus-within:ring-accent/10">
      {justParked ? (
        <div className="animate-fade-in flex min-h-[136px] flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <Wind className="size-6 text-accent" />
          <p className="font-serif text-xl text-ink">Parked. You can let it go now.</p>
          <p className="text-sm text-muted">It's locked away and won't come up anywhere else.</p>
        </div>
      ) : (
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What do you want to set down?"
          rows={4}
          maxLength={10000}
          disabled={busy}
          aria-label="Thought to park"
          className="block min-h-[136px] w-full resize-none bg-transparent px-5 pt-5 pb-2 text-[17px] leading-relaxed text-ink placeholder:text-faint focus:outline-none disabled:opacity-60"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 bg-canvas/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <MicButton value={text} onChange={setText} disabled={busy || justParked} />
        </div>
        <button onClick={park} disabled={!text.trim() || busy} className="btn-primary min-w-[110px]">
          {busy ? <Spinner /> : <Lock className="size-4" />} {busy ? "Locking…" : "Park it"}
        </button>
      </div>
      {error && <ErrorNotice className="m-4 mt-0" message={error} />}
    </section>
  );
}

function ParkedList({
  keys,
  parked,
  onRemoved,
  onReset,
}: {
  keys: ParkKeys;
  parked: ParkedMeta[];
  onRemoved: (id: string) => void;
  onReset: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // The unlocked key and decrypted text live only in memory, and only while this view is open.
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const lock = () => {
    setPrivateKey(null);
    setTexts({});
    setCode("");
  };
  useEffect(() => lock, []);

  const decryptAll = async (key: CryptoKey) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("parked_thoughts")
      .select("id, ciphertext, iv, wrapped_key")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("load");
    const out: Record<string, string> = {};
    for (const row of (data ?? []) as (SealedThought & { id: string })[]) {
      try {
        out[row.id] = await openThought(row, key);
      } catch {
        out[row.id] = "(This one couldn't be decrypted.)";
      }
    }
    setTexts(out);
  };

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!code) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const key = await unlockParkKey(code, keys);
      await decryptAll(key);
      setPrivateKey(key);
      setCode("");
    } catch (err) {
      setUnlockError(err instanceof WrongCodeError ? err.message : "Couldn't unlock right now. Please try again.");
    } finally {
      setUnlocking(false);
    }
  };

  const letGo = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("parked_thoughts").delete().eq("id", id);
    if (error) return toast("Couldn't remove that one. Please try again.", "error");
    setConfirmId(null);
    setTexts(({ [id]: _removed, ...rest }) => rest);
    onRemoved(id);
    toast("Let go.");
  };

  const startOver = async () => {
    if (!supabase) return;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;
    const a = await supabase.from("parked_thoughts").delete().eq("user_id", userId);
    const b = a.error ? a : await supabase.from("park_keys").delete().eq("user_id", userId);
    if (a.error || b.error) return toast("Couldn't start over. Please try again.", "error");
    lock();
    onReset();
  };

  if (!parked.length) {
    return <p className="mt-6 px-1 text-sm text-faint">Nothing parked yet. Whatever you park stays private to you.</p>;
  }

  return (
    <section className="mt-8">
      <button
        onClick={() => {
          if (open) lock();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-muted hover:text-ink"
      >
        <ChevronDown className={`size-4 transition ${open ? "" : "-rotate-90"}`} />
        <Lock className="size-3.5" /> {parked.length} parked {parked.length === 1 ? "thought" : "thoughts"}
      </button>

      {open && (
        <div className="animate-fade-in mt-3 space-y-3">
          {!privateKey ? (
            <form onSubmit={unlock} className="card flex flex-wrap items-end gap-3 p-4">
              <label className="min-w-[200px] flex-1">
                <span className="mb-1.5 block text-sm text-ink-soft">Enter your secret code to read them</span>
                <input className="input" type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <button type="submit" className="btn-outline" disabled={unlocking || !code}>
                {unlocking ? <Spinner /> : <LockOpen className="size-4" />} Unlock
              </button>
              {unlockError && <ErrorNotice className="w-full" message={unlockError} />}
            </form>
          ) : (
            <div className="flex justify-end">
              <button onClick={lock} className="btn-ghost text-sm">
                <Lock className="size-4" /> Lock again
              </button>
            </div>
          )}

          <ul className="space-y-2.5">
            {parked.map((p) => (
              <li key={p.id} className="card px-4 py-3">
                {privateKey && texts[p.id] !== undefined ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{texts[p.id]}</p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-faint">
                    <Lock className="size-3.5" /> Locked
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-faint">
                  <span>Parked {formatWhen(p.created_at)}</span>
                  {confirmId === p.id ? (
                    <span className="flex items-center gap-2">
                      Let it go for good?
                      <button className="cursor-pointer font-medium text-danger hover:underline" onClick={() => letGo(p.id)}>Yes</button>
                      <button className="cursor-pointer hover:underline" onClick={() => setConfirmId(null)}>No</button>
                    </span>
                  ) : (
                    <button className="inline-flex cursor-pointer items-center gap-1 hover:text-danger" onClick={() => setConfirmId(p.id)}>
                      <Trash2 className="size-3.5" /> Let it go
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="pt-2 text-xs text-faint">
            {confirmReset ? (
              <span className="flex flex-wrap items-center gap-2">
                This permanently deletes every parked thought and your code.
                <button className="cursor-pointer font-medium text-danger hover:underline" onClick={startOver}>Delete everything</button>
                <button className="cursor-pointer hover:underline" onClick={() => setConfirmReset(false)}>Cancel</button>
              </span>
            ) : (
              <button className="cursor-pointer hover:text-ink hover:underline" onClick={() => setConfirmReset(true)}>
                Forgot your code? Start over
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
