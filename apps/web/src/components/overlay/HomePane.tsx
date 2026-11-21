import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { env } from "@/lib/env";
import { greeting } from "@/lib/greeting";
import { formatSince, readLastVisit, stampLastVisit } from "@/lib/lastvisit";
import { useGalaxy } from "@/stores/galaxy";

const DRAFT_KEY = "gm:scratchpad";

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Home pane — big greeting, "since you were last here", and a minimal
 * line-numbered scratchpad. Ctrl+Enter files the buffer as a memory.
 */
export function HomePane() {
  const [lastVisit] = useState<number | null>(readLastVisit);
  const [draft, setDraft] = useState(readDraft);
  const [saving, setSaving] = useState(false);
  const gutterRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const saveMemory = useGalaxy((s) => s.saveMemory);
  const memoryCount = useGalaxy((s) => s.memories.length);
  const clusterCount = useGalaxy((s) => s.clusters.length);
  const edgeCount = useGalaxy((s) => s.edges.length);

  useEffect(() => {
    stampLastVisit();
  }, []);

  const lines = draft.split("\n").length;

  const syncScroll = () => {
    if (gutterRef.current && textRef.current) {
      gutterRef.current.scrollTop = textRef.current.scrollTop;
    }
  };

  const saveDraft = (value: string) => {
    setDraft(value);
    try {
      localStorage.setItem(DRAFT_KEY, value);
    } catch {
      // storage unavailable — draft lives in state only
    }
  };

  const fileAsMemory = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
      const title = firstLine.replace(/^#+\s*/, "").slice(0, 60) || "Scratch note";
      await saveMemory({ title, content, cluster: "Inbox", tags: ["scratchpad"] }, null);
      saveDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col px-9 pb-8 pt-9">
      <div>
        <h2 className="text-[34px] font-light leading-tight tracking-tight text-white/90">
          {greeting(env.userName)}
        </h2>
        <p className="mt-2 text-[13px] text-white/35">
          {lastVisit
            ? `Since you were last here — ${formatSince(lastVisit)} ago.`
            : "Welcome — this is your first visit."}
        </p>
        <p className="mt-4 text-[11px] tracking-wide text-white/22">
          {memoryCount} {memoryCount === 1 ? "memory" : "memories"}
          <span aria-hidden className="mx-1.5">
            ·
          </span>
          {clusterCount} {clusterCount === 1 ? "cluster" : "clusters"}
          <span aria-hidden className="mx-1.5">
            ·
          </span>
          {edgeCount} {edgeCount === 1 ? "connection" : "connections"}
        </p>
      </div>

      <div className="mt-9 flex min-h-0 flex-1 flex-col">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-white/25">
          Scratchpad
        </p>
        <div className="relative min-h-0 flex-1">
          <div
            ref={gutterRef}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-7 select-none overflow-hidden text-right font-mono text-[13px] leading-6 text-white/20"
          >
            {Array.from({ length: lines }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => saveDraft(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void fileAsMemory();
              }
            }}
            placeholder="Write something…"
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent pl-11 font-mono text-[13px] leading-6 text-white/80 placeholder:text-white/25 focus:outline-none"
          />
        </div>

        <div className="mt-4 flex items-center justify-between text-[11px] text-white/30">
          <span>autosaved locally</span>
          <button
            type="button"
            onClick={() => void fileAsMemory()}
            disabled={!draft.trim() || saving}
            className="group flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-white/50 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/50"
          >
            File to galaxy
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
