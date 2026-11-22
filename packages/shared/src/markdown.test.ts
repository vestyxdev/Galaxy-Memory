import { describe, expect, it } from "vitest";

import type { Memory } from "./types";
import {
  chunkMarkdown,
  contentHash,
  exportMarkdownDocument,
  extractHashtags,
  parseFrontmatter,
} from "./markdown";
import { toWikilink } from "./wikilinks";

describe("parseFrontmatter", () => {
  it("parses key: value pairs between --- fences", () => {
    const doc = "---\ntitle: My Note\ntags: a, b\npinned: true\n---\n# Body\n\ntext";
    const { frontmatter, body } = parseFrontmatter(doc);
    expect(frontmatter.title).toBe("My Note");
    expect(frontmatter.tags).toBe("a, b");
    expect(frontmatter.pinned).toBe("true");
    expect(body.startsWith("# Body")).toBe(true);
  });

  it("parses list-style tags", () => {
    const doc = "---\ntags:\n  - alpha\n  - beta\n---\nbody";
    const { frontmatter } = parseFrontmatter(doc);
    expect(frontmatter.tags).toBe("alpha,beta");
  });

  it("returns empty frontmatter without fences", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a body");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just a body");
  });

  it("handles unclosed or malformed fences", () => {
    const { frontmatter, body } = parseFrontmatter("---\ntitle: x\nno closing fence");
    expect(frontmatter).toEqual({});
    expect(body).toContain("no closing fence");
  });
});

describe("extractHashtags", () => {
  it("pulls #tags from text, dedupes, ignores code blocks", () => {
    const body = "Notes on #ml and #MLOps. `#code` stays code. #ml again.\n```\n#nope\n```";
    const tags = extractHashtags(body);
    expect(tags).toContain("ml");
    expect(tags).toContain("MLOps"); // case is preserved
    expect(tags).not.toContain("code");
    expect(tags).not.toContain("nope");
    expect(tags.filter((t) => t === "ml")).toHaveLength(1);
  });

  it("accepts Czech letters in tags", () => {
    expect(extractHashtags("poznámka o #šifrování dnes")).toContain("šifrování");
  });
});

describe("chunkMarkdown", () => {
  const manySections = Array.from(
    { length: 40 },
    (_, i) => `## Section ${i + 1}\n\n${"lorem ipsum dolor sit amet ".repeat(10)}\n`,
  ).join("\n");

  it("returns a single chunk for short docs", () => {
    const chunks = chunkMarkdown("short text", { maxChars: 1600, overlap: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.body).toBe("short text");
  });

  it("splits at heading boundaries and keeps the heading trail as context", () => {
    const chunks = chunkMarkdown(manySections, { maxChars: 1600, overlap: 200 });
    expect(chunks.length).toBe(40);
    expect(chunks.every((c) => c.body.length <= 1600)).toBe(true);
    expect(chunks[5]!.context).toBe("Section 6");
  });

  it("splits oversized sections at paragraphs with overlap", () => {
    const big =
      "## Big\n\n" +
      Array.from({ length: 8 }, (_, i) => `para-${i} ${"word ".repeat(80)}`).join("\n\n");
    const chunks = chunkMarkdown(big, { maxChars: 800, overlap: 120 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) {
      expect(c.body.length).toBeLessThanOrEqual(800);
      expect(c.context).toBe("Big");
    }
    // overlap: chunk 2 opens with content from the tail of chunk 1
    expect(chunks[0]!.body.includes(chunks[1]!.body.slice(0, 30))).toBe(true);
  });
});

describe("contentHash", () => {
  it("is deterministic and insensitive to whitespace/case", () => {
    const a = contentHash("Hello  World\n\nnew   line");
    const b = contentHash("hello world new line");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8,32}$/);
  });

  it("differs for different content", () => {
    expect(contentHash("alpha")).not.toBe(contentHash("beta"));
  });
});

describe("markdown export", () => {
  const mem: Memory = {
    id: "3f6b1a2c-1234-4abc-9def-0000000000aa",
    title: "Note Title",
    content: "Body text",
    summary: "one-liner",
    cluster: "Research",
    tags: ["x", "y"],
    source: "user",
    pinned: true,
    archived: false,
    content_hash: null,
    embedding: null,
    created_at: "2024-01-02T03:04:05.000Z",
    updated_at: "2024-01-03T03:04:05.000Z",
  };

  it("roundtrips frontmatter fields", () => {
    const md = exportMarkdownDocument(mem);
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.title).toBe("Note Title");
    expect(frontmatter.cluster).toBe("Research");
    expect(frontmatter.pinned).toBe("true");
    expect(frontmatter.archived).toBe("false");
    expect(frontmatter.tags).toBe("x,y");
    expect(frontmatter.id).toBe(mem.id);
    expect(body).toContain("Body text");
    expect(body).toContain("# Note Title");
  });
});

describe("toWikilink", () => {
  it("wraps a title", () => {
    expect(toWikilink("A B")).toBe("[[A B]]");
  });
});
