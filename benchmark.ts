#!/usr/bin/env npx tsx
import { spawn } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const PROJECT = "/Users/tatay/projects/campsafe/backend";
const EXCLUDE = ["vendor", "node_modules", ".git", "storage", ".phpunit.cache", "*.lock", "*.log"];

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function scanFiles(dir: string, exclude: string[]): Promise<{path: string, size: number, tokens: number}[]> {
  const files: {path: string, size: number, tokens: number}[] = [];
  
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d)) {
        if (exclude.some(e => entry.match(e))) continue;
        const full = join(d, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (entry.endsWith(".php") || entry.endsWith(".js") || entry.endsWith(".ts")) {
          const content = readFileSync(full, "utf-8");
          files.push({ path: full, size: content.length, tokens: countTokens(content) });
        }
      }
    } catch { }
  }
  
  walk(dir);
  return files;
}

async function main() {
  console.log("🔍 Scanning project files...");
  const allFiles = await scanFiles(PROJECT, EXCLUDE);
  const totalTokens = allFiles.reduce((sum, f) => sum + f.tokens, 0);
  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
  
  console.log(`\n📊 PROJECT STATS:`);
  console.log(`  Total files: ${allFiles.length}`);
  console.log(`  Total chars: ${totalSize.toLocaleString()}`);
  console.log(`  Total tokens (est): ${totalTokens.toLocaleString()}`);
  
  // Now run semantic search
  const pi = spawn("node", ["/Users/tatay/projects/ai/janus/pi-extension/dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  
  let buffer = "";
  pi.stdout.on("data", (chunk) => { buffer += chunk; });
  pi.stdout.on("data", () => {
    const lines = buffer.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.status === "ready") {
          pi.stdin.write(JSON.stringify({
            action: "index",
            files: allFiles.map(f => ({ path: f.path, content: readFileSync(f.path, "utf-8") }))
          }) + "\n");
        }
        if (data.action === "indexed") {
          console.log(`\n✅ Indexed ${data.fileCount} files`);
          
          // Query for auth-related
          pi.stdin.write(JSON.stringify({ action: "search", query: "authentication login", topK: 5 }) + "\n");
        }
        if (data.action === "search") {
          const results = data.results;
          
          console.log(`\n🔎 SEARCH: "authentication login" (top 5)`);
          const resultTokens = results.reduce((sum, r: any) => {
            const file = allFiles.find(f => f.path === r.path);
            return sum + (file?.tokens || 0);
          }, 0);
          
          console.log(`  Results:`);
          for (const r of results) {
            const file = allFiles.find(f => f.path === r.path);
            console.log(`    - ${r.path.split("/").pop()}: ${(file?.tokens || 0).toLocaleString()} tokens`);
          }
          
          console.log(`\n📉 TOKEN COMPARISON:`);
          console.log(`  All files:     ${totalTokens.toLocaleString()} tokens`);
          console.log(`  Top 5:       ${resultTokens.toLocaleString()} tokens`);
          console.log(`  Savings:     ${totalTokens - resultTokens} tokens (${((totalTokens - resultTokens) / totalTokens * 100).toFixed(1)}%)`);
          
          // Test more queries
          console.log(`\n🔎 SEARCH: "payment billing" (top 5)`);
          pi.stdin.write(JSON.stringify({ action: "search", query: "payment billing", topK: 5 }) + "\n");
        }
        if (data.action === "search" && !buffer.includes("authentication")) {
          const results = data.results;
          const resultTokens = results.reduce((sum, r: any) => {
            const file = allFiles.find(f => f.path === r.path);
            return sum + (file?.tokens || 0);
          }, 0);
          
          console.log(`  Results:`);
          for (const r of results) {
            const file = allFiles.find(f => f.path === r.path);
            console.log(`    - ${r.path.split("/").pop()}: ${(file?.tokens || 0).toLocaleString()} tokens`);
          }
          
          console.log(`\n📉 TOKEN COMPARISON:`);
          console.log(`  All files:     ${totalTokens.toLocaleString()} tokens`);
          console.log(`  Top 5:       ${resultTokens.toLocaleString()} tokens`);
          console.log(`  Savings:     ${totalTokens - resultTokens} tokens (${((totalTokens - resultTokens) / totalTokens * 100).toFixed(1)}%)`);
          
          pi.kill();
        }
      } catch { }
    }
  });
}

main();