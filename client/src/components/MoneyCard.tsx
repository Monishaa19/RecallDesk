import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Bell, Check, ExternalLink, RefreshCw, X } from "lucide-react";
import { api, ApiError, type MoneyAction } from "../lib/api";
import { formatEventDate } from "../lib/format";
import { loadPayPal } from "../lib/paypal";
import { notifyThoughtsChanged } from "./ThoughtDialog";
import { useToast } from "./Toast";
import { Spinner } from "./ui";

export const formatMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
};

// Currencies PayPal supports for invoices and checkout (INR is shown only if the AI heard it).
const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "SGD"];

const STATUS: Record<MoneyAction["status"], { label: string; className: string }> = {
  suggested: { label: "Needs your OK", className: "bg-amber-50 text-amber-800" },
  sent: { label: "Request sent", className: "bg-sky-50 text-sky-800" },
  awaiting_payment: { label: "Ready to pay", className: "bg-sky-50 text-sky-800" },
  paid: { label: "Paid", className: "bg-accent-soft text-accent-ink" },
  cancelled: { label: "Cancelled", className: "bg-subtle text-muted" },
  dismissed: { label: "Dismissed", className: "bg-subtle text-muted" },
};

export function moneyTitle(m: MoneyAction) {
  const amount = formatMoney(m.amount, m.currency);
  return m.direction === "owed_to_me" ? `${m.person} owes you ${amount}` : `You owe ${m.person} ${amount}`;
}

/**
 * One money moment from a capture. The AI only suggests; every PayPal action needs a tap here.
 * - owed_to_me: confirm -> PayPal emails the person an invoice -> RecallDesk ticks it off once paid.
 * - i_owe: confirm -> PayPal Checkout buttons -> paid.
 */
export function MoneyCard({ item, onChange }: { item: MoneyAction; onChange: (item: MoneyAction) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(item.email ?? "");
  const [amount, setAmount] = useState(String(Number(item.amount).toFixed(2)));
  const [currency, setCurrency] = useState(item.currency);
  const [busy, setBusy] = useState<null | "confirm" | "dismiss" | "remind" | "cancel" | "refresh">(null);
  const owed = item.direction === "owed_to_me";
  const status = STATUS[item.status];

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<{ item: MoneyAction }>, done?: string) => {
    setBusy(kind);
    try {
      const { item: next } = await fn();
      onChange(next);
      if (done) toast(done);
      if (next.status === "paid") notifyThoughtsChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong with PayPal. Please try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const confirm = () =>
    run(
      "confirm",
      async () => {
        const value = Math.round(Number(amount) * 100) / 100;
        if (!(value > 0)) throw new ApiError("Enter an amount above zero.", 400);
        if (value !== Number(item.amount) || currency !== item.currency) await api.editMoney(item.id, { amount: value, currency });
        return api.confirmMoney(item.id, email.trim());
      },
      owed ? `PayPal request sent to ${item.person}.` : undefined,
    );

  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${owed ? "bg-accent-soft text-accent" : "bg-subtle text-ink-soft"}`}
          aria-hidden="true"
        >
          {owed ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-medium text-ink ${item.status === "cancelled" ? "line-through opacity-60" : ""}`}>{moneyTitle(item)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
            {item.reason && <span>{item.reason}</span>}
            {item.due_date && <span>Due {formatEventDate(item.due_date)}</span>}
            {item.status === "paid" && item.paid_at && <span>on {new Date(item.paid_at).toLocaleDateString()}</span>}
          </p>
        </div>
      </div>

      {item.status === "suggested" && (
        <div className="mt-3 space-y-2 border-t border-line/70 pt-3">
          <p className="text-sm text-muted">
            {owed ? `Send ${item.person} a PayPal request?` : `Pay ${item.person} with PayPal?`} Nothing happens until you confirm.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`${item.person}'s PayPal email`}
              aria-label={`${item.person}'s PayPal email`}
              className="input min-w-0 flex-[2_1_200px]"
            />
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={`Amount in ${currency}`}
              className="input w-28 flex-[0_0_auto]"
            />
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency" className="input w-24 flex-[0_0_auto]">
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {currency === "INR" && (
            <p className="text-xs text-amber-800">PayPal doesn't process rupee payments between accounts. Switch to USD to send this through PayPal.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" onClick={() => run("dismiss", () => api.dismissMoney(item.id))} disabled={!!busy}>
              {busy === "dismiss" ? <Spinner /> : <X className="size-4" />} Not now
            </button>
            <button className="btn-primary" onClick={confirm} disabled={!!busy || !email.trim()}>
              {busy === "confirm" && <Spinner />} {owed ? "Send PayPal request" : "Continue to PayPal"}
            </button>
          </div>
        </div>
      )}

      {item.status === "awaiting_payment" && (
        <div className="mt-3 space-y-2 border-t border-line/70 pt-3">
          <PayPalPay item={item} onPaid={onChange} />
          <div className="flex justify-end">
            <button className="btn-ghost px-2.5 py-1.5 text-sm" onClick={() => run("cancel", () => api.cancelMoney(item.id))} disabled={!!busy}>
              {busy === "cancel" ? <Spinner /> : <X className="size-4" />} Cancel
            </button>
          </div>
        </div>
      )}

      {item.status === "sent" && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-line/70 pt-2.5">
          {item.pay_url && (
            <a href={item.pay_url} target="_blank" rel="noreferrer" className="btn-ghost mr-auto px-2.5 py-1.5 text-sm">
              <ExternalLink className="size-4" /> View request
            </a>
          )}
          <button className="btn-ghost px-2.5 py-1.5 text-sm" onClick={() => run("refresh", () => api.refreshMoney(item.id))} disabled={!!busy}>
            {busy === "refresh" ? <Spinner /> : <RefreshCw className="size-4" />} Check status
          </button>
          <button
            className="btn-ghost px-2.5 py-1.5 text-sm"
            onClick={() => run("remind", () => api.remindMoney(item.id), `Reminder sent to ${item.person}.`)}
            disabled={!!busy}
          >
            {busy === "remind" ? <Spinner /> : <Bell className="size-4" />} Remind
          </button>
          <button
            className="btn-ghost px-2.5 py-1.5 text-sm"
            onClick={() => run("cancel", () => api.cancelMoney(item.id), "Request cancelled.")}
            disabled={!!busy}
          >
            {busy === "cancel" ? <Spinner /> : <X className="size-4" />} Cancel
          </button>
        </div>
      )}

      {item.status === "paid" && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-accent">
          <Check className="size-4" /> Settled through PayPal{item.thought_id ? ", and the thought is ticked off" : ""}.
        </p>
      )}
    </div>
  );
}

