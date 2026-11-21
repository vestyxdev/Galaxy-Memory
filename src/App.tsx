import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="starfield relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 text-center">
      {/* soft violet nebula glow behind the wordmark */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-3xl"
      />

      <p className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground backdrop-blur">
        New project
      </p>

      <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
        Galaxy Memory
      </h1>

      <p className="mt-4 max-w-md text-balance text-base text-muted-foreground sm:text-lg">
        A fresh scaffold. React, Vite, Tailwind and shadcn/ui are wired up and ready for whatever
        this becomes.
      </p>

      <div className="mt-8">
        <Button asChild variant="secondary">
          <a href="https://github.com/vestyxdev/Galaxy-Memory" target="_blank" rel="noreferrer">
            <ArrowUpRight className="size-4" />
            View on GitHub
          </a>
        </Button>
      </div>

      <footer className="absolute bottom-6 text-xs text-muted-foreground/70">
        React 19 · Vite 8 · Tailwind v4 · shadcn/ui
      </footer>
    </main>
  );
}

export default App;
