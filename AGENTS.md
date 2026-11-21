# Agent notes

## Verify before push (mandatory)

```sh
npm run lint        # oxlint — zero errors
npm run typecheck   # tsc -b — strict, zero errors
npm run build       # vite production build
npm run format:check
```

## Conventions

- TypeScript strict everywhere. No `as X as Y` chains; non-const assertions
  need a `// SAFETY:` comment with the checked invariant.
- UI: Tailwind utilities first, shadcn/ui components before custom.
  Dark-first theme; keep `prefers-color-scheme` light mode working.
- Committed `.envrc` (direnv). Secrets only in `.env.local` (gitignored).
- No emojis in code or UI.
