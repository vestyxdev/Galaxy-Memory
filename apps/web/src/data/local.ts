import {
  createKvBackend,
  type Embedder,
  type KvAdapter,
  type KvState,
  type MemoryBackend,
} from "@galaxy-memory/shared";

import { SEED_INPUTS } from "./seed";

const STORAGE_KEY = "galaxy-memory:v1";

function createLocalStorageAdapter(): KvAdapter {
  return {
    async load() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        // SAFETY: this app wrote the JSON itself via save() below; missing
        // arrays fall back to empty here rather than trusting the parse.
        const parsed = JSON.parse(raw) as Partial<KvState>;
        return { memories: parsed.memories ?? [], edges: parsed.edges ?? [] };
      } catch {
        return null;
      }
    },
    async save(state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
  };
}

/**
 * Demo backend — LocalStorage persistence seeded with 30 sample memories on
 * first run. Seeding goes through saveMemory so the real pipeline produces
 * the demo embeddings + edge graph.
 */
export async function createLocalBackend(embedder: Embedder): Promise<MemoryBackend> {
  const backend = createKvBackend(createLocalStorageAdapter(), embedder, {
    label: "Demo",
    semanticThreshold: 0.5,
  });

  if (localStorage.getItem(STORAGE_KEY) === null) {
    for (const input of SEED_INPUTS) {
      await backend.saveMemory(input);
    }
  }
  return backend;
}
