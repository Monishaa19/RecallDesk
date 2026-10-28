-- Lets a thought be checked off (Google Tasks style). NULL = open, timestamp = when it was checked.
-- The existing "Users update own thoughts" RLS policy already covers this column.
alter table public.thoughts add column if not exists done_at timestamptz;
