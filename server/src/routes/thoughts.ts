import { Router } from "express";
import { z } from "zod";
import { embed, toVector } from "../embeddings.js";
import { badRequest, dbError, notFound } from "../errors.js";
import { auth } from "../supabase.js";
import { normalizeTopics, planReorganize } from "../llm.js";
import { parseTzOffset } from "../time.js";
import { captureThought, categorizeUntagged, searchThoughts, THOUGHT_COLUMNS } from "../thoughts.js";

export const thoughtsRouter = Router();

const UUID = z.string().uuid();

// List (reverse chronological, cursor-paginated) or search.
thoughtsRouter.get("/", async (req, res) => {
  const { db } = auth(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 300) : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

  if (q) {
    const hits = await searchThoughts(db, q, { limit: 30, minSimilarity: 0.3 });
    // Checked-off thoughts sink below open ones, like a task list.
    hits.sort((a, b) => Number(Boolean(a.done_at)) - Number(Boolean(b.done_at)));
    res.json({ thoughts: hits, nextCursor: null, mode: "search", total: hits.length });
    return;
  }

  const status = req.query.status === "active" || req.query.status === "done" ? req.query.status : "all";
  let query = db
    .from("thoughts")
    .select(THOUGHT_COLUMNS, { count: "exact" })
    .order(status === "done" ? "done_at" : "created_at", { ascending: false })
    .limit(limit + 1);
  if (status === "active") query = query.is("done_at", null);
  if (status === "done") query = query.not("done_at", "is", null);
  const before = typeof req.query.before === "string" ? req.query.before : "";
  if (before) {
    if (Number.isNaN(Date.parse(before))) throw badRequest("Invalid cursor.");
    query = query.lt("created_at", before);
  }
  const { data, error, count } = await query;
  if (error) throw dbError(error, "loading thoughts");
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  res.json({
    thoughts: page,
    // Cursor paging is by created_at, so it's only offered for the created_at-ordered lists.
    nextCursor: status !== "done" && rows.length > limit ? page[page.length - 1].created_at : null,
    mode: "list",
    total: count ?? page.length,
  });
});

// Organize thoughts that don't have topics yet (older thoughts, or edited ones).
thoughtsRouter.post("/categorize", async (req, res) => {
  const { db } = auth(req);
  res.json({ organized: await categorizeUntagged(db) });
});

const REORGANIZE_LIMIT = 300;

// Step 1: turn a spoken/typed instruction into proposed topic changes. Saves nothing.
thoughtsRouter.post("/reorganize/preview", async (req, res) => {
  const { db } = auth(req);
  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
  if (!instruction) throw badRequest("Say or type how you'd like your thoughts organized.");
  if (instruction.length > 2000) throw badRequest("Please keep the instruction under 2000 characters.");

  const { data, error } = await db
    .from("thoughts")
    .select("id, content, topics")
    .order("created_at", { ascending: false })
    .limit(REORGANIZE_LIMIT);
  if (error) throw dbError(error, "loading thoughts");
  const rows = (data ?? []) as { id: string; content: string; topics: string[] }[];
  if (!rows.length) {
    res.json({ reply: "You don't have any thoughts to organize yet.", changes: [] });
    return;
  }

  const plan = await planReorganize(
    rows.map((r, i) => ({ ref: i + 1, content: r.content, topics: r.topics ?? [] })),
    instruction,
  );
  res.json({
    reply: plan.reply,
    changes: plan.changes.map((c) => {
      const row = rows[c.ref - 1];
      return { id: row.id, content: row.content, from: row.topics ?? [], to: c.topics };
    }),
  });
});

// Step 2: apply the changes the person approved (also used for Undo).
const ApplySchema = z.object({
  changes: z
    .array(z.object({ id: z.string().uuid(), topics: z.array(z.string().max(64)).max(3) }))
    .min(1)
    .max(REORGANIZE_LIMIT),
});

thoughtsRouter.post("/reorganize/apply", async (req, res) => {
  const { db } = auth(req);
  const parsed = ApplySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Nothing to apply.");
  let updated = 0;
  for (const c of parsed.data.changes) {
    const topics = normalizeTopics(c.topics, c.topics);
    // RLS guarantees only the person's own thoughts can be updated.
    const { data, error } = await db.from("thoughts").update({ topics }).eq("id", c.id).select("id");
    if (error) throw dbError(error, "saving topics");
    updated += data?.length ?? 0;
  }
  res.json({ updated });
});

thoughtsRouter.get("/:id", async (req, res) => {
  const { db } = auth(req);
  const id = UUID.safeParse(req.params.id);
  if (!id.success) throw notFound("That thought doesn't exist.");
  const { data, error } = await db.from("thoughts").select(THOUGHT_COLUMNS).eq("id", id.data).maybeSingle();
  if (error) throw dbError(error, "loading the thought");
  if (!data) throw notFound("That thought doesn't exist anymore.");
  res.json({ thought: data });
});

thoughtsRouter.post("/", async (req, res) => {
  const { db } = auth(req);
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  res.status(201).json(await captureThought(db, text, parseTzOffset(req.body?.tzOffset)));
});

thoughtsRouter.patch("/:id", async (req, res) => {
  const { db } = auth(req);
  const id = UUID.safeParse(req.params.id);
  if (!id.success) throw notFound("That thought doesn't exist.");
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) throw badRequest("A thought can't be empty.");
  if (content.length > 4000) throw badRequest("Please keep a thought under 4000 characters.");

  const vector = await embed(content);
  const { data, error } = await db
    .from("thoughts")
    .update({ content, topics: [], embedding: vector ? toVector(vector) : null, updated_at: new Date().toISOString() })
    .eq("id", id.data)
    .select(THOUGHT_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(error, "updating the thought");
  if (!data) throw notFound("That thought doesn't exist anymore.");
  res.json({ thought: data });
});

// Check off / reopen a thought (Google Tasks style).
thoughtsRouter.patch("/:id/done", async (req, res) => {
  const { db } = auth(req);
  const id = UUID.safeParse(req.params.id);
  if (!id.success) throw notFound("That thought doesn't exist.");
  if (typeof req.body?.done !== "boolean") throw badRequest("Missing done flag.");
  const { data, error } = await db
    .from("thoughts")
    .update({ done_at: req.body.done ? new Date().toISOString() : null })
    .eq("id", id.data)
    .select(THOUGHT_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(error, "updating the thought");
  if (!data) throw notFound("That thought doesn't exist anymore.");
  res.json({ thought: data });
});

thoughtsRouter.delete("/:id", async (req, res) => {
  const { db } = auth(req);
  const id = UUID.safeParse(req.params.id);
  if (!id.success) throw notFound("That thought doesn't exist.");
  const { data, error } = await db.from("thoughts").delete().eq("id", id.data).select("id");
  if (error) throw dbError(error, "deleting the thought");
  if (!data?.length) throw notFound("That thought doesn't exist anymore.");
  res.status(204).end();
});
