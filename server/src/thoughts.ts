import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, toVector } from "./embeddings.js";
import { badRequest, dbError, HttpError } from "./errors.js";
import { condenseThought } from "./llm.js";

export interface Thought {
  id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
}

export const THOUGHT_COLUMNS = "id, content, created_at, updated_at";
export const MAX_CAPTURE_CHARS = 8000;

/**
 * Capture pipeline: raw text -> concise note (LLM) -> embedding -> insert.
 * The raw text is only held in memory for the duration of this call; it is
 * never written to the database or to logs.
 */
export async function captureThought(db: SupabaseClient, raw: string): Promise<Thought> {
  const text = raw.trim();
  if (!text) throw badRequest("Write a thought first.");
  if (text.length > MAX_CAPTURE_CHARS) throw badRequest(`That's a lot! Please keep a capture under ${MAX_CAPTURE_CHARS} characters.`);

  const note = await condenseThought(text);
  if (!note) throw new HttpError(422, "We couldn't find a thought to save in that text. Try adding a little more detail.", "empty_note");

  const vector = await embed(note);
  const { data, error } = await db
    .from("thoughts")
    .insert({ content: note.slice(0, 4000), embedding: vector ? toVector(vector) : null })
    .select(THOUGHT_COLUMNS)
    .single();
  if (error || !data) throw dbError(error, "saving the thought");
  return data as Thought;
}

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
  return (data ?? []) as SearchHit[];
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
