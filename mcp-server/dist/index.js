import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import fs from "fs";
import path from "path";
import ignore from "ignore";
import Database from "better-sqlite3";
const DEFAULT_TOP_K = 5;
const DEFAULT_EXCLUDES = ["node_modules", ".git", "vendor", "*.log"];
const DEFAULT_INCLUDE = ["app", "routes", "database"];
const MRL_TIERS = [64, 128, 256, 512, 1024];
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = "bge-m3:latest";
const FULL_DIM = 1024;
const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;
const PARALLEL_EMBEDDINGS = 4;
// Meta is now stored in the index DB - loaded during index time
// No runtime file dependency
function loadConfig(projectPath) {
    const configPath = path.join(projectPath, ".janus-config.json");
    if (fs.existsSync(configPath)) {
        try {
            const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            return {
                excludePatterns: userConfig.excludePatterns || DEFAULT_EXCLUDES,
                includeFolders: userConfig.includeFolders || DEFAULT_INCLUDE,
                defaultTopK: userConfig.defaultTopK || DEFAULT_TOP_K,
                fastMode: userConfig.fastMode || false,
                autoFilter: userConfig.autoFilter !== undefined ? userConfig.autoFilter : true,
                embeddingModel: userConfig.embeddingModel || "bge-m3:latest",
                fastModeDim: userConfig.fastModeDim || 128,
                normalModeDim: userConfig.normalModeDim || 1024,
            };
        }
        catch {
            return {
                excludePatterns: DEFAULT_EXCLUDES,
                includeFolders: DEFAULT_INCLUDE,
                defaultTopK: DEFAULT_TOP_K,
                fastMode: false,
                autoFilter: true,
                embeddingModel: "bge-m3:latest",
                fastModeDim: 128,
                normalModeDim: 768,
            };
        }
    }
    return {
        excludePatterns: DEFAULT_EXCLUDES,
        includeFolders: DEFAULT_INCLUDE,
        defaultTopK: DEFAULT_TOP_K,
        fastMode: false,
        autoFilter: true,
        embeddingModel: "bge-m3:latest",
        fastModeDim: 128,
        normalModeDim: 1024,
    };
}
function sliceEmbedding(embedding, targetDim) {
    return embedding.slice(0, targetDim);
}
function sliceEmbeddingToTiers(embedding) {
    const tiers = {};
    for (const dim of MRL_TIERS) {
        tiers[dim] = JSON.stringify(sliceEmbedding(embedding, dim));
    }
    return tiers;
}
function insertVector(db, path, embedding) {
    const tiers = sliceEmbeddingToTiers(embedding);
    db.prepare(`
    INSERT OR REPLACE INTO vectors 
    (path, embedding_64, embedding_128, embedding_256, embedding_512, embedding_1024, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(path, tiers[64], tiers[128], tiers[256], tiers[512], tiers[1024]);
}
async function embed(text) {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, prompt: text }),
    });
    if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.embedding;
}
function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
}
function chunkText(text, size, overlap) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        chunks.push(text.slice(start, start + size));
        start += size - overlap;
    }
    return chunks;
}
async function scanWithFd(dirPath) {
    const { execSync } = await import('child_process');
    try {
        const output = execSync(`fd -e php -e js -e ts -t f . ${dirPath} --max-depth 4`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        return output.trim().split('\n').filter(Boolean);
    }
    catch {
        return scanDirectoryNative(dirPath);
    }
}
function scanDirectoryNative(dirPath) {
    const config = loadConfig(dirPath);
    const files = [];
    const ig = ignore().add(config.excludePatterns);
    function walk(dir, relativePath) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (ig.ignores(entry.name))
                    continue;
                const fullPath = path.join(dir, entry.name);
                const relPath = path.join(relativePath, entry.name);
                if (entry.isDirectory()) {
                    if (relativePath === "" && config.includeFolders.includes(entry.name)) {
                        walk(fullPath, entry.name);
                    }
                    else if (relativePath !== "") {
                        walk(fullPath, relPath);
                    }
                }
                else if (entry.isFile() && (entry.name.endsWith(".php") || entry.name.endsWith(".js") || entry.name.endsWith(".ts"))) {
                    files.push(fullPath);
                }
            }
        }
        catch { }
    }
    walk(dirPath, "");
    return files;
}
async function embedBatch(texts) {
    const promises = texts.map(text => embed(text));
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
            if (parent === checkPath)
                break;
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
        // Migration: Add tier columns to existing DBs
        function migrateToMRL(db) {
            const columns = db.prepare("PRAGMA table_info(vectors)").all();
            const columnNames = columns.map(c => c.name);
            if (!columnNames.includes("embedding_1024")) {
                db.exec(`
          ALTER TABLE vectors ADD COLUMN embedding_64 TEXT;
          ALTER TABLE vectors ADD COLUMN embedding_128 TEXT;
          ALTER TABLE vectors ADD COLUMN embedding_256 TEXT;
          ALTER TABLE vectors ADD COLUMN embedding_512 TEXT;
          ALTER TABLE vectors ADD COLUMN embedding_1024 TEXT;
        `);
                const oldEntries = db.prepare("SELECT id, path, embedding FROM vectors WHERE embedding IS NOT NULL").all();
                for (const entry of oldEntries) {
                    const embedding = JSON.parse(entry.embedding);
                    const tiers = sliceEmbeddingToTiers(embedding);
                    db.prepare(`
            UPDATE vectors 
            SET embedding_64 = ?, embedding_128 = ?, embedding_256 = ?, embedding_512 = ?, embedding_1024 = ?
            WHERE id = ?
          `).run(tiers[64], tiers[128], tiers[256], tiers[512], tiers[1024], entry.id);
                }
            }
        }
        migrateToMRL(db);
        const files = await scanWithFd(projectPath).catch(() => scanDirectoryNative(projectPath));
        console.log(`Found ${files.length} files`);
        // Meta entries now added via 'janus meta add' command - not from file
        let count = 0;
        for (let i = 0; i < files.length; i += PARALLEL_EMBEDDINGS) {
            const batch = files.slice(i, i + PARALLEL_EMBEDDINGS);
            const batchChunks = [];
            for (const filePath of batch) {
                try {
                    const content = fs.readFileSync(filePath, "utf-8");
                    const fileChunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
                    fileChunks.forEach((text, idx) => {
                        batchChunks.push({ path: filePath, index: idx, text });
                    });
                }
                catch (e) {
                    console.error(`Error reading ${filePath}:`, e);
                }
            }
            const embeddings = await embedBatch(batchChunks.map(c => c.text));
            for (let j = 0; j < batchChunks.length; j++) {
                const { path: chunkPath, index } = batchChunks[j];
                insertVector(db, `${chunkPath}::chunk::${index}`, embeddings[j]);
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
            if (parent === checkPath)
                break;
            checkPath = parent;
        }
        const projectPath = detectedPath;
        const dbPath = path.join(projectPath, ".janus.db");
        const db = new Database(dbPath);
        const result = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as fileCount, COUNT(*) as chunkCount FROM vectors").get();
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
            if (parent === checkPath)
                break;
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
            const embedding = await embed(text);
            insertVector(db, `meta:${metaPath}::chunk::0`, embedding);
            console.log(`Added meta: ${metaPath}`);
            db.close();
            process.exit(0);
        }
        if (action === "list") {
            const entries = db.prepare("SELECT path FROM vectors WHERE path LIKE 'meta:%'").all();
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
            if (parent === checkPath)
                break;
            checkPath = parent;
        }
        const projectPath = detectedPath;
        const config = loadConfig(projectPath);
        const dbPath = path.join(projectPath, ".janus.db");
        const db = new Database(dbPath);
        const searchDim = config.fastMode ? (config.fastModeDim || 128) : (config.normalModeDim || 1024);
        // Embed query to full, then slice to the appropriate dimension
        const fullQueryEmbed = await embed(query);
        const queryEmbed = sliceEmbedding(fullQueryEmbed, searchDim);
        const col = `embedding_${searchDim}`;
        const entries = db.prepare(`SELECT path, ${col} as embedding FROM vectors WHERE ${col} IS NOT NULL`).all();
        const scored = entries.map((entry) => ({
            path: entry.path,
            score: cosineSimilarity(queryEmbed, JSON.parse(entry.embedding)),
        }));
        scored.sort((a, b) => b.score - a.score);
        // Convert meta: paths to actual file paths in results
        const fileScores = new Map();
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
    // Migration: Add tier columns to existing DBs
    function migrateToMRL(db) {
        const columns = db.prepare("PRAGMA table_info(vectors)").all();
        const columnNames = columns.map(c => c.name);
        if (!columnNames.includes("embedding_1024")) {
            db.exec(`
         ALTER TABLE vectors ADD COLUMN embedding_64 TEXT;
         ALTER TABLE vectors ADD COLUMN embedding_128 TEXT;
         ALTER TABLE vectors ADD COLUMN embedding_256 TEXT;
         ALTER TABLE vectors ADD COLUMN embedding_512 TEXT;
         ALTER TABLE vectors ADD COLUMN embedding_1024 TEXT;
       `);
            const oldEntries = db.prepare("SELECT id, path, embedding FROM vectors WHERE embedding IS NOT NULL").all();
            for (const entry of oldEntries) {
                const embedding = JSON.parse(entry.embedding);
                const tiers = sliceEmbeddingToTiers(embedding);
                db.prepare(`
           UPDATE vectors 
           SET embedding_64 = ?, embedding_128 = ?, embedding_256 = ?, embedding_512 = ?, embedding_1024 = ?
           WHERE id = ?
         `).run(tiers[64], tiers[128], tiers[256], tiers[512], tiers[1024], entry.id);
            }
        }
    }
    migrateToMRL(db);
    const server = new McpServer({
        name: "janus",
        version: "1.0.0",
    });
    server.registerTool("semantic_search", {
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
    }, async (args) => {
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
                if (parent === checkPath)
                    break; // Reached root
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
        function getEmbeddingColumn(dim) {
            return `embedding_${dim}`;
        }
        const query = args.query;
        const k = args.topK || searchConfig.defaultTopK;
        const searchDim = searchConfig.fastMode ? (searchConfig.fastModeDim || 128) : (searchConfig.normalModeDim || 1024);
        // Embed query to full, then slice to the appropriate dimension
        const fullQueryEmbed = await embed(query);
        const queryEmbed = sliceEmbedding(fullQueryEmbed, searchDim);
        const col = `embedding_${searchDim}`;
        const entries = searchDb.prepare(`SELECT path, ${col} as embedding FROM vectors WHERE ${col} IS NOT NULL`).all();
        const scored = entries.map((entry) => ({
            path: entry.path,
            score: cosineSimilarity(queryEmbed, JSON.parse(entry.embedding)),
        }));
        scored.sort((a, b) => b.score - a.score);
        // Convert meta: paths to actual file paths in results
        const fileScores = new Map();
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
    });
    server.registerTool("reindex", {
        description: "Rebuild vector index for project",
        inputSchema: fromJsonSchema({
            type: "object",
            properties: {
                projectPath: { type: "string", description: "Path to project (default: current)" },
            },
        }),
    }, async (args) => {
        const targetPath = args.projectPath;
        const target = targetPath || projectPath;
        const localConfig = loadConfig(target);
        // Try fd first, fallback to native
        const files = await scanWithFd(target).catch(() => scanDirectoryNative(target));
        // Group files by path prefix to check what needs re-indexing
        const existingPaths = new Set(db.prepare("SELECT path FROM vectors").all().map((r) => r.path.split("::chunk::")[0]));
        const filesToIndex = files.filter(f => !existingPaths.has(f));
        // If no files need indexing, return current stats
        if (filesToIndex.length === 0) {
            const count = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as cnt FROM vectors").get();
            return { content: [{ type: "text", text: JSON.stringify({ fileCount: count.cnt, chunkCount: 0, message: "No changes" }) }] };
        }
        // Process in parallel batches
        const indexedFiles = new Set();
        for (let i = 0; i < filesToIndex.length; i += PARALLEL_EMBEDDINGS) {
            const batch = filesToIndex.slice(i, i + PARALLEL_EMBEDDINGS);
            const batchChunks = [];
            for (const filePath of batch) {
                try {
                    const content = fs.readFileSync(filePath, "utf-8");
                    const fileChunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
                    fileChunks.forEach((text, idx) => {
                        batchChunks.push({ path: filePath, index: idx, text });
                    });
                }
                catch (e) {
                    console.error(`Error reading ${filePath}:`, e);
                }
            }
            // Parallel embed
            const embeddings = await embedBatch(batchChunks.map(c => c.text));
            // Store
            for (let j = 0; j < batchChunks.length; j++) {
                const { path: chunkPath, index } = batchChunks[j];
                insertVector(db, `${chunkPath}::chunk::${index}`, embeddings[j]);
            }
            batch.forEach(f => indexedFiles.add(f));
        }
        const totalFiles = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as cnt FROM vectors").get();
        const totalChunks = db.prepare("SELECT COUNT(*) as cnt FROM vectors").get();
        return {
            content: [{ type: "text", text: JSON.stringify({
                        fileCount: totalFiles.cnt,
                        chunkCount: totalChunks.cnt,
                        indexed: indexedFiles.size
                    }) }],
        };
    });
    server.registerTool("get_index_stats", {
        description: "Get index statistics",
        inputSchema: fromJsonSchema({
            type: "object",
            properties: {},
        }),
    }, async () => {
        const result = db.prepare("SELECT COUNT(DISTINCT substr(path, 1, instr(path || '::chunk::', '::chunk::'))) as fileCount, COUNT(*) as chunkCount, MAX(indexed_at) as indexedAt FROM vectors").get();
        return {
            content: [{ type: "text", text: JSON.stringify({ fileCount: result.fileCount, chunkCount: result.chunkCount, indexedAt: result.indexedAt }) }],
        };
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Janus MCP server started");
}
main().catch(console.error);
