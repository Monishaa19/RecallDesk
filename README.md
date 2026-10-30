# RecallDesk

**Capture anything. Find it when you need it.**

**Live demo:** https://recalldesk-zs0o.onrender.com (free tier: the first visit can take about a minute to wake up)

RecallDesk is a personal external memory. You type (or dictate with Wispr Flow) whatever is on your mind. RecallDesk:

1. **Captures it.** Gemini rewrites the raw thought as a concise, faithful note. Only that note and a timestamp are saved; the original text is never stored or logged.
2. **Remembers it.** Every note is indexed for both keyword search (Postgres full-text) and meaning (sentence embeddings + pgvector).
3. **Recalls it.** *Ask RecallDesk* uses Gemini to answer natural-language questions ("what was that rendering idea?") from your own notes only, with clickable source references. Daily and monthly summaries give a quick look back.

4. **Puts dates on your calendar.** Say "DBMS assignment due this Friday" or "interview next Monday at 3" while capturing, and Gemini works out the actual date and adds it to RecallDesk's built-in **Calendar** page. No Google Calendar connection is needed. Vague timing ("sometime next week") is never guessed into a date.
5. **Settles money through PayPal.** Say "Rahul owes me $20 for dinner" or "I owe Priya $15 for the cab", and Gemini spots the money moment. After you confirm, RecallDesk sends Rahul a **PayPal invoice** or opens **PayPal Checkout** so you can pay Priya, then ticks the thought off when it's paid. *Ask RecallDesk* answers "who still owes me money?" from live PayPal statuses.
6. **Lets you park it.** *Park it* is a private place to set a thought down, such as a worry or a loop you don't want to keep holding. It's **end-to-end encrypted in your browser** with a secret code only you know. RecallDesk's server, the AI, and the database only ever see ciphertext, and parked thoughts never appear in search, Ask, or summaries.

Thoughts can be ticked off like a task list (they move into a collapsible *Completed* section), but there are no folders, tags, or categories, by design.

---

## Architecture

```
client/   React 19 + Vite + TypeScript + Tailwind v4  (deploy: Vercel)
server/   Node + Express 5 + TypeScript                (deploy: Render / Railway / Fly)
supabase/ SQL migration: tables, RLS policies, hybrid search function
```

```
Browser ──(Supabase Auth: email + password)──► Supabase
   │
   └─ /api/* with the user's JWT ──► Express API ──► Gemini (summarize · plan · answer · summaries)
                                         │
                                         ├─ local embeddings (all-MiniLM-L6-v2, 384-d)
                                         └─ Supabase Postgres AS THAT USER (anon key + JWT ⇒ RLS enforced)
```

**Privacy model**

- The API never uses a service-role key. Each request builds a Supabase client from the *user's own JWT*, so Postgres Row Level Security applies to every read and write. Even a bug in the API can't read another user's rows.
- RLS policies let users select/insert/update/delete only rows where `user_id = auth.uid()`. The `search_thoughts` function is `SECURITY INVOKER` and also filters on `auth.uid()`.
- The Gemini API key lives only on the server. The Supabase *anon* key is public by design.
- Raw captures exist only in memory during the request. Logs record error codes, never thought content.

**How Ask RecallDesk retrieves (it never sends all your notes to the model)**

1. *Plan*: Gemini rewrites the question as a standalone question, using the conversation for follow-ups like "what about the other one?". It also extracts search terms and synonyms, and resolves dates such as "yesterday" or "this month" into a date range.
2. *Retrieve*: the `search_thoughts` Postgres function runs a **hybrid search** over only that user's notes. It combines prefix-matched full-text search with pgvector cosine similarity using Reciprocal Rank Fusion, and keeps the top 8. Period questions ("what did I capture yesterday?") read that date range instead (up to 60 notes).
3. *Answer*: Gemini answers from those notes only, says plainly when nothing relevant exists, and returns the notes it used. These become the clickable sources.

Summaries are generated on demand from the notes in the chosen day or month. They're cached in a `summaries` table keyed by a hash of the underlying notes, so they regenerate automatically when notes change. A **Regenerate** button forces a refresh.

---

### Money moments with PayPal

| Step | What happens |
|---|---|
| Capture | The same Gemini call that writes the note also extracts money items: direction (`owed_to_me` / `i_owe`), person, exact amount, currency, reason, due date. No exact amount or no named person means no item; nothing is guessed. |
| Suggest | Items are saved as `suggested`. **Nothing is sent to PayPal until the person taps confirm** (human in the loop). Emails are remembered per name in `contacts`. |
| Request money | **PayPal Invoicing API v2**: create the invoice (amount, reason, due date, recipient) and send it; PayPal emails the person a pay link. Remind and cancel use the same API. |
| Pay someone | **PayPal Orders API v2 + JavaScript SDK buttons**: the server creates an order whose payee is the friend's PayPal email, the person approves it in the PayPal window, and the server captures it. |
| Settle | Open items are re-checked against PayPal when the Money page or Ask RecallDesk is used (and every 20 s while the Money page is open). Paid → the item is marked paid and its thought is ticked off. |
| Recall | Ask RecallDesk receives the money records with their live PayPal status, so "who still owes me?" is answered from PayPal, not memory. |

