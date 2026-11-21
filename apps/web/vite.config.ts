import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Local dev bridge: the web app and the MCP server share ONE JSON document
 * at ~/.galaxy-memory/memories.json. In dev, the web app reads/writes it
 * through these middlewares — so an agent's save_memory shows up in the 3D
 * galaxy without Supabase. Production builds fall back to localStorage.
 */
function localMemoryApi(): Plugin {
  const dbPath = process.env.GALAXY_MEMORY_DB ?? join(homedir(), ".galaxy-memory", "memories.json");
  const mcpServerPath = join(REPO_ROOT, "packages", "mcp-server", "dist", "index.js");

  return {
    name: "galaxy-memory:local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/local-memories", async (req, res) => {
        try {
          if (req.method === "GET") {
            try {
              const raw = await readFile(dbPath, "utf8");
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(raw);
            } catch {
              res.statusCode = 204; // no shared file yet — treat as empty
              res.end();
            }
            return;
          }
          if (req.method === "PUT") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks);
            JSON.parse(body.toString("utf8")); // refuse malformed payloads
            await mkdir(dirname(dbPath), { recursive: true });
            const tmp = `${dbPath}.tmp`;
            await writeFile(tmp, body);
            await rename(tmp, dbPath);
            res.statusCode = 204;
            res.end();
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          );
        }
      });

      server.middlewares.use("/api/gm-status", (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ mcpServerPath, dbPath }));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localMemoryApi()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
