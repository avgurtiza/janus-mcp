import fs from "fs";
import path from "path";

export interface Config {
  excludePatterns: string[];
  includeFolders: string[];
  defaultTopK: number;
  fastMode: boolean;
  autoFilter: boolean;
  embeddingModel: string;
  fastModeDim: number;
  normalModeDim: number;
}

const DEFAULT_CONFIG: Config = {
  excludePatterns: ["node_modules", ".git", "vendor", "*.log"],
  includeFolders: ["app", "routes", "database"],
  defaultTopK: 5,
  fastMode: false,
  autoFilter: true,
  embeddingModel: "bge-m3:latest",
  fastModeDim: 128,
  normalModeDim: 1024,
};

export function loadConfig(projectPath: string): Config {
  const configPath = path.join(projectPath, ".janus-config.json");
  
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  
  return DEFAULT_CONFIG;
}