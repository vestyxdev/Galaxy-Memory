import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { clusterColor } from "@/lib/layout";
import { useGalaxy } from "@/stores/galaxy";

export function PagesPanel() {
  const open = useGalaxy((s) => s.pagesOpen);
  const setPagesOpen = useGalaxy((s) => s.setPagesOpen);
  const memories = useGalaxy((s) => s.memories);
  const clusters = useGalaxy((s) => s.clusters);
  const openMemory = useGalaxy((s) => s.openMemory);

  return (
    <Sheet open={open} onOpenChange={setPagesOpen}>
      <SheetContent side="right" className="w-[min(92vw,380px)]">
        <SheetHeader>
          <SheetTitle>Pages</SheetTitle>
          <SheetDescription>
            {memories.length} memories · {clusters.length} clusters
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {memories.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-white/35">
              Nothing captured yet — press N to write your first memory.
            </p>
          )}
          {clusters.map((cluster) => (
            <section key={cluster} className="mb-5">
              <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: clusterColor(cluster) }}
                />
                {cluster}
                <span className="font-normal text-white/25">
                  {memories.filter((m) => m.cluster === cluster).length}
                </span>
              </h2>
              <ul>
                {memories
                  .filter((m) => m.cluster === cluster)
                  .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
                  .map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => openMemory(m.id)}
                        className="group w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5"
                      >
                        <span className="block truncate text-[13px] text-white/80 group-hover:text-white">
                          {m.title}
                        </span>
                        {m.summary && (
                          <span className="mt-0.5 block truncate text-[11px] text-white/35">
                            {m.summary}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-white/10 px-5 py-3">
          <Badge variant="muted">click a page to fly to its node</Badge>
        </div>
      </SheetContent>
    </Sheet>
  );
}
