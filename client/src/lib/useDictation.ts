import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/**
 * Voice input for any text box, with two engines behind one button:
 *  - "live":   the browser's built-in speech recognition (Chrome, Edge, Safari). Free, instant, words appear as you speak.
 *  - "record": record a clip and let the server transcribe it with Gemini (works in every modern browser, e.g. Firefox).
 * Spoken text is appended to whatever is already in the box.
 */

export type DictationState = "idle" | "listening" | "transcribing";
type Engine = "live" | "record" | "none";

// Minimal typings for the (still vendor-prefixed) Web Speech API.
interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const RecognitionCtor: SpeechRecognitionCtor | undefined =
  typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition)
    : undefined;

const canRecord = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

const MAX_RECORDING_MS = 120_000;

/** Remember if live recognition failed (e.g. Brave or offline) so later taps go straight to recording. */
let liveBroken = false;

function pickEngine(): Engine {
  if (RecognitionCtor && !liveBroken) return "live";
  if (canRecord()) return "record";
  return "none";
}

const join = (base: string, add: string) => {
  const a = add.trim();
  if (!a) return base;
  return base && !/\s$/.test(base) ? `${base} ${a}` : `${base}${a}`;
};

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function useDictation(value: string, onChange: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const supported = pickEngine() !== "none";

  // Always read the latest value/onChange from inside async callbacks.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const startRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Allow the mic for this site in your browser's address bar, then try again.");
      setState("idle");
      return;
    }
    streamRef.current = stream;
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(
      (t) => MediaRecorder.isTypeSupported?.(t),
    );
    const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      releaseMic();
      const blob = new Blob(chunks, { type: recorder.mimeType || preferred || "audio/webm" });
      if (blob.size < 1000) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const { text } = await api.transcribe(await blobToBase64(blob), blob.type);
        onChangeRef.current(join(valueRef.current, text));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't turn that recording into text. Please try again.");
      } finally {
        setState("idle");
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("listening");
    timerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
  };

  const startLive = () => {
    const rec = new RecognitionCtor!();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    const base = valueRef.current;
    let finals = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals = join(finals, r[0].transcript);
        else interim = join(interim, r[0].transcript);
      }
      onChangeRef.current(join(join(base, finals), interim));
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        if (e.error === "service-not-allowed" && canRecord()) {
          liveBroken = true;
          setError("Live speech isn't available in this browser. Tap the mic again to record instead.");
        } else {
          setError("Microphone access was blocked. Allow the mic for this site in your browser's address bar, then try again.");
        }
      } else if (e.error === "network" || e.error === "language-not-supported") {
        if (canRecord()) {
          liveBroken = true;
          setError("Live speech isn't working here. Tap the mic again to record instead.");
        } else {
          setError("Speech recognition couldn't connect. Check your connection and try again.");
        }
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setError("Voice input stopped unexpectedly. Please try again.");
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      // Settle the text on the final words only (drop any half-heard interim words).
      onChangeRef.current(join(base, finals));
      setState("idle");
    };
    recognitionRef.current = rec;
    rec.start();
    setState("listening");
  };

  const start = useCallback(() => {
    setError(null);
    const engine = pickEngine();
    if (engine === "live") startLive();
    else if (engine === "record") void startRecording();
    else setError("Voice input isn't supported in this browser. Try Chrome, Edge or Safari, or use Wispr Flow.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const toggle = useCallback(() => (state === "listening" ? stop() : state === "idle" ? start() : undefined), [state, start, stop]);

  // Stop listening if the component goes away mid-dictation.
  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMic();
    },
    [],
  );

  return { state, error, supported, toggle, stop, clearError: () => setError(null) };
}
