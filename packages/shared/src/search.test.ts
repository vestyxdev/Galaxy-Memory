import { describe, expect, it } from "vitest";

import type { Memory } from "./types";
import {
  applyGraphBoost,
  findDuplicatePairs,
  fold,
  fuseRanked,
  hybridSearch,
  InvertedIndex,
  packContext,
  tokenize,
} from "./search";

let seq = 0;
function mem(partial: Partial<Memory> & { title: string }): Memory {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    content: "content",
    summary: null,
    cluster: "General",
    tags: [],
    source: "user",
    pinned: false,
    archived: false,
    content_hash: null,
    embedding: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("fold/tokenize", () => {
  it("folds Czech diacritics to ASCII", () => {
    expect(fold("Příliš žluťoučký kůň")).toBe("prilis zlutoucky kun");
    expect(fold("Tomáš")).toBe("tomas");
  });

  it("tokenizes on unicode word chars", () => {
    expect(tokenize("API rate-limit v2")).toEqual(["api", "rate", "limit", "v2"]);
  });
});

describe("InvertedIndex", () => {
  const docs = [
    mem({ title: "PostgreSQL pgvector setup", content: "vector index ivfflat lists cosine" }),
    mem({ title: "Křečkové", content: "křeček běží v kolečku každý den" }),
    mem({ title: "Auth hardening", content: "rate limiting and jwt rotation for the api" }),
    mem({ title: "Old draft", content: "vector draft", archived: true }),
  ];
  const index = new InvertedIndex(docs);

  it("matches diacritic-insensitive queries (Czech)", () => {
    const hits = index.score("krecek bezi");
    expect(hits[0]?.id).toBe(docs[1]!.id);
  });

  it("supports prefix matching (vect -> vector)", () => {
    const hits = index.score("vect");
    expect(hits.map((h) => h.id)).toContain(docs[0]!.id);
  });

  it("excludes archived documents entirely", () => {
    expect(index.size).toBe(3);
    expect(index.score("vector draft").map((h) => h.id)).not.toContain(docs[3]!.id);
  });

  it("boosts exact phrase matches", () => {
    const withPhrase = mem({ title: "x", content: "the jwt rotation runbook lives here" });
    const idx = new InvertedIndex([...docs.filter((d) => !d.archived), withPhrase]);
    const hits = idx.score("jwt rotation runbook");
    expect(hits[0]?.id).toBe(withPhrase.id);
  });
});

describe("fuseRanked", () => {
  const a = mem({ title: "A" });
  const b = mem({ title: "B" });
  const c = mem({ title: "C", pinned: true });

  it("dedupes ids across lists and marks via", () => {
    const fused = fuseRanked({
      vector: [{ id: a.id, similarity: 0.9 }],
      fts: [
        { id: a.id, score: 5 },
        { id: b.id, score: 3 },
      ],
      candidates: [a, b],
      limit: 10,
    });
    expect(fused).toHaveLength(2);
    expect(fused.find((m) => m.id === a.id)?.via).toBe("both");
    expect(fused.find((m) => m.id === b.id)?.via).toBe("fts");
  });

  it("pinned memories outrank stronger unpinned hits", () => {
    const fused = fuseRanked({
      vector: [
        { id: a.id, similarity: 0.9 },
        { id: c.id, similarity: 0.1 },
      ],
      fts: [],
      candidates: [a, c],
      limit: 10,
    });
    expect(fused[0]!.id).toBe(c.id); // 1.5x pin multiplier beats rank gap
  });
});

describe("applyGraphBoost", () => {
  it("lifts 1-hop neighbors of top hits in the final ranking", () => {
    const hub = mem({ title: "Hub" });
    const linked = mem({ title: "Linked note" });
    const unlinked = mem({ title: "Unlinked note" });
    const fused = [
      { ...hub, similarity: 1.0, via: "fts" as const },
      { ...unlinked, similarity: 0.5, via: "fts" as const },
      { ...linked, similarity: 0.4, via: "fts" as const },
    ];
    const edges = [
      {
        id: "e",
        source_id: hub.id,
        target_id: linked.id,
        edge_type: "explicit" as const,
        weight: 1,
      },
    ];
    // topN=1: only the hub counts as a "top hit" — its link out to `linked`
    // boosts 0.4 -> 0.6, overtaking the unlinked 0.5.
    const boosted = applyGraphBoost(fused, edges, { boost: 0.5, topN: 1 });
    expect(boosted.map((m) => m.id)).toEqual([hub.id, linked.id, unlinked.id]);
  });
});

describe("hybridSearch", () => {
  it("works keyword-only when the embedder is null (offline fallback)", async () => {
    const docs = [
      mem({ title: "Vector math", content: "cosine similarity and embeddings" }),
      mem({ title: "Cooking", content: "goulash recipe" }),
    ];
    const backend = {
      label: "t",
      listMemories: async () => docs,
      matchMemories: async () => [],
      listClusters: async () => [],
      findMemoryByTitle: async () => null,
      getMemory: async () => null,
      saveMemory: async () => docs[0]!,
      updateMemory: async () => docs[0]!,
      deleteMemory: async () => {},
      subscribe: () => () => {},
      listEdges: async () => [],
      edgesFor: async () => [],
      clearOutgoingEdges: async () => {},
      upsertEdge: async () => {},
    };
    const hits = await hybridSearch(backend, null, "cosine embeddings");
    expect(hits[0]?.id).toBe(docs[0]!.id);
    expect(hits[0]?.via).toBe("fts");
  });
});

describe("packContext", () => {
  it("packs hits + link neighbors under the token budget with citations", () => {
    const a = mem({ title: "Hit A", content: "important context" });
    const b = mem({ title: "Hit B", content: "second hit" });
    const n = mem({ title: "Neighbor", content: "extra detail around the hit" });
    const matches = [
      { ...a, similarity: 1, via: "both" as const },
      { ...b, similarity: 0.8, via: "fts" as const },
    ];
    const edges = [
      { id: "e1", source_id: a.id, target_id: n.id, edge_type: "explicit" as const, weight: 1 },
    ];
    const byId = new Map([a, b, n].map((m) => [m.id, m]));

    const packed = packContext(matches, edges, byId, { tokenBudget: 400 });
    const hits = packed.entries.filter((e) => e.kind === "hit");
    const neighbors = packed.entries.filter((e) => e.kind === "neighbor");
    expect(hits.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(neighbors.map((e) => e.id)).toEqual([n.id]);
    expect(neighbors[0]!.via).toBe("Hit A");
    expect(packed.tokensUsed).toBeLessThanOrEqual(400);
    expect(packed.omitted).toEqual([]);
  });

  it("omits hits that exceed a tight budget", () => {
    const big = mem({ title: "Huge", content: "x".repeat(8000) });
    const small = mem({ title: "Small", content: "ok" });
    const matches = [
      { ...big, similarity: 1, via: "fts" as const },
      { ...small, similarity: 0.9, via: "fts" as const },
    ];
    const packed = packContext(
      matches,
      [],
      new Map([
        [big.id, big],
        [small.id, small],
      ]),
      {
        tokenBudget: 300,
      },
    );
    expect(packed.entries.length).toBeGreaterThanOrEqual(1);
    expect(packed.tokensUsed).toBeLessThanOrEqual(300);
  });

  it("includeNeighbors:false suppresses the neighbor section", () => {
    const a = mem({ title: "Hit", content: "body" });
    const n = mem({ title: "Neighbor", content: "extra" });
    const matches = [{ ...a, similarity: 1, via: "fts" as const }];
    const edges = [
      { id: "e", source_id: a.id, target_id: n.id, edge_type: "explicit" as const, weight: 1 },
    ];
    const byId = new Map([a, n].map((m) => [m.id, m]));
    const packed = packContext(matches, edges, byId, {
      tokenBudget: 500,
      includeNeighbors: false,
    });
    expect(packed.entries.every((e) => e.kind === "hit")).toBe(true);
  });

  it("entries carry short cites for token-lean references", () => {
    const a = mem({ title: "Hit", content: "body" });
    const packed = packContext(
      [{ ...a, similarity: 1, via: "fts" as const }],
      [],
      new Map([[a.id, a]]),
      { tokenBudget: 400 },
    );
    expect(packed.entries[0]!.cite).toBe(a.id.slice(0, 8));
  });
});

describe("findDuplicatePairs", () => {
  it("flags cosine-similar items above threshold, skips archived", () => {
    const e1 = [1, 0, 0];
    const e2 = [0.995, 0.05, 0];
    const e3 = [0, 1, 0];
    const items = [
      { id: "a", title: "A", embedding: e1 },
      { id: "b", title: "B", embedding: e2 },
      { id: "c", title: "C", embedding: e3 },
      { id: "d", title: "D", embedding: e1, archived: true },
    ];
    const pairs = findDuplicatePairs(items, 0.9);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a.id).toBe("a");
    expect(pairs[0]!.b.id).toBe("b");
  });
});
