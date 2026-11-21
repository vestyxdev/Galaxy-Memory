import { createEmbedder, type Embedder, type MemoryBackend } from "@galaxy-memory/shared";

import { env } from "../lib/env";

export interface BackendHandle {
  backend: MemoryBackend;
  embedder: Embedder;
  mode: "demo" | "supabase";
}

let cached: Promise<BackendHandle> | null = null;

/**
 * Supabase when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set,
 * LocalStorage Demo Mode otherwise. The supabase path is a dynamic import so
 * the demo bundle stays lean.
 */
export function getBackend(): Promise<BackendHandle> {
  cached ??= init();
  return cached;
}

async function init(): Promise<BackendHandle> {
  const embedder = createEmbedder({
    provider: env.embeddingProvider,
    openaiApiKey: env.openaiApiKey,
    ollamaUrl: env.ollamaUrl,
  });

  if (env.supabaseUrl && env.supabaseAnonKey) {
    const [{ createClient }, { createSupabaseBackend }] = await Promise.all([
      import("@supabase/supabase-js"),
      import("@galaxy-memory/shared/supabase"),
    ]);
    const client = createClient(env.supabaseUrl, env.supabaseAnonKey);
    return { backend: createSupabaseBackend(client, embedder), embedder, mode: "supabase" };
  }

  const { createLocalBackend } = await import("./local");
  return { backend: await createLocalBackend(embedder), embedder, mode: "demo" };
}
