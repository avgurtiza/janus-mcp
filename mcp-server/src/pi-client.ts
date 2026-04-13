import { spawn, ChildProcess } from "child_process";

export interface PiResult {
  path: string;
  score: number;
}

export interface PiStats {
  fileCount: number;
  indexedAt: string | null;
}

export class PiClient {
  private process: ChildProcess | null = null;
  private ready = false;
  private pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private commandId = 0;
  private buffer = "";

  connect(extensionPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn("node", [extensionPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.stdout?.setEncoding("utf8");
      this.process.stderr?.on("data", (chunk) => console.error("[Pi stderr]", chunk));

      this.process.stdout?.on("data", (chunk) => {
        this.buffer += chunk;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          this.handleMessage(line);
        }
      });

      this.process.on("error", reject);
      this.process.on("close", () => {
        this.ready = false;
      });

      // Wait for ready
      const checkReady = setInterval(() => {
        if (this.ready) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkReady);
        if (!this.ready) {
          reject(new Error("Pi connection timeout"));
        }
      }, 10000);
    });
  }

  private handleMessage(line: string): void {
    try {
      const data = JSON.parse(line);
      
      if (data.status === "ready") {
        this.ready = true;
        return;
      }

      const pending = this.pending.get(data.id || "");
      if (pending) {
        pending.resolve(data);
        this.pending.delete(data.id || "");
      }
    } catch {
      // Ignore parse errors
    }
  }

  private send(command: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.connected) {
        reject(new Error("Pi not connected"));
        return;
      }

      const id = `cmd_${++this.commandId}`;
      this.pending.set(id, { resolve, reject });

      this.process.stdin?.write(JSON.stringify({ ...command, id }) + "\n");

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Pi command timeout"));
        }
      }, 30000);
    });
  }

  async index(files: { path: string; content: string }[]): Promise<number> {
    const result = await this.send({ action: "index", files }) as { action: string; fileCount: number };
    return result.fileCount;
  }

  async search(query: string, topK: number): Promise<PiResult[]> {
    const result = await this.send({ action: "search", query, topK }) as { action: string; results: PiResult[] };
    return result.results;
  }

  async getStats(): Promise<PiStats> {
    const result = await this.send({ action: "stats" }) as PiStats;
    return result;
  }

  async clear(): Promise<void> {
    await this.send({ action: "clear" });
  }

  disconnect(): void {
    this.process?.kill();
    this.process = null;
    this.ready = false;
  }
}