OAuth tokens are fetched with the client credentials on the server and cached; the secret never reaches the browser, and PayPal errors are logged by `debug_id` only.

**Sandbox note:** requests are issued from the RecallDesk sandbox business account. In production each user would connect their own PayPal account through PayPal's partner onboarding so invoices come from them; status updates would move from polling to verified webhooks.

### Voice input

Every text box (Capture, Ask, Park it, Reorganize) has a **mic button**, so voice works for anyone, with or without Wispr Flow:

- **Chrome, Edge, Safari:** the browser's built-in speech recognition. Words appear live as you speak, with no API key and no AI quota used.
- **Other browsers (e.g. Firefox), or if live recognition fails:** the clip is recorded and sent to `POST /api/transcribe`, where Gemini transcribes it. Audio is held in memory only for that request and is never stored or logged.
- Wispr Flow still works anywhere, since it simply types into the box.

### How *Park it* encryption works

- On first use you choose a secret code. The browser generates an RSA-OAEP-3072 key pair; the private key is encrypted with AES-256-GCM under a key derived from your code (PBKDF2-SHA256, 600,000 iterations). The code is never stored or transmitted.
- Parking a thought needs **no code**: the browser encrypts it with a fresh AES-256-GCM key, wraps that key with your public key, and saves only ciphertext straight to Supabase (RLS-protected). It never passes through the RecallDesk API.
- Reading parked thoughts requires the code. Decrypted text lives only in memory while the list is unlocked.
- A forgotten code can't be recovered by anyone; the only option is *Start over*, which deletes all parked thoughts.

## Setup

### 1. Prerequisites

- Node.js 20+ (tested on 22)
- A free [Supabase](https://supabase.com) account
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier works)

### 2. Create the Supabase project

1. In the Supabase dashboard: **New project**. Pick a name (e.g. `recalldesk`), a database password and a region.
2. Open **SQL Editor → New query**, paste the whole contents of
   [`supabase/migrations/20261027000000_init.sql`](supabase/migrations/20261027000000_init.sql), and click **Run**.
   This enables `pgvector` and creates the `thoughts`, `chat_messages` and `summaries` tables, their RLS policies, and the `search_thoughts` function.
   Then run the other files in `supabase/migrations/` **in filename order** the same way (checkbox support, *Park it*, topics, the calendar and money).
   *(With the Supabase CLI instead: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)*
3. **Authentication → Sign In / Providers → Email**: make sure Email is enabled.
   - For a frictionless hackathon demo, turn **Confirm email** *off*. Otherwise new users must click the confirmation link before signing in (the app handles both).
4. **Authentication → URL Configuration**: set **Site URL** to your frontend URL (`http://localhost:5173` locally, your Vercel URL in production) and add it under **Redirect URLs**.
5. **Project Settings → API**: copy the **Project URL** and the **anon / public** key.

### 3. Configure environment

```bash
cp .env.example .env
```

| Variable | Where it's used | Value |
|---|---|---|
| `SUPABASE_URL` | server | Supabase Project URL |
| `SUPABASE_ANON_KEY` | server | Supabase anon/public key |
| `GEMINI_API_KEY` | server (secret) | your Gemini API key |
| `VITE_SUPABASE_URL` | browser | same Project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | same anon key |
| `VITE_API_URL` | browser | empty locally; your API's URL in production |
| `GEMINI_MODEL` | server, optional | defaults to `gemini-2.5-flash` |
| `GEMINI_FALLBACK_MODELS` | server, optional | comma-separated models tried when the main one is overloaded (default `gemini-3.5-flash,gemini-3.1-flash-lite`) |
| `EMBEDDINGS_ENABLED` | server, optional | `true` (default); `false` = keyword-only search |
| `CORS_ORIGINS` | server, optional | comma-separated allowed origins (default `http://localhost:5173`) |
| `API_PORT` / `PORT` | server, optional | default `8787` (`API_PORT` takes precedence; hosts usually set `PORT`) |

### 4. Run locally

```bash
npm install
npm run dev
```

- App: http://localhost:5173 (Vite proxies `/api` to the server)
- API: http://localhost:8787 (`GET /api/health` shows which integrations are configured)

On first start the server downloads the ~23 MB embedding model into `server/.cache/` (one time).
If the database or AI isn't configured, the app shows a banner and the affected API routes return a clear `503`. Nothing is faked.

### Optional: fully local Supabase (Docker)

```bash
npx supabase start          # starts Postgres, Auth, REST locally and applies the migration
npx supabase status         # prints API URL + anon key → put them in .env
```

---

## Demo script (≈2 minutes)

