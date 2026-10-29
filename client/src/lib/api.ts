import { supabase } from "./supabase";

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export interface Thought {
  id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
  done_at?: string | null;
  topics?: string[];
}

export interface TopicChange {
  id: string;
  content: string;
  from: string[];
  to: string[];
}

export interface SourceRef {
  id: string;
  content: string | null;
  created_at: string | null;
  deleted?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources: SourceRef[];
}

export interface SummaryResponse {
  summary: string | null;
  generatedAt?: string;
  thoughts: Thought[];
  cached: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "error",
  ) {
    super(message);
  }
}

export const tzOffset = () => new Date().getTimezoneOffset();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (session) headers.set("Authorization", `Bearer ${session.access_token}`);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Can't reach RecallDesk. Check your connection and try again.", 0, "network");
  }
  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 401 && supabase) void supabase.auth.signOut();
    throw new ApiError(
      err?.message ?? (res.status >= 500 ? "The RecallDesk server isn't responding. Please try again." : "Something went wrong."),
      res.status,
      err?.code,
    );
  }
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; database: boolean; ai: boolean; embeddings: boolean }>("/api/health"),

  listThoughts: (params: { q?: string; before?: string | null; limit?: number; status?: "active" | "done" } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.before) qs.set("before", params.before);
    if (params.limit) qs.set("limit", String(params.limit));
    return request<{ thoughts: Thought[]; nextCursor: string | null; mode: "list" | "search"; total: number }>(`/api/thoughts?${qs}`);
  },
  getThought: (id: string) => request<{ thought: Thought }>(`/api/thoughts/${encodeURIComponent(id)}`),
  capture: (text: string) => request<{ thought: Thought }>("/api/thoughts", { method: "POST", body: JSON.stringify({ text }) }),
  updateThought: (id: string, content: string) =>
    request<{ thought: Thought }>(`/api/thoughts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  reorganizePreview: (instruction: string) =>
    request<{ reply: string; changes: TopicChange[] }>("/api/thoughts/reorganize/preview", {
      method: "POST",
      body: JSON.stringify({ instruction }),
    }),
  reorganizeApply: (changes: { id: string; topics: string[] }[]) =>
    request<{ updated: number }>("/api/thoughts/reorganize/apply", { method: "POST", body: JSON.stringify({ changes }) }),
  categorize: () => request<{ organized: number }>("/api/thoughts/categorize", { method: "POST" }),
  setDone: (id: string, done: boolean) =>
    request<{ thought: Thought }>(`/api/thoughts/${encodeURIComponent(id)}/done`, { method: "PATCH", body: JSON.stringify({ done }) }),
  deleteThought: (id: string) => request<void>(`/api/thoughts/${encodeURIComponent(id)}`, { method: "DELETE" }),

  chatHistory: () => request<{ messages: ChatMessage[] }>("/api/ask/history"),
  clearChat: () => request<void>("/api/ask/history", { method: "DELETE" }),
  ask: (question: string) =>
    request<{ messages: ChatMessage[]; retrieved: number }>("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question, tzOffset: tzOffset() }),
    }),

  summary: (type: "day" | "month", key: string, refresh = false) =>
    request<SummaryResponse>(
      `/api/summaries?type=${type}&key=${key}&tzOffset=${tzOffset()}${refresh ? "&refresh=1" : ""}`,
    ),
  activity: (month: string) => request<{ days: Record<string, number> }>(`/api/summaries/activity?month=${month}&tzOffset=${tzOffset()}`),

  transcribe: (audio: string, mimeType: string) =>
    request<{ text: string }>("/api/transcribe", { method: "POST", body: JSON.stringify({ audio, mimeType }) }),

  seedDemo: () => request<{ saved: Thought[]; failed: number }>("/api/demo/seed", { method: "POST" }),
};
