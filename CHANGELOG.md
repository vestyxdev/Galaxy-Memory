# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-22

Initial public release.

### Added

- Interactive 3D knowledge graph: Interstellar-inspired black hole with
  doppler-beamed accretion disk, photon ring, ~2900-grain dust field,
  bezier edge arcs, bloom/grain/vignette post-processing
- MCP server (stdio) with 7 tools: `search_memory`, `save_memory`,
  `update_memory`, `delete_memory`, `get_memory`, `get_memory_context`,
  `list_clusters`
- One write pipeline for UI and agents: embed, `[[wikilink]]` explicit
  edges, top-5 semantic edges
- Three backends: Supabase (pgvector + realtime), local JSON file shared
  with the MCP server via a Vite dev bridge, browser LocalStorage
- Home pane with greeting, last-visit line, and line-numbered scratchpad
- Search palette (Cmd+K / `/`) with recent captures and live node
  highlight; Pages panel; editor drawer with markdown preview and
  clickable wikilinks; clickable cluster labels that fly the camera
- System status popover: backend, storage, embedder, MCP path, test
  connection, copyable agent config, last-sync heartbeat
- Corrupt-JSON quarantine, paginated Supabase reads, per-writer temp
  files, cross-tab/realtime live sync, `prefers-reduced-motion` support,
  WebGL failure boundary
- `scripts/run-tests.mjs` (`npm test`): isolated end-to-end probes for
  save/search/get/delete, hostile inputs, and corruption recovery

[0.1.0]: https://github.com/vestyxdev/Galaxy-Memory/releases/tag/v0.1.0
