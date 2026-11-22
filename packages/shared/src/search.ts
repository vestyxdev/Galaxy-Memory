import type { MemoryBackend } from "./backend.js";
import { cosineSimilarity, type Embedder } from "./embeddings.js";
import type { HybridMatch, Memory, MemoryEdge } from "./types.js";

/**
 * Hybrid retrieval: keyword FTS (diacritic-insensitive, BM25-lite) fused
 * with vector similarity via Reciprocal Rank Fusion, then weighted by
 * recency and pinning. Pure functions — the KV backend indexes these in
 * memory and the Supabase backend mirrors the ranking in SQL.
 */

/** Diacritic-fold + lowercase: "Tomáš"/"tomas", "Příliš"/"prilis" compare equal. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const TOKEN_RE = /[\p{L}\p{N}_]+/gu;

export function tokenize(text: string): string[] {
  return fold(text).match(TOKEN_RE) ?? [];
}

export interface ScoredDoc {
  id: string;
  score: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const PREFIX_MIN_LEN = 3;
const TITLE_BOOST = 1.5;
const PHRASE_BOOST = 2.0;

/**
 * In-memory inverted index over a memory set. Rebuild on reload — at 10k
 * docs this is tens of ms, and lazy construction means it only exists
 * when someone actually searches.
 */
export class InvertedIndex {
  private postings = new Map<string, Map<string, number>>();
  private titleTerms = new Map<string, Set<string>>();
  private foldedText = new Map<string, string>();
  private docLen = new Map<string, number>();
  private avgLen = 1;
  private vocab: string[] = [];
  readonly size: number;

  constructor(memories: Memory[]) {
    const docs = memories.filter((m) => !m.archived);
    this.size = docs.length;
    let total = 0;
    for (const m of docs) {
      const body = tokenize(`${m.content} ${m.tags.join(" ")}`);
      const title = tokenize(m.title);
      this.titleTerms.set(m.id, new Set(title));
      this.foldedText.set(m.id, fold(`${m.title}\n${m.content}`));
      this.docLen.set(m.id, Math.max(body.length + title.length, 1));
      total += body.length + title.length;
      const tf = new Map<string, number>();
      for (const t of [...body, ...title]) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [term, count] of tf) {
        let post = this.postings.get(term);
        if (!post) this.postings.set(term, (post = new Map()));
        post.set(m.id, count);
      }
    }
    this.avgLen = Math.max(total / Math.max(docs.length, 1), 1);
    this.vocab = [...this.postings.keys()];
  }

  /** BM25-lite over exact + prefix-expanded terms, plus phrase bonus. */
  score(query: string): ScoredDoc[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const out = new Map<string, number>();
    const seen = new Set<string>();

    const addTerm = (term: string, weight: number) => {
      const post = this.postings.get(term);
      if (!post) return;
      const df = post.size;
      const idf = Math.log(1 + (this.size - df + 0.5) / (df + 0.5));
      for (const [id, tf] of post) {
        const dl = this.docLen.get(id) ?? 1;
        const bm =
          ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / this.avgLen))) *
          idf;
        const titled = this.titleTerms.get(id)?.has(term) ? TITLE_BOOST : 1;
        out.set(id, (out.get(id) ?? 0) + bm * weight * titled);
      }
    };

    for (const term of terms) {
      if (seen.has(term)) continue;
      seen.add(term);
      addTerm(term, 1);
      if (term.length >= PREFIX_MIN_LEN) {
        for (const token of this.vocab) {
          if (token !== term && token.startsWith(term) && !seen.has(token)) {
            addTerm(token, 0.5);
          }
        }
      }
    }

    // exact phrase bonus on the folded document text
    const foldedQuery = fold(query).trim();
    if (terms.length > 1 && foldedQuery.length > 0) {
      const mean = terms.reduce((a) => a + 1, 0) * PHRASE_BOOST;
      for (const [id] of out) {
        if (this.foldedText.get(id)?.includes(foldedQuery)) {
          out.set(id, (out.get(id) ?? 0) + mean);
        }
      }
    }

    return [...out.entries()]
      .map(([id, score]): ScoredDoc => ({ id, score }))
      .sort((a, b) => b.score - a.score);
  }
}

