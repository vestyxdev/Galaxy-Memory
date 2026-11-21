import { Focus, Plus, Search } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useGalaxy } from "@/stores/galaxy";

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

function DockButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white",
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
    <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[#0c0c10]/70 p-1.5 shadow-2xl backdrop-blur-md">
        <DockButton onClick={openNewMemory}>
          <Plus className="size-3.5" />
          New Memory
        </DockButton>
        <DockButton onClick={() => setSearchOpen(true)}>
          <Search className="size-3.5" />
          Search
          <kbd className="ml-1 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-normal text-white/40">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </DockButton>
        <DockButton onClick={resetCamera}>
          <Focus className="size-3.5" />
          Reset Camera
        </DockButton>
      </div>
    </div>
  );
}
