// `npm test` — runs every MCP stdio probe against an isolated temp db.
// Requires `npm run build` first (probes spawn packages/mcp-server/dist).
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gm-test-"));
process.env.GALAXY_MEMORY_DB = join(dir, "memories.json");
console.log("isolated db:", process.env.GALAXY_MEMORY_DB);

const probes = [
  "scripts/mcp-smoke.mjs",
  "scripts/get-memory-test.mjs",
  "scripts/mcp-edge.mjs",
  "scripts/corrupt-test.mjs",
];

for (const probe of probes) {
  console.log(`\n=== ${probe} ===`);
  const r = spawnSync("node", [probe], { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`FAILED ${probe} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}
console.log("\nall probes passed");
