function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  // API_PORT wins so a frontend dev tool's PORT can't hijack the API; hosts like Render set PORT.
  port: Number(env("API_PORT") || env("PORT") || "8787"),
  supabaseUrl: env("SUPABASE_URL"),
  supabaseAnonKey: env("SUPABASE_ANON_KEY"),
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  model: env("ANTHROPIC_MODEL", "claude-opus-5-5"),
  // Server-side refusal fallbacks. Disable if your API gateway rejects beta params.
  llmFallbacks: env("LLM_FALLBACKS", "true") !== "false",
  embeddingsEnabled: env("EMBEDDINGS_ENABLED", "true") !== "false",
  embeddingModel: env("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2"),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
export const isLlmConfigured = Boolean(config.anthropicApiKey);
