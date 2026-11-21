import { useEffect } from "react";

import { Dock } from "@/components/overlay/Dock";
import { EditorDrawer } from "@/components/overlay/EditorDrawer";
import { PagesPanel } from "@/components/overlay/PagesPanel";
import { SearchPalette } from "@/components/overlay/SearchPalette";
import { TopBar } from "@/components/overlay/TopBar";
import { SceneRoot } from "@/components/scene/SceneRoot";
import { useGalaxy } from "@/stores/galaxy";

function App() {
  const status = useGalaxy((s) => s.status);
  const error = useGalaxy((s) => s.error);
  const init = useGalaxy((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useGalaxy.getState().setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050507] text-white">
      <SceneRoot />

      {status === "ready" && (
        <>
          <TopBar />
          <Dock />
          <PagesPanel />
          <SearchPalette />
          <EditorDrawer />
        </>
      )}

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
          <p className="animate-pulse text-xs tracking-wide text-white/40">
            assembling the galaxy…
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-40 grid place-items-center">
          <div className="max-w-sm rounded-xl border border-white/10 bg-[#0c0c10]/90 p-6 text-center backdrop-blur-md">
            <p className="text-sm font-medium text-white/85">Failed to load memories</p>
            <p className="mt-2 text-xs leading-relaxed text-white/45">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
