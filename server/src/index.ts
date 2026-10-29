import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { config, isLlmConfigured, isSupabaseConfigured } from "./config.js";
import { embeddingsStatus, warmUpEmbeddings } from "./embeddings.js";
import { HttpError } from "./errors.js";
import { askRouter } from "./routes/ask.js";
import { demoRouter } from "./routes/demo.js";
import { summariesRouter } from "./routes/summaries.js";
import { thoughtsRouter } from "./routes/thoughts.js";
import { transcribeRouter } from "./routes/transcribe.js";
import { requireUser } from "./supabase.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.corsOrigins, allowedHeaders: ["Authorization", "Content-Type"] }));
// Voice recordings need a larger body limit, so this route parses its own JSON first.
app.use("/api/transcribe", transcribeRouter);
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    database: isSupabaseConfigured,
    ai: isLlmConfigured,
    embeddings: embeddingsStatus().enabled,
  });
});

app.use("/api/thoughts", requireUser, thoughtsRouter);
app.use("/api/ask", requireUser, askRouter);
app.use("/api/summaries", requireUser, summariesRouter);
app.use("/api/demo", requireUser, demoRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: { message: "Not found.", code: "not_found" } });
});

// In production the API also serves the built website, so the whole app is one service and one URL.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  // Client-side routes (/thoughts, /ask, ...) all load the single-page app.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// Central error handler. Never echoes request bodies (they contain user thoughts).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }
  if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.too.large") {
    res.status(413).json({ error: { message: "That text is too long.", code: "too_large" } });
    return;
  }
  console.error("[server] unexpected error:", err instanceof Error ? err.name + ": " + err.message : "unknown");
  res.status(500).json({ error: { message: "Something went wrong on our side. Please try again.", code: "internal" } });
});

app.listen(config.port, () => {
  console.log(`RecallDesk API listening on http://localhost:${config.port}`);
  if (!isSupabaseConfigured) console.warn("! SUPABASE_URL / SUPABASE_ANON_KEY not set; database features will return 503.");
  if (!isLlmConfigured) console.warn("! GEMINI_API_KEY not set; AI features will return 503.");
  warmUpEmbeddings();
});
