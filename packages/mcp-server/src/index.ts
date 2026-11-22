#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  collectSubgraph,
  createEmbedder,
  createKvBackend,
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

  const server = new McpServer({ name: "galaxy-memory", version: "0.1.0" });

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
        const [queryEmbedding] = await embedder.embed([query]);
        if (!queryEmbedding) throw new Error("embedder returned no vector");
        const matches = await backend.matchMemories(
          queryEmbedding,
          SEARCH_THRESHOLD,
          limit,
          cluster ?? null,
        );

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
          matches.map((m) => ({ ...summarize(m), neighbors: neighborsById.get(m.id) ?? [] })),
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
        "edges, and attaches semantic edges to its nearest neighbors.",
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
      },
    },
    async ({ id, title, content, summary, cluster, tags }) => {
      try {
        const memory = await backend.updateMemory(id, {
          title,
          content,
          summary,
          cluster,
          tags,
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
        return ok({ ...memory, connections });
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

  await server.connect(new StdioServerTransport());
  // stdout carries the protocol — diagnostics go to stderr only.
  console.error(`galaxy-memory ready (backend=${backend.label}, embedder=${embedder.name})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
