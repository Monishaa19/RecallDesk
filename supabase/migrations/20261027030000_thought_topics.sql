-- Topics assigned automatically by the AI (1-3 per thought, first = main topic).
-- Used only to group My Thoughts; people never have to choose or manage them.
alter table public.thoughts add column if not exists topics text[] not null default '{}';