1. **Sign up** with any email and password.
2. **Capture**: dictate with Wispr Flow into the box, e.g. *"I need to revise lazy propagation for DSA. I also had an idea for my graphics project about dynamically adjusting the number of Gaussians based on frame time. And I want to make a YouTube video about gratitude."* → **Capture** (or Ctrl+Enter). The concise note appears with "Thought captured."
3. Capture another thought, e.g. *"I learned that caching can reduce repeated database queries, but I still don't understand cache invalidation."*
   - Shortcut: on a brand-new account, **Try it with sample thoughts** captures the five sample thoughts below through the real pipeline, *for that account only*.
4. **Ask RecallDesk**: *"I remember an idea related to rendering performance. Can you find it?"*, then the follow-up *"and what did I want to learn about caching?"*. Click a source card to open the saved thought.
5. **Summaries → Daily** shows today's summary. Expand **Based on N thoughts** to see the notes behind it. Switch to **Monthly**.

Sample captures (used by the opt-in seed button):

1. I need to revise lazy propagation for DSA.
2. I have an idea for my graphics project: dynamically adjust the number of rendered Gaussians based on frame time to maintain a target frame rate.
3. I want to create a YouTube video about gratitude.
4. I learned that caching can reduce repeated database queries, but I still don't understand cache invalidation.
5. I should ask my project teammate whether the UI is ready.

---

## Deployment (one service on Render, free)

In production the Express server also serves the built website, so RecallDesk deploys as **one web service with one URL** (no CORS setup needed). [`render.yaml`](render.yaml) describes it.

1. Push this repo to GitHub.
2. On [render.com](https://render.com), choose **New → Blueprint**, pick the repo, and Render reads `render.yaml`.
3. Fill in the five secret values when asked: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. When the deploy finishes, open the `https://<name>.onrender.com` URL.
5. In Supabase, go to **Authentication → URL Configuration**, set **Site URL** to that URL, and add it to **Redirect URLs**.

Notes: Render's free tier sleeps after ~15 minutes idle; the first visit afterwards takes about a minute to wake up, so open the link shortly before a demo. The first capture after a restart also downloads the small embedding model once.

Manual equivalent (any Node host): build with `npm ci --include=dev && npm run build`, start with `npm start`, and set the same environment variables.

## API reference

All routes require `Authorization: Bearer <supabase access token>`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/thoughts` `{text, tzOffset}` | Summarize, embed and save a capture; any dates mentioned go on the calendar. Returns the note and the calendar events. |
| `GET` | `/api/thoughts?q=&before=&limit=` | List (newest first, cursor) or hybrid search |
| `GET/PATCH/DELETE` | `/api/thoughts/:id` | Read, edit (re-embeds), delete |
| `POST` | `/api/ask` `{question, tzOffset}` | Plan → retrieve → grounded answer with sources |
| `GET/DELETE` | `/api/ask/history` | Conversation history / start over |
| `GET` | `/api/summaries?type=day\|month&key=&tzOffset=&refresh=1` | Daily/monthly summary + source thoughts |
| `GET` | `/api/summaries/activity?month=` | Days with captures (for the date strip) |
| `GET` | `/api/calendar?from=&to=` · `/api/calendar/upcoming?from=` | Calendar events in a date range / coming up |
| `POST/PATCH/DELETE` | `/api/calendar[/:id]` `{title, date, time?, kind?}` | Add, change or remove a calendar event by hand |
| `GET` | `/api/money?sync=1` | Money items, re-checked against PayPal |
| `POST` | `/api/money/:id/confirm` `{email}` | Send the PayPal invoice (owed to me) or get ready for Checkout (I owe) |
| `POST` | `/api/money/:id/order` · `/capture` `{orderId}` | PayPal Checkout: create and capture the order |
| `PATCH` · `POST` | `/api/money/:id` · `/refresh` `/remind` `/cancel` `/dismiss` | Edit a suggestion, refresh status, remind, cancel, dismiss |
| `POST` | `/api/demo/seed` | Opt-in: capture the 5 sample thoughts for the current user |

## Data model

| Table | Columns |
|---|---|
| `thoughts` | `id`, `user_id`, `content` (concise note only), `created_at`, `updated_at`, `done_at` (ticked off), `embedding vector(384)`, `fts tsvector` (generated) |
| `chat_messages` | `id`, `user_id`, `role`, `content`, `source_ids uuid[]`, `created_at` |
| `park_keys` | `user_id`, `public_key`, `wrapped_private_key`, `wrap_iv`, `salt`, `iterations` (the code itself is never stored) |
| `parked_thoughts` | `id`, `user_id`, `ciphertext`, `iv`, `wrapped_key`, `created_at` (ciphertext only) |
| `calendar_events` | `id`, `user_id`, `thought_id` (source capture; removed with it), `title`, `event_date`, `event_time`, `kind`, `created_at` |
| `money_actions` | `id`, `user_id`, `thought_id`, `direction`, `person`, `email`, `amount`, `currency`, `reason`, `due_date`, `status`, `paypal_id`, `pay_url`, `paid_at`, timestamps |
| `contacts` | `id`, `user_id`, `name`, `email` (so a name needs an email only once) |
| `summaries` | `id`, `user_id`, `period_type`, `period_key`, `content`, `thought_ids`, `source_hash`, `created_at` (a cache, always regenerable) |
