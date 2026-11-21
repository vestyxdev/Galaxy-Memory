import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { KvAdapter, KvState } from "@galaxy-memory/shared";

export function defaultDbPath(): string {
  return join(homedir(), ".galaxy-memory", "memories.json");
}

/**
 * KvAdapter over a single JSON file — the MCP server's zero-config fallback
 * when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
 */
export function createFileAdapter(path: string): KvAdapter {
  return {
    async load() {
      try {
        const raw = await readFile(path, "utf8");
        // SAFETY: file was written by save() below; unknown fields are ignored
        // and missing arrays fall back to empty on this line.
        const parsed = JSON.parse(raw) as Partial<KvState>;
        return { memories: parsed.memories ?? [], edges: parsed.edges ?? [] };
      } catch {
        return null;
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, path);
    },
  };
}
