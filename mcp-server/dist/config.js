import fs from "fs";
import path from "path";
const DEFAULT_CONFIG = {
    excludePatterns: ["node_modules", ".git", "vendor", "*.log"],
    includeFolders: ["app", "routes", "database"],
    defaultTopK: 5,
};
export function loadConfig(projectPath) {
    const configPath = path.join(projectPath, ".janus-config.json");
    if (fs.existsSync(configPath)) {
        try {
            const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            return { ...DEFAULT_CONFIG, ...userConfig };
        }
        catch {
            return DEFAULT_CONFIG;
        }
    }
    return DEFAULT_CONFIG;
}
