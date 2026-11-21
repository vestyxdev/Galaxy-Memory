import { LocateFixed, Plus, Search } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useGalaxy } from "@/stores/galaxy";

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

function DockButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center justify-center rounded-full p-2.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

export function Dock() {
  const openNewMemory = useGalaxy((s) => s.openNewMemory);
  const setSearchOpen = useGalaxy((s) => s.setSearchOpen);
  const resetCamera = useGalaxy((s) => s.resetCamera);

  return (
    <div className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[#0c0c10]/70 p-1 shadow-2xl backdrop-blur-md">
        <DockButton onClick={openNewMemory} title="New memory (N)">
          <Plus className="size-4" />
        </DockButton>
        <DockButton
          onClick={() => setSearchOpen(true)}
          title={`Search (/ or ${isMac ? "⌘" : "Ctrl"}+K)`}
        >
          <Search className="size-4" />
        </DockButton>
        <DockButton onClick={resetCamera} title="Reset camera (R)">
          <LocateFixed className="size-4" />
        </DockButton>
      </div>
    </div>
  );
}
