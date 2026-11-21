# Galaxy-Memory

Infinite, semantically searchable long-term memory for AI coding agents — plus
an interactive 3D knowledge graph centered on an Interstellar-inspired black
hole.

## Layout

```
apps/web            React 19 + Vite + Three.js galaxy visualizer + editor UI
packages/mcp-server stdio MCP server — memory tools for AI agents
packages/shared     types, embeddings (openai/ollama/local), [[wikilinks]],
                    ingest pipeline, MemoryBackend interface, Supabase backend
supabase/migrations PostgreSQL + pgvector schema (HNSW, match_memories RPC)
```

npm workspaces. TypeScript strict everywhere; oxlint + oxfmt, never ESLint/Prettier.

## Quickstart (zero config)

```sh
npm install
npm run dev
```

With no env vars the app runs in **LocalStorage Demo Mode**, seeded with 30
interconnected memories across 5 clusters. The MCP server likewise falls back
to a local JSON file (`~/.galaxy-memory/memories.json`).

## Supabase mode

1. Create a project, then apply the schema:
   `supabase/migrations/001_init.sql` (SQL editor or `supabase db push`).
2. Copy `.env.example` → `.env.local` and set:

```sh
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

3. Embeddings: `OPENAI_API_KEY` (text-embedding-3-small), or
   `EMBEDDING_PROVIDER=ollama` + `OLLAMA_URL` for local `nomic-embed-text`,
   or leave unset for the built-in deterministic embedder.

Note: `VITE_OPENAI_API_KEY` ships the key to the browser — fine for a
self-hosted single-user vault, not for a public deploy.

## MCP server

```sh
npm run build -w @galaxy-memory/shared -w @galaxy-memory/mcp-server
```

Register it in your agent client (see `packages/mcp-server/mcp-config.example.json`):

```json
{
  "mcpServers": {
    "galaxy-memory": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/index.js"],
      "env": { "SUPABASE_URL": "...", "SUPABASE_SERVICE_ROLE_KEY": "...", "OPENAI_API_KEY": "..." }
    }
  }
}
```

Tools: `search_memory` (Graph-Augmented RAG, optional 1-hop neighbors),
`save_memory`, `update_memory`, `get_memory_context`, `list_clusters`.
Agent writes run the full pipeline — embed, `[[wikilink]]` explicit edges,
top-5 semantic edges (>0.78 cosine) — with `source: "ai_agent"`.

## Commands

| Command                           | What it does                        |
| --------------------------------- | ----------------------------------- |
| `npm run dev`                     | build shared, then Vite dev server  |
| `npm run build`                   | all packages + web production build |
| `npm run lint` / `npm run format` | oxlint / oxfmt                      |
| `npm run typecheck`               | `tsc -b` over the whole workspace   |
| `npm run mcp`                     | build + run the MCP server          |

A `justfile` mirrors these (`just dev`, `just check`) and `lefthook.yml`
gates `git push` on them.

## Notes

- `zod` is pinned to 3.x because `@modelcontextprotocol/sdk` vendors it via
  `zod-to-json-schema`; `npm audit` reports a high-severity finding fixed only
  in zod 4.x — the vulnerable copy exists in the SDK's tree regardless, and the
  exposed surface is tool-arg validation from a local stdio client.
