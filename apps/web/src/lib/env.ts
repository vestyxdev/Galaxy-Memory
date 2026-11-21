function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Typed, evidence-checked access to Vite env vars. */
export const env = {
  supabaseUrl: str(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: str(import.meta.env.VITE_SUPABASE_ANON_KEY),
  openaiApiKey: str(import.meta.env.VITE_OPENAI_API_KEY),
  embeddingProvider: str(import.meta.env.VITE_EMBEDDING_PROVIDER),
  ollamaUrl: str(import.meta.env.VITE_OLLAMA_URL),
  userName: str(import.meta.env.VITE_USER_NAME) ?? "Tomáš",
};
