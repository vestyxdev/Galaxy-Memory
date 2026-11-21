import { marked } from "marked";
import { Link2, Trash2 } from "lucide-react";
import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { Memory, MemoryEdge } from "@galaxy-memory/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { clusterColor } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { useGalaxy } from "@/stores/galaxy";

function deriveSummary(content: string): string | null {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

interface LinkAc {
  /** index of the "[[" that opened this autocomplete */
  start: number;
  caret: number;
  prefix: string;
}

interface Connection {
  id: string;
  title: string;
  edge_type: MemoryEdge["edge_type"];
  weight: number;
}

export function EditorDrawer() {
  const open = useGalaxy((s) => s.drawerOpen);
  const closeDrawer = useGalaxy((s) => s.closeDrawer);
  const editingId = useGalaxy((s) => s.editingId);
  const memories = useGalaxy((s) => s.memories);

  const memory = editingId ? memories.find((m) => m.id === editingId) : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeDrawer()}>
      <SheetContent side="right" className="w-[min(94vw,540px)] gap-0">
        <SheetHeader className="pr-10">
          <SheetTitle>{memory ? "Edit memory" : "New memory"}</SheetTitle>
          <SheetDescription>
            {memory
              ? `${memory.cluster} · updated ${new Date(memory.updated_at).toLocaleDateString()}`
              : "Saved memories get embedded and linked into the galaxy."}
          </SheetDescription>
        </SheetHeader>
        {/* key remounts the form per target — no sync effect needed */}
        <EditorForm key={editingId ?? "new"} memory={memory} />
      </SheetContent>
    </Sheet>
  );
}

function EditorForm({ memory }: { memory: Memory | undefined }) {
  const editingId = useGalaxy((s) => s.editingId);
  const memories = useGalaxy((s) => s.memories);
  const edges = useGalaxy((s) => s.edges);
  const clusters = useGalaxy((s) => s.clusters);
  const saveMemory = useGalaxy((s) => s.saveMemory);
  const deleteMemory = useGalaxy((s) => s.deleteMemory);
  const closeDrawer = useGalaxy((s) => s.closeDrawer);
  const openMemory = useGalaxy((s) => s.openMemory);

  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [cluster, setCluster] = useState(memory?.cluster ?? "");
  const [tags, setTags] = useState(memory?.tags.join(", ") ?? "");
  const [view, setView] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ac, setAc] = useState<LinkAc | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const connections = useMemo<Connection[]>(() => {
    if (!editingId) return [];
    const titleOf = new Map(memories.map((m) => [m.id, m.title]));
    return edges
      .filter((e) => e.source_id === editingId || e.target_id === editingId)
      .map((e) => {
        const other = e.source_id === editingId ? e.target_id : e.source_id;
        return {
          id: other,
          title: titleOf.get(other) ?? other,
          edge_type: e.edge_type,
          weight: e.weight,
        };
      });
  }, [edges, editingId, memories]);

  const acSuggestions = useMemo(() => {
    if (!ac) return [];
    const p = ac.prefix.toLowerCase();
    return memories
      .filter((m) => m.id !== editingId && m.title.toLowerCase().includes(p))
      .slice(0, 6);
  }, [ac, memories, editingId]);

  // detect an open "[[prefix" right before the caret
  const detectAc = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const start = before.lastIndexOf("[[");
    if (start < 0) return null;
    const fragment = before.slice(start + 2);
    if (fragment.includes("]") || fragment.includes("\n")) return null;
    return { start, caret, prefix: fragment } satisfies LinkAc;
  };

  const insertWikilink = useCallback(
    (target: string) => {
      if (!ac || !taRef.current) return;
      const next = `${content.slice(0, ac.start)}[[${target}]]${content.slice(ac.caret)}`;
      setContent(next);
      setAc(null);
      requestAnimationFrame(() => {
        const pos = ac.start + target.length + 4;
        taRef.current?.setSelectionRange(pos, pos);
        taRef.current?.focus();
      });
    },
    [ac, content],
  );

  const onContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setAc(detectAc(e.target.value, e.target.selectionStart));
    setAcIndex(0);
  };

  const onContentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void save();
      return;
    }
    if (!ac || acSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAcIndex((i) => Math.min(i + 1, acSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAcIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const s = acSuggestions[acIndex];
      if (s) insertWikilink(s.title);
    } else if (e.key === "Escape") {
      setAc(null);
    }
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await saveMemory(
        {
          title: title.trim(),
          content,
          summary: memory?.summary ?? deriveSummary(content),
          cluster: cluster.trim() || undefined,
          tags: parseTags(tags),
        },
        editingId,
      );
    } finally {
      setSaving(false);
    }
  };

  const previewHtml = useMemo(
    () => (view === "preview" ? marked.parse(content, { async: false }) : ""),
    [view, content],
  );

  return (
    <>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="h-10 border-white/10 bg-transparent text-base font-medium"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/40">Cluster</label>
            <Input
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              placeholder="General"
              list="gm-cluster-options"
            />
            <datalist id="gm-cluster-options">
              {clusters.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/40">
              Tags <span className="text-white/25">(comma separated)</span>
            </label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="project, idea"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-full border border-white/10 p-0.5">
            {(["write", "preview"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                  view === v ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-white/30">[[wikilinks]] create edges</span>
        </div>

        <div className="relative flex-1">
          {view === "write" ? (
            <>
              <Textarea
                ref={taRef}
                value={content}
                onChange={onContentChange}
                onKeyDown={onContentKeyDown}
                onBlur={() => setTimeout(() => setAc(null), 150)}
                placeholder={"Markdown…\n\nLink notes with [[Other Title]]."}
                className="h-full min-h-[240px] resize-none font-mono text-[13px] leading-relaxed"
              />
              {ac && acSuggestions.length > 0 && (
                <div className="absolute left-2 top-2 z-10 w-64 overflow-hidden rounded-md border border-white/10 bg-[#121218] shadow-xl">
                  {acSuggestions.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertWikilink(s.title);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                        i === acIndex ? "bg-white/10 text-white" : "text-white/60",
                      )}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: clusterColor(s.cluster) }}
                      />
                      <span className="truncate">{s.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div
              className="gm-markdown h-full min-h-[240px] overflow-y-auto rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              // SAFETY: content is authored by the local user in this same app;
              // marked output is rendered unmodified as the preview contract.
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </div>

        {connections.length > 0 && (
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-white/40">
              <Link2 className="size-3" />
              Connected memories
            </h3>
            <ul className="space-y-0.5">
              {connections.map((c) => (
                <li key={`${c.id}-${c.edge_type}`}>
                  <button
                    type="button"
                    onClick={() => openMemory(c.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <Badge variant="muted">
                      {c.edge_type}
                      {c.edge_type === "semantic" && ` ${Math.round(c.weight * 100)}%`}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
        {memory && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              await deleteMemory(memory.id);
            }}
            className={cn(
              "text-white/45 hover:text-white",
              confirmDelete && "text-red-300 hover:text-red-200",
            )}
          >
            <Trash2 className="size-3.5" />
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        )}
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={closeDrawer}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || !title.trim() || !content.trim()}
          onClick={() => void save()}
          className="bg-white/90 text-black hover:bg-white"
        >
          {saving ? "Saving…" : memory ? "Save changes" : "Save memory"}
        </Button>
      </div>
    </>
  );
}
