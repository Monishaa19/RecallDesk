import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { api, ApiError, type MoneyAction } from "../lib/api";
import { formatMoney, MoneyCard } from "../components/MoneyCard";
import { useThoughtsChanged } from "../components/ThoughtDialog";
import { EmptyState, ErrorNotice, Skeleton } from "../components/ui";

const OPEN = new Set<MoneyAction["status"]>(["sent", "awaiting_payment"]);
const POLL_MS = 20_000;

/** Totals per currency, e.g. "$35.00" or "$20.00 + ₹500.00". */
function total(items: MoneyAction[]) {
  const sums = new Map<string, number>();
  for (const i of items) sums.set(i.currency, (sums.get(i.currency) ?? 0) + Number(i.amount));
  if (!sums.size) return formatMoney(0, "USD");
  return [...sums.entries()].map(([c, v]) => formatMoney(v, c)).join(" + ");
}

export function MoneyPage() {
  const [items, setItems] = useState<MoneyAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await api.money(true);
      setItems(items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your money items.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useThoughtsChanged(load);

  // While a request or payment is open, keep its PayPal status fresh.
  const hasOpen = items?.some((i) => OPEN.has(i.status)) ?? false;
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [hasOpen, load]);

  const update = (next: MoneyAction) =>
    setItems((list) => {
      if (!list) return list;
      if (next.status === "dismissed") return list.filter((i) => i.id !== next.id);
      return list.map((i) => (i.id === next.id ? next : i));
    });

  const groups = useMemo(() => {
    const all = items ?? [];
    return {
      suggested: all.filter((i) => i.status === "suggested"),
      owedToMe: all.filter((i) => i.direction === "owed_to_me" && OPEN.has(i.status)),
      iOwe: all.filter((i) => i.direction === "i_owe" && OPEN.has(i.status)),
      settled: all.filter((i) => i.status === "paid" || i.status === "cancelled"),
    };
  }, [items]);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-6 md:pt-16">
      <h1 className="page-title">Money</h1>

      {error && <ErrorNotice className="mt-6" message={error} onRetry={load} />}

      {!items && !error && (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )}

      {items && (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="card px-4 py-3.5">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-faint">Owed to you</p>
              <p className="mt-1 font-serif text-2xl text-ink">{total(groups.owedToMe)}</p>
            </div>
            <div className="card px-4 py-3.5">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-faint">You owe</p>
              <p className="mt-1 font-serif text-2xl text-ink">{total(groups.iOwe)}</p>
            </div>
          </div>

          {items.length === 0 && (
            <div className="card mt-6">
              <EmptyState icon={<Wallet className="size-5" />} title="Nothing owed either way">
                Mention money with a person’s name and an amount when you capture a thought, and it will show up here.
              </EmptyState>
            </div>
          )}

          <Group title="Needs your OK" items={groups.suggested} onChange={update} />
          <Group title="Owed to you" items={groups.owedToMe} onChange={update} />
          <Group title="You owe" items={groups.iOwe} onChange={update} />

          {groups.settled.length > 0 && (
            <section className="mt-10">
              <button
                onClick={() => setShowSettled((s) => !s)}
                className="flex cursor-pointer items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-faint hover:text-ink"
                aria-expanded={showSettled}
              >
                <ChevronDown className={`size-3.5 transition ${showSettled ? "" : "-rotate-90"}`} /> Settled ({groups.settled.length})
              </button>
              {showSettled && (
                <ul className="mt-3 space-y-3">
                  {groups.settled.map((i) => (
                    <li key={i.id}>
                      <MoneyCard item={i} onChange={update} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Group({ title, items, onChange }: { title: string; items: MoneyAction[]; onChange: (i: MoneyAction) => void }) {
  if (!items.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-faint">{title}</h2>
      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id}>
            <MoneyCard item={i} onChange={onChange} />
          </li>
        ))}
      </ul>
    </section>
  );
}