const RRF_K = 60;
const RECENCY_TAU_DAYS = 30;
const RECENCY_WEIGHT = 0.1;
const PIN_MULTIPLIER = 1.5;

export type { HybridMatch } from "./types.js";

export interface FuseArgs {
  /** Vector matches, best-first (rank position = index). */
  vector: { id: string; similarity: number }[];
  /** FTS scores, best-first. */
  fts: ScoredDoc[];
  /** Candidate memories to look up by id (already archived-filtered). */
  candidates: Memory[];
  limit: number;
  now?: number;
}

/**
 * Reciprocal Rank Fusion: score = Σ 1/(K + rank) across lists, then
 * multiplied by a mild recency decay and a hard pin boost.
 */
export function fuseRanked({
  vector,
  fts,
  candidates,
  limit,
  now = Date.now(),
}: FuseArgs): HybridMatch[] {
  const scores = new Map<string, { score: number; vector: boolean; fts: boolean }>();
  vector.forEach(({ id }, rank) => {
    const e = scores.get(id) ?? { score: 0, vector: false, fts: false };
    e.score += 1 / (RRF_K + rank + 1);
    e.vector = true;
    scores.set(id, e);
  });
  fts.forEach(({ id }, rank) => {
    const e = scores.get(id) ?? { score: 0, vector: false, fts: false };
    e.score += 1 / (RRF_K + rank + 1);
    e.fts = true;
    scores.set(id, e);
  });

  const byId = new Map(candidates.map((m) => [m.id, m]));
  const day = 86_400_000;
  return [...scores.entries()]
    .flatMap(([id, e]): HybridMatch[] => {
      const m = byId.get(id);
      if (!m) return [];
      const ageDays = (now - Date.parse(m.updated_at)) / day;
      const recency = 1 + RECENCY_WEIGHT * Math.exp(-Math.max(ageDays, 0) / RECENCY_TAU_DAYS);
      const score = e.score * recency * (m.pinned ? PIN_MULTIPLIER : 1);
      return [
        { ...m, similarity: score, via: e.vector && e.fts ? "both" : e.vector ? "vector" : "fts" },
      ];
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export interface SearchOptions {
  limit?: number;
  cluster?: string | null;
  /** Vector prefilter for matchMemories when falling back. */
  vectorThreshold?: number;
}

/**
 * One entry point for all retrieval: embed the query (embedder failure
 * degrades to FTS-only), then fuse vector + keyword rankings. Uses the
 * backend's native `searchMemories` when it provides one.
 */
export async function hybridSearch(
  backend: MemoryBackend,
  embedder: Embedder | null,
  query: string,
  { limit = 10, cluster = null, vectorThreshold = 0.1 }: SearchOptions = {},
): Promise<HybridMatch[]> {
  let queryEmbedding: number[] | null = null;
  if (embedder && query.trim()) {
    try {
      const [vec] = await embedder.embed([query]);
      queryEmbedding = vec ?? null;
    } catch {
      // embedder offline/rate-limited — keyword retrieval still answers
    }
  }

  if (backend.searchMemories) {
    return backend.searchMemories({ query, queryEmbedding, limit, cluster });
  }

  const all = (await backend.listMemories()).filter(
    (m) => !m.archived && (cluster == null || m.cluster === cluster),
  );
  const fts = new InvertedIndex(all).score(query);
  const vector = queryEmbedding
    ? (await backend.matchMemories(queryEmbedding, vectorThreshold, limit * 4, cluster))
        .filter((m) => !m.archived)
        .map((m) => ({ id: m.id, similarity: m.similarity }))
    : [];
  return fuseRanked({ vector, fts, candidates: all, limit });
}

export interface PackedEntry {
  rank: number;
  id: string;
  title: string;
  cluster: string;
  score: number;
  kind: "hit" | "neighbor";
  /** For neighbors: the hit title that linked them in. */
  via?: string;
  text: string;
}

export interface PackedContext {
  entries: PackedEntry[];
  /** Rough estimate at ~4 chars/token. */
  tokensUsed: number;
  /** Hits that fit the ranking but not the budget. */
  omitted: { id: string; title: string }[];
}

const CHARS_PER_TOKEN = 4;
const NEIGHBOR_SNIPPET = 220;

/**
 * Context-window packing: top-K fused hits + their 1-hop link neighbors,
 * clipped to a char budget derived from a token limit. Every entry carries
 * a citation `[rank] title — id` an agent can quote back.
 */
export function packContext(
  matches: HybridMatch[],
  edges: MemoryEdge[],
  byId: Map<string, Memory>,
  { tokenBudget = 2000, maxNeighbors = 6 }: { tokenBudget?: number; maxNeighbors?: number } = {},
): PackedContext {
  const budget = tokenBudget * CHARS_PER_TOKEN;
  let used = 0;
  const entries: PackedEntry[] = [];
  const omitted: { id: string; title: string }[] = [];
  const included = new Set<string>();

  matches.forEach((m, i) => {
    const header = `[${i + 1}] ${m.title} — ${m.cluster} — id:${m.id}\n`;
    // -1: the entry's trailing newline counts against the budget too
    const room = budget - used - header.length - 1;
    if (room < 120) {
      omitted.push({ id: m.id, title: m.title });
      return;
    }
    const text = m.content.length <= room ? m.content : `${m.content.slice(0, room - 1)}…`;
    used += header.length + text.length + 1;
    included.add(m.id);
    entries.push({
      rank: i + 1,
      id: m.id,
      title: m.title,
      cluster: m.cluster,
      score: m.similarity,
      kind: "hit",
      text,
    });
  });

  const seen = new Set(included);
  const neighbors: { id: string; via: string }[] = [];
  for (const e of edges) {
    const srcIn = included.has(e.source_id);
    const dstIn = included.has(e.target_id);
    if (srcIn === dstIn) continue;
    const id = srcIn ? e.target_id : e.source_id;
    if (seen.has(id)) continue;
    seen.add(id);
    const viaHit = byId.get(srcIn ? e.source_id : e.target_id);
    neighbors.push({ id, via: viaHit?.title ?? "" });
    if (neighbors.length >= maxNeighbors) break;
  }

  let rank = entries.length;
  for (const n of neighbors) {
    const m = byId.get(n.id);
    if (!m || m.archived) continue;
    const header = `[+${++rank}] ${m.title} — linked from ${n.via} — id:${m.id}\n`;
    const snippet = (m.summary ?? m.content.slice(0, NEIGHBOR_SNIPPET)).slice(0, NEIGHBOR_SNIPPET);
    const room = budget - used - header.length;
    if (room < 80) break;
    const text = snippet.length <= room ? snippet : `${snippet.slice(0, room - 1)}…`;
    used += header.length + text.length + 1;
    entries.push({
      rank,
      id: m.id,
      title: m.title,
      cluster: m.cluster,
      score: 0,
      kind: "neighbor",
      via: n.via,
      text,
    });
  }

  return { entries, tokensUsed: Math.ceil(used / CHARS_PER_TOKEN), omitted };
}

export interface DuplicatePair {
  a: { id: string; title: string };
  b: { id: string; title: string };
  similarity: number;
}

export interface EmbeddableItem {
  id: string;
  title: string;
  embedding: number[] | null;
  archived?: boolean;
}

/**
 * Near-duplicate detection over stored embeddings. O(n²) cosine — the
 * caller decides the cap (the MCP tool truncates at 2000 and reports it).
 */
export function findDuplicatePairs(items: EmbeddableItem[], threshold = 0.9): DuplicatePair[] {
  const embedded = items.filter(
    (m): m is EmbeddableItem & { embedding: number[] } => !m.archived && m.embedding !== null,
  );
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < embedded.length; i++) {
    const a = embedded[i]!;
    for (let j = i + 1; j < embedded.length; j++) {
      const b = embedded[j]!;
      const similarity = cosineSimilarity(a.embedding, b.embedding);
      if (similarity >= threshold) {
        pairs.push({
          a: { id: a.id, title: a.title },
          b: { id: b.id, title: b.title },
          similarity,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
