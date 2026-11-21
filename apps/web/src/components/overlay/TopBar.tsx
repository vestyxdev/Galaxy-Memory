import { BookOpen, Home, SlidersHorizontal } from "lucide-react";

import { StatusBadge } from "@/components/overlay/StatusBadge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useGalaxy, type GraphSettings } from "@/stores/galaxy";

const SETTING_ROWS: { key: keyof GraphSettings; label: string }[] = [
  { key: "showSemanticEdges", label: "Semantic edges" },
  { key: "showLabels", label: "Node labels" },
  { key: "autoRotate", label: "Auto-rotate" },
];

function ViewSwitcher() {
  const settingsOpen = useGalaxy((s) => s.settingsOpen);
  const setSettingsOpen = useGalaxy((s) => s.setSettingsOpen);
  const settings = useGalaxy((s) => s.settings);
  const toggleSetting = useGalaxy((s) => s.toggleSetting);
  const resetCamera = useGalaxy((s) => s.resetCamera);

  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#0c0c10]/70 p-1 backdrop-blur-md">
        <button
          type="button"
          onClick={resetCamera}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white/60 transition-colors hover:text-white"
        >
          <Home className="size-3.5" />
          Home
        </button>
        <div aria-hidden className="h-3.5 w-px bg-white/10" />
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
          aria-label="Graph settings"
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            settingsOpen ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80",
          )}
        >
          <SlidersHorizontal className="size-3.5" />
        </button>
      </div>

      {settingsOpen && (
        <div className="absolute left-1/2 top-full mt-2 w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0c0c10]/95 p-3 shadow-2xl backdrop-blur-md">
          {SETTING_ROWS.map(({ key, label }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-xs text-white/70 hover:bg-white/5"
            >
              {label}
              <Switch checked={settings[key]} onCheckedChange={() => toggleSetting(key)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const count = useGalaxy((s) => s.memories.length);
  const setPagesOpen = useGalaxy((s) => s.setPagesOpen);

  return (
    <header className="relative z-30 flex h-13 shrink-0 items-center justify-between px-5">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight text-white/90">Galaxy-Memory</h1>
        <div className="flex items-center gap-2 text-[11px] text-white/35">
          <span>
            {count} {count === 1 ? "memory" : "memories"}
          </span>
          <span aria-hidden>·</span>
          <StatusBadge />
        </div>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2">
        <ViewSwitcher />
      </div>

      <button
        type="button"
        onClick={() => setPagesOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0c0c10]/70 px-3.5 py-1.5 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
      >
        <BookOpen className="size-3.5" />
        Pages
      </button>
    </header>
  );
}
