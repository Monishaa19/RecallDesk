function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  // API_PORT wins so a frontend dev tool's PORT can't hijack the API; hosts like Render set PORT.
  port: Number(env("API_PORT") || env("PORT") || "8787"),
  supabaseUrl: env("SUPABASE_URL"),
  supabaseAnonKey: env("SUPABASE_ANON_KEY"),
  geminiApiKey: env("GEMINI_API_KEY"),
  model: env("GEMINI_MODEL", "gemini-2.5-flash"),
  // Tried in order when the primary model is overloaded (503) or rate limited (429).
  fallbackModels: env("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.1-flash-lite")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  embeddingsEnabled: env("EMBEDDINGS_ENABLED", "true") !== "false",
  embeddingModel: env("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2"),
  // PayPal developer platform. "sandbox" uses test accounts and test money only.
  paypalEnv: env("PAYPAL_ENV", "sandbox") === "live" ? "live" : "sandbox",
  paypalClientId: env("PAYPAL_CLIENT_ID"),
  paypalClientSecret: env("PAYPAL_CLIENT_SECRET"),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
export const isLlmConfigured = Boolean(config.geminiApiKey);
export const isPayPalConfigured = Boolean(config.paypalClientId && config.paypalClientSecret);
