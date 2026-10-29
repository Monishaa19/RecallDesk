-- Calendar: dated things (deadlines, exams, meetings...) picked out of captures by the AI,
-- or added by hand on the Calendar page. Lives entirely inside RecallDesk; no external calendar.

create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The capture this came from; the event goes away if that thought is deleted.
  thought_id  uuid references public.thoughts (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  event_date  date not null,
  event_time  time,  -- optional local time of day
  kind        text not null default 'event' check (kind in ('deadline', 'exam', 'meeting', 'appointment', 'reminder', 'event')),
  created_at  timestamptz not null default now()
);

create index if not exists calendar_events_user_date_idx on public.calendar_events (user_id, event_date);
create index if not exists calendar_events_thought_idx on public.calendar_events (thought_id);

alter table public.calendar_events enable row level security;

create policy "Users read own events" on public.calendar_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add own events" on public.calendar_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own events" on public.calendar_events
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own events" on public.calendar_events
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.calendar_events from anon;
