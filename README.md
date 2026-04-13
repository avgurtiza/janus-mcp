# Semantic Context Gatekeeper

A standalone MCP server that uses local embeddings to prune context before sending to cloud LLMs. Reduce token costs by 50-99% while improving relevance.

## Why?

When using cloud LLMs (Claude 3.5, GPT-4o) for large projects, costs and latency rise as the model "reads" irrelevant files. This MCP server:

1. **Indexes your project** locally using EmbeddingGemma (via Ollama)
2. **Finds relevant files** via semantic similarity search
3. **Prunes context** to only high-signal files before sending to cloud

## Features

- **Local-first**: All processing happens on your machine
- **Semantic search**: Find related files even without exact keywords
- **Configurable**: Exclude patterns via `.semantic-gatekeeper.json`
- **Fast**: <200ms search time

## Quickstart

```bash
# Install dependencies
cd mcp-server && npm install
cd pi-extension && npm install

# Build
cd mcp-server && npm run build
cd pi-extension && npm run build

# Start Ollama
ollama serve
ollama pull embeddinggemma

# Terminal 1: Start Pi extension
cd pi-extension && node dist/index.js

# Terminal 2: Start MCP server
cd mcp-server && node dist/index.js
```

## Configuration

Create `.semantic-gatekeeper.json` in project root:

```json
{
  "excludePatterns": ["node_modules", ".git", "vendor", "*.log"],
  "defaultTopK": 5
}
```

## Tools

Once configured in OpenCode:

```javascript
// Index a project
reindex(projectPath: "/path/to/project")

// Search semantically
semantic_search(query: "payment logic", topK: 5)

// Get stats
get_index_stats()
```

## Benchmark

| Metric | Value |
|--------|-------|
| Total tokens (full project) | 936,605 |
| Tokens (top 5 relevant) | ~2,500 |
| **Savings** | **99.7%** |

## Architecture

```
OpenCode → MCP Server → Pi (daemon) → Ollama → sqlite-vec
```

## Tech Stack

- MCP Server: Node.js + TypeScript
- Embeddings: Ollama + EmbeddingGemma
- Vector Store: SQLite (in-memory similarity)
- Protocol: stdio JSON

## License

MIT