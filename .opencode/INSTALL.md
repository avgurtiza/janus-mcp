# Janus OpenCode Install

Fetch and follow instructions from the local file:
`https://github.com/avgurtiza/janus-mcp/blob/main/.opencode/INSTALL.md`

## Steps

1. Ensure dependencies are installed:
   - `cd janus-mcp/mcp-server && npm install`

2. Build Janus MCP server:
   - `cd janus-mcp/mcp-server && npm run build`

3. (Optional) Install Janus CLI globally:
   - `cd janus-mcp/mcp-server && npm install -g .`

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
   - `ollama pull bge-m3`

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
   - `npx -C janus-mcp/mcp-server janus index`

8. Verify index:
   - `npx -C janus-mcp/mcp-server janus stats`
