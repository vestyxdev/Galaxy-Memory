import { EMBEDDING_DIM } from "./types.js";

export interface Embedder {
  /** Provider label for status/debug output. */
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingEnv {
  /** "openai" | "ollama" | "local". Auto-detected when unset. */
  provider?: string;
  openaiApiKey?: string;
  /** Defaults to http://localhost:11434 */
  ollamaUrl?: string;
  openaiModel?: string;
  ollamaModel?: string;
}

/** OpenAI text-embedding-3-small over plain fetch — no SDK dependency. */
function createOpenAIEmbedder(apiKey: string, model: string): Embedder {
  return {
    name: `openai:${model}`,
    async embed(texts) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { data: { embedding: number[] }[] };
      // SAFETY: response shape is fixed by the OpenAI embeddings API contract.
      return body.data.map((d) => d.embedding);
    },
  };
}

/** Local Ollama nomic-embed-text. Output is padded to EMBEDDING_DIM to match the schema. */
function createOllamaEmbedder(baseUrl: string, model: string): Embedder {
  return {
    name: `ollama:${model}`,
    async embed(texts) {
      const res = await fetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { embeddings: number[][] };
      // SAFETY: response shape is fixed by the Ollama /api/embed contract.
      return body.embeddings.map((v) => normalize(padTo(v, EMBEDDING_DIM)));
    },
  };
}

/**
 * Deterministic zero-config embedder for Demo Mode and offline MCP use.
 * Hashed bag-of-words into EMBEDDING_DIM buckets, L2-normalized —
 * real cosine signal for documents that share vocabulary.
 */
export function createLocalEmbedder(): Embedder {
  return {
    name: "local:hash-v1",
    embed(texts) {
      return Promise.resolve(texts.map(hashEmbed));
    },
  };
}

function hashEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    const h = fnv1a(token);
    vec[h % EMBEDDING_DIM]! += 1;
    // a second bucket keyed by a byte-level variant reduces collisions
    vec[(h >>> 8) % EMBEDDING_DIM]! += 0.35;
  }
  return normalize(vec);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function padTo(v: number[], dim: number): number[] {
  if (v.length === dim) return v;
  const out = new Array<number>(dim).fill(0);
  for (let i = 0; i < Math.min(v.length, dim); i++) out[i] = v[i]!;
  return out;
}

function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  if (norm === 0) return v;
  const inv = 1 / Math.sqrt(norm);
  return v.map((x) => x * inv);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Pick an embedder from environment-shaped config.
 * openai key wins; explicit provider overrides detection; local is the fallback.
 */
export function createEmbedder(env: EmbeddingEnv): Embedder {
  const provider = env.provider ?? (env.openaiApiKey ? "openai" : "local");
  if (provider === "openai") {
    if (!env.openaiApiKey) throw new Error("EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY");
    return createOpenAIEmbedder(env.openaiApiKey, env.openaiModel ?? "text-embedding-3-small");
  }
  if (provider === "ollama") {
    return createOllamaEmbedder(
      env.ollamaUrl ?? "http://localhost:11434",
      env.ollamaModel ?? "nomic-embed-text",
    );
  }
  return createLocalEmbedder();
}
