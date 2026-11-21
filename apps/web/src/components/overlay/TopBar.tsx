import { BookOpen, Map, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { env } from "@/lib/env";
import { greeting } from "@/lib/greeting";
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

  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#0c0c10]/70 p-1 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setSettingsOpen(false)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            !settingsOpen ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80",
          )}
        >
          <Map className="size-3.5" />
          3D Map
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            settingsOpen ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80",
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Graph Settings
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
  const mode = useGalaxy((s) => s.mode);
  const setPagesOpen = useGalaxy((s) => s.setPagesOpen);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-5">
      <div className="pointer-events-auto">
        <h1 className="text-sm font-semibold tracking-tight text-white/90">Galaxy-Memory</h1>
        <p className="mt-0.5 text-xs text-white/45">{greeting(env.userName)}</p>
        <p className="mt-1.5 flex items-center gap-2 text-[11px] text-white/35">
          <span>
            {count} {count === 1 ? "memory" : "memories"}
          </span>
          <span aria-hidden>·</span>
          <Badge variant={mode === "demo" ? "outline" : "default"}>
            {mode === "demo" ? "Demo" : "Supabase"} sync
          </Badge>
        </p>
      </div>

      <div className="pointer-events-auto absolute left-1/2 top-5 -translate-x-1/2">
        <ViewSwitcher />
      </div>

      <button
        type="button"
        onClick={() => setPagesOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0c0c10]/70 px-3.5 py-1.5 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
      >
        <BookOpen className="size-3.5" />
        Pages
      </button>
    </header>
  );
}
