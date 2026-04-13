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
- **Fast Mode**: 128-dim embeddings for sub-200ms search on massive codebases
- **Configurable**: `.janus-config.json` for folders, patterns, topK
- **Fast indexing**: ~40s reindex with parallel embeddings
- **Smart indexing**: Skip unchanged files, chunked for large files

## Quickstart

```bash
# Install dependencies
cd mcp-server && npm install

# Build
cd mcp-server && npm run build

# Start Ollama
ollama serve
ollama pull nomic-embed-text
```

### CLI Commands

Index your project:
```bash
cd /path/to/project
npx -C /path/to/janus/mcp-server janus index
```

Check stats:
```bash
npx -C /path/to/janus/mcp-server janus stats
```

## OpenCode Setup

Tell OpenCode:

```txt
Fetch and follow instructions from https://raw.githubusercontent.com/avgurtiza/janus-mcp/main/.opencode/INSTALL.md
```

Add Janus to your `opencode.json` config:

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

Or install globally:

```bash
cd mcp-server && npm install -g .
```

### Prerequisites

1. **Start Ollama** before using Janus:
```bash
ollama serve
ollama pull nomic-embed-text
```

2. **Create `.janus-config.json`** in your project root:
```json
{
  "includeFolders": ["app", "routes", "database"],
  "excludePatterns": ["node_modules", ".git", "vendor", "*.log"],
  "defaultTopK": 5,
  "fastMode": false,
  "autoFilter": true
}
```

### Usage

With `autoFilter: true` (default), Janus automatically filters context whenever your AI agent needs project files — no manual steps needed.

For manual use or debugging:

```bash
# Index current project (CLI)
node /path/to/janus/mcp-server/dist/index.js index

# Or MCP tool (for scripts/agents)
semantic_search(query: "payment logic")

# Get stats
get_index_stats()
```

### AI Agent Setup

To have your coding agent automatically use Janus:

**OpenCode:** Add to your system prompt or project instructions:
```
Before answering questions about this project, use the 'semantic_search' tool 
to find relevant files first. This improves accuracy and reduces context.
```

**Other agents:** Similar - add guidance to use `semantic_search` for context-heavy tasks.

The agent will automatically call Janus when it needs project context.

## Workflow Example

**Scenario:** You're working on a Laravel project and ask the LLM about user authentication.

With `autoFilter: true`, Janus automatically:
1. Scans your query → triggers `semantic_search("user authentication login")`
2. Returns top-ranked files → LLM receives only relevant context

No manual tool calls needed — it just works.

## Configuration

`.janus-config.json` in project root:

| Option | Default | Description |
|--------|---------|-------------|
| `includeFolders` | `["app", "routes", "database"]` | Folders to index |
| `excludePatterns` | `["node_modules", ".git", "vendor", "*.log"]` | Patterns to skip |
| `defaultTopK` | `5` | Number of files to return to LLM (context limit) |
| `fastMode` | `false` | Use 128-dim embeddings (6x faster search) |
| `autoFilter` | `true` | Agent auto-calls semantic_search for context tasks |

## Benchmark

| Metric | Value |
|--------|-------|
| Total tokens (full project) | 668,574 |
| Tokens (top 5 relevant) | ~2,000 |
| **Savings** | **99.7%** |
| Reindex time (189 files) | ~40s |
| Search time (386 chunks) | ~60ms |
| Fast mode search time | <1ms |

**Fast Mode** trades ~0.5% accuracy for **60x faster search** on large codebases.

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
- Embeddings: Ollama + nomic-embed-text
- Vector Store: SQLite
- Protocol: stdio JSON

## Requirements

- **Unix-like (macOS/Linux)**: Uses `fd` for fast file discovery — install via `brew install fd`
- **Ollama**: `nomic-embed-text` (274MB)
- **Windows**: Not supported (shell tools required) — PRs welcome!

## License

MIT