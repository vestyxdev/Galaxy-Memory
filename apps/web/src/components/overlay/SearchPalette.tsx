import { FileText, Search } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hybridSearch, type HybridMatch, type MemoryMatch } from "@galaxy-memory/shared";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { clusterColor } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { useGalaxy } from "@/stores/galaxy";

interface Result {
  match: MemoryMatch;
  via: HybridMatch["via"] | null;
}

export function SearchPalette() {
  const open = useGalaxy((s) => s.searchOpen);
  const setSearchOpen = useGalaxy((s) => s.setSearchOpen);
  const setHighlight = useGalaxy((s) => s.setHighlight);
  const setHovered = useGalaxy((s) => s.setHovered);
  const openMemory = useGalaxy((s) => s.openMemory);
  const memories = useGalaxy((s) => s.memories);
  const backend = useGalaxy((s) => s.backend);
  const embedder = useGalaxy((s) => s.embedder);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // empty query → recent captures so the palette is useful before typing
  const recent = useMemo<Result[]>(
    () =>
      [...memories]
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
        .slice(0, 6)
        .map((m) => ({ match: { ...m, similarity: 0 }, via: null })),
    [memories],
  );
  const list = query.trim() ? results : recent;

  // hybrid retrieval (FTS + vector + RRF); matching nodes light up as you type
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        let merged: Result[] = [];
        if (backend && embedder) {
          try {
            merged = (await hybridSearch(backend, embedder, q, { limit: 10 })).map((m) => ({
              match: m,
              via: m.via,
            }));
          } catch {
            // backend hiccup — leave the list empty rather than crash the palette
          }
        }
        if (cancelled) return;
        setResults(merged);
        setActive(0);
        setHighlight(new Set(merged.map((r) => r.match.id)));
      })();
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, backend, embedder, setHighlight]);

  const pick = useCallback(
    (id: string) => {
      setSearchOpen(false);
      setHighlight(null);
      setHovered(null);
      setQuery("");
      openMemory(id);
    },
    [openMemory, setHighlight, setHovered, setSearchOpen],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown" ? Math.min(active + 1, list.length - 1) : Math.max(active - 1, 0);
      setActive(next);
      setHovered(list[next]?.match.id ?? null);
    } else if (e.key === "Enter" && list[active]) {
      e.preventDefault();
      pick(list[active].match.id);
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setSearchOpen(o);
        if (!o) {
          setHighlight(null);
          setHovered(null);
          setQuery("");
        }
      }}
    >
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Search memories</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <Search className="size-4 shrink-0 text-white/40" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) {
                setResults([]);
                setHighlight(null);
              }
            }}
            onKeyDown={onKeyDown}
            placeholder="Search memories semantically…"
            className="flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/30"
          />
          <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {query.trim() && results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-white/35">
              No memories match “{query}”.
            </p>
          )}
          {!query.trim() && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-white/25">
                Recent captures
              </p>
              {recent.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-white/35">
                  No memories yet — press N to capture one.
                </p>
              )}
            </>
          )}
          {list.map((r, i) => (
            <button
              key={r.match.id}
              type="button"
              data-index={i}
              onClick={() => pick(r.match.id)}
              onMouseEnter={() => {
                setActive(i);
                setHovered(r.match.id);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                i === active ? "bg-white/10" : "hover:bg-white/5",
              )}
            >
              <FileText className="size-4 shrink-0 text-white/30" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-white/85">{r.match.title}</span>
                <span className="block truncate text-[11px] text-white/35">
                  {r.match.summary ?? r.match.content.slice(0, 80)}
                </span>
              </span>
              {r.via && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-white/10 text-[9px] text-white/35"
                >
                  {r.via}
                </Badge>
              )}
              {r.match.similarity > 0 && (
                <span className="text-[10px] tabular-nums text-white/35">
                  {Math.round(r.match.similarity * 100)}%
                </span>
              )}
              <Badge
                variant="outline"
                style={{ color: clusterColor(r.match.cluster) }}
                className="shrink-0 border-white/10"
              >
                {r.match.cluster}
              </Badge>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
