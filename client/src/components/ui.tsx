import type { ReactNode } from "react";
import { AlertCircle, RotateCw } from "lucide-react";

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-accent)" />
      <path d="M10 21.5c0-3.6 2.7-6.5 6-6.5s6 2.9 6 6.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="10.5" r="2.6" fill="#fff" />
    </svg>
  );
}

export function ErrorNotice({ message, onRetry, className = "" }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={`animate-fade-in flex items-start gap-3 rounded-xl border border-danger/15 bg-danger-soft px-4 py-3 text-sm text-danger ${className}`}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 leading-relaxed">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 font-medium hover:underline cursor-pointer">
          <RotateCw className="size-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="animate-fade-in flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="font-serif text-xl text-ink">{title}</h3>
      {children && <div className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-subtle ${className}`} />;
}

/** Renders plain AI text: paragraphs and "- " bullet lists. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 space-y-1.5">
          {bullets.map((b, i) => (
            <li key={i} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:size-1.5 before:rounded-full before:bg-accent/50">
              {b}
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[-*•]\s+/.test(t)) {
      bullets.push(t.replace(/^[-*•]\s+/, ""));
    } else {
      flush();
      if (t) blocks.push(<p key={`p-${blocks.length}`} className="my-2 first:mt-0 last:mb-0">{t}</p>);
    }
  }
  flush();
  return <div className={className}>{blocks}</div>;
}
