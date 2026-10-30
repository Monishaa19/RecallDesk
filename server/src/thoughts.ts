import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, toVector } from "./embeddings.js";
import { badRequest, dbError, HttpError } from "./errors.js";
import { categorizeNotes, condenseThought, type ExtractedEvent, type ExtractedMoney } from "./llm.js";
import { formatLocal, todayLocal } from "./time.js";

export interface Thought {
  id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
  /** When the thought was checked off; null while it's open. */
  done_at?: string | null;
  /** AI-assigned topics, main topic first. */
  topics?: string[];
}

export const THOUGHT_COLUMNS = "id, content, created_at, updated_at, done_at, topics";

/** The person's topics, most used first, so new notes reuse the same labels. */
export async function existingTopics(db: SupabaseClient, limit = 40): Promise<string[]> {
  const { data, error } = await db.from("thoughts").select("topics").order("created_at", { ascending: false }).limit(1000);
  if (error) throw dbError(error, "loading topics");
  const counts = new Map<string, number>();
  for (const row of data ?? []) for (const t of (row.topics as string[]) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

const CATEGORIZE_BATCH = 40;

/** Give topics to the person's thoughts that don't have any yet. Returns how many were organized. */
export async function categorizeUntagged(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from("thoughts")
    .select("id, content")
    .eq("topics", "{}")
    .order("created_at", { ascending: false })
    .limit(CATEGORIZE_BATCH);
  if (error) throw dbError(error, "loading thoughts");
  const rows = (data ?? []) as { id: string; content: string }[];
  if (!rows.length) return 0;

  const assigned = await categorizeNotes(
    rows.map((r, i) => ({ ref: i + 1, content: r.content })),
    await existingTopics(db),
  );
  let updated = 0;
  for (const [ref, topics] of assigned) {
    const row = rows[ref - 1];
    if (!row) continue;
    const { error: upErr } = await db.from("thoughts").update({ topics }).eq("id", row.id);
    if (upErr) throw dbError(upErr, "saving topics");
    updated++;
  }
  return updated;
}
export const MAX_CAPTURE_CHARS = 8000;

/**
 * Capture pipeline: raw text -> concise note (LLM) -> embedding -> insert.
 * The raw text is only held in memory for the duration of this call; it is
 * never written to the database or to logs.
 */
export async function captureThought(
  db: SupabaseClient,
  raw: string,
  tzOffset = 0,
): Promise<{ thought: Thought; events: CalendarEvent[]; money: MoneyAction[] }> {
  const text = raw.trim();
  if (!text) throw badRequest("Write a thought first.");
  if (text.length > MAX_CAPTURE_CHARS) throw badRequest(`That's a lot! Please keep a capture under ${MAX_CAPTURE_CHARS} characters.`);

  const now = { label: formatLocal(new Date(), tzOffset), today: todayLocal(tzOffset) };
  const { note, topics, events, money } = await condenseThought(text, await existingTopics(db), now);
  if (!note) throw new HttpError(422, "We couldn't find a thought to save in that text. Try adding a little more detail.", "empty_note");

  const vector = await embed(note);
  const { data, error } = await db
    .from("thoughts")
    .insert({ content: note.slice(0, 4000), topics, embedding: vector ? toVector(vector) : null })
    .select(THOUGHT_COLUMNS)
    .single();
  if (error || !data) throw dbError(error, "saving the thought");
  const thought = data as Thought;

  // The thought is already safe; a calendar or money hiccup shouldn't turn the capture into an error.
  const [savedEvents, savedMoney] = await Promise.all([saveEvents(db, thought.id, events), suggestMoney(db, thought.id, money)]);
  return { thought, events: savedEvents, money: savedMoney };
}

async function saveEvents(db: SupabaseClient, thoughtId: string, events: ExtractedEvent[]): Promise<CalendarEvent[]> {
  if (!events.length) return [];
  const { data, error } = await db
    .from("calendar_events")
    .insert(events.map((e) => ({ thought_id: thoughtId, title: e.title, event_date: e.date, event_time: e.time, kind: e.kind })))
    .select(EVENT_COLUMNS);
  if (error) {
    console.error("[calendar] couldn't save events:", error.code, error.message);
    return [];
  }
  return (data ?? []) as CalendarEvent[];
}

/** Save the AI's money suggestions. Nothing goes to PayPal until the person confirms one. */
async function suggestMoney(db: SupabaseClient, thoughtId: string, items: ExtractedMoney[]): Promise<MoneyAction[]> {
  if (!items.length) return [];
  const { data: contacts } = await db.from("contacts").select("name, email");
  const emailFor = (name: string) =>
    (contacts ?? []).find((c) => (c.name as string).toLowerCase() === name.toLowerCase())?.email as string | undefined;
  const { data, error } = await db
    .from("money_actions")
    .insert(
      items.map((m) => ({
        thought_id: thoughtId,
        direction: m.direction,
        person: m.person,
        email: emailFor(m.person) ?? null,
        amount: m.amount,
        currency: m.currency,
        reason: m.reason,
        due_date: m.due,
      })),
    )
    .select(MONEY_COLUMNS);
  if (error) {
    console.error("[money] couldn't save suggestions:", error.code, error.message);
    return [];
  }
  return (data ?? []) as MoneyAction[];
}

export interface MoneyAction {
  id: string;
  thought_id: string | null;
  direction: "owed_to_me" | "i_owe";
  person: string;
  email: string | null;
  amount: number;
  currency: string;
  reason: string;
  due_date: string | null;
  status: "suggested" | "sent" | "awaiting_payment" | "paid" | "cancelled" | "dismissed";
  paypal_id: string | null;
  pay_url: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export const MONEY_COLUMNS =
  "id, thought_id, direction, person, email, amount, currency, reason, due_date, status, paypal_id, pay_url, paid_at, created_at, updated_at";

export interface CalendarEvent {
  id: string;
  thought_id: string | null;
  title: string;
  event_date: string;
  event_time: string | null;
  kind: string;
  created_at: string;
}

export const EVENT_COLUMNS = "id, thought_id, title, event_date, event_time, kind, created_at";

export interface SearchHit extends Thought {
  score: number;
  keyword_rank: number;
  similarity: number;
}

/** Hybrid keyword + semantic search, scoped to the signed-in user (RLS + auth.uid()). */
export async function searchThoughts(
  db: SupabaseClient,
  text: string,
  opts: { limit?: number; from?: Date | null; to?: Date | null; minSimilarity?: number; embedText?: string } = {},
): Promise<SearchHit[]> {
  const semanticText = (opts.embedText ?? text).trim();
  const vector = semanticText ? await embed(semanticText) : null;
  const { data, error } = await db.rpc("search_thoughts", {
    query_text: text,
    query_embedding: vector ? toVector(vector) : null,
    match_count: opts.limit ?? 10,
    date_from: opts.from?.toISOString() ?? null,
    date_to: opts.to?.toISOString() ?? null,
    min_similarity: opts.minSimilarity ?? 0.25,
  });
  if (error) throw dbError(error, "searching thoughts");
  return attachDone(db, (data ?? []) as SearchHit[]);
}

/** search_thoughts() doesn't return done_at/topics, so look them up for the hits. */
async function attachDone<T extends Thought>(db: SupabaseClient, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const { data, error } = await db.from("thoughts").select("id, done_at, topics").in("id", rows.map((r) => r.id));
  if (error) throw dbError(error, "loading thoughts");
  const extra = new Map((data ?? []).map((r) => [r.id as string, r as { done_at: string | null; topics: string[] }]));
  return rows.map((r) => ({ ...r, done_at: extra.get(r.id)?.done_at ?? null, topics: extra.get(r.id)?.topics ?? [] }));
}

export async function listThoughtsInRange(db: SupabaseClient, from: Date, to: Date, limit = 400): Promise<Thought[]> {
  const { data, error } = await db
    .from("thoughts")
    .select(THOUGHT_COLUMNS)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw dbError(error, "loading thoughts");
  return (data ?? []) as Thought[];
}

export async function getThoughtsByIds(db: SupabaseClient, ids: string[]): Promise<Thought[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from("thoughts").select(THOUGHT_COLUMNS).in("id", ids);
  if (error) throw dbError(error, "loading thoughts");
  return (data ?? []) as Thought[];
}
