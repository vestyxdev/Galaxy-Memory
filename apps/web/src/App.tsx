import { Suspense, lazy, useEffect } from "react";

import { Dock } from "@/components/overlay/Dock";
import { EditorDrawer } from "@/components/overlay/EditorDrawer";
import { HomePane } from "@/components/overlay/HomePane";
import { PagesPanel } from "@/components/overlay/PagesPanel";
import { SearchPalette } from "@/components/overlay/SearchPalette";
import { TopBar } from "@/components/overlay/TopBar";
import { useGalaxy } from "@/stores/galaxy";

// three.js is ~1 MB — keep it out of the boot chunk; the shell paints first
const SceneRoot = lazy(() =>
  import("@/components/scene/SceneRoot").then((m) => ({ default: m.SceneRoot })),
);

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
      else if (e.key === "Escape") s.clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#030305] text-white">
      {status === "ready" && <TopBar />}

      <div className="flex min-h-0 flex-1">
        {status === "ready" && (
          <aside className="hidden w-[330px] shrink-0 md:block lg:w-[390px]">
            <HomePane />
          </aside>
        )}

        <main className="relative min-w-0 flex-1 overflow-hidden">
          <Suspense fallback={null}>
            <div className="animate-in fade-in absolute inset-0 duration-1000">
              <SceneRoot />
            </div>
          </Suspense>
          {status === "ready" && <Dock />}
          {/* soft inner vignette + left-edge fade into the home pane */}
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_40px_rgba(3,3,5,0.5)]" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-36 bg-gradient-to-r from-[#030305] via-[#030305]/50 to-transparent" />
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
