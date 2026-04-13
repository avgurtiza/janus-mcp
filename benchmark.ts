#!/usr/bin/env npx tsx
import fs from "fs";
import path from "path";
import ignore from "ignore";

const PROJECT = process.argv[2] || "/Users/tatay/projects/campsafe/backend";
const EXCLUDE = ["vendor", "node_modules", ".git", "storage", ".phpunit.cache", "*.lock", "*.log"];
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = "embeddinggemma:latest";

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    start += size - overlap;
  }
  return chunks;
}

async function embed(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: text }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${errText}`);
    }
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  } catch (e) {
    console.error("Embed error:", e.message);
    throw e;
  }
}

interface FileInfo {
  path: string;
  name: string;
  tokens: number;
  content: string;
  chunks: { text: string; start: number }[];
}

async function scanFiles(dir: string, exclude: string[]): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const ig = ignore().add(exclude);

  function walk(dir: string) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ig.ignores(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && (entry.name.endsWith(".php") || entry.name.endsWith(".js") || entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".jsx"))) {
          const content = fs.readFileSync(full, "utf-8");
          const tokens = countTokens(content);
          const chunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP).map((text, i) => ({ text, start: i * (CHUNK_SIZE - CHUNK_OVERLAP) }));
          files.push({ path: full, name: entry.name, tokens, content, chunks });
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
  const totalChunks = allFiles.reduce((sum, f) => sum + f.chunks.length, 0);
  
  console.log(`\n📊 PROJECT STATS:`);
  console.log(`  Total files: ${allFiles.length}`);
  console.log(`  Total tokens (est): ${totalTokens.toLocaleString()}`);
  console.log(`  Total chunks (${CHUNK_SIZE} chars, ${CHUNK_OVERLAP} overlap): ${totalChunks}`);

  console.log("\n📡 Indexing files with embeddinggemma...");
  
  type IndexedChunk = { file: FileInfo; chunkIndex: number; start: number; embedding: number[] };
  const indexedChunks: IndexedChunk[] = [];
  const failedFiles: string[] = [];
  const failedChunks: string[] = [];

  for (const file of allFiles) {
    try {
      for (const chunk of file.chunks) {
        try {
          const embedding = await embed(chunk.text);
          indexedChunks.push({ file, chunkIndex: file.chunks.indexOf(chunk), start: chunk.start, embedding });
          if (indexedChunks.length % 100 === 0) console.log(`  Progress: ${indexedChunks.length}/${totalChunks} chunks`);
        } catch (e) {
          failedChunks.push(`${file.name}[${file.chunks.indexOf(chunk)}]`);
        }
      }
    } catch (e) {
      failedFiles.push(file.name);
    }
  }
  console.log(`  ✅ Indexed ${indexedChunks.length} chunks (${failedChunks.length} chunks failed in ${failedFiles.length} files)`);

  const queries = ["authentication login", "payment billing", "database queries"];
  
  for (const query of queries) {
    console.log(`\n🔎 SEARCH: "${query}"`);
    const queryEmbed = await embed(query);
    
    const results = indexedChunks.map(c => ({
      path: c.file.path,
      name: c.file.name,
      chunkIndex: c.chunkIndex,
      score: cosineSimilarity(queryEmbed, c.embedding)
    }));
    results.sort((a, b) => b.score - a.score);
    
    // Dedupe by file - take highest scoring chunk per file
    const fileScores = new Map<string, { name: string; score: number; tokens: number }>();
    for (const r of results) {
      const existing = fileScores.get(r.path);
      if (!existing || r.score > existing.score) {
        fileScores.set(r.path, { name: r.name, score: r.score, tokens: r.file.tokens });
      }
    }
    const top5 = Array.from(fileScores.values()).slice(0, 5);
    const resultTokens = top5.reduce((sum, f) => sum + f.tokens, 0);

    console.log("  Results:");
    for (const r of top5) {
      console.log(`    - ${r.name}: ${r.tokens.toLocaleString()} tokens (score: ${r.score.toFixed(3)})`);
    }

    console.log(`\n📉 TOKEN COMPARISON:`);
    console.log(`  All files:     ${totalTokens.toLocaleString()} tokens`);
    console.log(`  Top 5:       ${resultTokens.toLocaleString()} tokens`);
    console.log(`  Savings:     ${((totalTokens - resultTokens) / totalTokens * 100).toFixed(1)}%`);
  }

  console.log("\n✅ Benchmark complete");
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});