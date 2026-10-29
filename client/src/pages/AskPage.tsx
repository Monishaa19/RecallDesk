import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, BookOpen, RotateCcw } from "lucide-react";
import { api, ApiError, type ChatMessage, type SourceRef } from "../lib/api";
import { formatWhen } from "../lib/format";
import { useOpenThought } from "../components/ThoughtDialog";
import { MicButton } from "../components/MicButton";
import { useToast } from "../components/Toast";
import { ErrorNotice, Logo, RichText, Skeleton } from "../components/ui";

const SUGGESTIONS = [
  "What was that graphics project idea I had?",
  "What did I want to revise for DSA?",
  "What video ideas did I have?",
  "Did I ever write anything about cache invalidation?",
  "What did I capture yesterday?",
  "What topics did I think about most this month?",
];

function Sources({ sources }: { sources: SourceRef[] }) {
  const open = useOpenThought();
  if (!sources.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
        <BookOpen className="size-3.5" /> From your thoughts
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((s) =>
          s.deleted || !s.content ? (
            <div key={s.id} className="rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-faint">
              This thought was deleted.
            </div>
          ) : (
            <button
              key={s.id}
              onClick={() => open(s.id)}
              className="group cursor-pointer rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-accent/40 hover:bg-accent-soft/40"
            >
              <p className="line-clamp-2 text-[13px] leading-snug text-ink-soft">{s.content}</p>
              <p className="mt-1.5 text-[11px] text-faint group-hover:text-accent">{formatWhen(s.created_at!)}</p>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade-up flex gap-3">
      <Logo className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AskPage() {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<{ question: string; message: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const { messages } = await api.chatHistory();
      setMessages(messages);
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : "Couldn't load your conversation.");
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, askError]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setPending(question);
    setAskError(null);
    setInput("");
    try {
      const res = await api.ask(question);
      setMessages((m) => [...(m ?? []), ...res.messages]);
    } catch (e) {
      setAskError({ question, message: e instanceof ApiError ? e.message : "Couldn't get an answer. Please try again." });
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };

  const clear = async () => {
    try {
      await api.clearChat();
      setMessages([]);
      setAskError(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't clear the conversation.", "error");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(input);
    }
  };

  const empty = messages !== null && messages.length === 0 && !pending && !askError;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4 sm:px-6 md:min-h-dvh">
      <header className="flex items-end justify-between gap-4 pt-10 pb-4 md:pt-16">
        <div>
          <h1 className="page-title">Ask RecallDesk</h1>
          <p className="mt-1.5 text-muted">Ask about anything you've captured, even if you only half-remember it.</p>
        </div>
        {messages && messages.length > 0 && (
          <button onClick={clear} className="btn-ghost shrink-0 text-muted" title="Start a new conversation">
            <RotateCcw className="size-4" /> <span className="hidden sm:inline">New conversation</span>
          </button>
        )}
      </header>

      <div className="flex-1 space-y-7 py-6" aria-live="polite">
        {historyError && <ErrorNotice message={historyError} onRetry={loadHistory} />}
        {!messages && !historyError && (
          <div className="space-y-4">
            <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-20 w-5/6 rounded-2xl" />
          </div>
        )}

        {empty && (
          <div className="animate-fade-up pt-4">
            <p className="text-sm text-muted">Try asking</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="card cursor-pointer px-4 py-3 text-left text-sm text-ink-soft transition hover:border-accent/40 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages?.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] text-accent-ink">
                {m.content}
              </p>
            </div>
          ) : (
            <AssistantBubble key={m.id}>
              <RichText text={m.content} className="text-[15px] leading-relaxed text-ink" />
              <Sources sources={m.sources} />
            </AssistantBubble>
          ),
        )}

        {(pending || askError) && (
          <div className="flex justify-end">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] text-accent-ink">
              {pending ?? askError?.question}
            </p>
          </div>
        )}
        {pending && (
          <AssistantBubble>
            <p className="flex items-center gap-2 pt-1 text-sm text-muted">
              Searching your thoughts
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-bounce rounded-full bg-accent/60" style={{ animationDelay: `${i * 140}ms` }} />
                ))}
              </span>
            </p>
          </AssistantBubble>
        )}
        {askError && <ErrorNotice message={askError.message} onRetry={() => ask(askError.question)} />}
        <div ref={bottomRef} className="scroll-mb-28" />
      </div>

      <div className="sticky bottom-[68px] bg-gradient-to-t from-canvas from-70% to-transparent pt-6 pb-4 md:bottom-0 md:pb-8">
        <div className="card flex items-end gap-2 p-2 pl-4 shadow-lift transition focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={1000}
            placeholder="Ask about your thoughts…"
            aria-label="Ask a question"
            className="max-h-44 flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
          />
          <MicButton value={input} onChange={setInput} disabled={Boolean(pending)} />
          <button
            onClick={() => ask(input)}
            disabled={!input.trim() || Boolean(pending)}
            className="btn-primary size-10 shrink-0 rounded-xl p-0"
            aria-label="Send"
          >
            <ArrowUp className="size-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}
