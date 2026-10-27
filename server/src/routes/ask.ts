import { Router } from "express";
import { badRequest, dbError } from "../errors.js";
import { answerQuestion, planRetrieval, type ChatTurn, type NoteForLlm } from "../llm.js";
import { auth, type AuthedRequest } from "../supabase.js";
import { getThoughtsByIds, listThoughtsInRange, searchThoughts, type Thought } from "../thoughts.js";
import { addDays, formatLocal, isDate, localDayStart, parseTzOffset } from "../time.js";

export const askRouter = Router();

const HISTORY_LIMIT = 60;
const CONTEXT_TURNS = 10;
const MAX_NOTES = 8;
const MAX_PERIOD_NOTES = 60;

interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  source_ids: string[];
  created_at: string;
}

async function withSources(db: AuthedRequest["db"], rows: ChatRow[]) {
  const ids = [...new Set(rows.flatMap((r) => r.source_ids ?? []))];
  const thoughts = await getThoughtsByIds(db, ids);
  const byId = new Map(thoughts.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...r,
    sources: (r.source_ids ?? []).map((id) => byId.get(id) ?? { id, content: null, created_at: null, deleted: true }),
  }));
}

askRouter.get("/history", async (req, res) => {
  const { db } = auth(req);
  const { data, error } = await db
    .from("chat_messages")
    .select("id, role, content, source_ids, created_at")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw dbError(error, "loading the conversation");
  res.json({ messages: await withSources(db, ((data ?? []) as ChatRow[]).reverse()) });
});

askRouter.delete("/history", async (req, res) => {
  const { db, userId } = auth(req);
  const { error } = await db.from("chat_messages").delete().eq("user_id", userId);
  if (error) throw dbError(error, "clearing the conversation");
  res.status(204).end();
});

askRouter.post("/", async (req, res) => {
  const { db } = auth(req);
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) throw badRequest("Ask a question first.");
  if (question.length > 1000) throw badRequest("Please keep questions under 1000 characters.");
  const tz = parseTzOffset(req.body?.tzOffset);
  const nowLocal = formatLocal(new Date(), tz);

  // Recent conversation for follow-up questions.
  const { data: historyRows, error: historyError } = await db
    .from("chat_messages")
    .select("role, content")
    .order("created_at", { ascending: false })
    .limit(CONTEXT_TURNS);
  if (historyError) throw dbError(historyError, "loading the conversation");
  const history = ((historyRows ?? []) as ChatTurn[]).reverse();

  // 1. Understand the question (resolve follow-ups, extract search terms and dates).
  const plan = await planRetrieval(history, question, nowLocal);
  const from = isDate(plan.date_from) ? localDayStart(plan.date_from, tz) : null;
  const to = isDate(plan.date_to) ? localDayStart(addDays(plan.date_to, 1), tz) : null;

  // 2. Retrieve only the relevant notes for this user.
  let notes: Thought[] = [];
  if (plan.mode === "period" && (from || to) && !plan.search_text.trim()) {
    notes = await listThoughtsInRange(db, from ?? new Date(0), to ?? new Date(), MAX_PERIOD_NOTES);
  } else {
    const keywordText = `${plan.search_text} ${plan.standalone_question}`;
    notes = await searchThoughts(db, keywordText, {
      embedText: plan.standalone_question,
      limit: plan.mode === "period" ? MAX_PERIOD_NOTES : MAX_NOTES,
      from,
      to,
    });
    if (!notes.length && (from || to)) {
      notes = await listThoughtsInRange(db, from ?? new Date(0), to ?? new Date(), MAX_PERIOD_NOTES);
    }
  }

  // 3. Answer grounded in those notes.
  const forLlm: NoteForLlm[] = notes.map((n, i) => ({ ref: i + 1, when: formatLocal(n.created_at, tz), content: n.content }));
  const result = await answerQuestion(history, question, forLlm, nowLocal);
  const sourceIds = [...new Set(result.used_notes)]
    .filter((ref) => ref >= 1 && ref <= notes.length)
    .map((ref) => notes[ref - 1].id);

  // 4. Persist the exchange only after a successful answer.
  const askedAt = Date.now();
  const { data: saved, error: saveError } = await db
    .from("chat_messages")
    .insert([
      { role: "user", content: question, created_at: new Date(askedAt).toISOString() },
      {
        role: "assistant",
        content: result.answer.slice(0, 8000),
        source_ids: sourceIds,
        created_at: new Date(askedAt + 1).toISOString(),
      },
    ])
    .select("id, role, content, source_ids, created_at");
  if (saveError || !saved) throw dbError(saveError, "saving the conversation");

  const messages = await withSources(
    db,
    (saved as ChatRow[]).sort((a, b) => (a.role === b.role ? 0 : a.role === "user" ? -1 : 1)),
  );
  res.json({ messages, retrieved: notes.length });
});
