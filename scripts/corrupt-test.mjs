// Corruption quarantine check: poison the db file, then run a real
// save_memory through the MCP server and verify the backup appears.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = tmpdir();
const db = join(tmp, "gm-corrupt-test.json");
writeFileSync(db, "{broken json!!!");
console.log("poisoned", db);

const c = spawn("node", ["packages/mcp-server/dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, GALAXY_MEMORY_DB: db },
});
let out = "";
c.stdout.on("data", (d) => {
  out += d;
});
c.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    },
  }) + "\n",
);
setTimeout(() => {
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  c.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "save_memory",
        arguments: { title: "post-corruption", content: "recovered write" },
      },
    }) + "\n",
  );
}, 800);
setTimeout(() => {
  c.kill();
  const backups = readdirSync(tmp).filter((f) => f.startsWith("gm-corrupt-test.json.corrupt"));
  console.log("quarantined backups:", backups);
  console.log("new db head:", readFileSync(db, "utf8").slice(0, 160));
  console.log("save response tail:", out.slice(-200));
  process.exit(backups.length > 0 ? 0 : 1);
}, 5000);
