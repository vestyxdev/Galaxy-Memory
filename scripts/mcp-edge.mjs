// Edge-case probe for the MCP server — feeds invalid/hostile inputs and
// prints what each tool actually returns. Not a gate; a diagnostic.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = "packages/mcp-server/dist/index.js";
const child = spawn("node", [SERVER], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, GALAXY_MEMORY_DB: join(tmpdir(), "gm-edge-test.json") },
});
let buf = "";
const pending = new Map();
let id = 0;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 20000);
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
const head = (r) => (r?.content?.[0]?.text ?? JSON.stringify(r)).slice(0, 140);

await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "edge", version: "0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const T = async (label, name, args) => {
  const r = await call(name, args);
  console.log(`${r?.isError ? "ERR " : "ok  "}${label.padEnd(34)} → ${head(r)}`);
};

await T("empty title", "save_memory", { title: "", content: "x" });
await T("empty content", "save_memory", { title: "x", content: "" });
await T("whitespace title", "save_memory", { title: "   ", content: "x" });
await T("missing fields", "save_memory", {});
await T("special chars", "save_memory", {
  title: "Spec <>&\"'%_* [[link]]",
  content: "body %_ * \\ unicode ",
  cluster: "T",
});
await T("bad uuid update", "update_memory", { id: "not-a-uuid", title: "x" });
await T("nonexistent update", "update_memory", {
  id: "00000000-0000-4000-8000-000000000000",
  title: "x",
});
await T("bad uuid delete", "delete_memory", { id: "nope" });
await T("nonexistent delete", "delete_memory", {
  id: "00000000-0000-4000-8000-000000000000",
});
await T("empty search", "search_memory", { query: "" });
await T("huge query", "search_memory", { query: "x".repeat(50000) });
await T("ctx bad id", "get_memory_context", { id: "zzz" });
await T("ctx nonexistent", "get_memory_context", {
  id: "00000000-0000-4000-8000-000000000000",
});
await T("dup titles x2", "save_memory", { title: "Dup", content: "first" });
await T("dup titles x2 (2nd)", "save_memory", { title: "Dup", content: "second" });
const big = "lorem ".repeat(40000); // ~240 KB markdown
await T("240KB content", "save_memory", { title: "Big", content: big });
await T("self-link", "save_memory", {
  title: "SelfLink",
  content: "I link to [[SelfLink]] myself",
});
await T("list_clusters", "list_clusters", {});

child.kill();
