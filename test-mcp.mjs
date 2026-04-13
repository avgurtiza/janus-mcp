#!/usr/bin/env node
import { spawn } from "child_process";

const server = spawn("node", ["/Users/tatay/projects/ai/janus/mcp-server/dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"]
});

let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  for (const line of lines) {
    if (line.trim()) console.log("OUT:", line);
  }
});

server.stderr.on("data", (chunk) => console.log("ERR:", chunk.toString()));

// Send reindex
setTimeout(() => {
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "reindex", arguments: { projectPath: "/Users/tatay/projects/campsafe/backend" } }
  }) + "\n");
}, 1000);

setTimeout(() => {
  server.kill();
  process.exit(0);
}, 30000);