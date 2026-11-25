import { DEFAULT_CLUSTER } from "./types.js";

/**
 * Obsidian-compatible markdown helpers: YAML-lite frontmatter, #tag
 * extraction, heading-aware chunking for long documents, vault export,
 * and a sync content fingerprint used for idempotent re-ingest.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HASHTAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;

export interface ParsedDocument {
  /** Frontmatter fields, all values as strings (tags stays a string[] via list syntax). */
  frontmatter: Record<string, string>;
  /** Markdown body with the frontmatter block stripped. */
  body: string;
}

/**
 * Parse a leading `---\nkey: value\n---` block. Deliberately YAML-lite:
 * scalar strings, [a, b] inline lists, and "- item" lists are supported —
 * enough for Obsidian vault files without a YAML dependency.
 */
export function parseFrontmatter(markdown: string): ParsedDocument {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: markdown };
  const frontmatter: Record<string, string> = {};
  const lines = (match[1] ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = (kv[2] ?? "").trim();
    if (value === "" || value === "|" || value === ">") {
      // "- item" list or block scalar following the key
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1] ?? "")) {
        items.push((lines[++i] ?? "").replace(/^\s+-\s+/, "").trim());
      }
      if (items.length > 0) frontmatter[key] = items.join(",");
      else frontmatter[key] = "";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .join(",");
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body: markdown.slice(match[0].length) };
}

/** Extract unique #tags from body text (not inside code fences). */
export function extractHashtags(content: string): string[] {
  const withoutCode = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const seen = new Set<string>();
  for (const match of withoutCode.matchAll(HASHTAG_RE)) {
    const tag = match[2]?.trim().replace(/\/$/, "");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export interface MarkdownChunk {
  /** Heading trail preserved from the source document, e.g. "Spec > API". */
  context: string;
  body: string;
}

/**
 * Split a long document into overlapping chunks at heading boundaries.
 * Every chunk carries its heading trail as `context` so an isolated chunk
 * still knows which document/section it came from (RAG context headers).
 * Non-heading paragraphs are packed up to maxChars with `overlap` chars
 * of the previous chunk's tail prepended.
 */
export function chunkMarkdown(
  markdown: string,
  { maxChars = 1600, overlap = 200 }: { maxChars?: number; overlap?: number } = {},
): MarkdownChunk[] {
  const sections: { context: string; text: string }[] = [];
  const trail: string[] = [];
  let current = "";

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (current.trim()) {
        // dense trail — sparse slots ("## " before any "# ") joined as " > X"
        sections.push({ context: trail.filter(Boolean).join(" > "), text: current.trim() });
        current = "";
      }
      const level = heading[1]!.length;
      trail.length = Math.min(trail.length, level - 1);
      trail[level - 1] = heading[2]!.trim();
    } else {
      current += line + "\n";
    }
  }
  if (current.trim())
    sections.push({ context: trail.filter(Boolean).join(" > "), text: current.trim() });

  const chunks: MarkdownChunk[] = [];
  for (const section of sections) {
    if (section.text.length <= maxChars) {
      chunks.push({ context: section.context, body: section.text });
      continue;
    }
    // split oversized sections on paragraph boundaries
    const paragraphs = section.text.split(/\n{2,}/);
    let buf = "";
    for (const p of paragraphs) {
      if (buf && buf.length + p.length + 2 > maxChars) {
        chunks.push({ context: section.context, body: buf.trim() });
        buf = overlap > 0 ? buf.slice(-overlap).trimStart() + "\n\n" : "";
      }
      buf += p + "\n\n";
    }
    if (buf.trim()) chunks.push({ context: section.context, body: buf.trim() });
  }
  return chunks;
}

/**
 * Fingerprint of normalized content for idempotent re-ingest. Two stacked
 * FNV-1a 64-bit hashes (different seeds) — collision space is far beyond
 * any realistic vault size. Isomorphic: no node:crypto in the browser.
 */
export function contentHash(content: string): string {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x9e3779b97f4a7c15n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  for (let i = 0; i < normalized.length; i++) {
    const c = BigInt(normalized.charCodeAt(i));
    h1 = ((h1 ^ c) * FNV_PRIME) & MASK;
    h2 = ((h2 ^ (c + 0x9e3779b9n)) * FNV_PRIME) & MASK;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

/**
 * One-line summary derived from content — first non-heading text line,
 * truncated. Used when a caller rewrites content without supplying a
 * summary, so the stored line doesn't go stale.
 */
export function deriveSummary(content: string): string | null {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

export interface ExportableMemory {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  cluster: string;
  tags: string[];
  source: string;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

const yamlEscape = (v: string) => (/[:#\n[\]{}"']/.test(v) ? JSON.stringify(v) : v);

/** Serialize one memory to an Obsidian-compatible markdown document. */
export function exportMarkdownDocument(m: ExportableMemory): string {
  const tags = m.tags.map((t) => `  - ${t}`).join("\n");
  const fm = [
    "---",
    `title: ${yamlEscape(m.title)}`,
    `cluster: ${yamlEscape(m.cluster)}`,
    tags ? `tags:\n${tags}` : "tags: []",
    `source: ${m.source}`,
    `pinned: ${m.pinned}`,
    `archived: ${m.archived}`,
    `created: ${m.created_at}`,
    `updated: ${m.updated_at}`,
    `id: ${m.id}`,
    "---",
    "",
  ].join("\n");
  return `${fm}# ${m.title}\n\n${m.summary ? `> ${m.summary}\n\n` : ""}${m.content.trim()}\n`;
}

/** Whole-vault export: one markdown file per cluster section. */
export function exportVaultMarkdown(memories: ExportableMemory[]): string {
  const byCluster = new Map<string, ExportableMemory[]>();
  for (const m of memories) {
    const list = byCluster.get(m.cluster) ?? [];
    list.push(m);
    byCluster.set(m.cluster, list);
  }
  const parts: string[] = [];
  for (const [cluster, list] of [...byCluster.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(
      `# ${cluster === DEFAULT_CLUSTER ? cluster : `${cluster}`}`,
      "",
      ...list
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((m) => exportMarkdownDocument(m).replace(/^# /, "## ")),
      "",
    );
  }
  return parts.join("\n");
}
