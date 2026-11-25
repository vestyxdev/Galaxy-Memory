#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  chunkMarkdown,
  collectSubgraph,
  createEmbedder,
  createKvBackend,
  exportMarkdownDocument,
  exportVaultMarkdown,
  extractHashtags,
  findDuplicatePairs,
  hybridSearch,
  packContext,
  parseFrontmatter,
  toWikilink,
  type Memory,
  type MemoryBackend,
  type MemoryMatch,
} from "@galaxy-memory/shared";
import { createSupabaseBackend, type Database } from "@galaxy-memory/shared/supabase";

import { createFileAdapter, defaultDbPath } from "./file-adapter.js";

/** Search results need a lower bar than edge-creation (0.78) to be useful. */
const SEARCH_THRESHOLD = 0.2;

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** Compact shape for tool output — drops the 1536-dim embedding + full body. */
function summarize(m: Memory | MemoryMatch) {
  return {
    id: m.id,
    title: m.title,
    summary: m.summary,
    cluster: m.cluster,
    tags: m.tags,
    source: m.source,
    pinned: m.pinned,
    archived: m.archived,
    updated_at: m.updated_at,
    snippet: m.content.slice(0, 280),
    ...("similarity" in m ? { similarity: Math.round(m.similarity * 1000) / 1000 } : {}),
  };
}

