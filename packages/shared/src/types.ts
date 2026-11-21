export const EMBEDDING_DIM = 1536;
export const DEFAULT_CLUSTER = "General";

export type EdgeType = "explicit" | "semantic";
export type MemorySource = "user" | "ai_agent";

export interface Memory {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  cluster: string;
  tags: string[];
  /** Present on the save/update path; list endpoints omit it for payload size. */
  embedding: number[] | null;
  source: MemorySource;
  created_at: string;
  updated_at: string;
}

export interface MemoryEdge {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeType;
  /** explicit = 1.0; semantic = cosine similarity */
  weight: number;
}

export interface MemoryMatch extends Memory {
  similarity: number;
}

export interface MemoryInput {
  title: string;
  content: string;
  summary?: string | null;
  cluster?: string;
  tags?: string[];
  source?: MemorySource;
  /** Optional backdated timestamp (seeds, imports). Defaults to now. */
  created_at?: string;
}

export interface MemoryPatch {
  title?: string;
  content?: string;
  summary?: string | null;
  cluster?: string;
  tags?: string[];
}

export interface ClusterCount {
  cluster: string;
  count: number;
}

export interface MemorySubgraph {
  memories: Memory[];
  edges: MemoryEdge[];
}
