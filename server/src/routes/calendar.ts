import { Router } from "express";
import { z } from "zod";
import { badRequest, dbError as baseDbError, HttpError, notFound } from "../errors.js";
import { auth } from "../supabase.js";
import { isDate } from "../time.js";
import { EVENT_COLUMNS } from "../thoughts.js";

export const calendarRouter = Router();

// A missing table means the calendar migration hasn't been run yet; say so plainly.
function dbError(err: { message?: string; code?: string } | null, what: string): HttpError {
  if (err?.code === "PGRST205" || err?.code === "42P01") {
    return new HttpError(503, "The calendar isn't set up in the database yet. Run the calendar migration in Supabase.", "calendar_missing");
  }
  return baseDbError(err, what);
}

// Each event also carries the thought it came from (if any), so the calendar can show and link it.
const WITH_THOUGHT = `${EVENT_COLUMNS}, thought:thoughts(id, content, done_at)`;

const UUID = z.string().uuid();
const KINDS = ["deadline", "exam", "meeting", "appointment", "reminder", "event"] as const;

const validDate = (s: string) => isDate(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const EventSchema = z.object({
  title: z.string().trim().min(1, "Give it a name.").max(200),
  date: z.string().refine(validDate, "Pick a valid date."),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  kind: z.enum(KINDS).optional(),
});

// Events between two dates (inclusive), e.g. the visible month grid.
calendarRouter.get("/", async (req, res) => {
  const { db } = auth(req);
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!validDate(from) || !validDate(to) || from > to) throw badRequest("Pick a valid date range.");
  const { data, error } = await db
    .from("calendar_events")
    .select(WITH_THOUGHT)
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date")
    .order("event_time", { nullsFirst: true })
    .limit(500);
  if (error) throw dbError(error, "loading your calendar");
  res.json({ events: data ?? [] });
});

// Upcoming events from a given day onward.
calendarRouter.get("/upcoming", async (req, res) => {
  const { db } = auth(req);
  const from = String(req.query.from ?? "");
  if (!validDate(from)) throw badRequest("Pick a valid date.");
  const { data, error } = await db
    .from("calendar_events")
    .select(WITH_THOUGHT)
    .gte("event_date", from)
    .order("event_date")
    .order("event_time", { nullsFirst: true })
    .limit(Math.min(Math.max(Number(req.query.limit) || 8, 1), 50));
  if (error) throw dbError(error, "loading your calendar");
  res.json({ events: data ?? [] });
});

calendarRouter.post("/", async (req, res) => {
  const { db } = auth(req);
  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "That event isn't valid.");
  const e = parsed.data;
  const { data, error } = await db
    .from("calendar_events")
    .insert({ title: e.title, event_date: e.date, event_time: e.time ?? null, kind: e.kind ?? "event" })
    .select(WITH_THOUGHT)
    .single();
  if (error || !data) throw dbError(error, "saving the event");
  res.status(201).json({ event: data });
});

calendarRouter.patch("/:id", async (req, res) => {
  const { db } = auth(req);
  const id = UUID.safeParse(req.params.id);
  if (!id.success) throw notFound("That event doesn't exist.");
  const parsed = EventSchema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "That change isn't valid.");
  const e = parsed.data;
  const patch: Record<string, unknown> = {};
  if (e.title !== undefined) patch.title = e.title;
  if (e.date !== undefined) patch.event_date = e.date;
  if (e.time !== undefined) patch.event_time = e.time;
  if (e.kind !== undefined) patch.kind = e.kind;
  if (!Object.keys(patch).length) throw badRequest("Nothing to change.");
  const { data, error } = await db.from("calendar_events").update(patch).eq("id", id.data).select(WITH_THOUGHT);
  if (error) throw dbError(error, "updating the event");
  if (!data?.length) throw notFound("That event doesn't exist anymore.");
  res.json({ event: data[0] });
});

calendarRouter.delete("/:id", async (req, res) => {
  const { db } = auth(req);
  const id = UUID.safeParse(req.params.id);
  if (!id.success) throw notFound("That event doesn't exist.");
  const { data, error } = await db.from("calendar_events").delete().eq("id", id.data).select("id");
  if (error) throw dbError(error, "removing the event");
  if (!data?.length) throw notFound("That event doesn't exist anymore.");
  res.status(204).end();
});
