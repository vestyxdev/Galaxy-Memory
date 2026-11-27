import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemoryBackend } from "./backend.js";
import type { Embedder } from "./embeddings.js";
import { contentHash, deriveSummary } from "./markdown.js";
import { embedMemoryText, syncMemoryEdges } from "./pipeline.js";
import { fuseRanked, InvertedIndex, NEAR_DUP_THRESHOLD } from "./search.js";
import type {
  ClusterCount,
  EdgeType,
  HybridMatch,
  Memory,
  MemoryEdge,
  MemoryMatch,
  MemorySource,
} from "./types.js";
import { DEFAULT_CLUSTER } from "./types.js";

/**
 * Hand-maintained Database type mirroring supabase/migrations/001_init.sql.
 * Keeps queries + the RPC typed without running supabase codegen.
 * Row shapes are `type` aliases on purpose: interfaces lack the implicit
 * index signature supabase-js's GenericTable constraint requires.
 */
export interface Database {
  public: {
    Tables: {
      memories: {
        Row: MemoryRow;
        Insert: MemoryInsert;
        Update: Partial<MemoryInsert>;
        Relationships: [];
      };
      memory_edges: {
        Row: EdgeRow;
        Insert: EdgeInsert;
        Update: Partial<EdgeInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_memories: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
          filter_cluster?: string | null;
        };
        Returns: MatchRow[];
      };
      hybrid_search: {
        Args: {
          query_embedding: number[] | null;
          fts_query: string;
          match_count: number;
          filter_cluster?: string | null;
        };
        Returns: HybridRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  cluster: string;
  tags: string[];
  /** pgvector serializes to a bracket string; number[] is accepted on write. */
  embedding: string | number[] | null;
  source: string;
  /** Present only once migration 002 is applied — optional for graceful fallback. */
  pinned?: boolean;
  archived?: boolean;
  content_hash?: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryInsert = {
  id?: string;
  title: string;
  content: string;
  summary?: string | null;
  cluster?: string;
  tags?: string[];
  embedding?: number[];
  source?: string;
  pinned?: boolean;
  archived?: boolean;
  content_hash?: string | null;
  created_at?: string;
  updated_at?: string;
};

type EdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
};

type EdgeInsert = {
  id?: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight?: number;
};

type MatchRow = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  cluster: string;
  tags: string[];
  source: string;
  pinned?: boolean;
  archived?: boolean;
  content_hash?: string | null;
  created_at: string;
  updated_at: string;
  similarity: number;
};

type HybridRow = MatchRow & { via: string };

const BASE_COLS = "id,title,content,summary,cluster,tags,source,created_at,updated_at";
// Literal (not template concat) so supabase-js keeps row-type inference.
const EXT_COLS =
  "id,title,content,summary,cluster,tags,source,created_at,updated_at,pinned,archived,content_hash";

/** What MEMORY_COLS selects — the full row minus the embedding vector. */
type ListedMemoryRow = Omit<MemoryRow, "embedding">;

interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * PostgREST caps responses at 1000 rows — every list read paginates through
 * this so the graph doesn't silently truncate as the vault grows.
 */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const SIZE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await page(from, from + SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < SIZE) return out;
  }
}

