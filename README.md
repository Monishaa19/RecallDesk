# RecallDesk

**Capture anything. Find it when you need it.**

RecallDesk is a personal external memory. You type (or dictate with Wispr Flow) whatever is on your mind. RecallDesk:

1. **Captures it.** Gemini rewrites the raw thought as a concise, faithful note. Only that note and a timestamp are saved; the original text is never stored or logged.
2. **Remembers it.** Every note is indexed for both keyword search (Postgres full-text) and meaning (sentence embeddings + pgvector).
3. **Recalls it.** *Ask RecallDesk* uses Gemini to answer natural-language questions ("what was that rendering idea?") from your own notes only, with clickable source references. Daily and monthly summaries give a quick look back.

There are no folders, tags, categories, or task lists, by design.

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
| `GEMINI_MODEL` | server, optional | defaults to `gemini-flash-latest` |
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

## Deployment

### Backend (Render, as an example)

1. New **Web Service** from this repo.
2. Build command: `npm install && npm run build -w server`
3. Start command: `node server/dist/index.js`
4. Environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `CORS_ORIGINS=https://<your-app>.vercel.app`.
   Render sets `PORT` automatically.

Use an instance with at least 512 MB of RAM for the embedding model. With less, set `EMBEDDINGS_ENABLED=false` to fall back to keyword search.

### Frontend (Vercel)

1. Import the repo. Set **Root Directory** to `client` (framework: Vite).
2. Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=https://<your-api>.onrender.com`.
3. Deploy. `client/vercel.json` rewrites routes to the SPA.
4. Add the Vercel URL to Supabase **Site URL / Redirect URLs** and to the API's `CORS_ORIGINS`.

---

## API reference

All routes require `Authorization: Bearer <supabase access token>`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/thoughts` `{text}` | Summarize, embed and save a capture. Returns the saved note. |
| `GET` | `/api/thoughts?q=&before=&limit=` | List (newest first, cursor) or hybrid search |
| `GET/PATCH/DELETE` | `/api/thoughts/:id` | Read, edit (re-embeds), delete |
| `POST` | `/api/ask` `{question, tzOffset}` | Plan → retrieve → grounded answer with sources |
| `GET/DELETE` | `/api/ask/history` | Conversation history / start over |
| `GET` | `/api/summaries?type=day\|month&key=&tzOffset=&refresh=1` | Daily/monthly summary + source thoughts |
| `GET` | `/api/summaries/activity?month=` | Days with captures (for the date strip) |
| `POST` | `/api/demo/seed` | Opt-in: capture the 5 sample thoughts for the current user |

## Data model

| Table | Columns |
|---|---|
| `thoughts` | `id`, `user_id`, `content` (concise note only), `created_at`, `updated_at`, `embedding vector(384)`, `fts tsvector` (generated) |
| `chat_messages` | `id`, `user_id`, `role`, `content`, `source_ids uuid[]`, `created_at` |
| `summaries` | `id`, `user_id`, `period_type`, `period_key`, `content`, `thought_ids`, `source_hash`, `created_at` (a cache, always regenerable) |
