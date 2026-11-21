import {
  createKvBackend,
  type Embedder,
  type KvAdapter,
  type KvState,
  type MemoryBackend,
} from "@galaxy-memory/shared";

import { fileBridgeAvailable, createFileBridgeAdapter } from "./file-bridge";
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
    subscribe(onChange) {
      // 'storage' fires only in OTHER tabs — cross-tab sync for free
      const handler = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) onChange();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}

export interface LocalBackendHandle {
  backend: MemoryBackend;
  /** Storage detail for the status popover. */
  storage: string;
}

async function seed(backend: MemoryBackend): Promise<void> {
  for (const input of SEED_INPUTS) {
    await backend.saveMemory(input);
  }
}

/**
 * Demo backend selection:
 * - dev server + bridge middleware up → shared JSON file (~/.galaxy-memory/
 *   memories.json), the same document the MCP server reads/writes
 * - otherwise → LocalStorage (production demo, private mode, no middleware)
 * Seeds 30 sample memories when the chosen storage is empty.
 */
export async function createLocalBackend(embedder: Embedder): Promise<LocalBackendHandle> {
  if (import.meta.env.DEV && (await fileBridgeAvailable())) {
    const backend = createKvBackend(createFileBridgeAdapter(), embedder, {
      label: "Local JSON",
      semanticThreshold: 0.5,
    });
    if ((await backend.listMemories()).length === 0) {
      await seed(backend);
    }
    return { backend, storage: "Local JSON file (shared with MCP server)" };
  }

  const backend = createKvBackend(createLocalStorageAdapter(), embedder, {
    label: "Demo",
    semanticThreshold: 0.5,
  });
  if (localStorage.getItem(STORAGE_KEY) === null) {
    await seed(backend);
  }
  return { backend, storage: "Browser LocalStorage" };
}
