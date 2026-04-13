# Semantic Context Gatekeeper - Quickstart

A standalone MCP server that uses local embeddings (EmbeddingGemma via Ollama) to prune context before sending to cloud LLMs.

## Prerequisites

- Node.js 20+
- [Ollama](https://github.com/ollama/ollama) installed with `embeddinggemma` model

```bash
# Pull the embedding model
ollama pull embeddinggemma
```

## Setup

```bash
# Install dependencies
cd mcp-server && npm install
cd pi-extension && npm install

# Build both
cd mcp-server && npm run build
cd pi-extension && npm run build
```

## Running

**Terminal 1 - Start Ollama:**
```bash
ollama serve
```

**Terminal 2 - Start Pi Extension:**
```bash
cd pi-extension && node dist/index.js
```

**Terminal 3 - Start MCP Server:**
```bash
cd mcp-server && node dist/index.js
```

## Configuration

Create `.semantic-gatekeeper.json` in your project root:

```json
{
  "excludePatterns": ["node_modules", ".git", "vendor", "*.log"],
  "defaultTopK": 5
}
```

## Usage (in OpenCode)

Once configured as an MCP server:

```bash
# Index a project
reindex(projectPath: "/path/to/laravel-project")

# Search semantically
semantic_search(query: "payment processing logic", topK: 5)

# Get stats
get_index_stats()
```

## Troubleshooting

**"Ollama not running":**
```bash
ollama serve
```

**"embedding-gemma not found":**
```bash
ollama pull embedding-gemma
```

**Empty results:** Run `reindex` first to build the vector index.