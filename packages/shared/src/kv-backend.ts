import type { MemoryBackend } from "./backend.js";
import { cosineSimilarity, type Embedder } from "./embeddings.js";
import { embedMemoryText, syncMemoryEdges } from "./pipeline.js";
import type { ClusterCount, Memory, MemoryEdge, MemoryMatch } from "./types.js";
import { DEFAULT_CLUSTER } from "./types.js";

export interface KvState {
  memories: Memory[];
  edges: MemoryEdge[];
}

/**
 * Persistence adapter for createKvBackend — a single JSON document.
 * The web app backs this with localStorage; the MCP server uses a file.
 */
export interface KvAdapter {
  /** Return null when nothing is stored yet (first run). */
  load(): Promise<KvState | null>;
  save(state: KvState): Promise<void>;
}

export interface KvBackendOptions {
  label?: string;
  /** Demo embeddings are flatter than OpenAI's — lower bar keeps edges visible. */
  semanticThreshold?: number;
}

const EMPTY: KvState = { memories: [], edges: [] };

/**
 * Full MemoryBackend over an opaque KV adapter: embeds on write, keeps the
 * edge graph in the same document, and answers matchMemories with brute-force
 * cosine (fine at demo/personal scale).
 */
export function createKvBackend(
  adapter: KvAdapter,
  embedder: Embedder,
  opts: KvBackendOptions = {},
): MemoryBackend {
  const threshold = opts.semanticThreshold ?? 0.55;
  let state: KvState | null = null;

  async function load(): Promise<KvState> {
    if (!state) state = (await adapter.load()) ?? EMPTY;
    return state;
  }

  async function persist(): Promise<void> {
    if (state) await adapter.save(state);
  }

  const backend: MemoryBackend = {
    label: opts.label ?? "Local",

    async listMemories() {
      const s = await load();
      return [...s.memories].sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    async listEdges() {
      return (await load()).edges;
    },

    async listClusters() {
      const counts = new Map<string, number>();
      for (const m of (await load()).memories) {
        counts.set(m.cluster, (counts.get(m.cluster) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([cluster, count]): ClusterCount => ({ cluster, count }))
        .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster));
    },

    async getMemory(id) {
      return (await load()).memories.find((m) => m.id === id) ?? null;
    },

    async findMemoryByTitle(title) {
      const needle = title.trim().toLowerCase();
      return (await load()).memories.find((m) => m.title.trim().toLowerCase() === needle) ?? null;
    },

    async saveMemory(input) {
      const s = await load();
      const embedding = await embedMemoryText(embedder, input.title, input.content);
      const now = new Date().toISOString();
      const memory: Memory = {
        id: crypto.randomUUID(),
        title: input.title,
        content: input.content,
        summary: input.summary ?? null,
        cluster: input.cluster ?? DEFAULT_CLUSTER,
        tags: input.tags ?? [],
        embedding,
        source: input.source ?? "user",
        created_at: input.created_at ?? now,
        updated_at: input.created_at ?? now,
      };
      s.memories.push(memory);
      await syncMemoryEdges(backend, memory, threshold);
      await persist();
      return memory;
    },

    async updateMemory(id, patch) {
      const s = await load();
      const current = s.memories.find((m) => m.id === id);
      if (!current) throw new Error(`Memory ${id} not found`);

      const title = patch.title ?? current.title;
      const content = patch.content ?? current.content;
      const reembed = title !== current.title || content !== current.content;

      current.title = title;
      current.content = content;
      if (patch.summary !== undefined) current.summary = patch.summary;
      if (patch.cluster !== undefined) current.cluster = patch.cluster;
      if (patch.tags !== undefined) current.tags = patch.tags;
      current.updated_at = new Date().toISOString();
      if (reembed || !current.embedding) {
        current.embedding = await embedMemoryText(embedder, title, content);
      }
      if (reembed) await syncMemoryEdges(backend, current, threshold);
      await persist();
      return current;
    },

    async deleteMemory(id) {
      const s = await load();
      s.memories = s.memories.filter((m) => m.id !== id);
      s.edges = s.edges.filter((e) => e.source_id !== id && e.target_id !== id);
      await persist();
    },

    async matchMemories(queryEmbedding, matchThreshold, count, cluster) {
      const s = await load();
      return s.memories
        .filter(
          (m): m is Memory & { embedding: number[] } =>
            m.embedding !== null && (cluster == null || m.cluster === cluster),
        )
        .map((m): MemoryMatch => ({
          ...m,
          similarity: cosineSimilarity(queryEmbedding, m.embedding),
        }))
        .filter((m) => m.similarity > matchThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, count);
    },

    async edgesFor(ids) {
      const set = new Set(ids);
      return (await load()).edges.filter((e) => set.has(e.source_id) || set.has(e.target_id));
    },

    async clearOutgoingEdges(id, edgeType) {
      const s = await load();
      s.edges = s.edges.filter(
        (e) => e.source_id !== id || (edgeType !== undefined && e.edge_type !== edgeType),
      );
    },

    async upsertEdge(edge) {
      const s = await load();
      const existing = s.edges.find(
        (e) =>
          e.source_id === edge.source_id &&
          e.target_id === edge.target_id &&
          e.edge_type === edge.edge_type,
      );
      if (existing) {
        existing.weight = edge.weight;
        return;
      }
      s.edges.push({ id: crypto.randomUUID(), ...edge });
    },
  };

  return backend;
}
