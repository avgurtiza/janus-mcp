import { spawn } from "child_process";
export class PiClient {
    process = null;
    ready = false;
    pending = new Map();
    commandId = 0;
    buffer = "";
    connect(extensionPath) {
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
                    if (!line.trim())
                        continue;
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
    handleMessage(line) {
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
        }
        catch {
            // Ignore parse errors
        }
    }
    send(command) {
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
    async index(files) {
        const result = await this.send({ action: "index", files });
        return result.fileCount;
    }
    async search(query, topK) {
        const result = await this.send({ action: "search", query, topK });
        return result.results;
    }
    async getStats() {
        const result = await this.send({ action: "stats" });
        return result;
    }
    async clear() {
        await this.send({ action: "clear" });
    }
    disconnect() {
        this.process?.kill();
        this.process = null;
        this.ready = false;
    }
}
