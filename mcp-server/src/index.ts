import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import fs from "fs";
import path from "path";
import ignore from "ignore";
import Database from "better-sqlite3";

const DEFAULT_TOP_K = 5;
const DEFAULT_EXCLUDES = ["node_modules", ".git", "vendor", "*.log"];
const DEFAULT_INCLUDE = ["app", "routes", "database"];
const MRL_TIERS = [64, 128, 256, 512, 1024] as const;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = "bge-m3:latest";
const FULL_DIM = 1024;
const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;
const PARALLEL_EMBEDDINGS = 4;

interface Config {
  excludePatterns: string[];
  includeFolders: string[];
  defaultTopK: number;
  fastMode: boolean;
  autoFilter: boolean; // Agent auto-uses semantic_search for context tasks
}

interface VectorEntry {
  path: string;
  embedding: string;
  indexed_at: string;
}

// Meta is now stored in the index DB - loaded during index time
// No runtime file dependency

function loadConfig(projectPath: string): Config {
  const configPath = path.join(projectPath, ".janus-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return {
        excludePatterns: userConfig.excludePatterns || DEFAULT_EXCLUDES,
        includeFolders: userConfig.includeFolders || DEFAULT_INCLUDE,
        defaultTopK: userConfig.defaultTopK || DEFAULT_TOP_K,
        fastMode: userConfig.fastMode || false,
        autoFilter: userConfig.autoFilter !== undefined ? userConfig.autoFilter : true, // Default true
      };
    } catch {
      return { excludePatterns: DEFAULT_EXCLUDES, includeFolders: DEFAULT_INCLUDE, defaultTopK: DEFAULT_TOP_K, fastMode: false, autoFilter: true };
    }
  }
  return { excludePatterns: DEFAULT_EXCLUDES, includeFolders: DEFAULT_INCLUDE, defaultTopK: DEFAULT_TOP_K, fastMode: false, autoFilter: true };
}

function sliceEmbedding(embedding: number[], targetDim: number): number[] {
  return embedding.slice(0, targetDim);
}

async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { embedding: number[] };
  return data.embedding;
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

async function scanWithFd(dirPath: string): Promise<string[]> {
  const { execSync } = await import('child_process');
  
  try {
    const output = execSync(
      `fd -e php -e js -e ts -t f . ${dirPath} --max-depth 4`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return scanDirectoryNative(dirPath);
  }
}

function scanDirectoryNative(dirPath: string): string[] {
  const config = loadConfig(dirPath);
  const files: string[] = [];
  const ig = ignore().add(config.excludePatterns);

  function walk(dir: string, relativePath: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ig.ignores(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relativePath, entry.name);
        
        if (entry.isDirectory()) {
          if (relativePath === "" && config.includeFolders.includes(entry.name)) {
            walk(fullPath, entry.name);
          } else if (relativePath !== "") {
            walk(fullPath, relPath);
          }
        } else if (entry.isFile() && (entry.name.endsWith(".php") || entry.name.endsWith(".js") || entry.name.endsWith(".ts"))) {
          files.push(fullPath);
        }
      }
    } catch { }
  }

  walk(dirPath, "");
  return files;
}

async function embedBatch(texts: string[], fastMode: boolean = false): Promise<number[][]> {
  const promises = texts.map(text => embed(text, fastMode));
  return Promise.all(promises);
}

