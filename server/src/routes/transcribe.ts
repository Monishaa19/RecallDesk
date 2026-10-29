import express, { Router } from "express";
import { badRequest } from "../errors.js";
import { transcribeAudio } from "../llm.js";
import { requireUser } from "../supabase.js";

/**
 * POST /api/transcribe  { audio: base64, mimeType }
 * Fallback speech-to-text for browsers without built-in speech recognition.
 * The audio is held in memory only for this request; it is never stored or logged.
 */
export const transcribeRouter = Router();

const ALLOWED = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|m4a)(;.*)?$/i;
const MAX_BASE64 = 8 * 1024 * 1024; // ~6 MB of audio, roughly a few minutes of compressed speech

transcribeRouter.post("/", express.json({ limit: "9mb" }), requireUser, async (req, res) => {
  const audio = typeof req.body?.audio === "string" ? req.body.audio : "";
  const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "";
  if (!audio) throw badRequest("No recording received. Please try again.");
  if (audio.length > MAX_BASE64) throw badRequest("That recording is too long. Please keep it under about 2 minutes.");
  if (!ALLOWED.test(mimeType)) throw badRequest("Unsupported audio format.");

  const text = await transcribeAudio(audio, mimeType.split(";")[0]);
  if (!text) throw badRequest("Couldn't hear any words in that recording. Please try again a little closer to the mic.");
  res.json({ text });
});
