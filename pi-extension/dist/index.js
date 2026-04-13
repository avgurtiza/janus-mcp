// pi-extension/src/index.ts
import { VectorStore } from "./vector-store.js";
import { OllamaClient } from "./ollama-client.js";
import { parseCommand, createResponse } from "./protocol.js";
let vectorStore;
let ollama;
async function main() {
    vectorStore = new VectorStore();
    ollama = new OllamaClient();
    await vectorStore.initialize();
    // Handle stdin commands
    process.stdin.setEncoding("utf8");
    let buffer = "";
    process.stdin.on("data", async (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (!line.trim())
                continue;
            const command = parseCommand(line);
            if (!command)
                continue;
            const response = await handleCommand(command);
            process.stdout.write(createResponse(response));
        }
    });
    // Signal ready
    process.stdout.write(createResponse({ status: "ready" }));
}
async function handleCommand(command) {
    try {
        switch (command.action) {
            case "index": {
                const embeds = await Promise.all(command.files.map(async (f) => ({
                    path: f.path,
                    embedding: await ollama.embed(f.content),
                })));
                await vectorStore.addBatch(embeds);
                return { action: "indexed", fileCount: embeds.length };
            }
            case "search": {
                const queryEmbed = await ollama.embed(command.query);
                const results = await vectorStore.search(queryEmbed, command.topK);
                return { action: "search", results };
            }
            case "stats": {
                const stats = await vectorStore.getStats();
                return { action: "stats", ...stats };
            }
            case "clear": {
                await vectorStore.clear();
                return { action: "indexed", fileCount: 0 };
            }
            default:
                return { action: "error", message: "Unknown command" };
        }
    }
    catch (error) {
        return { action: "error", message: String(error) };
    }
}
main();
