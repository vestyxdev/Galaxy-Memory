import type { KvAdapter, KvState } from "@galaxy-memory/shared";

const API = "/api/local-memories";
const POLL_MS = 2500;

/** True when the dev-server middleware is up (vite dev only). */
export async function fileBridgeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(API, { method: "GET" });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

/**
 * KvAdapter over the dev-server bridge to ~/.galaxy-memory/memories.json —
 * the same document the MCP server writes. subscribe() polls the file so
 * agent saves appear live in the galaxy (Supabase mode uses realtime
 * instead).
 */
export function createFileBridgeAdapter(): KvAdapter {
  let lastSeen: string | null = null;

  return {
    async load() {
      const res = await fetch(API);
      if (res.status === 204 || res.status === 404) return null;
      if (!res.ok) throw new Error(`local-memory bridge: HTTP ${res.status}`);
      const raw = await res.text();
      lastSeen = raw;
      // SAFETY: the bridge only serves JSON it was itself asked to persist;
      // missing arrays fall back to empty on this line.
      const parsed = JSON.parse(raw) as Partial<KvState>;
      return { memories: parsed.memories ?? [], edges: parsed.edges ?? [] };
    },

    async save(state) {
      const body = JSON.stringify(state);
      const res = await fetch(API, { method: "PUT", body });
      if (!res.ok) throw new Error(`local-memory bridge: HTTP ${res.status}`);
      lastSeen = body; // our own write — don't retrigger on the next poll
    },

    subscribe(onChange) {
      const timer = setInterval(() => {
        void (async () => {
          const res = await fetch(API);
          if (!res.ok) return;
          const raw = res.status === 204 ? null : await res.text();
          if (raw !== lastSeen) {
            lastSeen = raw;
            onChange();
          }
        })().catch(() => {
          // transient dev-server hiccup — next tick retries
        });
      }, POLL_MS);
      return () => clearInterval(timer);
    },
  };
}
