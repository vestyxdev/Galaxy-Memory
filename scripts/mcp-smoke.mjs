// MCP stdio smoke test: initialize → save_memory → search_memory → verify
// the record persists to the shared JSON file the web bridge serves.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVER = "packages/mcp-server/dist/index.js";
const dbPath = join(homedir(), ".galaxy-memory", "memories.json");

const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const pending = new Map();
let id = 0;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
  });

child.stdout.on("data", (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result ?? msg.error);
      pending.delete(msg.id);
    }
  }
});

const call = (name, args) => send("tools/call", { name, arguments: args });
const text = (r) => r?.content?.[0]?.text ?? "";

const init = await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
console.log("init:", init.serverInfo?.name, init.protocolVersion);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const marker = `Bridge e2e ${Date.now()}`;
const save = await call("save_memory", {
  title: marker,
  content: `Saved over MCP to prove the web bridge shares one file. [[Galaxy-Memory]]`,
  cluster: "Inbox",
  tags: ["e2e"],
});
console.log("save_memory:", text(save).slice(0, 220));

const search = await call("search_memory", { query: "shared file bridge", limit: 3 });
console.log("search_memory:", text(search).slice(0, 400));

child.kill();

const raw = await readFile(dbPath, "utf8");
const state = JSON.parse(raw);
const found = state.memories.find((m) => m.title === marker);
console.log(
  found
    ? `PERSISTED in ${dbPath}: "${found.title}" source=${found.source} edges=${state.edges.filter((e) => e.source_id === found.id || e.target_id === found.id).length}`
    : "NOT FOUND in shared file",
);
process.exit(found ? 0 : 1);
