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

## Commits

- Every commit message ends with:
  `Authored By: vestyyx <128259536+vestyyx@users.noreply.github.com>`
- Windows `cmd.exe`: `;` is NOT a command separator (use `&&`), and `>`
  inside echoed text creates redirect files. Never build commit messages
  with echo subshells — write the message file and use `git commit -F`.

## Testing

- `npm test` runs the MCP stdio probes (save/search/get/delete, hostile
  inputs, corruption quarantine) against an isolated temp db. Requires
  `npm run build` first.
- `scripts/mcp-edge.mjs` is a diagnostic, not an assertion suite — read
  its output, don't gate on ERR lines (expected rejections).