async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === "index" || command === "reindex") {
    console.log("Indexing project...");
    // Auto-detect project path
    let detectedPath = process.cwd();
    let checkPath = detectedPath;
    for (let i = 0; i < 5; i++) {
      const dbPath = path.join(checkPath, ".janus.db");
      if (fs.existsSync(dbPath)) {
        detectedPath = checkPath;
        break;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    const projectPath = detectedPath;
    const config = loadConfig(projectPath);
    const dbPath = path.join(projectPath, ".janus.db");
    
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        embedding_64 TEXT,
        embedding_128 TEXT,
        embedding_256 TEXT,
        embedding_512 TEXT,
        embedding_1024 TEXT,
        indexed_at TEXT
      )
    `);
    
    const files = await scanWithFd(projectPath).catch(() => scanDirectoryNative(projectPath));
    console.log(`Found ${files.length} files`);
    
    // Meta entries now added via 'janus meta add' command - not from file
    
    let count = 0;
    for (let i = 0; i < files.length; i += PARALLEL_EMBEDDINGS) {
      const batch = files.slice(i, i + PARALLEL_EMBEDDINGS);
      const batchChunks: { path: string; index: number; text: string }[] = [];
      
      for (const filePath of batch) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const fileChunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
          fileChunks.forEach((text, idx) => {
            batchChunks.push({ path: filePath, index: idx, text });
          });
        } catch (e) {
          console.error(`Error reading ${filePath}:`, e);
        }
      }
      
      const embeddings = await embedBatch(batchChunks.map(c => c.text), config.fastMode);
      
      for (let j = 0; j < batchChunks.length; j++) {
        const { path: chunkPath, index } = batchChunks[j];
        db.prepare("INSERT OR REPLACE INTO vectors (path, embedding, indexed_at) VALUES (?, ?, datetime('now'))")
          .run(`${chunkPath}::chunk::${index}`, JSON.stringify(embeddings[j]));
      }
      
      count += batch.length;
      console.log(`Indexed ${count}/${files.length} files`);
    }
    
    console.log(`Done! Indexed ${count} files.`);
    db.close();
    process.exit(0);
  }
  
  if (command === "stats") {
    // Auto-detect project path
    let detectedPath = process.cwd();
    let checkPath = detectedPath;
    for (let i = 0; i < 5; i++) {
      const dbPath = path.join(checkPath, ".janus.db");
      if (fs.existsSync(dbPath)) {
        detectedPath = checkPath;
        break;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    
    const projectPath = detectedPath;
    const dbPath = path.join(projectPath, ".janus.db");
    const db = new Database(dbPath);
    const result = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as fileCount, COUNT(*) as chunkCount FROM vectors").get() as { fileCount: number; chunkCount: number };
    console.log(`Files: ${result.fileCount}, Chunks: ${result.chunkCount}`);
    db.close();
    process.exit(0);
  }
  
  if (command === "meta") {
    const action = args[1];
    // Auto-detect project path
    let detectedPath = process.cwd();
    let checkPath = detectedPath;
    for (let i = 0; i < 5; i++) {
      const dbPath = path.join(checkPath, ".janus.db");
      if (fs.existsSync(dbPath)) {
        detectedPath = checkPath;
        break;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    const projectPath = detectedPath;
    const config = loadConfig(projectPath);
    const dbPath = path.join(projectPath, ".janus.db");
    const db = new Database(dbPath);
    
    if (action === "add") {
      const metaPath = args[2];
      const description = args.slice(3).join(' ');
      if (!metaPath || !description) {
        console.log("Usage: janus meta add <path> <description>");
        process.exit(1);
      }
      const text = `${metaPath}: ${description}`;
      const embedding = await embed(text, config.fastMode);
      db.prepare("INSERT OR REPLACE INTO vectors (path, embedding, indexed_at) VALUES (?, ?, datetime('now'))")
        .run(`meta:${metaPath}::chunk::0`, JSON.stringify(embedding));
      console.log(`Added meta: ${metaPath}`);
      db.close();
      process.exit(0);
    }
    
    if (action === "list") {
      const entries = db.prepare("SELECT path FROM vectors WHERE path LIKE 'meta:%'").all() as { path: string }[];
      entries.forEach(e => console.log(e.path.replace('::chunk::0', '').replace('meta:', '')));
      db.close();
      process.exit(0);
    }
    
    if (action === "delete") {
      const metaPath = args[2];
      if (!metaPath) {
        console.log("Usage: janus meta delete <path>");
        process.exit(1);
      }
      db.prepare("DELETE FROM vectors WHERE path = ?").run(`meta:${metaPath}::chunk::0`);
      console.log(`Deleted meta: ${metaPath}`);
      db.close();
      process.exit(0);
    }
    
    console.log("Usage: janus meta [add|list|delete]");
    db.close();
    process.exit(1);
  }
  
  if (command === "search") {
    const query = args.find(a => a.startsWith('--query='))?.split('=')[1] || args[1];
    const topK = parseInt(args.find(a => a.startsWith('--topK='))?.split('=')[2] || '5');
    
    if (!query) {
      console.log("Usage: janus search --query='your search' --topK=5");
      process.exit(1);
    }
    
    // Auto-detect project path - walk up looking for .janus.db
    let detectedPath = process.cwd();
    let checkPath = detectedPath;
    for (let i = 0; i < 5; i++) {
      const dbPath = path.join(checkPath, ".janus.db");
      if (fs.existsSync(dbPath)) {
        detectedPath = checkPath;
        break;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    
    const projectPath = detectedPath;
    const config = loadConfig(projectPath);
    const dbPath = path.join(projectPath, ".janus.db");
    const db = new Database(dbPath);
    
    const queryEmbed = await embed(query, config.fastMode);
    const entries = db.prepare("SELECT path, embedding FROM vectors").all() as VectorEntry[];
    
    const scored = entries.map((entry) => ({
      path: entry.path,
      score: cosineSimilarity(queryEmbed, JSON.parse(entry.embedding)),
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    // Convert meta: paths to actual file paths in results
    const fileScores = new Map<string, { path: string; score: number }>();
    for (const s of scored) {
      let filePath = s.path.split("::chunk::")[0];
      // Convert meta:path to actual path
      if (filePath.startsWith("meta:")) {
        filePath = filePath.substring(5); // Remove "meta:" prefix
      }
      const existing = fileScores.get(filePath);
      if (!existing || s.score > existing.score) {
        fileScores.set(filePath, { path: s.path, score: s.score });
      }
    }
    
    const topResults = Array.from(fileScores.values()).slice(0, topK);
    console.log(JSON.stringify(topResults, null, 2));
    db.close();
    process.exit(0);
  }
  
  console.log("Usage: janus [index|stats|search]");
  process.exit(1);
}

async function main() {
  // CLI mode if args provided
  if (process.argv.length > 2) {
    return runCli();
  }
  
  // MCP mode (stdio)
  const projectPath = process.cwd();
  const config = loadConfig(projectPath);
  const dbPath = path.join(projectPath, ".janus.db");

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      embedding_64 TEXT,
      embedding_128 TEXT,
      embedding_256 TEXT,
      embedding_512 TEXT,
      embedding_1024 TEXT,
      indexed_at TEXT
    )
  `);

  const server = new McpServer({
    name: "janus",
    version: "1.0.0",
  });

  server.registerTool(
    "semantic_search",
    {
      description: "Search for relevant files using semantic embeddings",
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          topK: { type: "number", description: "Number of results (default 5)" },
          projectPath: { type: "string", description: "Optional: project path to search (defaults to current directory)" },
        },
        required: ["query"],
      }),
    },
    async (args: any) => {
      // Auto-detect project if not provided - walk up from cwd looking for .janus.db
      let detectedPath = projectPath;
      if (!args.projectPath) {
        let checkPath = projectPath;
        for (let i = 0; i < 5; i++) { // Max 5 levels up
          const dbPath = path.join(checkPath, ".janus.db");
          if (fs.existsSync(dbPath)) {
            detectedPath = checkPath;
            break;
          }
          const parent = path.dirname(checkPath);
          if (parent === checkPath) break; // Reached root
          checkPath = parent;
        }
      }
      
      // Allow override of project path from args
      const searchPath = args.projectPath || detectedPath;
      const searchConfig = args.projectPath ? loadConfig(searchPath) : (searchPath !== projectPath ? loadConfig(searchPath) : config);
      const searchDbPath = path.join(searchPath, ".janus.db");
      
      // Open a separate DB connection for the target project if different
      let searchDb = db;
      let shouldCloseDb = false;
      
      if (args.projectPath || searchPath !== projectPath) {
        searchDb = new Database(searchDbPath);
        shouldCloseDb = true;
      }
      
      const query = args.query;
      const k = args.topK || searchConfig.defaultTopK;
      const queryEmbed = await embed(query, searchConfig.fastMode);

      const entries = searchDb.prepare("SELECT path, embedding FROM vectors").all() as VectorEntry[];
      
      const scored = entries.map((entry) => ({
        path: entry.path,
        score: cosineSimilarity(queryEmbed, JSON.parse(entry.embedding)),
      }));

      scored.sort((a, b) => b.score - a.score);

      // Convert meta: paths to actual file paths in results
      const fileScores = new Map<string, { path: string; score: number }>();
      for (const s of scored) {
        let filePath = s.path.split("::chunk::")[0];
        // Convert meta:path to actual path
        if (filePath.startsWith("meta:")) {
          filePath = filePath.substring(5);
        }
        const existing = fileScores.get(filePath);
        if (!existing || s.score > existing.score) {
          fileScores.set(filePath, { path: s.path, score: s.score });
        }
      }

      const topResults = Array.from(fileScores.values()).slice(0, k);

      // Close the separate DB connection if we opened one
      if (shouldCloseDb) {
        searchDb.close();
      }

      return {
        content: [{ type: "text", text: JSON.stringify(topResults) }],
      };
    }
  );

  server.registerTool(
    "reindex",
    {
      description: "Rebuild vector index for project",
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Path to project (default: current)" },
        },
      }),
    },
    async (args: any) => {
      const targetPath = args.projectPath;
      const target = targetPath || projectPath;
      const localConfig = loadConfig(target);
      
      // Try fd first, fallback to native
      const files = await scanWithFd(target).catch(() => scanDirectoryNative(target));

      // Group files by path prefix to check what needs re-indexing
      const existingPaths = new Set(db.prepare("SELECT path FROM vectors").all().map((r: any) => r.path.split("::chunk::")[0]));
      const filesToIndex = files.filter(f => !existingPaths.has(f));
      
      // If no files need indexing, return current stats
      if (filesToIndex.length === 0) {
        const count = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as cnt FROM vectors").get() as { cnt: number };
        return { content: [{ type: "text", text: JSON.stringify({ fileCount: count.cnt, chunkCount: 0, message: "No changes" }) }] };
      }

      // Process in parallel batches
      const indexedFiles = new Set<string>();
      
      for (let i = 0; i < filesToIndex.length; i += PARALLEL_EMBEDDINGS) {
        const batch = filesToIndex.slice(i, i + PARALLEL_EMBEDDINGS);
        const batchChunks: { path: string; index: number; text: string }[] = [];
        
        for (const filePath of batch) {
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const fileChunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
            fileChunks.forEach((text, idx) => {
              batchChunks.push({ path: filePath, index: idx, text });
            });
          } catch (e) {
            console.error(`Error reading ${filePath}:`, e);
          }
        }
        
        // Parallel embed
        const embeddings = await embedBatch(batchChunks.map(c => c.text), localConfig.fastMode);
        
        // Store
        for (let j = 0; j < batchChunks.length; j++) {
          const { path: chunkPath, index } = batchChunks[j];
          db.prepare("INSERT OR REPLACE INTO vectors (path, embedding, indexed_at) VALUES (?, ?, datetime('now'))")
            .run(`${chunkPath}::chunk::${index}`, JSON.stringify(embeddings[j]));
        }
        
        batch.forEach(f => indexedFiles.add(f));
      }

      const totalFiles = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as cnt FROM vectors").get() as { cnt: number };
      const totalChunks = db.prepare("SELECT COUNT(*) as cnt FROM vectors").get() as { cnt: number };

      return {
        content: [{ type: "text", text: JSON.stringify({ 
          fileCount: totalFiles.cnt, 
          chunkCount: totalChunks.cnt,
          indexed: indexedFiles.size 
        }) }],
      };
    }
  );

  server.registerTool(
    "get_index_stats",
    {
      description: "Get index statistics",
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {},
      }),
    },
    async () => {
      const result = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as fileCount, COUNT(*) as chunkCount, MAX(indexed_at) as indexedAt FROM vectors").get() as { fileCount: number; chunkCount: number; indexedAt: string | null };
      return {
        content: [{ type: "text", text: JSON.stringify({ fileCount: result.fileCount, chunkCount: result.chunkCount, indexedAt: result.indexedAt }) }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Janus MCP server started");
}

main().catch(console.error);