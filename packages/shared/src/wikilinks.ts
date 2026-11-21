const WIKILINK_RE = /\[\[([^\][|]+)(?:\|[^\][]*)?\]\]/g;

/**
 * Extract unique [[Note Title]] targets from markdown content.
 * Supports the [[Title|alias]] form — the alias is ignored.
 */
export function extractWikilinks(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(WIKILINK_RE)) {
    const title = match[1]?.trim();
    if (title) seen.add(title);
  }
  return [...seen];
}

/** Wrap a title in wikilink syntax. */
export function toWikilink(title: string): string {
  return `[[${title}]]`;
}
