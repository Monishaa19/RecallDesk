-- "Park it": private, end-to-end encrypted thoughts the person wants to set down.
-- Everything here is encrypted IN THE BROWSER before it is saved. The database only
-- ever holds ciphertext; the secret code never leaves the person's device.
-- Parked thoughts are never summarized, searched, or sent to the AI.

-- One key pair per user. The public key lets the app lock new parked thoughts without
-- asking for the code; the private key is itself encrypted with a key derived from the
-- secret code (PBKDF2-SHA256), so only the code can unlock it.
create table if not exists public.park_keys (
  user_id              uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  public_key           text not null,  -- base64 SPKI, RSA-OAEP 3072 / SHA-256
  wrapped_private_key  text not null,  -- base64 AES-256-GCM(pkcs8 private key)
  wrap_iv              text not null,
  salt                 text not null,
  iterations           int  not null check (iterations >= 100000),
  created_at           timestamptz not null default now()
);

create table if not exists public.parked_thoughts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ciphertext   text not null check (char_length(ciphertext) <= 40000),  -- base64 AES-256-GCM
  iv           text not null,
  wrapped_key  text not null,  -- base64 RSA-OAEP(per-thought AES key)
  created_at   timestamptz not null default now()
);

create index if not exists parked_thoughts_user_created_idx on public.parked_thoughts (user_id, created_at desc);

alter table public.park_keys enable row level security;
alter table public.parked_thoughts enable row level security;

create policy "Users read own park key" on public.park_keys
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create own park key" on public.park_keys
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own park key" on public.park_keys
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own parked thoughts" on public.parked_thoughts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users park own thoughts" on public.parked_thoughts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users let go of own parked thoughts" on public.parked_thoughts
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.park_keys, public.parked_thoughts from anon;
