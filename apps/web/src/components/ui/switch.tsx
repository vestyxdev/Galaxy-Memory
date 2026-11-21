import { Switch } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

function SwitchRoot({ className, ...props }: React.ComponentProps<typeof Switch.Root>) {
  return (
    <Switch.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-white/15 bg-white/10 transition-colors data-[state=checked]:border-white/40 data-[state=checked]:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25",
        className,
      )}
      {...props}
    >
      <Switch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white/60 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-[#0c0c10]" />
    </Switch.Root>
  );
}

export { SwitchRoot as Switch };