function toMemory(row: MatchRow | ListedMemoryRow): Memory {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    cluster: row.cluster,
    tags: row.tags,
    // listing/RPC paths never select the vector; only the save path sets it
    embedding: null,
    // SAFETY: source is constrained to 'user' | 'ai_agent' by the column default
    // and every writer in this codebase.
    source: row.source as MemorySource,
    pinned: row.pinned ?? false,
    archived: row.archived ?? false,
    content_hash: row.content_hash ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toEdge(row: EdgeRow): MemoryEdge {
  return {
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    // SAFETY: edge_type is written only as 'explicit' | 'semantic' everywhere.
    edge_type: row.edge_type as EdgeType,
    weight: row.weight,
  };
}

export type GalaxySupabaseClient = SupabaseClient<Database>;

export function createSupabaseBackend(
  client: GalaxySupabaseClient,
  embedder: Embedder,
): MemoryBackend {
  /**
   * Detects once whether migration 002 columns exist. Databases still on
   * 001 keep working — selects fall back to the base column set.
   */
  let colsPromise: Promise<string> | null = null;
  function cols(): Promise<string> {
    colsPromise ??= (async () => {
      const { error } = await client
        .from("memories")
        .select("pinned", { head: true, count: "exact" });
      return error ? BASE_COLS : EXT_COLS;
    })();
    return colsPromise;
  }
  async function hasV2(): Promise<boolean> {
    return (await cols()) === EXT_COLS;
  }

  /** Literal column lists keep supabase-js's row-type inference — a dynamic string returns GenericStringError rows. */
  function selectMemories(extended: boolean) {
    return extended
      ? client.from("memories").select(EXT_COLS)
      : client.from("memories").select(BASE_COLS);
  }

  const backend: MemoryBackend = {
    label: "Supabase",

    async listMemories() {
      const extended = await hasV2();
      const rows = await fetchAll((from, to) =>
        selectMemories(extended)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      return rows.map(toMemory);
    },

    async listEdges() {
      const rows = await fetchAll((from, to) =>
        client.from("memory_edges").select("*").order("id").range(from, to),
      );
      return rows.map(toEdge);
    },

    async listClusters() {
      const v2 = await hasV2();
      const data = await fetchAll((from, to) =>
        (v2
          ? client.from("memories").select("cluster,archived")
          : client.from("memories").select("cluster")
        )
          .order("id")
          .range(from, to),
      );
      const counts = new Map<string, number>();
      for (const row of data) {
        // archived exists only on 002 schemas — `in` narrows without a cast
        if ("archived" in row && row.archived) continue;
        counts.set(row.cluster, (counts.get(row.cluster) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([cluster, count]): ClusterCount => ({ cluster, count }))
        .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster));
    },

    async getMemory(id) {
      const { data, error } = await selectMemories(await hasV2())
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toMemory(data) : null;
    },

    async findMemoryByTitle(title) {
      // PostgREST ilike treats %, _ and * in the value as wildcards and can't
      // express a literal match — filter client-side for an exact ci-match.
      const needle = title.trim().toLowerCase();
      const extended = await hasV2();
      const rows = await fetchAll((from, to) =>
        selectMemories(extended).order("id").range(from, to),
      );
      const row = rows.find(
        (r) => !("archived" in r && r.archived) && r.title.trim().toLowerCase() === needle,
      );
      return row ? toMemory(row) : null;
    },

    async saveMemory(input) {
      const v2 = await hasV2();
      const hash = contentHash(input.content);
      if (v2) {
        // idempotent ingest: identical content returns the existing row
        const { data: dup } = await client
          .from("memories")
          .select("id")
          .eq("content_hash", hash)
          .limit(1);
        const dupId = dup?.[0]?.id;
        if (dupId) {
          const existing = await backend.getMemory(dupId);
          if (existing) return existing;
        }
      }
      const embedding = await embedMemoryText(embedder, input.title, input.content);

      // Near-duplicate merge: cosine >= threshold means this is a newer
      // revision of an existing fact — merge into that row so its id (and
      // every backlink) survives.
      if (embedding) {
        const [dup] = await backend.matchMemories(embedding, NEAR_DUP_THRESHOLD, 1);
        if (dup) {
          return backend.updateMemory(dup.id, {
            content: input.content,
            summary: input.summary,
            tags: [...new Set([...dup.tags, ...(input.tags ?? [])])],
          });
        }
      }

      const row = {
        title: input.title,
        content: input.content,
        summary: input.summary ?? null,
        cluster: input.cluster ?? DEFAULT_CLUSTER,
        tags: input.tags ?? [],
        source: input.source ?? "user",
        embedding,
        ...(v2
          ? {
              pinned: input.pinned ?? false,
              archived: input.archived ?? false,
              content_hash: hash,
            }
          : {}),
        ...(input.created_at ? { created_at: input.created_at, updated_at: input.created_at } : {}),
      };
      // Literal column lists per branch — a string union breaks supabase-js's
      // select parser and returns ParserError rows.
      const { data, error } = await (v2
        ? client.from("memories").insert(row).select(EXT_COLS).single()
        : client.from("memories").insert(row).select(BASE_COLS).single());
      if (error) throw new Error(error.message);
      const memory = { ...toMemory(data), embedding };
      await syncMemoryEdges(backend, memory);
      return memory;
    },

    async updateMemory(id, patch) {
      const current = await backend.getMemory(id);
      if (!current) throw new Error(`Memory ${id} not found`);

      const title = patch.title ?? current.title;
      const content = patch.content ?? current.content;
      const reembed = title !== current.title || content !== current.content;
      const embedding = reembed
        ? await embedMemoryText(embedder, title, content)
        : current.embedding;

      const v2 = await hasV2();
      const fields = {
        ...(patch.title !== undefined ? { title } : {}),
        ...(patch.content !== undefined ? { content } : {}),
        // content changed but no summary supplied → re-derive, never stale
        ...(patch.summary !== undefined
          ? { summary: patch.summary }
          : reembed
            ? { summary: deriveSummary(content) }
            : {}),
        ...(patch.cluster !== undefined ? { cluster: patch.cluster } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(v2 && patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(v2 && patch.archived !== undefined ? { archived: patch.archived } : {}),
        ...(v2 && reembed ? { content_hash: contentHash(content) } : {}),
        ...(embedding ? { embedding } : {}),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await (v2
        ? client.from("memories").update(fields).eq("id", id).select(EXT_COLS).single()
        : client.from("memories").update(fields).eq("id", id).select(BASE_COLS).single());
      if (error) throw new Error(error.message);

      const memory = { ...toMemory(data), embedding };
      // Resync edges only when text actually changed — running it on a
      // metadata-only update would clear outgoing edges while memory.embedding
      // is null here, permanently deleting the node's semantic connections.
      if (reembed) {
        await syncMemoryEdges(backend, memory);
      }
      return memory;
    },

    async deleteMemory(id) {
      const { error } = await client.from("memories").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },

    async matchMemories(queryEmbedding, threshold, count, cluster) {
      const { data, error } = await client.rpc("match_memories", {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: count,
        filter_cluster: cluster ?? null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row): MemoryMatch => ({
        ...toMemory(row),
        similarity: row.similarity,
      }));
    },

    async searchMemories({ query, queryEmbedding, limit, cluster }) {
      try {
        const { data, error } = await client.rpc("hybrid_search", {
          query_embedding: queryEmbedding,
          fts_query: query,
          match_count: limit,
          filter_cluster: cluster ?? null,
        });
        if (error) throw new Error(error.message);
        return (data ?? []).map((row): HybridMatch => ({
          ...toMemory(row),
          similarity: row.similarity,
          // SAFETY: via is produced by the hybrid_search CASE as one of
          // 'vector' | 'fts' | 'both'.
          via: row.via as HybridMatch["via"],
        }));
      } catch {
        // 002 not applied — fuse list+vector client-side instead of failing.
        const all = (await backend.listMemories()).filter(
          (m) => !m.archived && (cluster == null || m.cluster === cluster),
        );
        const fts = new InvertedIndex(all).score(query);
        const vector = queryEmbedding
          ? (await backend.matchMemories(queryEmbedding, 0.0, limit * 4, cluster))
              .filter((m) => !m.archived)
              .map((m) => ({ id: m.id, similarity: m.similarity }))
          : [];
        return fuseRanked({ vector, fts, candidates: all, limit });
      }
    },

    async listEmbeddings() {
      // vector payloads are heavy — only maintenance tools call this
      const v2 = await hasV2();
      const rows = await fetchAll((from, to) =>
        (v2
          ? client.from("memories").select("id,title,embedding,archived")
          : client.from("memories").select("id,title,embedding")
        )
          .order("id")
          .range(from, to),
      );
      return rows
        .filter((r) => !("archived" in r && r.archived))
        .map((r) => ({
          id: r.id,
          title: r.title,
          embedding: Array.isArray(r.embedding)
            ? r.embedding
            : typeof r.embedding === "string"
              ? (JSON.parse(r.embedding) as number[])
              : null,
        }));
    },

    async edgesFor(ids) {
      if (ids.length === 0) return [];
      const list = ids.join(",");
      const { data, error } = await client
        .from("memory_edges")
        .select("*")
        .or(`source_id.in.(${list}),target_id.in.(${list})`);
      if (error) throw new Error(error.message);
      return (data ?? []).map(toEdge);
    },

    async clearOutgoingEdges(id, edgeType) {
      let query = client.from("memory_edges").delete().eq("source_id", id);
      if (edgeType) query = query.eq("edge_type", edgeType);
      const { error } = await query;
      if (error) throw new Error(error.message);
    },

    async upsertEdge(edge) {
      const { error } = await client
        .from("memory_edges")
        .upsert(
          { ...edge },
          { onConflict: "source_id,target_id,edge_type", ignoreDuplicates: false },
        );
      if (error) throw new Error(error.message);
    },
  };

  // Live sync: any writer (web UI, MCP server, SQL) triggers a refetch.
  // Requires the tables to be added to the supabase_realtime publication.
  backend.subscribe = (onChange) => {
    const channel = client
      .channel("galaxy-memory:changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "memory_edges" }, onChange)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  };

  return backend;
}
