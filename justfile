# Galaxy-Memory task runner — `just --list` shows recipes
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# Start the Vite dev server
dev:
    npm run dev

# Lint (oxlint)
lint:
    npm run lint

# Typecheck (strict tsc project refs)
typecheck:
    npx tsc -b

# Format all files in place (oxfmt)
format:
    npm run format

# Lint + typecheck + production build — run before every push
check: lint typecheck
    npm run build

# Preview the production build locally
preview:
    npm run preview
