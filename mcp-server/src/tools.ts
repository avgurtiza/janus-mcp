import { z } from "zod";
import { PiClient } from "./pi-client.js";
import { loadConfig } from "./config.js";
import fs from "fs";
import path from "path";

const semanticSearchSchema = z.object({
  query: z.string(),
  topK: z.number().optional(),
});

const reindexSchema = z.object({
  projectPath: z.string(),
});

export function createTools(piClient: PiClient, projectPath: string) {
  const config = loadConfig(projectPath);
  
  return {
    semantic_search: {
      description: "Search for relevant files using semantic embeddings",
      parameters: semanticSearchSchema,
      execute: async (params: z.infer<typeof semanticSearchSchema>) => {
        const topK = params.topK || config.defaultTopK;
        const results = await piClient.search(params.query, topK);
        return {
          content: results.map((r) => ({
            type: "text" as const,
            text: JSON.stringify(r),
          })),
        };
      },
    },

    reindex: {
      description: "Rebuild the vector index for a project",
      parameters: reindexSchema,
      execute: async (params: z.infer<typeof reindexSchema>) => {
        const localConfig = loadConfig(params.projectPath);
        const files = await scanDirectory(params.projectPath, localConfig.excludePatterns);
        
        const fileContents = await Promise.all(
          files.map(async (filePath) => ({
            path: filePath,
            content: fs.readFileSync(filePath, "utf-8"),
          }))
        );

        const count = await piClient.index(fileContents);
        return {
          content: [{ type: "text", text: JSON.stringify({ fileCount: count }) }],
        };
      },
    },

    get_index_stats: {
      description: "Get statistics about the current index",
      parameters: z.object({}),
      execute: async () => {
        const stats = await piClient.getStats();
        return {
          content: [{ type: "text", text: JSON.stringify(stats) }],
        };
      },
    },
  };
}

async function scanDirectory(
  dirPath: string,
  excludePatterns: string[]
): Promise<string[]> {
  const files: string[] = [];

  function matchesPattern(name: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern.startsWith("*")) {
        if (name.endsWith(pattern.slice(1))) return true;
      } else if (name === pattern || name.startsWith(pattern + "/")) {
        return true;
      }
    }
    return false;
  }

  async function walk(dir: string): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (matchesPattern(entry.name, excludePatterns)) continue;
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(dirPath);
  return files;
}