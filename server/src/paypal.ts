import { config, isPayPalConfigured } from "./config.js";
import { HttpError } from "./errors.js";

/**
 * Thin client for the PayPal developer platform (REST, v2).
 *  - Requests ("Rahul owes me $20"): Invoicing API. PayPal emails the person a pay link.
 *  - Payments ("I owe Priya $15"): Orders API + the PayPal JS SDK buttons in the browser.
 * The client secret never leaves the server. Nothing about a person's thoughts is logged.
 */

const BASE = config.paypalEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

let cached: { token: string; expiresAt: number } | null = null;

function requirePayPal() {
  if (!isPayPalConfigured) {
    throw new HttpError(503, "PayPal isn't connected on the server yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.", "paypal_unconfigured");
  }
}

async function accessToken(): Promise<string> {
  requirePayPal();
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    console.error(`[paypal] token request failed: ${res.status}`);
    throw new HttpError(502, "Couldn't connect to PayPal. Please try again.", "paypal_auth");
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
}

/** Friendly messages for the PayPal errors a person can actually do something about. */
function friendly(status: number, err: PayPalErrorBody, what: string): HttpError {
  const issues = (err.details ?? []).map((d) => d.issue ?? "");
  if (status === 403 || err.name === "NOT_AUTHORIZED") {
    return new HttpError(
      502,
      `PayPal didn't allow ${what}. In the PayPal developer dashboard, open this app and turn on the feature it needs (e.g. Invoicing).`,
      "paypal_not_authorized",
    );
  }
  if (issues.some((i) => /CURRENCY_NOT_SUPPORTED|FOREIGN_CURRENCY|CURRENCY/i.test(i))) {
    return new HttpError(
      422,
      "PayPal can't process this currency between these accounts (for example, INR, or a request from an India-based account). Switch the currency to USD and use a US PayPal account.",
      "paypal_currency",
    );
  }
  if (issues.some((i) => /PAYEE_ACCOUNT|RECEIVER|PAYEE_NOT|INVALID_EMAIL|EMAIL/i.test(i))) {
    return new HttpError(422, "PayPal couldn't use that email address. Check it belongs to a PayPal account.", "paypal_bad_email");
  }
  if (issues.some((i) => /INSTRUMENT_DECLINED|PAYER_ACTION_REQUIRED/.test(i))) {
    return new HttpError(402, "PayPal declined that payment method. Please try again with another one.", "paypal_declined");
  }
  return new HttpError(502, `PayPal couldn't complete ${what}. Please try again.`, "paypal_error");
}

async function call<T>(method: string, path: string, what: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, "Couldn't reach PayPal. Check your connection and try again.", "paypal_network");
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const err = json as PayPalErrorBody;
    console.error(`[paypal] ${what} failed: ${res.status} ${err.name ?? ""} debug_id=${err.debug_id ?? "-"} ${(err.details ?? []).map((d) => d.issue).join(",")}`);
    throw friendly(res.status, err, what);
  }
  return json as T;
}

const money = (amount: number) => amount.toFixed(2);

// ---------------------------------------------------------------------------
// Invoicing: request money from someone
// ---------------------------------------------------------------------------

export type InvoiceStatus = "DRAFT" | "SENT" | "SCHEDULED" | "PAID" | "MARKED_AS_PAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY_PAID" | "PARTIALLY_REFUNDED" | "MARKED_AS_REFUNDED" | "UNPAID" | "PAYMENT_PENDING";

interface Invoice {
  id: string;
  status: InvoiceStatus;
  detail?: { metadata?: { recipient_view_url?: string } };
}

export async function sendInvoice(opts: {
  email: string;
  name: string;
  amount: number;
  currency: string;
  reason: string;
  dueDate: string | null;
}): Promise<{ id: string; status: InvoiceStatus; payUrl: string | null }> {
  const draft = await call<Invoice>(
    "POST",
    "/v2/invoicing/invoices",
    "creating the PayPal request",
    {
      detail: {
        currency_code: opts.currency,
        note: "Sent with RecallDesk.",
        ...(opts.dueDate ? { payment_term: { due_date: opts.dueDate } } : {}),
      },
      primary_recipients: [{ billing_info: { email_address: opts.email, name: { full_name: opts.name } } }],
      items: [
        {
          name: (opts.reason || "Payment request").slice(0, 200),
          quantity: "1",
          unit_amount: { currency_code: opts.currency, value: money(opts.amount) },
        },
      ],
    },
    { Prefer: "return=representation" },
  );
  try {
    await call("POST", `/v2/invoicing/invoices/${encodeURIComponent(draft.id)}/send`, "sending the PayPal request", {
      send_to_invoicer: false,
      send_to_recipient: true,
    });
  } catch (e) {
    // Don't leave an unsent draft behind in the PayPal account.
    await call("DELETE", `/v2/invoicing/invoices/${encodeURIComponent(draft.id)}`, "cleaning up the draft").catch(() => {});
    throw e;
  }
  const sent = await getInvoice(draft.id);
  return { id: draft.id, status: sent.status, payUrl: sent.payUrl };
}

export async function getInvoice(id: string): Promise<{ status: InvoiceStatus; payUrl: string | null }> {
  const inv = await call<Invoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`, "checking the PayPal request");
  return { status: inv.status, payUrl: inv.detail?.metadata?.recipient_view_url ?? null };
}

export async function remindInvoice(id: string) {
  await call("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, "sending a reminder", {
    send_to_invoicer: false,
    send_to_recipient: true,
  });
}

export async function cancelInvoice(id: string) {
  await call("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, "cancelling the PayPal request", {
    send_to_invoicer: false,
    send_to_recipient: true,
  });
}

export const isInvoicePaid = (s: InvoiceStatus) => s === "PAID" || s === "MARKED_AS_PAID";
export const isInvoiceClosed = (s: InvoiceStatus) => s === "CANCELLED" || s === "REFUNDED" || s === "MARKED_AS_REFUNDED";

// ---------------------------------------------------------------------------
// Orders (Checkout): pay someone
// ---------------------------------------------------------------------------

interface Order {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
}

/** An order whose money goes to the other person's PayPal account (the payee). */
export async function createOrder(opts: {
  payeeEmail: string;
  amount: number;
  currency: string;
  reason: string;
  reference: string;
}): Promise<string> {
  const order = await call<Order>("POST", "/v2/checkout/orders", "starting the PayPal payment", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: opts.reference.slice(0, 256),
        description: (opts.reason || "Payment").slice(0, 127),
        amount: { currency_code: opts.currency, value: money(opts.amount) },
        payee: { email_address: opts.payeeEmail },
      },
    ],
    payment_source: {
      paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", brand_name: "RecallDesk" } },
    },
  });
  return order.id;
}

export async function captureOrder(id: string): Promise<Order["status"]> {
  const order = await call<Order>("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, "completing the PayPal payment", {});
  return order.status;
}

export async function getOrder(id: string): Promise<Order["status"]> {
  const order = await call<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`, "checking the PayPal payment");
  return order.status;
}
