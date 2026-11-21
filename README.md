# Galaxy Memory

Work in progress. The project direction is not decided yet — this is the
production-grade scaffold it will grow from.

## Stack

- **React 19 + Vite 8 + TypeScript** (strict: `strict`, `noUncheckedIndexedAccess`)
- **Tailwind CSS v4** + **shadcn/ui** (new-york, CSS variables, `@/` alias)
- **oxlint** for lint, **oxfmt** for format — never ESLint/Prettier
- Dark-first theme with automatic light mode via `prefers-color-scheme`

## Quickstart

```sh
npm install
npm run dev
```

## Commands

| Command                           | What it does                 |
| --------------------------------- | ---------------------------- |
| `npm run dev`                     | Vite dev server              |
| `npm run build`                   | `tsc -b` + production build  |
| `npm run lint`                    | oxlint                       |
| `npm run typecheck`               | strict tsc over project refs |
| `npm run format` / `format:check` | oxfmt write / check          |

A `justfile` mirrors these (`just dev`, `just lint`, `just check`) for anyone
with `just` installed.

## Conventions

- `lefthook.yml` enforces lint + format + typecheck + build on `git push`
  (run `lefthook install` once per clone).
- `.envrc` is committed for direnv; real secrets go in `.env.local`
  (gitignored — see `.env.example`).
- CI (`.github/workflows/ci.yml`) runs lint → format check → build.
- Add shadcn components with `npx shadcn@latest add <component>`.
