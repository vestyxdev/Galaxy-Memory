import { createEmbedder, type Embedder, type MemoryBackend } from "@galaxy-memory/shared";

import { env } from "../lib/env";

export interface BackendHandle {
  backend: MemoryBackend;
  embedder: Embedder;
  mode: "demo" | "supabase";
  /** Storage detail for the status popover, e.g. "Local JSON file". */
  storage: string;
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
    return {
      backend: createSupabaseBackend(client, embedder),
      embedder,
      mode: "supabase",
      storage: "Supabase Postgres + pgvector (realtime)",
    };
  }

  const { createLocalBackend } = await import("./local");
  const local = await createLocalBackend(embedder);
  return { backend: local.backend, embedder, mode: "demo", storage: local.storage };
}
