import type { MemoryInput } from "@galaxy-memory/shared";

/**
 * Demo seed — 30 interconnected memories loaded into localStorage on first
 * run when Supabase env vars are absent. [[wikilinks]] become explicit edges;
 * a few deliberately point at non-existent titles (a real vault has those).
 */
export const SEED_INPUTS: MemoryInput[] = [
  // ---------------------------------------------------------------- Projects
  {
    title: "Galaxy-Memory — Second Brain",
    cluster: "Projects",
    summary: "Infinite searchable memory + 3D knowledge graph around a black hole.",
    tags: ["active", "typescript", "react", "mcp"],
    created_at: "2026-11-16T09:12:00Z",
    content: `Monorepo: \`apps/web\` (React 19 + Vite + Three.js), \`packages/mcp-server\` (stdio MCP), \`packages/shared\` (types, embeddings, wikilinks), \`supabase\` (pgvector).

The 3D galaxy renders memories as stars orbiting a black hole — see [[Interstellar Black Hole Shader]] and [[Graph Layout Algorithm]]. Agents write memories through [[MCP Memory Tools]]; vectors live in [[pgvector Schema Design]].

Zero-config path: no env vars means LocalStorage demo mode. [[Embedding Provider Fallbacks]] covers the same degrade chain for embeddings.`,
  },
  {
    title: "OptiMeal — Meal Planning App",
    cluster: "Projects",
    summary: "Family meal planner with generated menus and shopping lists.",
    tags: ["active", "sveltekit", "family"],
    created_at: "2026-10-28T14:03:00Z",
    content: `Weekly menu generator + shopping list. Deploy notes live in [[OptiMeal Deployment Notes]].

Menu regeneration runs on a schedule — see [[Weekly Cron & Restic Backups]] for the job that also covers backups of its Postgres volume.`,
  },
  {
    title: "KERN CI Runner",
    cluster: "Projects",
    summary: "Self-hosted GitHub-Actions-compatible CI with a Postgres control plane.",
    tags: ["go", "ci", "self-hosted"],
    created_at: "2026-09-30T18:44:00Z",
    content: `Go control plane + containerized job execution across a runner fleet. Jobs lease through the queue described in [[Postgres Job Queue Design]].

Webhook intake flow is documented in [[GitHub App Webhook Flow]] (still a draft note — link intentionally dangling until I write it).`,
  },
  {
    title: "Homelab Docker Host",
    cluster: "Projects",
    summary: "Single docker host running the whole personal stack.",
    tags: ["infra", "docker", "ops"],
    created_at: "2026-08-15T11:20:00Z",
    content: `Everything behind Traefik — config notes in [[Traefik TLS Setup]].

Data safety: [[Weekly Cron & Restic Backups]] snapshots volumes nightly to the NAS.`,
  },
  {
    title: "Agent Memory Repo",
    cluster: "Projects",
    summary: "Persistent cross-session memory as a plain git repo.",
    tags: ["agents", "workflow"],
    created_at: "2026-11-05T08:30:00Z",
    content: `Memory lives in a dedicated git repo, not a single MEMORY.md — history, merge, and a remote keep it alive across machines.

Sessions start by pulling it and end by writing durable facts back. The checklist I follow is in [[Memory Loop Checklist]] (todo note — dangling on purpose).`,
  },
  {
    title: "T3 Code Thread Setup",
    cluster: "Projects",
    summary: "Orchestration defaults for parallel T3 threads and delegates.",
    tags: ["agents", "t3code"],
    created_at: "2026-11-10T19:55:00Z",
    content: `Worktree threads get \`workspaceStrategy\`; independent work starts from origin default branch.

Reusable agent prompts I'm collecting go into [[Prompt Templates Library]].`,
  },

  // ------------------------------------------------------ Code & Architecture
  {
    title: "Interstellar Black Hole Shader",
    cluster: "Code & Architecture",
    summary: "GLSL accretion disk: polar swirl, differential rotation, HDR output for bloom.",
    tags: ["glsl", "three.js", "shader"],
    created_at: "2026-11-17T21:40:00Z",
    content: `Ring geometry (inner 1.5, outer 4.6) with a custom ShaderMaterial. Speed falls off with radius — inner plasma orbits ~4x faster than the rim.

Output HDR values (1.5-3.5) so [[Three.js Bloom Tuning]] picks it up. A thin torus arc over the event horizon fakes the lensed disk image for [[Galaxy-Memory — Second Brain]].`,
  },
  {
    title: "pgvector Schema Design",
    cluster: "Code & Architecture",
    summary: "memories + memory_edges, HNSW cosine index, match_memories RPC.",
    tags: ["postgres", "pgvector", "supabase"],
    created_at: "2026-11-12T10:15:00Z",
    content: `\`memories.embedding\` is \`vector(1536)\` for text-embedding-3-small — see [[Embedding Provider Fallbacks]] for the padding trick with smaller models.

HNSW with \`vector_cosine_ops\`. \`match_memories(query_embedding, threshold, count, cluster)\` returns similarity = 1 - distance. Edges: \`explicit\` from wikilinks, \`semantic\` above 0.78. Query it through [[Supabase RPC Patterns]].`,
  },
  {
    title: "MCP Memory Tools",
    cluster: "Code & Architecture",
    summary: "search_memory, save_memory, update_memory, get_memory_context, list_clusters.",
    tags: ["mcp", "agents", "typescript"],
    created_at: "2026-11-18T16:02:00Z",
    content: `Five tools over stdio via @modelcontextprotocol/sdk. save/update run the full embed + [[wikilinks]] + semantic-neighbor pipeline with source 'ai_agent'.

Without Supabase env it falls back to a JSON file backend — same MemoryBackend interface as [[pgvector Schema Design]]. Protocol notes: newline-delimited JSON-RPC, stdout is protocol-only, diagnostics to stderr.`,
  },
  {
    title: "Postgres Job Queue Design",
    cluster: "Code & Architecture",
    summary: "FOR UPDATE SKIP LOCKED leasing for KERN CI jobs.",
    tags: ["postgres", "go", "queue"],
    created_at: "2026-10-02T13:27:00Z",
    content: `Job rows lease via \`SELECT ... FOR UPDATE SKIP LOCKED\` inside a txn — no separate queue infra for [[KERN CI Runner]].

Open question: lease expiry vs heartbeat tradeoffs — want a note on [[Backpressure Strategies]] once I finish the runner autoscaler.`,
  },
  {
    title: "Embedding Provider Fallbacks",
    cluster: "Code & Architecture",
    summary: "openai → ollama → local hash embedder, selected purely by env.",
    tags: ["embeddings", "resilience"],
    created_at: "2026-11-13T09:48:00Z",
    content: `Chain: OpenAI \`text-embedding-3-small\` when a key exists, else Ollama \`nomic-embed-text\` if provider is set, else a deterministic hashed bag-of-words embedder.

Ollama returns 768 dims — pad to [[pgvector Schema Design]]'s 1536. The local embedder keeps demo search honest: same-vocabulary docs get real cosine similarity.`,
  },
  {
    title: "Graph Layout Algorithm",
    cluster: "Code & Architecture",
    summary: "Cluster sectors + deterministic hash placement for the 3D galaxy.",
    tags: ["three.js", "layout", "frontend"],
    created_at: "2026-11-20T22:11:00Z",
    content: `Each cluster owns an angular sector (sorted by a preferred order). Node angle = sector center + hash jitter; radius 5.4-11.5; small y jitter.

Deterministic on memory id — layout survives reloads and new nodes don't reshuffle the sky. Powers the galaxy in [[Galaxy-Memory — Second Brain]].`,
  },

  // ------------------------------------------------------------ Reference Notes
  {
    title: "Three.js Bloom Tuning",
    cluster: "Reference Notes",
    summary: "Bloom settings that glow the accretion disk without washing out nodes.",
    tags: ["three.js", "postprocessing"],
    created_at: "2026-11-17T22:30:00Z",
    content: `\`mipmapBlur\`, luminanceThreshold ~0.35, intensity ~1.1. Feed it HDR material output, not LDR colors — that's why [[Interstellar Black Hole Shader]] multiplies color past 1.0.

Keep threshold above the starfield dots or the whole sky blooms.`,
  },
  {
    title: "Traefik TLS Setup",
    cluster: "Reference Notes",
    summary: "Labels-only TLS for the homelab docker host.",
    tags: ["traefik", "tls", "infra"],
    created_at: "2026-08-20T15:10:00Z",
    content: `Wildcard cert via DNS challenge; containers opt in with labels (\`traefik.enable=true\`, router rule, entrypoints=websecure).

Used on [[Homelab Docker Host]]; cert renewals are covered by [[Weekly Cron & Restic Backups]]'s health check job.`,
  },
  {
    title: "Supabase RPC Patterns",
    cluster: "Reference Notes",
    summary: "Typed Database interface, .rpc() for functions, row typing gotchas.",
    tags: ["supabase", "typescript"],
    created_at: "2026-11-13T11:05:00Z",
    content: `Hand-write the \`Database\` interface instead of codegen for small schemas. Row types must be \`type\` aliases — interfaces lack the implicit index signature \`GenericTable\` requires (lost an hour to \`never\` rows).

Calling [[pgvector Schema Design]]'s \`match_memories\` is just \`.rpc("match_memories", {query_embedding: [...]})\` — pass the embedding as a plain array.`,
  },
  {
    title: "Zustand Store Patterns",
    cluster: "Reference Notes",
    summary: "One store, selector subscriptions, actions next to state.",
    tags: ["react", "state"],
    created_at: "2026-10-11T17:22:00Z",
    content: `Single store for app state; components subscribe with selectors — never destructure the whole store.

Async actions call the backend then merge results into state. Non-serializable singletons (backend, embedder) live in module scope, not the store.`,
  },
  {
    title: "Radix Dialog Composition",
    cluster: "Reference Notes",
    summary: "Sheet-style panels from Dialog primitives: portal + overlay + content.",
    tags: ["radix", "a11y", "react"],
    created_at: "2026-10-05T12:40:00Z",
    content: `Side panels = \`Dialog.Root\` + \`Portal\` + dimmed \`Overlay\` + fixed-position \`Content\`. You get focus trap, ESC, and scroll-lock free.

The unified \`radix-ui\` package exports \`Dialog\`, \`Switch\`, \`Slot\` namespaces — no per-primitive packages needed.`,
  },
  {
    title: "OptiMeal Deployment Notes",
    cluster: "Reference Notes",
    summary: "Coolify deploy, env layout, and the migration checklist.",
    tags: ["deploy", "optimeal"],
    created_at: "2026-10-30T20:14:00Z",
    content: `Deployed via Coolify on the [[Homelab Docker Host]]. Migrations run in the release phase, not on boot.

Cron schedule for menu generation documented under [[Weekly Cron & Restic Backups]].`,
  },
  {
    title: "Weekly Cron & Restic Backups",
    cluster: "Reference Notes",
    summary: "One scheduled container: OptiMeal menus, volume snapshots, health pings.",
    tags: ["cron", "backups", "ops"],
    created_at: "2026-09-01T07:45:00Z",
    content: `Sunday 04:00: restic snapshots of all named volumes to the NAS (forget --keep-weekly 4).

Sunday 06:00: [[OptiMeal — Meal Planning App]] menu regeneration. Healthchecks.io ping after each — alerts land in mail.`,
  },

  // --------------------------------------------------------------------- Ideas
  {
    title: "Voice Capture for Memories",
    cluster: "Ideas",
    summary: "Push-to-talk note capture that lands straight in the graph.",
    tags: ["idea", "whisper", "ux"],
    created_at: "2026-11-19T08:15:00Z",
    content: `Global hotkey → record → local whisper.cpp → markdown transcript → save_memory.

The MCP path already exists ([[MCP Memory Tools]]), so this is mostly a desktop shell problem. Would make [[Galaxy-Memory — Second Brain]] capture-friction zero.`,
  },
  {
    title: "Semantic Duplicate Detection",
    cluster: "Ideas",
    summary: "Flag near-identical memories and suggest merges.",
    tags: ["idea", "embeddings"],
    created_at: "2026-11-14T13:50:00Z",
    content: `When match_memories returns similarity > 0.92 on save, surface a "possible duplicate" prompt with a merge action.

Cheap version: reuse [[Embedding Provider Fallbacks]]' embedder on save; expensive version: background dedup job.`,
  },
  {
    title: "Weekly Review Digest",
    cluster: "Ideas",
    summary: "Auto-generated Sunday digest of new/changed memories.",
    tags: ["idea", "automation"],
    created_at: "2026-11-08T18:05:00Z",
    content: `Cron pulls memories changed this week, LLM summarizes themes, saves the digest as a memory in Daily Logs.

Runs on the same job container as [[Weekly Cron & Restic Backups]].`,
  },
  {
    title: "Constellation Export",
    cluster: "Ideas",
    summary: "Export a subgraph neighborhood as a shareable image/JSON bundle.",
    tags: ["idea", "sharing"],
    created_at: "2026-11-09T15:33:00Z",
    content: `Pick a node, take its 2-hop neighborhood, render a still of the galaxy + JSON export of nodes/edges.

Depends on [[Graph Layout Algorithm]] being deterministic so exported coordinates match the live view.`,
  },
  {
    title: "Time-Travel Graph View",
    cluster: "Ideas",
    summary: "Scrub created_at to replay the graph growing over time.",
    tags: ["idea", "three.js", "viz"],
    created_at: "2026-11-15T23:26:00Z",
    content: `Slider on created_at: nodes fade in as they were written, edges draw on link creation.

Layout stays fixed thanks to [[Graph Layout Algorithm]] — only opacity/scale animate. Very Interstellar.`,
  },
  {
    title: "Prompt Templates Library",
    cluster: "Ideas",
    summary: "Versioned library of reusable agent prompts.",
    tags: ["idea", "agents", "prompts"],
    created_at: "2026-11-11T10:41:00Z",
    content: `Curated prompts for delegate reviews, porting sweeps, release checks — stored as memories, tagged \`prompt\`.

Feeds into [[T3 Code Thread Setup]]; agents could pull the right template via [[MCP Memory Tools]] search.`,
  },

  // ---------------------------------------------------------------- Daily Logs
  {
    title: "Daily Log — 2026-11-17",
    cluster: "Daily Logs",
    summary: "Accretion disk shader day.",
    tags: ["log"],
    created_at: "2026-11-17T23:10:00Z",
    content: `Deep work on [[Interstellar Black Hole Shader]] — differential rotation finally reads as plasma instead of a spinning donut.

[[Three.js Bloom Tuning]]: threshold 0.35 was the sweet spot; 0.2 bloomed the starfield.`,
  },
  {
    title: "Daily Log — 2026-11-18",
    cluster: "Daily Logs",
    summary: "MCP server wired end to end.",
    tags: ["log"],
    created_at: "2026-11-18T22:47:00Z",
    content: `[[MCP Memory Tools]] all five registered and answering over stdio. File-backend fallback works — saved a memory with no env at all.

Open: semantic edge threshold 0.78 might be too strict for the local embedder.`,
  },
  {
    title: "Daily Log — 2026-11-19",
    cluster: "Daily Logs",
    summary: "OptiMeal redeploy + dinner logistics.",
    tags: ["log"],
    created_at: "2026-11-19T21:05:00Z",
    content: `Shipped the shopping-list fix per [[OptiMeal Deployment Notes]]. Migrations clean on release phase.

Noted the cron overlap risk in [[Weekly Cron & Restic Backups]] — menus regenerate while restic holds the volume snapshot; fine so far.`,
  },
  {
    title: "Daily Log — 2026-11-20",
    cluster: "Daily Logs",
    summary: "KERN queue soak test.",
    tags: ["log"],
    created_at: "2026-11-20T23:58:00Z",
    content: `Ran 200 synthetic jobs through [[Postgres Job Queue Design]] — zero double-leases, p95 lease time 40ms.

Tomorrow: galaxy UI polish, [[Graph Layout Algorithm]] sector spread still feels uneven with 5 clusters.`,
  },
  {
    title: "Daily Log — 2026-11-21",
    cluster: "Daily Logs",
    summary: "Galaxy UI assembly day.",
    tags: ["log"],
    created_at: "2026-11-21T02:47:00Z",
    content: `Scene + overlay landing today for [[Galaxy-Memory — Second Brain]]. Sector spread bumped to 0.68 — clusters read distinctly now.

Backlog captured: [[Voice Capture for Memories]], [[Time-Travel Graph View]].`,
  },
];
