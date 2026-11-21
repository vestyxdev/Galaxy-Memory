import type { MemoryBackend } from "./backend.js";
import type { Embedder } from "./embeddings.js";
import type { Memory } from "./types.js";
import { extractWikilinks } from "./wikilinks.js";

/** Spec constants: top-5 semantic neighbors above 0.78 cosine. */
export const SEMANTIC_EDGE_THRESHOLD = 0.78;
export const SEMANTIC_EDGE_COUNT = 5;

export async function embedMemoryText(
  embedder: Embedder,
  title: string,
  content: string,
): Promise<number[]> {
  const [vector] = await embedder.embed([`${title}\n${content}`]);
  if (!vector) throw new Error(`Embedder ${embedder.name} returned no vectors`);
  return vector;
}

/**
 * Auto-linking pipeline run after every create/update:
 *  1. drop stale outgoing edges, then
 *  2. upsert 'explicit' edges for each [[wikilink]] that resolves to a memory,
 *  3. upsert 'semantic' edges for the top-N matchMemories neighbors.
 *
 * The threshold is a parameter so the demo backend (hash embeddings with a
 * flatter similarity scale) can pass a lower bar than the pgvector default.
 */
export async function syncMemoryEdges(
  backend: MemoryBackend,
  memory: Memory,
  semanticThreshold = SEMANTIC_EDGE_THRESHOLD,
): Promise<void> {
  await backend.clearOutgoingEdges(memory.id);

  for (const title of extractWikilinks(memory.content)) {
    const target = await backend.findMemoryByTitle(title);
    if (target && target.id !== memory.id) {
      await backend.upsertEdge({
        source_id: memory.id,
        target_id: target.id,
        edge_type: "explicit",
        weight: 1,
      });
    }
  }

  if (memory.embedding) {
    const matches = await backend.matchMemories(
      memory.embedding,
      semanticThreshold,
      SEMANTIC_EDGE_COUNT + 1,
    );
    let linked = 0;
    for (const match of matches) {
      if (match.id === memory.id) continue;
      if (linked >= SEMANTIC_EDGE_COUNT) break;
      await backend.upsertEdge({
        source_id: memory.id,
        target_id: match.id,
        edge_type: "semantic",
        weight: match.similarity,
      });
      linked++;
    }
  }
}

/** Breadth-first subgraph around a memory, used by get_memory_context. */
export async function collectSubgraph(
  backend: MemoryBackend,
  rootId: string,
  depth = 1,
): Promise<{ memories: Memory[]; edges: import("./types.js").MemoryEdge[] }> {
  const root = await backend.getMemory(rootId);
  if (!root) return { memories: [], edges: [] };

  const seen = new Map<string, Memory>([[root.id, root]]);
  const edgeAcc = new Map<string, import("./types.js").MemoryEdge>();
  let frontier = [root.id];

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const edges = await backend.edgesFor(frontier);
    const next = new Set<string>();
    for (const edge of edges) {
      edgeAcc.set(edge.id, edge);
      for (const id of [edge.source_id, edge.target_id]) {
        if (!seen.has(id)) next.add(id);
      }
    }
    const missing = [...next].filter((id) => !seen.has(id));
    for (const id of missing) {
      const m = await backend.getMemory(id);
      if (m) seen.set(id, m);
    }
    frontier = missing;
  }

  return { memories: [...seen.values()], edges: [...edgeAcc.values()] };
}
