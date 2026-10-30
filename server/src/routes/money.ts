import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { config, isPayPalConfigured } from "../config.js";
import { badRequest, dbError as baseDbError, HttpError, notFound } from "../errors.js";
import {
  cancelInvoice,
  captureOrder,
  createOrder,
  getInvoice,
  getOrder,
  isInvoiceClosed,
  isInvoicePaid,
  remindInvoice,
  sendInvoice,
} from "../paypal.js";
import { auth } from "../supabase.js";
import { isDate } from "../time.js";
import { MONEY_COLUMNS, type MoneyAction } from "../thoughts.js";

export const moneyRouter = Router();

// A missing table means the money migration hasn't been run yet; say so plainly.
function dbError(err: { message?: string; code?: string } | null, what: string): HttpError {
  if (err?.code === "PGRST205" || err?.code === "42P01") {
    return new HttpError(503, "Money isn't set up in the database yet. Run the money migration in Supabase.", "money_missing");
  }
  return baseDbError(err, what);
}

const UUID = z.string().uuid();
const Email = z.string().trim().toLowerCase().email("That doesn't look like an email address.").max(254);

async function load(db: SupabaseClient, rawId: string): Promise<MoneyAction> {
  const id = UUID.safeParse(rawId);
  if (!id.success) throw notFound("That item doesn't exist.");
  const { data, error } = await db.from("money_actions").select(MONEY_COLUMNS).eq("id", id.data).maybeSingle();
  if (error) throw dbError(error, "loading that item");
  if (!data) throw notFound("That item doesn't exist anymore.");
  return data as MoneyAction;
}

async function save(db: SupabaseClient, id: string, patch: Partial<MoneyAction>): Promise<MoneyAction> {
  const { data, error } = await db
    .from("money_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(MONEY_COLUMNS)
    .single();
  if (error || !data) throw dbError(error, "saving that item");
  return data as MoneyAction;
}

/** Settled: record it and tick off the thought it came from, like a finished task. */
async function markPaid(db: SupabaseClient, item: MoneyAction): Promise<MoneyAction> {
  const now = new Date().toISOString();
  const saved = await save(db, item.id, { status: "paid", paid_at: now });
  if (item.thought_id) {
    const { error } = await db.from("thoughts").update({ done_at: now }).eq("id", item.thought_id).is("done_at", null);
    if (error) console.error("[money] couldn't tick off the thought:", error.code);
  }
  return saved;
}

/** Remember who's who, so a name only needs an email once. */
async function rememberContact(db: SupabaseClient, name: string, email: string) {
  const { data } = await db.from("contacts").select("id, name").ilike("name", name.replace(/[%_\\]/g, "\\$&"));
  const existing = (data ?? []).find((c) => (c.name as string).toLowerCase() === name.toLowerCase());
  const { error } = existing
    ? await db.from("contacts").update({ email, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : await db.from("contacts").insert({ name, email });
  if (error) console.error("[money] couldn't save the contact:", error.code);
}

/** Ask PayPal for the live status of anything still open. */
async function sync(db: SupabaseClient, item: MoneyAction): Promise<MoneyAction> {
  if (!item.paypal_id || !isPayPalConfigured) return item;
  try {
    if (item.status === "sent") {
      const inv = await getInvoice(item.paypal_id);
      if (isInvoicePaid(inv.status)) return markPaid(db, item);
      if (isInvoiceClosed(inv.status)) return save(db, item.id, { status: "cancelled" });
      if (inv.payUrl && inv.payUrl !== item.pay_url) return save(db, item.id, { pay_url: inv.payUrl });
    } else if (item.status === "awaiting_payment") {
      if ((await getOrder(item.paypal_id)) === "COMPLETED") return markPaid(db, item);
    }
  } catch {
    // Keep showing the last known status; the next refresh tries again.
  }
  return item;
}

const STATUS_TEXT: Record<MoneyAction["status"], string> = {
  suggested: "noted, not sent through PayPal yet",
  sent: "PayPal request sent, not paid yet",
  awaiting_payment: "waiting for you to pay with PayPal",
  paid: "paid through PayPal",
  cancelled: "cancelled",
  dismissed: "dismissed",
};

/** The person's money records with live PayPal statuses, written as lines Ask RecallDesk can read. */
export async function moneyForAsk(db: SupabaseClient): Promise<{ thoughtId: string | null; text: string }[]> {
  const { data, error } = await db
    .from("money_actions")
    .select(MONEY_COLUMNS)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return []; // e.g. the money migration hasn't been run; Ask still works without it
  const items = await Promise.all(
    ((data ?? []) as MoneyAction[]).map((i) => (i.status === "sent" || i.status === "awaiting_payment" ? sync(db, i) : i)),
  );
  return items.map((i) => {
    const amount = `${Number(i.amount).toFixed(2)} ${i.currency}`;
    const who = i.direction === "owed_to_me" ? `${i.person} owes you ${amount}` : `You owe ${i.person} ${amount}`;
    const when = i.status === "paid" && i.paid_at ? ` on ${i.paid_at.slice(0, 10)}` : "";
    return {
      thoughtId: i.thought_id,
      text: `MONEY RECORD: ${who}${i.reason ? ` for ${i.reason}` : ""}${i.due_date ? `, due ${i.due_date}` : ""}. Status: ${STATUS_TEXT[i.status]}${when}. Created ${i.created_at.slice(0, 10)}.`,
    };
  });
}

// Public bits the browser needs to show PayPal buttons. The secret never leaves the server.
moneyRouter.get("/config", (_req, res) => {
  res.json({ enabled: isPayPalConfigured, clientId: config.paypalClientId || null, env: config.paypalEnv });
});

moneyRouter.get("/", async (req, res) => {
  const { db } = auth(req);
  const { data, error } = await db
    .from("money_actions")
    .select(MONEY_COLUMNS)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw dbError(error, "loading your money items");
  let items = (data ?? []) as MoneyAction[];
  if (req.query.sync === "1") {
    const open = items.filter((i) => i.status === "sent" || i.status === "awaiting_payment").slice(0, 20);
    const fresh = new Map((await Promise.all(open.map((i) => sync(db, i)))).map((i) => [i.id, i]));
    items = items.map((i) => fresh.get(i.id) ?? i);
  }
  res.json({ items });
});

// Fix what the AI heard before confirming (only while it's still a suggestion).
const EditSchema = z.object({
  direction: z.enum(["owed_to_me", "i_owe"]).optional(),
  person: z.string().trim().min(1).max(80).optional(),
  email: Email.nullable().optional(),
  amount: z.number().positive("The amount must be more than zero.").max(10000, "Please keep it under 10,000.").optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  reason: z.string().trim().max(200).optional(),
  due_date: z.string().refine(isDate, "Pick a valid date.").nullable().optional(),
});

moneyRouter.patch("/:id", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  if (item.status !== "suggested") throw badRequest("This has already been sent, so it can't be edited.");
  const parsed = EditSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "That change isn't valid.");
  const patch = { ...parsed.data } as Partial<MoneyAction>;
  if (patch.amount !== undefined) patch.amount = Math.round(patch.amount * 100) / 100;
  res.json({ item: await save(db, item.id, patch) });
});

// The person said yes. Requests go out as a PayPal invoice; payments wait for PayPal Checkout.
moneyRouter.post("/:id/confirm", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  if (item.status !== "suggested") throw badRequest("This has already been handled.");
  const email = Email.safeParse(req.body?.email ?? item.email ?? "");
  if (!email.success) throw badRequest(`Add ${item.person}'s PayPal email first.`);
  await rememberContact(db, item.person, email.data);
  // Keep the email even if PayPal then says no, so the person doesn't have to retype it.
  if (item.email !== email.data) await save(db, item.id, { email: email.data });

  if (item.direction === "owed_to_me") {
    const inv = await sendInvoice({
      email: email.data,
      name: item.person,
      amount: Number(item.amount),
      currency: item.currency,
      reason: item.reason,
      dueDate: item.due_date,
    });
    res.json({ item: await save(db, item.id, { email: email.data, status: "sent", paypal_id: inv.id, pay_url: inv.payUrl }) });
    return;
  }
  res.json({ item: await save(db, item.id, { email: email.data, status: "awaiting_payment" }) });
});

