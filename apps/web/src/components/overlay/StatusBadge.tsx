import { Check, Copy, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/env";
import { useGalaxy } from "@/stores/galaxy";

function embedderLabel(name: string): string {
  if (name.startsWith("openai:")) return `OpenAI ${name.slice(7)}`;
  if (name.startsWith("ollama:")) return `Ollama ${name.slice(7)}`;
  return "Local hash (deterministic)";
}

interface BridgeStatus {
  mcpServerPath?: string;
  dbPath?: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-1 py-1">
      <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-white/30">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[11px] text-white/70" title={value}>
        {value}
      </span>
    </div>
  );
}

/** Clickable sync badge → backend/embedder status + MCP setup snippet. */
export function StatusBadge() {
  const mode = useGalaxy((s) => s.mode);
  const backendLabel = useGalaxy((s) => s.backendLabel);
  const storage = useGalaxy((s) => s.storage);
  const embedderName = useGalaxy((s) => s.embedderName);
  const backend = useGalaxy((s) => s.backend);

  const [open, setOpen] = useState(false);
  const [bridge, setBridge] = useState<BridgeStatus>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !import.meta.env.DEV) return;
    fetch("/api/gm-status")
      .then((r) => (r.ok ? (r.json() as Promise<BridgeStatus>) : {}))
      .then(setBridge)
      .catch(() => setBridge({}));
  }, [open]);

  const mcpConfig = {
    mcpServers: {
      "galaxy-memory": {
        command: "node",
        args: [bridge.mcpServerPath ?? "<repo>/packages/mcp-server/dist/index.js"],
        ...(mode === "supabase"
          ? {
              env: {
                SUPABASE_URL: env.supabaseUrl ?? "<supabase-url>",
                SUPABASE_SERVICE_ROLE_KEY: "<service-role-key>",
              },
            }
          : {}),
      },
    },
  };
  const configText = JSON.stringify(mcpConfig, null, 2);

  const testConnection = async () => {
    if (!backend || testing) return;
    setTesting(true);
    setTestResult(null);
    const t0 = performance.now();
    try {
      const clusters = await backend.listClusters();
      const ms = Math.round(performance.now() - t0);
      setTestResult({ ok: true, text: `Connected — ${clusters.length} clusters, ${ms} ms` });
    } catch (error) {
      setTestResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(configText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable (insecure context) — select manually instead
    }
  };

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="System status & MCP setup"
        className="rounded-full transition-transform hover:scale-[1.04]"
      >
        <Badge variant={mode === "demo" ? "outline" : "default"}>
          {mode === "demo" ? "Demo" : "Supabase"} sync
        </Badge>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[21rem] rounded-xl border border-white/10 bg-[#0c0c10]/95 p-3.5 shadow-2xl backdrop-blur-md">
          <div className="flex flex-col">
            <Row label="Backend" value={backendLabel} />
            <Row label="Storage" value={storage || "—"} />
            <Row label="Embedder" value={embedderLabel(embedderName)} />
            {bridge.dbPath && <Row label="Shared file" value={bridge.dbPath} />}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <PlugZap className="size-3" />
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult && (
              <span
                className={`truncate text-[11px] ${testResult.ok ? "text-emerald-400/80" : "text-red-400/80"}`}
                title={testResult.text}
              >
                {testResult.text}
              </span>
            )}
          </div>

          <div className="mt-3 border-t border-white/10 pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                MCP config
              </span>
              <button
                type="button"
                onClick={() => void copyConfig()}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                {copied ? (
                  <Check className="size-3 text-emerald-400" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-44 overflow-auto rounded-lg border border-white/10 bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-white/60">
              {configText}
            </pre>
            <p className="mt-1.5 text-[10px] leading-snug text-white/30">
              Paste into your agent's MCP config
              {import.meta.env.DEV
                ? " — paths resolved for this machine."
                : " — set the built server path first."}
            </p>
          </div>
        </div>
      )}
    </span>
  );
}
