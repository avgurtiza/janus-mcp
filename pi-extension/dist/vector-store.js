import Database from "better-sqlite3";
export class VectorStore {
    db;
    dbPath;
    constructor(dbPath = "./.gatekeeper.db") {
        this.dbPath = dbPath;
        this.db = new Database(dbPath);
    }
    async initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        embedding TEXT NOT NULL,
        indexed_at TEXT
      )
    `);
    }
    async add(filePath, embedding) {
        this.db.prepare(`
      INSERT OR REPLACE INTO vectors (path, embedding, indexed_at)
      VALUES (?, ?, datetime('now'))
    `).run(filePath, JSON.stringify(embedding));
    }
    async addBatch(files) {
        const insertVector = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (path, embedding, indexed_at)
      VALUES (?, ?, datetime('now'))
    `);
        for (const file of files) {
            insertVector.run(file.path, JSON.stringify(file.embedding));
        }
    }
    async search(query, topK) {
        const all = this.db.prepare("SELECT path, embedding FROM vectors").all();
        const results = all.map((row) => ({
            path: row.path,
            score: this.cosineSimilarity(query, JSON.parse(row.embedding)),
        }));
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
    cosineSimilarity(a, b) {
        const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        if (magA === 0 || magB === 0)
            return 0;
        return dot / (magA * magB);
    }
    async getStats() {
        const result = this.db.prepare("SELECT COUNT(*) as count, MAX(indexed_at) as indexed_at FROM vectors").get();
        return { fileCount: result.count, indexedAt: result.indexed_at };
    }
    async clear() {
        this.db.exec("DELETE FROM vectors");
    }
    close() {
        this.db.close();
    }
}