async function main() {
  const embedder = createEmbedder({
    provider: process.env.EMBEDDING_PROVIDER,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaUrl: process.env.OLLAMA_URL,
  });

  let backend: MemoryBackend;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    const client = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    backend = createSupabaseBackend(client, embedder);
  } else {
    const dbPath = process.env.GALAXY_MEMORY_DB ?? defaultDbPath();
    backend = createKvBackend(createFileAdapter(dbPath), embedder, {
      label: `Local file (${dbPath})`,
    });
  }

  const server = new McpServer({ name: "galaxy-memory", version: "0.2.0" });

  server.registerTool(
    "search_memory",
    {
      description:
        "Semantic search over long-term memories (Graph-Augmented RAG). Returns ranked " +
        "matches and, when include_neighbors is set, each match's 1-hop graph neighbors.",
      inputSchema: {
        query: z.string().describe("Natural-language search query"),
        limit: z.number().int().min(1).max(20).default(5),
        cluster: z.string().optional().describe("Restrict to one cluster name"),
        include_neighbors: z.boolean().default(true),
      },
    },
    async ({ query, limit, cluster, include_neighbors }) => {
      try {
        // hybrid retrieval: FTS + vector fused via RRF; embedder failure
        // degrades to keyword-only inside hybridSearch.
        const matches = await hybridSearch(backend, embedder, query, {
          limit,
          cluster: cluster ?? null,
          vectorThreshold: SEARCH_THRESHOLD,
        });

        let neighborsById = new Map<
          string,
          { id: string; title: string; edge_type: string; weight: number }[]
        >();
        if (include_neighbors && matches.length > 0) {
          const [edges, all] = await Promise.all([
            backend.edgesFor(matches.map((m) => m.id)),
            backend.listMemories(),
          ]);
          const titleOf = new Map(all.map((m) => [m.id, m.title]));
          const matchIds = new Set(matches.map((m) => m.id));
          neighborsById = new Map(matches.map((m) => [m.id, []]));
          for (const e of edges) {
            for (const [from, to] of [
              [e.source_id, e.target_id],
              [e.target_id, e.source_id],
            ] as const) {
              const list = neighborsById.get(from);
              const title = titleOf.get(to);
              // neighbor entries point outside the match set — avoid echoing matches back
              if (list && title && !matchIds.has(to)) {
                list.push({ id: to, title, edge_type: e.edge_type, weight: e.weight });
              }
            }
          }
        }

        return ok(
          matches.map((m) => ({
            ...summarize(m),
            via: m.via,
            neighbors: neighborsById.get(m.id) ?? [],
          })),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "save_memory",
    {
      description:
        "Save a new memory: embeds it, stores it, resolves [[wikilinks]] into explicit " +
        "edges, and attaches semantic edges to its nearest neighbors. Identical content " +
        "(hash) returns the existing memory; near-identical content merges into it as a " +
        "newer revision — keeping the original id so backlinks survive.",
      inputSchema: {
        title: z.string().trim().min(1),
        content: z
          .string()
          .refine((s) => s.trim().length > 0, "content must not be blank")
          .describe("Markdown body; [[Other Title]] creates edges"),
        summary: z.string().optional().describe("Optional one-line summary"),
        cluster: z.string().optional().describe("Defaults to 'General'"),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ title, content, summary, cluster, tags }) => {
      try {
        const memory = await backend.saveMemory({
          title,
          content,
          summary: summary ?? null,
          cluster,
          tags,
          source: "ai_agent",
        });
        const [edges, all] = await Promise.all([
          backend.edgesFor([memory.id]),
          backend.listMemories(),
        ]);
        const titleOf = new Map(all.map((m) => [m.id, m.title]));
        const connections = edges.map((e) => {
          const other = e.source_id === memory.id ? e.target_id : e.source_id;
          return { title: titleOf.get(other) ?? other, edge_type: e.edge_type, weight: e.weight };
        });
        return ok({ ...summarize(memory), connections });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_memory",
    {
      description:
        "Update a memory's fields. Re-embeds and rebuilds outgoing edges when " +
        "title or content changed.",
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().trim().min(1).optional(),
        content: z
          .string()
          .refine((s) => s.trim().length > 0, "content must not be blank")
          .optional(),
        summary: z.string().nullable().optional().describe("One-line summary; null clears it"),
        cluster: z.string().optional(),
        tags: z.array(z.string()).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
    },
    async ({ id, title, content, summary, cluster, tags, pinned, archived }) => {
      try {
        const memory = await backend.updateMemory(id, {
          title,
          content,
          summary,
          cluster,
          tags,
          pinned,
          archived,
        });
        return ok(summarize(memory));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "delete_memory",
    {
      description: "Delete a memory and all its edges by id.",
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const existing = await backend.getMemory(id);
        if (!existing) return fail(`Memory ${id} not found`);
        await backend.deleteMemory(id);
        return ok({ deleted: id, title: existing.title });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_memory",
    {
      description: "Read one memory in full by id: complete markdown, tags, and metadata.",
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const memory = await backend.getMemory(id);
        if (!memory) return fail(`Memory ${id} not found`);
        const edges = await backend.edgesFor([id]);
        const all = await backend.listMemories();
        const titleOf = new Map(all.map((m) => [m.id, m.title]));
        const connections = edges.map((e) => {
          const other = e.source_id === id ? e.target_id : e.source_id;
          return { title: titleOf.get(other) ?? other, edge_type: e.edge_type };
        });
        // embedding is 1536 floats — useless to an agent, huge in the payload
        return ok({ ...memory, embedding: null, connections });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_memory_context",
    {
      description: "Return one memory plus its connected subgraph up to `depth` hops.",
      inputSchema: {
        id: z.string().uuid(),
        depth: z.number().int().min(1).max(3).default(1),
      },
    },
    async ({ id, depth }) => {
      try {
        const subgraph = await collectSubgraph(backend, id, depth);
        if (subgraph.memories.length === 0) {
          return fail(`Memory ${id} not found`);
        }
        return ok({
          memories: subgraph.memories.map(summarize),
          edges: subgraph.edges,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_clusters",
    {
      description: "List all clusters with memory counts.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await backend.listClusters());
      } catch (error) {
        return fail(error);
      }
    },
  );

  /** id-or-title resolution shared by link/recall-style tools. */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function resolveMemory(ref: string): Promise<Memory | null> {
    // uuid-lookup first; a memory literally TITLED like a uuid still resolves
    if (UUID_RE.test(ref.trim())) {
      return (await backend.getMemory(ref.trim())) ?? backend.findMemoryByTitle(ref);
    }
    return backend.findMemoryByTitle(ref);
  }

  server.registerTool(
    "recall",
    {
      description:
        "Context-window packing: hybrid-searches memories, then returns the top " +
        "matches plus their 1-hop link neighbors clipped to a token budget. " +
        "Each entry carries a citation ([rank] title — id) for the agent to quote.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(8),
        token_budget: z.number().int().min(200).max(32000).default(2000),
        cluster: z.string().optional(),
        include_neighbors: z.boolean().default(true),
      },
    },
    async ({ query, limit, token_budget, cluster, include_neighbors }) => {
      try {
        const matches = await hybridSearch(backend, embedder, query, {
          limit,
          cluster: cluster ?? null,
        });
        if (matches.length === 0) return ok({ entries: [], tokens_used: 0, omitted: [] });
        const [edges, all] = await Promise.all([
          backend.edgesFor(matches.map((m) => m.id)),
          backend.listMemories(),
        ]);
        const byId = new Map(all.map((m) => [m.id, m]));
        const packed = packContext(matches, edges, byId, {
          tokenBudget: token_budget,
          includeNeighbors: include_neighbors,
        });
        return ok({ ...packed, tokens_used: packed.tokensUsed });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "link_memories",
    {
      description:
        "Create explicit [[wikilink]]-style edges between two memories, both " +
        "directions. Accepts ids or exact titles.",
      inputSchema: {
        from: z.string().min(1).describe("id or exact title of the source memory"),
        to: z.string().min(1).describe("id or exact title of the target memory"),
      },
    },
    async ({ from, to }) => {
      try {
        const a = await resolveMemory(from);
        if (!a) return fail(`Memory not found: ${from}`);
        const b = await resolveMemory(to);
        if (!b) return fail(`Memory not found: ${to}`);
        if (a.id === b.id) return fail("Cannot link a memory to itself");
        const pairs: [string, string][] = [
          [a.id, b.id],
          [b.id, a.id],
        ];
        for (const [source_id, target_id] of pairs) {
          await backend.upsertEdge({ source_id, target_id, edge_type: "explicit", weight: 1 });
        }
        return ok({ linked: [a.title, b.title], directions: 2 });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "import_markdown",
    {
      description:
        "Import an Obsidian-compatible markdown document. Parses frontmatter " +
        "(title/cluster/tags/created/pinned), merges #hashtags from the body, " +
        "chunks long documents at headings with overlap + context headers, " +
        "and dedups chunks by content hash so re-imports are no-ops.",
      inputSchema: {
        content: z
          .string()
          .refine((s) => s.trim().length > 0, "content must not be blank")
          .describe("Full markdown, optionally with ---frontmatter---"),
        title: z.string().optional().describe("Overrides frontmatter title / first heading"),
        cluster: z.string().optional().describe("Overrides frontmatter cluster"),
        chunk_size: z.number().int().min(400).max(8000).default(1600),
      },
    },
    async ({ content, title, cluster, chunk_size }) => {
      try {
        const { frontmatter, body } = parseFrontmatter(content);
        const fmTags = (frontmatter.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const tags = [...new Set([...fmTags, ...extractHashtags(body)])];
        const docTitle =
          title ?? frontmatter.title ?? body.match(/^#\s+(.*)$/m)?.[1]?.trim() ?? "Imported note";
        const docCluster = cluster ?? frontmatter.cluster;
        const pinned = frontmatter.pinned === "true";
        const created =
          frontmatter.created && !Number.isNaN(Date.parse(frontmatter.created))
            ? new Date(frontmatter.created).toISOString()
            : undefined;

        const chunks = chunkMarkdown(body.trim(), { maxChars: chunk_size, overlap: 200 });
        const single = chunks.length <= 1;

        let hub: Memory | null = null;
        const ids: string[] = [];
        const created_ids: string[] = [];
        if (!single) {
          // parent note links every part; parts link back via [[title]]
          hub = await backend.saveMemory({
            title: docTitle,
            content: `Index note for the imported document. Parts:\n${chunks
              .map((_, i) => `- ${toWikilink(`${docTitle} §${i + 1}`)}`)
              .join("\n")}`,
            cluster: docCluster,
            tags,
            pinned,
            created_at: created,
          });
          ids.push(hub.id);
          created_ids.push(hub.id);
        }

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          const partTitle = single ? docTitle : `${docTitle} §${i + 1}`;
          const header = single
            ? ""
            : `Part ${i + 1} of ${toWikilink(docTitle)}` +
              (chunk.context ? ` — ${chunk.context}` : "") +
              "\n\n";
          const before = new Set(ids);
          const memory = await backend.saveMemory({
            title: partTitle,
            content: header + chunk.body,
            cluster: docCluster,
            tags,
            pinned,
            created_at: created,
          });
          ids.push(memory.id);
          if (!before.has(memory.id)) created_ids.push(memory.id);
        }

        return ok({
          title: docTitle,
          parts: single ? 1 : chunks.length,
          ids,
          created: created_ids.length,
          skipped_duplicates: ids.length - created_ids.length,
          frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : undefined,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "export_markdown",
    {
      description:
        "Export memories as Obsidian-compatible markdown with frontmatter " +
        "(title, cluster, tags, pinned, archived, timestamps, id). One memory " +
        "by id, or the whole vault grouped by cluster.",
      inputSchema: {
        id: z.string().uuid().optional(),
        cluster: z.string().optional().describe("Vault export: one cluster only"),
      },
    },
    async ({ id, cluster }) => {
      try {
        if (id) {
          const memory = await backend.getMemory(id);
          if (!memory) return fail(`Memory ${id} not found`);
          return ok({ markdown: exportMarkdownDocument(memory) });
        }
        const all = await backend.listMemories();
        const filtered = cluster ? all.filter((m) => m.cluster === cluster) : all;
        return ok({ markdown: exportVaultMarkdown(filtered), memories: filtered.length });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "pin_memory",
    {
      description:
        "Pin or unpin a memory. Pinned memories get a ranking boost in " +
        "hybrid search — use for critical long-term facts.",
      inputSchema: { id: z.string().uuid(), pinned: z.boolean().default(true) },
    },
    async ({ id, pinned }) => {
      try {
        const memory = await backend.updateMemory(id, { pinned });
        return ok(summarize(memory));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "archive_memory",
    {
      description:
        "Archive or unarchive a memory. Archived memories stay in the store " +
        "with their edges but are hidden from search, clusters, and the graph " +
        "— soft-delete without breaking references.",
      inputSchema: { id: z.string().uuid(), archived: z.boolean().default(true) },
    },
    async ({ id, archived }) => {
      try {
        const memory = await backend.updateMemory(id, { archived });
        return ok(summarize(memory));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "find_duplicates",
    {
      description:
        "Scan stored embeddings for near-duplicate memories (cosine ≥ " +
        "threshold). O(n²) — scans at most `cap` newest memories.",
      inputSchema: {
        threshold: z.number().min(0.5).max(1).default(0.9),
        cap: z.number().int().min(10).max(20000).default(2000),
      },
    },
    async ({ threshold, cap }) => {
      try {
        const items = backend.listEmbeddings
          ? await backend.listEmbeddings()
          : await backend.listMemories();
        const scanned = items.slice(-cap);
        const pairs = findDuplicatePairs(scanned, threshold);
        return ok({
          pairs,
          scanned: scanned.length,
          total: items.length,
          truncated: items.length > scanned.length,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "graph_stats",
    {
      description:
        "Vault statistics: totals, cluster counts, pinned/archived counts, " +
        "and orphan memories (no edges in either direction).",
      inputSchema: {},
    },
    async () => {
      try {
        const [memories, edges, clusters] = await Promise.all([
          backend.listMemories(),
          backend.listEdges(),
          backend.listClusters(),
        ]);
        const connected = new Set<string>();
        for (const e of edges) {
          connected.add(e.source_id);
          connected.add(e.target_id);
        }
        const orphans = memories.filter((m) => !connected.has(m.id) && !m.archived);
        return ok({
          memories: memories.length,
          edges: edges.length,
          clusters,
          pinned: memories.filter((m) => m.pinned).length,
          archived: memories.filter((m) => m.archived).length,
          orphans: orphans.map((m) => ({ id: m.id, title: m.title, cluster: m.cluster })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  // stdout carries the protocol — diagnostics go to stderr only.
  console.error(`galaxy-memory ready (backend=${backend.label}, embedder=${embedder.name})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