/** PayPal Checkout buttons: create the order on our server, approve in PayPal, capture on our server. */
function PayPalPay({ item, onPaid }: { item: MoneyAction; onPaid: (item: MoneyAction) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const latest = useRef({ onPaid, toast });
  latest.current = { onPaid, toast };

  useEffect(() => {
    let cancelled = false;
    let buttons: { close(): Promise<void> } | null = null;
    loadPayPal(item.currency)
      .then(async (paypal) => {
        if (cancelled || !ref.current) return;
        const b = paypal.Buttons({
          style: { layout: "horizontal", color: "gold", shape: "pill", label: "pay", tagline: false, height: 44 },
          createOrder: async () => (await api.moneyOrder(item.id)).orderId,
          onApprove: async ({ orderID }) => {
            try {
              const { item: paid } = await api.captureMoney(item.id, orderID);
              latest.current.toast(`Paid ${item.person} through PayPal.`);
              notifyThoughtsChanged();
              latest.current.onPaid(paid);
            } catch (e) {
              latest.current.toast(e instanceof ApiError ? e.message : "PayPal couldn't complete that payment.", "error");
            }
          },
          onError: () => latest.current.toast("PayPal ran into a problem. Please try again.", "error"),
        });
        buttons = b;
        ref.current.innerHTML = "";
        await b.render(ref.current);
        if (!cancelled) setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load PayPal.");
        setState("error");
      });
    return () => {
      cancelled = true;
      void buttons?.close().catch(() => {});
    };
  }, [item.id, item.currency, item.person]);

  return (
    <div>
      {state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-3.5" /> Loading PayPal…
        </p>
      )}
      {state === "error" && <p className="text-sm text-danger">{error}</p>}
      <div ref={ref} className="max-w-sm" />
      {state === "ready" && <p className="mt-1 text-xs text-faint">The money goes to {item.email}.</p>}
    </div>
  );
}
