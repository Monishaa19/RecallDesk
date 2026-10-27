-- RecallDesk schema
-- Thoughts store ONLY the concise AI-written note (never the raw capture).
-- Every table is protected by Row Level Security so a user can only ever touch their own rows.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Thoughts
-- ---------------------------------------------------------------------------
create table public.thoughts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  -- 384-dim sentence embedding (all-MiniLM-L6-v2) used for semantic recall
  embedding   extensions.vector(384),
  -- keyword search vector, maintained automatically
  fts         tsvector generated always as (to_tsvector('english', content)) stored
);

create index thoughts_user_created_idx on public.thoughts (user_id, created_at desc);
create index thoughts_fts_idx on public.thoughts using gin (fts);
create index thoughts_embedding_idx on public.thoughts
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.thoughts enable row level security;

create policy "Users read own thoughts" on public.thoughts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own thoughts" on public.thoughts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own thoughts" on public.thoughts
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own thoughts" on public.thoughts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Ask RecallDesk conversation history
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) between 1 and 8000),
  source_ids  uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index chat_messages_user_created_idx on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

create policy "Users read own messages" on public.chat_messages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own messages" on public.chat_messages
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own messages" on public.chat_messages
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Cached daily / monthly summaries (always regenerable from thoughts)
-- ---------------------------------------------------------------------------
create table public.summaries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  period_type  text not null check (period_type in ('day', 'month')),
  period_key   text not null,
  content      text not null,
  thought_ids  uuid[] not null default '{}',
  source_hash  text not null,
  created_at   timestamptz not null default now(),
  unique (user_id, period_type, period_key)
);

alter table public.summaries enable row level security;

create policy "Users read own summaries" on public.summaries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own summaries" on public.summaries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own summaries" on public.summaries
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own summaries" on public.summaries
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get nothing.
revoke all on public.thoughts, public.chat_messages, public.summaries from anon;

-- ---------------------------------------------------------------------------
-- Hybrid retrieval: keyword (full-text, prefix-matched) + semantic (pgvector),
-- merged with Reciprocal Rank Fusion. SECURITY INVOKER => RLS still applies,
-- and we additionally filter on auth.uid() explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.search_thoughts(
  query_text      text,
  query_embedding extensions.vector(384) default null,
  match_count     int default 10,
  date_from       timestamptz default null,
  date_to         timestamptz default null,
  min_similarity  float default 0.25
)
returns table (
  id            uuid,
  content       text,
  created_at    timestamptz,
  score         float,
  keyword_rank  float,
  similarity    float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with base as (
    select t.id, t.content, t.created_at, t.fts, t.embedding
    from public.thoughts t
    where t.user_id = auth.uid()
      and (date_from is null or t.created_at >= date_from)
      and (date_to   is null or t.created_at <  date_to)
  ),
  q as (
    -- "cache invalidation" -> 'cache':* | 'invalidation':*  (stemmed, prefix-matched, OR-ed)
    select to_tsquery('english', coalesce(string_agg(quote_literal(w) || ':*', ' | '), '')) as tsq
    from regexp_split_to_table(lower(coalesce(query_text, '')), '[^[:alnum:]]+') as w
    where length(w) > 1
  ),
  kw as (
    select b.id,
           ts_rank_cd(b.fts, q.tsq) as rank,
           row_number() over (order by ts_rank_cd(b.fts, q.tsq) desc) as rn
    from base b, q
    where b.fts @@ q.tsq
    order by rank desc
    limit 40
  ),
  sem as (
    select s.id, s.sim, row_number() over (order by s.sim desc) as rn
    from (
      select b.id, 1 - (b.embedding <=> query_embedding) as sim
      from base b
      where query_embedding is not null and b.embedding is not null
      order by b.embedding <=> query_embedding
      limit 40
    ) s
    where s.sim >= min_similarity
  )
  select b.id,
         b.content,
         b.created_at,
         (coalesce(1.0 / (60 + kw.rn), 0) + coalesce(1.0 / (60 + sem.rn), 0))::float as score,
         coalesce(kw.rank, 0)::float as keyword_rank,
         coalesce(sem.sim, 0)::float as similarity
  from base b
  left join kw  on kw.id  = b.id
  left join sem on sem.id = b.id
  where kw.id is not null or sem.id is not null
  order by score desc, b.created_at desc
  limit greatest(match_count, 1);
$$;

revoke execute on function public.search_thoughts(text, extensions.vector, int, timestamptz, timestamptz, float) from public, anon;
grant execute on function public.search_thoughts(text, extensions.vector, int, timestamptz, timestamptz, float) to authenticated;
