import { useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ErrorNotice, Logo, Spinner } from "../components/ui";

export function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setCheckEmail(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg === "Failed to fetch" ? "Can't reach the sign-in service. Check your connection." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <Logo className="mx-auto size-11" />
          <h1 className="mt-5 font-serif text-[34px] leading-tight tracking-tight">Your thoughts, remembered.</h1>
          <p className="mt-2 text-[15px] text-muted">Capture anything now. Find it whenever you need it.</p>
        </div>

        <div className="card p-6">
          {checkEmail ? (
            <div className="py-4 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
                <MailCheck className="size-5" />
              </div>
              <h2 className="mt-4 font-medium">Check your inbox</h2>
              <p className="mt-1.5 text-sm text-muted">
                We sent a confirmation link to <span className="text-ink">{email}</span>. Open it, then sign in.
              </p>
              <button
                className="btn-outline mt-5 w-full"
                onClick={() => {
                  setCheckEmail(false);
                  setMode("signin");
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 rounded-xl bg-subtle p-1 text-sm" role="tablist">
                {(["signin", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => {
                      setMode(m);
                      setError(null);
                    }}
                    className={`rounded-lg py-2 transition cursor-pointer ${mode === m ? "bg-surface font-medium text-ink shadow-card" : "text-muted"}`}
                  >
                    {m === "signin" ? "Sign in" : "Create account"}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm text-ink-soft">Email</span>
                <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-ink-soft">Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={6}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "signup" && <span className="mt-1.5 block text-xs text-faint">At least 6 characters.</span>}
              </label>
              {error && <ErrorNotice message={error} />}
              <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
                {busy && <Spinner />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-faint">Your thoughts are private to your account.</p>
      </div>
    </div>
  );
}

export function SetupRequired() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-lg p-8">
        <Logo className="size-10" />
        <h1 className="mt-5 font-serif text-3xl">Almost there</h1>
        <p className="mt-2 text-muted">
          RecallDesk needs a Supabase project for sign-in and storage. Add these to the <code className="rounded bg-subtle px-1.5 py-0.5 text-sm">.env</code> file
          in the project root, then restart <code className="rounded bg-subtle px-1.5 py-0.5 text-sm">npm run dev</code>:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-subtle p-4 text-sm text-ink-soft">
          {`VITE_SUPABASE_URL=https://<project>.supabase.co\nVITE_SUPABASE_ANON_KEY=<anon public key>`}
        </pre>
        <p className="mt-4 text-sm text-muted">The README walks through the full setup.</p>
      </div>
    </div>
  );
}
