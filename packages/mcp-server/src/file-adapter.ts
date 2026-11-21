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
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        return null; // file simply doesn't exist yet
      }
      try {
        // SAFETY: file was written by save() below; unknown fields are ignored
        // and missing arrays fall back to empty on this line.
        const parsed = JSON.parse(raw) as Partial<KvState>;
        return { memories: parsed.memories ?? [], edges: parsed.edges ?? [] };
      } catch {
        // Corrupt JSON — quarantine it instead of letting the next save()
        // silently overwrite recoverable data.
        const backup = `${path}.corrupt-${Date.now()}`;
        await rename(path, backup).catch(() => {});
        console.error(`galaxy-memory: corrupt db quarantined to ${backup}`);
        return null;
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      // unique tmp name — a second writer (the Vite bridge) shares this file
      // and a shared .tmp name can interleave into corrupt JSON
      const tmp = `${path}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, path);
    },
  };
}
