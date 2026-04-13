# Janus

A semantic **context filter** for LLMs. Sit between your project and the LLM to prune irrelevant files before context is sent. Reduce token costs by 50-99% while improving relevance.

## Why?

Most RAG servers store and index everything. Janus is different - it's a **middleware filter**:

```
Project Files → Janus (filter) → LLM Context
                ↑
            "I see 50 files, 
             narrowed to 5"
```

When the LLM needs context, Janus narrows the field - not a general search tool, but a **context pruner**.

## Features

- **Middleware filter**: Not a search tool - prunes context before LLM sees it
- **Client-agnostic**: Works with OpenCode, Cursor, Cline, Windsurf - any AI coding agent with MCP support
- **Local-first**: All processing happens on your machine
- **Semantic pruning**: Find relevant files even without exact keywords
- **Fast Mode**: Tiered embeddings — fast: 128 dims, accurate: 1024 dims
- **Matryoshka Embeddings**: Store 5 accuracy tiers (64/128/256/512/1024 dims) — fast search uses 128 dims, accurate uses 1024
- **Configurable**: `.janus-config.json` for folders, patterns, topK
- **Fast indexing**: ~40s reindex with parallel embeddings
- **Smart indexing**: Skip unchanged files, chunked for large files
- **Auto-detect project**: Walks up from cwd to find `.janus.db`
- **Meta entries**: Add semantic descriptions to files for better search

## Quickstart

```bash
# Install & build
cd mcp-server && npm install && npm run build

# Start Ollama (keep running)
ollama serve
ollama pull bge-m3:latest
```

### Index Your Project

```bash
cd /path/to/project
npx -C /path/to/janus/mcp-server janus index
```

### Search

```bash
npx -C /path/to/janus/mcp-server janus search --query="payment logic" --topK=5
```

### Check Stats

```bash
npx -C /path/to/janus/mcp-server janus stats
```

### Meta Commands

Add descriptions to files for better search:
```bash
janus meta add "app/Http/Controllers/CampsiteController.php" "Handles campsite CRUD operations"
janus meta list
janus meta delete "app/Http/Controllers/CampsiteController.php"
```

## Configuration

Create `.janus-config.json` in your project root:

| Option | Default | Description |
|--------|---------|-------------|
| `includeFolders` | `["app", "routes", "database"]` | Folders to index |
| `excludePatterns` | `["node_modules", ".git", "vendor", "*.log"]` | Patterns to skip |
| `defaultTopK` | `5` | Number of files to return to LLM |
| `fastMode` | `false` | Use tiered embeddings — fast: 128 dims, accurate: 1024 dims |
| `fastModeDim` | `128` | Dimension for fast mode search |
| `normalModeDim` | `1024` | Dimension for accurate mode search |
| `embeddingModel` | `"bge-m3:latest"` | Ollama embedding model |
| `autoFilter` | `true` | Agent auto-calls semantic_search |

## OpenCode Setup

Add Janus to your `opencode.json` config:

```json
{
  "mcp": {
    "janus": {
      "command": ["npx", "-C", "/path/to/janus/mcp-server", "janus"],
      "enabled": true,
      "type": "local"
    }
  }
}
```

Search via MCP:
```bash
semantic_search(query: "payment logic", topK: 10)
```

The tool auto-detects which project to search based on the current working directory. You can also explicitly specify `projectPath`.

### AI Agent Prompt

To have your coding agent automatically use Janus, add to your system prompt:
```
Before answering questions about this project, use the 'semantic_search' tool 
to find relevant files first. This improves accuracy and reduces context.
```

## Supported Embedding Models

- **bge-m3** (recommended) - Best semantic understanding, 1024 dims
- **nomic-embed-text** - Alternative, 768 dims
- **mxbai-embed-large** - Good quality but may have Ollama issues

## Architecture

```
Project Files → Janus (semantic filter) → LLM Context
                      ↓
              SQLite (vector index)
              Ollama (embeddings)
```

Janus doesn't replace your files - it filters what the LLM sees.

## Tech Stack

- MCP Server: Node.js + TypeScript
- Embeddings: Ollama + bge-m3 (Matryoshka: 5 tier levels)
- Vector Store: SQLite
- Protocol: stdio JSON

## Requirements

- **Unix-like (macOS/Linux)**: Uses `fd` for fast file discovery — install via `brew install fd`
- **Ollama**: `bge-m3:latest` (MRL-capable embedding model)
- **Windows**: Not supported (shell tools required) — PRs welcome!

## License

MIT