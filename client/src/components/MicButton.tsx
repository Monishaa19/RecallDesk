import { useEffect } from "react";
import { Mic, Square } from "lucide-react";
import { useDictation } from "../lib/useDictation";
import { useToast } from "./Toast";
import { Spinner } from "./ui";

/**
 * One-tap voice input for a text box. Tap to start speaking, tap again to stop;
 * the words are added to the box so the person can glance at them before sending.
 */
export function MicButton({
  value,
  onChange,
  disabled = false,
  showLabel = false,
  className = "",
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  /** Show "Speak" / "Listening…" text next to the icon. */
  showLabel?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const { state, error, supported, toggle, clearError } = useDictation(value, onChange);

  useEffect(() => {
    if (error) {
      toast(error, "error");
      clearError();
    }
  }, [error, toast, clearError]);

  if (!supported) return null;

  const listening = state === "listening";
  const transcribing = state === "transcribing";
  const label = listening ? "Stop listening" : transcribing ? "Turning speech into text" : "Speak instead of typing";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || transcribing}
      aria-label={label}
      aria-pressed={listening}
      title={label}
      className={`relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        showLabel ? "h-10 px-3.5" : "size-10"
      } ${
        listening
          ? "bg-danger text-white shadow-card"
          : "border border-line bg-surface text-ink-soft hover:border-accent/40 hover:text-accent"
      } ${className}`}
    >
      {listening && <span className="absolute inset-0 animate-ping rounded-xl bg-danger/30" aria-hidden="true" />}
      {transcribing ? (
        <Spinner className="size-4" />
      ) : listening ? (
        <Square className="relative size-3.5 fill-current" />
      ) : (
        <Mic className="size-4" strokeWidth={2} />
      )}
      {showLabel && (
        <span className="relative">{listening ? "Listening…" : transcribing ? "Writing…" : "Speak"}</span>
      )}
    </button>
  );
}
