import type {
  ClusterCount,
  EdgeType,
  Memory,
  MemoryEdge,
  MemoryInput,
  MemoryMatch,
  MemoryPatch,
} from "./types.js";

/**
 * Storage abstraction shared by the Supabase backend (shared/supabase)
 * and the web app's LocalStorage demo backend. The MCP server and the
 * web UI go through this interface, so the ingest pipeline and graph
 * reads behave identically on both surfaces.
 */
export interface MemoryBackend {
  /** Short label for status UI, e.g. "Supabase" or "Demo". */
  readonly label: string;

  listMemories(): Promise<Memory[]>;
  listEdges(): Promise<MemoryEdge[]>;
  listClusters(): Promise<ClusterCount[]>;
  getMemory(id: string): Promise<Memory | null>;
  findMemoryByTitle(title: string): Promise<Memory | null>;

  /** Insert + embed + auto-link (explicit wikilinks + semantic neighbors). */
  saveMemory(input: MemoryInput): Promise<Memory>;
  /** Patch + re-embed/relink when title or content changed. */
  updateMemory(id: string, patch: MemoryPatch): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;

  /** Cosine-ranked nearest memories; may include the query's own id. */
  matchMemories(
    queryEmbedding: number[],
    threshold: number,
    count: number,
    cluster?: string | null,
  ): Promise<MemoryMatch[]>;

  /** All edges touching any of the given memory ids (either direction). */
  edgesFor(ids: string[]): Promise<MemoryEdge[]>;
  /** Remove outgoing edges of a node, optionally narrowed to one edge type. */
  clearOutgoingEdges(id: string, edgeType?: EdgeType): Promise<void>;
  upsertEdge(edge: Omit<MemoryEdge, "id">): Promise<void>;
}
