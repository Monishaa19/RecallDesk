import { Router } from "express";
import { auth } from "../supabase.js";
import { parseTzOffset } from "../time.js";
import { captureThought, type Thought } from "../thoughts.js";

/**
 * Explicit, opt-in demo seeding for the *current* user only.
 * Each sample goes through the real capture pipeline (LLM + embedding + insert);
 * nothing is pre-written or shared between accounts.
 */
export const DEMO_CAPTURES = [
  "I need to revise lazy propagation for DSA.",
  "I have an idea for my graphics project: dynamically adjust the number of rendered Gaussians based on frame time to maintain a target frame rate.",
  "I want to create a YouTube video about gratitude.",
  "I learned that caching can reduce repeated database queries, but I still don't understand cache invalidation.",
  "I should ask my project teammate whether the UI is ready.",
];

export const demoRouter = Router();

demoRouter.post("/seed", async (req, res) => {
  const { db } = auth(req);
  const saved: Thought[] = [];
  const failed: number[] = [];
  // Sequential so timestamps keep the sample order.
  for (const [i, text] of DEMO_CAPTURES.entries()) {
    try {
      saved.push((await captureThought(db, text, parseTzOffset(req.body?.tzOffset))).thought);
    } catch {
      failed.push(i);
    }
  }
  res.status(saved.length ? 201 : 502).json({ saved, failed: failed.length });
});
