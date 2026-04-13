# Janus OpenCode Install

Fetch and follow instructions from the local file:
`/Users/tatay/projects/ai/janus/.opencode/INSTALL.md`

## Steps

1. Ensure dependencies are installed:
   - `cd /Users/tatay/projects/ai/janus/mcp-server && npm install`

2. Build Janus MCP server:
   - `cd /Users/tatay/projects/ai/janus/mcp-server && npm run build`

3. (Optional) Install Janus CLI globally:
   - `cd /Users/tatay/projects/ai/janus/mcp-server && npm install -g .`

4. Add Janus MCP server to OpenCode config (`opencode.json`):

```json
{
  "mcp": {
    "janus": {
      "command": ["npx", "janus"],
      "enabled": true,
      "type": "local"
    }
  }
}
```

5. Start embedding backend before using Janus:
   - `ollama serve`
   - `ollama pull nomic-embed-text`

6. In the target project, create `.janus-config.json`:

```json
{
  "includeFolders": ["app", "routes", "database"],
  "excludePatterns": ["node_modules", ".git", "vendor", "*.log"],
  "defaultTopK": 5,
  "fastMode": false,
  "autoFilter": true
}
```

7. Index target project:
   - `cd /path/to/project`
   - `npx -C /Users/tatay/projects/ai/janus/mcp-server janus index`

8. Verify index:
   - `npx -C /Users/tatay/projects/ai/janus/mcp-server janus stats`
