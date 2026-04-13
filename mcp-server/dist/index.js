import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import { PiClient } from "./pi-client.js";
import fs from "fs";
import path from "path";
const semanticSearchInputSchema = fromJsonSchema({
    type: "object",
    properties: {
        query: { type: "string" },
        topK: { type: "number" },
    },
    required: ["query"],
});
const reindexInputSchema = fromJsonSchema({
    type: "object",
    properties: {
        projectPath: { type: "string" },
    },
    required: ["projectPath"],
});
const reindexOutputSchema = fromJsonSchema({
    type: "object",
    properties: {
        fileCount: { type: "number" },
    },
});
async function main() {
    const piClient = new PiClient();
    const extensionPath = path.join(process.cwd(), "../pi-extension/dist/index.js");
    await piClient.connect(extensionPath);
    const server = new McpServer({
        name: "semantic-gatekeeper",
        version: "1.0.0",
    });
    const projectPath = process.cwd();
    server.registerTool("semantic_search", {
        title: "Semantic Search",
        description: "Search for relevant files using semantic embeddings",
        inputSchema: semanticSearchInputSchema,
    }, async ({ query, topK }) => {
        const results = await piClient.search(query, topK || 10);
        return {
            content: results.map((r) => ({
                type: "text",
                text: JSON.stringify(r),
            })),
        };
    });
    server.registerTool("reindex", {
        title: "Reindex",
        description: "Rebuild the vector index for a project",
        inputSchema: reindexInputSchema,
        outputSchema: reindexOutputSchema,
    }, async ({ projectPath: projPath }) => {
        const configPath = path.join(projPath, ".janus.json");
        let excludePatterns = ["node_modules", ".git", "dist", "build"];
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            excludePatterns = config.excludePatterns || excludePatterns;
        }
        const files = await scanDirectory(projPath, excludePatterns);
        const fileContents = await Promise.all(files.map(async (filePath) => ({
            path: filePath,
            content: fs.readFileSync(filePath, "utf-8"),
        })));
        const count = await piClient.index(fileContents);
        return {
            content: [{ type: "text", text: JSON.stringify({ fileCount: count }) }],
            structuredContent: { fileCount: count },
        };
    });
    server.registerTool("get_index_stats", {
        title: "Get Index Stats",
        description: "Get statistics about the current index",
        inputSchema: fromJsonSchema({
            type: "object",
            properties: {},
        }),
    }, async () => {
        const stats = await piClient.getStats();
        return {
            content: [{ type: "text", text: JSON.stringify(stats) }],
        };
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Semantic Context Gatekeeper MCP server started");
}
async function scanDirectory(dirPath, excludePatterns) {
    const files = [];
    function matchesPattern(name, patterns) {
        for (const pattern of patterns) {
            if (pattern.startsWith("*")) {
                if (name.endsWith(pattern.slice(1)))
                    return true;
            }
            else if (name === pattern || name.startsWith(pattern + "/")) {
                return true;
            }
        }
        return false;
    }
    async function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (matchesPattern(entry.name, excludePatterns))
                continue;
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    }
    await walk(dirPath);
    return files;
}
main().catch(console.error);
