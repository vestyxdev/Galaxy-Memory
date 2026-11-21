import { useEffect } from "react";

import { Dock } from "@/components/overlay/Dock";
import { EditorDrawer } from "@/components/overlay/EditorDrawer";
import { HomePane } from "@/components/overlay/HomePane";
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
      const s = useGalaxy.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setSearchOpen(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      if (s.drawerOpen || s.searchOpen || s.pagesOpen) return;
      if (e.key === "n") s.openNewMemory();
      else if (e.key === "/") {
        e.preventDefault();
        s.setSearchOpen(true);
      } else if (e.key === "r") s.resetCamera();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#050507] text-white">
      {status === "ready" && <TopBar />}

      <div className="flex min-h-0 flex-1">
        {status === "ready" && (
          <aside className="hidden w-[330px] shrink-0 md:block lg:w-[390px]">
            <HomePane />
          </aside>
        )}

        <main className="relative min-w-0 flex-1 overflow-hidden md:m-2.5 md:ml-0 md:rounded-2xl md:border md:border-white/10">
          <SceneRoot />
          {status === "ready" && <Dock />}
          {/* soft inner vignette over the viewport edges */}
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_40px_rgba(5,5,7,0.55)]" />
        </main>
      </div>

      {status === "ready" && (
        <>
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
