import { createHash } from "node:crypto";
import { Router } from "express";
import { badRequest, dbError } from "../errors.js";
import { summarizePeriod } from "../llm.js";
import { auth } from "../supabase.js";
import { listThoughtsInRange } from "../thoughts.js";
import { addDays, dayRange, formatLocal, isDate, isMonth, monthRange, parseTzOffset, todayLocal } from "../time.js";

export const summariesRouter = Router();

const SUMMARY_FORMAT = "prose-v2";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayLabel(key: string, tz: number) {
  const [y, m, d] = key.split("-").map(Number);
  const pretty = `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
  const today = todayLocal(tz);
  if (key === today) return `today (${pretty})`;
  if (key === addDays(today, -1)) return `yesterday (${pretty})`;
  return pretty;
}

function monthLabel(key: string, tz: number) {
  const [y, m] = key.split("-").map(Number);
  const pretty = `${MONTH_NAMES[m - 1]} ${y}`;
  return todayLocal(tz).startsWith(key) ? `this month (${pretty})` : pretty;
}

// Which days in a month have thoughts (for the date picker).
summariesRouter.get("/activity", async (req, res) => {
  const { db } = auth(req);
  const month = String(req.query.month ?? "");
  if (!isMonth(month)) throw badRequest("Pick a valid month.");
  const tz = parseTzOffset(req.query.tzOffset);
  const { from, to } = monthRange(month, tz);
  const { data, error } = await db
    .from("thoughts")
    .select("created_at")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .limit(2000);
  if (error) throw dbError(error, "loading activity");
  const days: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = new Date(new Date(row.created_at).getTime() - tz * 60_000).toISOString().slice(0, 10);
    days[key] = (days[key] ?? 0) + 1;
  }
  res.json({ days });
});

summariesRouter.get("/", async (req, res) => {
  const { db } = auth(req);
  const type = req.query.type === "month" ? "month" : "day";
  const key = String(req.query.key ?? "");
  const tz = parseTzOffset(req.query.tzOffset);
  const refresh = req.query.refresh === "1";

  if (type === "day" && !isDate(key)) throw badRequest("Pick a valid day.");
  if (type === "month" && !isMonth(key)) throw badRequest("Pick a valid month.");

  const { from, to } = type === "day" ? dayRange(key, tz) : monthRange(key, tz);
  const thoughts = await listThoughtsInRange(db, from, to, 400);

  if (!thoughts.length) {
    res.json({ summary: null, thoughts: [], cached: false });
    return;
  }

  // The cache is valid only while the underlying thoughts are unchanged.
  // Bump SUMMARY_FORMAT when the summary style changes so cached summaries regenerate.
  const sourceHash = createHash("sha256")
    .update(SUMMARY_FORMAT + "|" + thoughts.map((t) => `${t.id}:${t.updated_at ?? t.created_at}`).join("|"))
    .digest("hex");

  if (!refresh) {
    const { data: cached, error } = await db
      .from("summaries")
      .select("content, source_hash, created_at")
      .eq("period_type", type)
      .eq("period_key", key)
      .maybeSingle();
    if (error) throw dbError(error, "loading the summary");
    if (cached && cached.source_hash === sourceHash) {
      res.json({ summary: cached.content, generatedAt: cached.created_at, thoughts, cached: true });
      return;
    }
  }

  const label = type === "day" ? dayLabel(key, tz) : monthLabel(key, tz);
  const summary = await summarizePeriod(
    type,
    label,
    thoughts.map((t) => ({ when: formatLocal(t.created_at, tz), content: t.content })),
  );

  const generatedAt = new Date().toISOString();
  const { error: saveError } = await db.from("summaries").upsert(
    {
      user_id: auth(req).userId,
      period_type: type,
      period_key: key,
      content: summary,
      thought_ids: thoughts.map((t) => t.id),
      source_hash: sourceHash,
      created_at: generatedAt,
    },
    { onConflict: "user_id,period_type,period_key" },
  );
  // Caching is best-effort; the summary itself is still valid.
  if (saveError) console.error(`[db] caching summary failed: ${saveError.code ?? ""}`);

  res.json({ summary, generatedAt, thoughts, cached: false });
});
