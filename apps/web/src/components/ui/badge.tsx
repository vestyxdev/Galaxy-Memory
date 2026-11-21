import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & {
  variant?: "default" | "outline" | "muted";
}) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        variant === "default" && "border border-white/15 bg-white/10 text-white/80",
        variant === "outline" && "border border-white/15 text-white/60",
        variant === "muted" && "bg-white/5 text-white/50",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
