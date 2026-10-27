import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

/**
 * Local sentence embeddings (all-MiniLM-L6-v2, 384 dims) computed on the server.
 * No extra API key needed; the ~23 MB model is downloaded once and cached.
 * If embeddings are unavailable, retrieval gracefully falls back to keyword search.
 */
type Extractor = (text: string, opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;
let disabledReason: string | null = config.embeddingsEnabled ? null : "disabled by EMBEDDINGS_ENABLED=false";

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      const here = path.dirname(fileURLToPath(import.meta.url));
      env.cacheDir = path.resolve(here, "..", ".cache");
      const pipe = await pipeline("feature-extraction", config.embeddingModel, { dtype: "q8" });
      return pipe as unknown as Extractor;
    })();
    extractorPromise.catch((err) => {
      disabledReason = `failed to load model: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[embeddings] ${disabledReason}`);
    });
  }
  return extractorPromise;
}

/** Returns a normalized embedding, or null if embeddings are unavailable. */
export async function embed(text: string): Promise<number[] | null> {
  if (disabledReason) return null;
  try {
    const extractor = await getExtractor();
    const out = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (err) {
    console.error(`[embeddings] embed failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** pgvector literal, e.g. "[0.1,0.2,...]" */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

export function embeddingsStatus() {
  return { enabled: !disabledReason, reason: disabledReason };
}

/** Start loading the model in the background so the first capture is fast. */
export function warmUpEmbeddings() {
  if (!disabledReason) void getExtractor().catch(() => undefined);
}
