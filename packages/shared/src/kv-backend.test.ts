import { describe, expect, it } from "vitest";

import { createLocalEmbedder } from "./embeddings";
import { createKvBackend, type KvAdapter, type KvState } from "./kv-backend";

function memAdapter(seed: KvState | null = null): KvAdapter & { saved: KvState[] } {
  let state = seed;
  const saved: KvState[] = [];
  return {
    saved,
    async load() {
      return state;
    },
    async save(s) {
      state = s;
      saved.push(s);
    },
  };
}

describe("kv-backend lifecycle", () => {
  it("dedups re-ingested identical content by content hash", async () => {
    const adapter = memAdapter();
    const backend = createKvBackend(adapter, createLocalEmbedder());

    const first = await backend.saveMemory({ title: "A", content: "the same body" });
    const second = await backend.saveMemory({
      title: "Different title, same body",
      content: "THE SAME  body\n\n",
    });
    expect(second.id).toBe(first.id);
    expect(await backend.listMemories()).toHaveLength(1);
  });

  it("does not dedup different content with the same title intent", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const a = await backend.saveMemory({ title: "A", content: "body one" });
    const b = await backend.saveMemory({ title: "A2", content: "body two" });
    expect(b.id).not.toBe(a.id);
    expect(await backend.listMemories()).toHaveLength(2);
  });

  it("excludes archived memories from clusters and search but keeps the row", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const live = await backend.saveMemory({ title: "Live note", content: "visible text" });
    const dead = await backend.saveMemory({ title: "Stale note", content: "hidden text" });
    await backend.updateMemory(dead.id, { archived: true });

    const clusters = await backend.listClusters();
    const staleCount = clusters.find((c) => c.cluster === "General")?.count;
    expect(staleCount).toBe(1); // only the live one counts

    const hits =
      await backend.searchMemories! /* SAFETY: kv backend always implements searchMemories */({
        query: "hidden text",
        queryEmbedding: null,
        limit: 5,
        cluster: null,
      });
    expect(hits.map((h) => h.id)).toContain(live.id);
    expect(hits.map((h) => h.id)).not.toContain(dead.id);

    // the row itself survives — edges and content preserved
    expect((await backend.getMemory(dead.id))?.content).toBe("hidden text");
  });

  it("pinned memories surface above unpinned ones in hybrid search", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const ordinary = await backend.saveMemory({
      title: "apple pie",
      content: "apple pie recipe with cinnamon",
    });
    const pinned = await backend.saveMemory({
      title: "apple cider",
      content: "apple orchard press notes",
      pinned: true,
    });
    const hits =
      await backend.searchMemories! /* SAFETY: kv backend always implements searchMemories */({
        query: "apple",
        queryEmbedding: null,
        limit: 5,
        cluster: null,
      });
    expect(hits[0]!.id).toBe(pinned.id);
    expect(hits.map((h) => h.id)).toContain(ordinary.id);
  });

  it("normalizes legacy rows missing pinned/archived/content_hash", async () => {
    const legacy = {
      memories: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "Legacy",
          content: "old row",
          summary: null,
          cluster: "General",
          tags: [],
          source: "user",
          embedding: null,
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
          // pre-0.2 fields absent on purpose
        },
      ],
      edges: [],
    } as unknown as KvState;
    const backend = createKvBackend(memAdapter(legacy), createLocalEmbedder());
    const [m] = await backend.listMemories();
    expect(m!.pinned).toBe(false);
    expect(m!.archived).toBe(false);
    expect(m!.content_hash).toBeNull();
  });

  it("merges a near-duplicate save into the existing memory, preserving backlinks", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    // the target must exist before the wikilink resolves into an edge
    const original = await backend.saveMemory({
      title: "Deploy runbook",
      content: "Ship via docker build, tag the image, push to registry, deploy.",
      tags: ["ops"],
    });
    await backend.saveMemory({ title: "Linker", content: "see [[Deploy runbook]]" });
    const edgesBefore = await backend.edgesFor([original.id]);
    expect(edgesBefore.length).toBeGreaterThan(0);

    // near-identical revision — same note re-saved with a slight update;
    // a reworded TITLE also shifts the title+content embedding, so merges
    // are intentionally conservative (misses beat over-consolidation).
    const merged = await backend.saveMemory({
      title: "Deploy runbook",
      content: "Ship via docker build, tag the image, push to registry, deploy today.",
      tags: ["release"],
    });

    expect(merged.id).toBe(original.id);
    // canonical id survives → the Linker's backlink still points at it
    const edgesAfter = await backend.edgesFor([original.id]);
    expect(edgesAfter.length).toBe(edgesBefore.length);
    expect((await backend.listMemories()).length).toBe(2); // linker + merged
    // SAFETY: the merge contract guarantees the canonical id still exists
    const canon = (await backend.getMemory(original.id))!;
    expect(canon.content).toContain("deploy today");
    expect(canon.tags.sort()).toEqual(["ops", "release"]);
    expect(Date.parse(canon.updated_at)).toBeGreaterThanOrEqual(Date.parse(canon.created_at));
  });

  it("does NOT merge genuinely different content (below threshold)", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const a = await backend.saveMemory({
      title: "Cooking",
      content: "Goulash needs paprika, onions, beef and slow simmering.",
    });
    const b = await backend.saveMemory({
      title: "Compilers",
      content: "Rust borrows lifetimes at compile time without GC.",
    });
    expect(b.id).not.toBe(a.id);
    expect(await backend.listMemories()).toHaveLength(2);
  });

  it("title resolution never lands on archived rows", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const ghost = await backend.saveMemory({ title: "Ghost note", content: "forgotten" });
    await backend.updateMemory(ghost.id, { archived: true });
    expect(await backend.findMemoryByTitle("Ghost note")).toBeNull();
    // id-lookup still works — archived ≠ deleted
    expect((await backend.getMemory(ghost.id))?.title).toBe("Ghost note");
  });

  it("rewriting content without a summary re-derives it (never stale)", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const m = await backend.saveMemory({
      title: "Doc",
      content: "first version line",
      summary: "first version line",
    });
    const updated = await backend.updateMemory(m.id, {
      content: "# Header\n\ncompletely new body",
    });
    expect(updated.summary).toBe("Header");
  });

  it("collectSubgraph drops archived neighbors and their edges, keeps the root", async () => {
    const { collectSubgraph } = await import("./pipeline");
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    const leaf = await backend.saveMemory({ title: "Leaf", content: "target" });
    const root = await backend.saveMemory({ title: "Root", content: "links [[Leaf]]" });
    await backend.updateMemory(leaf.id, { archived: true });

    const sub = await collectSubgraph(backend, root.id, 1);
    expect(sub.memories.map((m) => m.id)).toEqual([root.id]);
    expect(sub.edges).toHaveLength(0);
  });

  it("deleting a memory removes its edges too", async () => {
    const backend = createKvBackend(memAdapter(), createLocalEmbedder());
    // B must exist first — [[B]] in A resolves to an edge only against
    // an existing title at save time.
    const b = await backend.saveMemory({ title: "B", content: "target" });
    const a = await backend.saveMemory({ title: "A", content: "links to [[B]]" });
    expect((await backend.edgesFor([a.id, b.id])).length).toBeGreaterThan(0);
    await backend.deleteMemory(b.id);
    expect(await backend.edgesFor([a.id])).toHaveLength(0);
  });
});
