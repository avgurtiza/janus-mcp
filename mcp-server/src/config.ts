import fs from "fs";
import path from "path";

export interface Config {
  excludePatterns: string[];
  defaultTopK: number;
}

const DEFAULT_CONFIG: Config = {
  excludePatterns: ["node_modules", ".git", "vendor", "*.log"],
  defaultTopK: 5,
};

export function loadConfig(projectPath: string): Config {
  const configPath = path.join(projectPath, ".semantic-gatekeeper.json");
  
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