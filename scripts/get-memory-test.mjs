// Verify the get_memory MCP tool returns full content + connections.
import { spawn } from "node:child_process";

const server = spawn("node", ["packages/mcp-server/dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let savedId = "";
server.stdout.on("data", (d) => {
  buf += d;
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 1) {
      const saved = JSON.parse(msg.result.content[0].text);
      savedId = saved.id;
      console.log("SAVE ok:", saved.id, "| summary:", JSON.stringify(saved.summary));
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_memory", arguments: { id: saved.id } },
      });
    } else if (msg.id === 2) {
      const m = JSON.parse(msg.result.content[0].text);
      console.log(
        "GET_MEMORY keys:",
        Object.keys(m).join(","),
        "| title:",
        m.title,
        "| connections:",
        (m.connections ?? []).length,
        "| content len:",
        m.content?.length,
      );
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_memory",
          arguments: { id: "00000000-0000-0000-0000-000000000000" },
        },
      });
    } else if (msg.id === 3) {
      const r = msg.result?.content?.[0]?.text ?? "";
      console.log("GET_MEMORY missing id ->", r.slice(0, 80));
      send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "delete_memory", arguments: { id: savedId } },
      });
    } else if (msg.id === 4) {
      const r = msg.result?.content?.[0]?.text ?? "";
      console.log("DELETE cleanup ->", r.slice(0, 80));
      server.kill();
      process.exit(0);
    }
  }
});

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

send({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "get-test", version: "1" },
  },
});

setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "save_memory",
      arguments: {
        title: "Get-memory probe [[Greeting workflow]]",
        content: "Verifies get_memory returns the full document and its connections.",
        summary: "Probe summary",
        cluster: "Inbox",
      },
    },
  });
}, 300);

setTimeout(() => {
  console.log("TIMEOUT");
  server.kill();
  process.exit(1);
}, 15000);
