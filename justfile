# Galaxy-Memory task runner — `just --list` shows recipes
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# Build shared package, then start the Vite dev server (demo mode works with no env)
dev:
    npm run dev

# Lint everything (oxlint)
lint:
    npm run lint

# Typecheck all workspace projects (strict tsc project refs)
typecheck:
    npx tsc -b

# Format all files in place (oxfmt)
format:
    npm run format

# Lint + typecheck + production build — run before every push
check: lint typecheck
    npm run build

# Start the MCP server locally (builds shared + server first)
mcp:
    npm run mcp

# Preview the production web build
preview:
    npm run preview
