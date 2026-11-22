/**
 * Synthetic benchmark: 1,000 memories through the KV backend.
 * Measures ingest throughput, first-search index build, and hybrid
 * query latency. Run after `npm run build`.
 */
import { performance } from "node:perf_hooks";
import { createKvBackend, createLocalEmbedder } from "../packages/shared/dist/index.js";

const N = Number(process.env.BENCH_N ?? 1000);

const adapter = {
  state: null,
  load: async () => adapter.state,
  save: async (s) => {
    adapter.state = s;
  },
};

const backend = createKvBackend(adapter, createLocalEmbedder(), { label: "bench" });
const ms = (t0) => (performance.now() - t0).toFixed(1);

const TOPICS = [
  ["postgres", "pgvector index tuning cosine ivfflat lists probes"],
  ["react", "rendering memoization suspense concurrent features"],
  ["auth", "jwt rotation refresh tokens rate limiting oauth"],
  ["deploy", "ci cd pipeline docker build cache layers"],
  ["search", "bm25 inverted index ranking reciprocal rank fusion"],
  ["design", "dark theme spacing tokens glassmorphism layers"],
  ["api", "rest endpoints pagination cursor filtering errors"],
  ["testing", "unit integration e2e fixtures mocks coverage"],
];

console.log(`bench: ingesting ${N} memories…`);
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const [cluster, body] = TOPICS[i % TOPICS.length];
  await backend.saveMemory({
    title: `Note ${i} ${cluster}`,
    content: `${body} — variant ${i} ${"filler text ".repeat(8)}`,
    cluster,
  });
}
const ingestMs = performance.now() - t0;
console.log(`  ingest: ${ingestMs.toFixed(0)}ms total, ${(ingestMs / N).toFixed(1)}ms/write`);

const queries = [
  "pgvector index performance",
  "jwt refresh rotation",
  "react rendering memoization",
  "bm25 rank fusion",
  "docker layer caching",
];

// cold query: forces the lazy inverted index build
let t = performance.now();
await backend.searchMemories({ query: queries[0], queryEmbedding: null, limit: 10, cluster: null });
console.log(`  first hybrid query (incl. index build): ${ms(t)}ms`);

// warm queries, 10 iterations each
const lat = [];
for (let i = 0; i < 50; i++) {
  const q = queries[i % queries.length];
  t = performance.now();
  await backend.searchMemories({ query: q, queryEmbedding: null, limit: 10, cluster: null });
  lat.push(performance.now() - t);
}
lat.sort((a, b) => a - b);
const p = (x) => lat[Math.min(lat.length - 1, Math.floor(lat.length * x))].toFixed(1);
console.log(`  hybrid FTS-only p50=${p(0.5)}ms p95=${p(0.95)}ms n=${lat.length}`);

// vector path
const embedder = createLocalEmbedder();
const [qv] = await embedder.embed(["semantic similarity search"]);
const vec = [];
for (let i = 0; i < 20; i++) {
  t = performance.now();
  await backend.searchMemories({
    query: "semantic similarity",
    queryEmbedding: qv,
    limit: 10,
    cluster: null,
  });
  vec.push(performance.now() - t);
}
vec.sort((a, b) => a - b);
console.log(`  hybrid FTS+vec p50=${vec[Math.floor(vec.length / 2)].toFixed(1)}ms`);

const edges = await backend.listEdges();
console.log(`  graph: ${(await backend.listMemories()).length} memories, ${edges.length} edges`);
console.log("bench: done");
