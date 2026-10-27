import { Router } from "express";
import { z } from "zod";
import { embed, toVector } from "../embeddings.js";
import { badRequest, dbError, notFound } from "../errors.js";
import { auth } from "../supabase.js";
import { captureThought, searchThoughts, THOUGHT_COLUMNS } from "../thoughts.js";

export const thoughtsRouter = Router();

const UUID = z.string().uuid();

// List (reverse chronological, cursor-paginated) or search.
thoughtsRouter.get("/", async (req, res) => {
  const { db } = auth(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 300) : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

  if (q) {
    const hits = await searchThoughts(db, q, { limit: 30, minSimilarity: 0.3 });
    res.json({ thoughts: hits, nextCursor: null, mode: "search" });
    return;
  }

  let query = db.from("thoughts").select(THOUGHT_COLUMNS).order("created_at", { ascending: false }).limit(limit + 1);
  const before = typeof req.query.before === "string" ? req.query.before : "";
  if (before) {
    if (Number.isNaN(Date.parse(before))) throw badRequest("Invalid cursor.");
    query = query.lt("created_at", before);
  }
  const { data, error } = await query;
  if (error) throw dbError(error, "loading thoughts");
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  res.json({
    thoughts: page,
    nextCursor: rows.length > limit ? page[page.length - 1].created_at : null,
    mode: "list",
  });
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
  const thought = await captureThought(db, text);
  res.status(201).json({ thought });
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
    .update({ content, embedding: vector ? toVector(vector) : null, updated_at: new Date().toISOString() })
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
