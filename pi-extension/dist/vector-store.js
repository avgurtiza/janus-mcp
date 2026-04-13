import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
export class VectorStore {
    db;
    dbPath;
    constructor(dbPath = "./.gatekeeper.db") {
        this.dbPath = dbPath;
        this.db = new Database(dbPath);
        sqliteVec.load(this.db);
    }
    async initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        rowid INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        embedding BLOB,
        indexed_at TEXT
      );
    `);
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors_idx'").get();
        if (!tables) {
            this.db.exec(`CREATE VIRTUAL TABLE vectors_idx USING vec0(embedding);`);
        }
    }
    async add(filePath, embedding) {
        const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
        this.db.prepare(`
      INSERT OR REPLACE INTO vectors (path, embedding, indexed_at)
      VALUES (?, ?, datetime('now'))
    `).run(filePath, embeddingBlob);
    }
    async addBatch(files) {
        const insertVector = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (path, embedding, indexed_at)
      VALUES (?, ?, datetime('now'))
    `);
        for (const file of files) {
            const embeddingBlob = Buffer.from(new Float32Array(file.embedding).buffer);
            insertVector.run(file.path, embeddingBlob);
        }
        this.db.exec("DROP TABLE IF EXISTS vectors_idx");
        this.db.exec(`CREATE VIRTUAL TABLE vectors_idx USING vec0(embedding);`);
        const all = this.db.prepare("SELECT rowid, path, embedding FROM vectors").all();
        const insertAll = this.db.prepare(`
      INSERT INTO vectors_idx (rowid, embedding) VALUES (?, ?)
    `);
        for (const row of all) {
            const embedding = new Float32Array(row.embedding.buffer);
            insertAll.run(BigInt(row.rowid), embedding);
        }
    }
    async search(query, topK) {
        try {
            const rows = this.db.prepare(`
        SELECT v.path, d.distance
        FROM vectors v
        JOIN vectors_idx idx ON v.rowid = idx.rowid
        WHERE idx.embedding MATCH ?
        ORDER BY d.distance
        LIMIT ?
      `).all(new Float32Array(query), topK);
            return rows.map((row) => ({
                path: row.path,
                score: row.distance,
            }));
        }
        catch {
            return this.exactSearch(query, topK);
        }
    }
    async exactSearch(query, topK) {
        const all = this.db.prepare("SELECT path, embedding FROM vectors").all();
        const results = all.map((row) => ({
            path: row.path,
            score: this.cosineDistance(query, Array.from(new Float32Array(row.embedding.buffer))),
        }));
        results.sort((a, b) => a.score - b.score);
        return results.slice(0, topK);
    }
    cosineDistance(a, b) {
        const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return 1 - dot / (magA * magB);
    }
    async getStats() {
        const result = this.db.prepare("SELECT COUNT(*) as count, MAX(indexed_at) as indexed_at FROM vectors").get();
        return { fileCount: result.count, indexedAt: result.indexed_at };
    }
    async clear() {
        this.db.exec("DELETE FROM vectors");
        this.db.exec("DROP TABLE IF EXISTS vectors_idx");
        await this.initialize();
    }
    close() {
        this.db.close();
    }
}
