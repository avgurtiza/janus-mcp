import Database from "better-sqlite3";

export interface VectorResult {
  path: string;
  score: number;
}

export class VectorStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath = "./.gatekeeper.db") {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        embedding TEXT NOT NULL,
        indexed_at TEXT
      )
    `);
  }

  async add(filePath: string, embedding: number[]): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO vectors (path, embedding, indexed_at)
      VALUES (?, ?, datetime('now'))
    `).run(filePath, JSON.stringify(embedding));
  }

  async addBatch(files: { path: string; embedding: number[] }[]): Promise<void> {
    const insertVector = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (path, embedding, indexed_at)
      VALUES (?, ?, datetime('now'))
    `);
    
    for (const file of files) {
      insertVector.run(file.path, JSON.stringify(file.embedding));
    }
  }

  async search(query: number[], topK: number): Promise<VectorResult[]> {
    const all = this.db.prepare("SELECT path, embedding FROM vectors").all() as {
      path: string;
      embedding: string;
    }[];

    const results = all.map((row) => ({
      path: row.path,
      score: this.cosineSimilarity(query, JSON.parse(row.embedding)),
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }

  async getStats(): Promise<{ fileCount: number; indexedAt: string | null }> {
    const result = this.db.prepare("SELECT COUNT(*) as count, MAX(indexed_at) as indexed_at FROM vectors").get() as {
      count: number;
      indexed_at: string | null;
    };
    return { fileCount: result.count, indexedAt: result.indexed_at };
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM vectors");
  }

  close(): void {
    this.db.close();
  }
}