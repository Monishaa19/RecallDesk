-- Money moments: "Rahul owes me $20", "I owe Priya $15 for the cab".
-- The AI only SUGGESTS these from a capture; nothing is sent to PayPal until the person confirms.
-- Requests use the PayPal Invoicing API; paying someone uses PayPal Checkout (Orders API).

-- People the person has requested money from or paid, so a name only needs an email once.
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  email       text not null check (char_length(email) between 3 and 254),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists contacts_user_name_idx on public.contacts (user_id, lower(name));

create table if not exists public.money_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The capture this came from; the money record outlives the thought if that is deleted.
  thought_id  uuid references public.thoughts (id) on delete set null,
  direction   text not null check (direction in ('owed_to_me', 'i_owe')),
  person      text not null check (char_length(person) between 1 and 80),
  email       text check (email is null or char_length(email) between 3 and 254),
  amount      numeric(12, 2) not null check (amount > 0 and amount <= 10000),
  currency    text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  reason      text not null default '' check (char_length(reason) <= 200),
  due_date    date,
  status      text not null default 'suggested'
              check (status in ('suggested', 'sent', 'awaiting_payment', 'paid', 'cancelled', 'dismissed')),
  paypal_id   text,  -- invoice id (requests) or order id (payments)
  pay_url     text,  -- where the other person pays a request
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists money_actions_user_created_idx on public.money_actions (user_id, created_at desc);
create index if not exists money_actions_thought_idx on public.money_actions (thought_id);

alter table public.contacts enable row level security;
alter table public.money_actions enable row level security;

create policy "Users read own contacts" on public.contacts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add own contacts" on public.contacts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own contacts" on public.contacts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own contacts" on public.contacts
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own money" on public.money_actions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add own money" on public.money_actions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own money" on public.money_actions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own money" on public.money_actions
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.contacts, public.money_actions from anon;