// PayPal Checkout, step 1: the browser's PayPal button asks for an order to approve.
moneyRouter.post("/:id/order", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  if (item.direction !== "i_owe" || item.status !== "awaiting_payment" || !item.email) {
    throw badRequest("This isn't waiting for a payment.");
  }
  const orderId = await createOrder({
    payeeEmail: item.email,
    amount: Number(item.amount),
    currency: item.currency,
    reason: item.reason ? `${item.reason} (to ${item.person})` : `Payment to ${item.person}`,
    reference: item.id,
  });
  await save(db, item.id, { paypal_id: orderId });
  res.json({ orderId });
});

// PayPal Checkout, step 2: the person approved in the PayPal window; take the payment.
moneyRouter.post("/:id/capture", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId : "";
  if (item.status !== "awaiting_payment" || !orderId || orderId !== item.paypal_id) throw badRequest("That payment doesn't match.");
  const status = await captureOrder(orderId);
  if (status !== "COMPLETED") throw new HttpError(402, "PayPal hasn't completed that payment yet. Please try again.", "paypal_incomplete");
  res.json({ item: await markPaid(db, item) });
});

moneyRouter.post("/:id/refresh", async (req, res) => {
  const { db } = auth(req);
  res.json({ item: await sync(db, await load(db, req.params.id)) });
});

moneyRouter.post("/:id/remind", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  if (item.status !== "sent" || !item.paypal_id) throw badRequest("Only a sent request can be reminded.");
  await remindInvoice(item.paypal_id);
  res.json({ item });
});

moneyRouter.post("/:id/cancel", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  if (item.status === "sent" && item.paypal_id) await cancelInvoice(item.paypal_id);
  else if (item.status !== "awaiting_payment") throw badRequest("This can't be cancelled.");
  res.json({ item: await save(db, item.id, { status: "cancelled" }) });
});

// "Not a money thing" / "already sorted": hide the suggestion.
moneyRouter.post("/:id/dismiss", async (req, res) => {
  const { db } = auth(req);
  const item = await load(db, req.params.id);
  if (item.status !== "suggested") throw badRequest("This has already been handled.");
  res.json({ item: await save(db, item.id, { status: "dismissed" }) });
});
