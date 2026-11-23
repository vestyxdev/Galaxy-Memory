import type { MemoryBackend } from "./backend.js";
import { cosineSimilarity, type Embedder } from "./embeddings.js";
import { contentHash } from "./markdown.js";
import { embedMemoryText, syncMemoryEdges } from "./pipeline.js";
import { fuseRanked, InvertedIndex, NEAR_DUP_THRESHOLD } from "./search.js";
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
  /**
   * Optional: fires when the underlying document was changed by another
   * writer (another tab, the MCP server's file writes). Returns unsubscribe.
   */
  subscribe?(onChange: () => void): () => void;
}

export interface KvBackendOptions {
  label?: string;
  /** Demo embeddings are flatter than OpenAI's — lower bar keeps edges visible. */
  semanticThreshold?: number;
  /**
   * Cosine threshold for the save-time near-dup merge (default 0.93).
   * Set to 1 to disable consolidation.
   */
  nearDupThreshold?: number;
}

const emptyState = (): KvState => ({ memories: [], edges: [] });

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
  // lazily-built FTS index, keyed to the loaded state object
  let indexedFor: KvState | null = null;
  let index: InvertedIndex | null = null;

  /** Backfill fields added after v0.1 docs were written. */
  function normalize(s: KvState): KvState {
    for (const m of s.memories) {
      m.pinned ??= false;
      m.archived ??= false;
      m.content_hash ??= null;
    }
    return s;
  }

  async function load(): Promise<KvState> {
    // never hand out a shared EMPTY object — callers mutate it in place
    if (!state) state = normalize((await adapter.load()) ?? emptyState());
    return state;
  }

  function indexFor(s: KvState): InvertedIndex {
    if (indexedFor !== s || !index) {
      index = new InvertedIndex(s.memories);
      indexedFor = s;
    }
    return index;
  }

  async function persist(): Promise<void> {
    index = null; // state mutated in place — drop the FTS index
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
        if (m.archived) continue;
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
      const hash = contentHash(input.content);
      // Content-hash dedup: re-ingesting identical content is a no-op and
      // returns the existing memory instead of creating a twin node.
      const existing = (await load()).memories.find((m) => m.content_hash === hash);
      if (existing) return existing;

      // Embed BEFORE touching the cached snapshot — subscribe() invalidates
      // `state` on external writes, and any snapshot captured before this
      // await would be stale by persist time.
      const embedding = await embedMemoryText(embedder, input.title, input.content);
      const s = await load();
      // re-check after the await — a concurrent writer may have landed it
      const raced = s.memories.find((m) => m.content_hash === hash);
      if (raced) return raced;

      // Near-duplicate merge: an existing memory whose embedding sits within
      // the consolidation threshold is a newer revision of the same fact, not
      // a new note. Merge INTO it — keeping its id preserves every backlink.
      const nearDup = opts.nearDupThreshold ?? NEAR_DUP_THRESHOLD;
      if (embedding && nearDup < 1) {
        const dup = s.memories.find(
          (m) =>
            !m.archived &&
            m.embedding !== null &&
            cosineSimilarity(embedding, m.embedding) >= nearDup,
        );
        if (dup) {
          return backend.updateMemory(dup.id, {
            content: input.content,
            summary: input.summary,
            tags: [...new Set([...dup.tags, ...(input.tags ?? [])])],
          });
        }
      }

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
        pinned: input.pinned ?? false,
        archived: input.archived ?? false,
        content_hash: hash,
        created_at: input.created_at ?? now,
        updated_at: input.created_at ?? now,
      };
      s.memories.push(memory);
      await syncMemoryEdges(backend, memory, threshold);
      await persist();
      return memory;
    },

    async updateMemory(id, patch) {
      const snapshot = await load();
      const before = snapshot.memories.find((m) => m.id === id);
      if (!before) throw new Error(`Memory ${id} not found`);

      const title = patch.title ?? before.title;
      const content = patch.content ?? before.content;
      const reembed = title !== before.title || content !== before.content;
      const embedding =
        reembed || !before.embedding
          ? await embedMemoryText(embedder, title, content)
          : before.embedding;

      // The snapshot may have been invalidated while the embed awaited —
      // re-load so the patch lands on top of any external write.
      const s = await load();
      const current = s.memories.find((m) => m.id === id);
      if (!current) throw new Error(`Memory ${id} was deleted during update`);

      current.title = title;
      current.content = content;
      if (patch.summary !== undefined) current.summary = patch.summary;
      if (patch.cluster !== undefined) current.cluster = patch.cluster;
      if (patch.tags !== undefined) current.tags = patch.tags;
      if (patch.pinned !== undefined) current.pinned = patch.pinned;
      if (patch.archived !== undefined) current.archived = patch.archived;
      if (reembed) current.content_hash = contentHash(content);
      current.embedding = embedding;
      current.updated_at = new Date().toISOString();
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
            m.embedding !== null && !m.archived && (cluster == null || m.cluster === cluster),
        )
        .map((m): MemoryMatch => ({
          ...m,
          similarity: cosineSimilarity(queryEmbedding, m.embedding),
        }))
        .filter((m) => m.similarity > matchThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, count);
    },

    async searchMemories({ query, queryEmbedding, limit, cluster }) {
      const s = await load();
      const candidates = s.memories.filter(
        (m) => !m.archived && (cluster == null || m.cluster === cluster),
      );
      const fts = indexFor(s).score(query);
      const vector = queryEmbedding
        ? candidates
            .filter((m): m is Memory & { embedding: number[] } => m.embedding !== null)
            .map((m) => ({ id: m.id, similarity: cosineSimilarity(queryEmbedding, m.embedding) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit * 4)
        : [];
      return fuseRanked({ vector, fts, candidates, limit });
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

  const adapterSubscribe = adapter.subscribe;
  if (adapterSubscribe) {
    backend.subscribe = (onChange) =>
      adapterSubscribe(() => {
        // drop the cached snapshot so the next read reloads from storage
        state = null;
        onChange();
      });
  }

  return backend;
}
