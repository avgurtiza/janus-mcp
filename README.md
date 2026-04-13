# Janus MCP Server

A semantic **context filter** for LLMs. Sit between your project and the LLM to prune irrelevant files before context is sent. Reduce token costs by 50-99% while improving relevance.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why?

Most RAG servers store and index everything. Janus is different - it's a **middleware filter**:

```text
Project Files → Janus (filter) → LLM Context
                ↑
            "I see 50 files, 
             narrowed to 5"
```

When the LLM needs context, Janus narrows the field. It's not a general search tool, but a **context pruner** designed to act as an MCP (Model Context Protocol) Server for AI coding agents.

## Features

- **Middleware filter**: Prunes context before the LLM sees it.
- **Client-agnostic**: Works seamlessly with OpenCode, Cursor, Cline, Windsurf, or any AI coding agent with MCP support.
- **Local-first**: All processing and vector storage happens completely on your machine.
- **Semantic pruning**: Find relevant files using natural language, even without exact keyword matches.
- **Matryoshka Embeddings**: Stores 5 accuracy tiers (64/128/256/512/1024 dims). Fast search uses 128 dims, while accurate search uses 1024.
- **Fast & Smart Indexing**:
  - ~40s reindex with parallel embeddings.
  - Skips unchanged files automatically.
  - Chunks large files for better semantic matching.
- **Meta entries**: Add explicit semantic descriptions to files for enhanced search accuracy.
- **Configurable**: Define folders, ignore patterns, and topK limits via `.janus-config.json`.
- **Auto-detect project**: Walks up the directory tree from `cwd` to find `.janus.db`.

## Requirements

- **Unix-like OS**: macOS or Linux
- **Node.js**: v18+ 
- **Ollama**: Installed and running locally
- **fd**: Required for fast file discovery (`brew install fd` or `apt-get install fd-find`)

*(Note: Windows is not supported due to shell tool requirements, but PRs are welcome!)*

## Quickstart

### 1. Install & Build
```bash
# Clone the repository
git clone https://github.com/avgurtiza/janus-mcp.git
cd janus-mcp/mcp-server

# Install dependencies and build
npm install
npm run build
```

### 2. Setup Ollama
Ensure Ollama is running and pull the recommended embedding model:
```bash
ollama serve
ollama pull bge-m3:latest
```

### 3. Index Your Project
Navigate to any project you want to index and run Janus from its installation path:
```bash
cd /path/to/your/project
npx -C /path/to/janus-mcp/mcp-server janus index
```

### 4. Search & Check Stats
Test the search and view index statistics directly from the CLI:
```bash
# Search your indexed project
npx -C /path/to/janus-mcp/mcp-server janus search --query="payment logic" --topK=5

# View index stats
npx -C /path/to/janus-mcp/mcp-server janus stats
```

## IDE / Agent Setup

Add Janus to your MCP configuration file. Here is an example for **OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "janus": {
      "command": ["npx", "-C", "/path/to/janus-mcp/mcp-server", "janus"],
      "enabled": true,
      "type": "local"
    }
  }
}
```

Once configured, the agent can call the exposed tool:
```javascript
semantic_search(query: "payment logic", topK: 10)
```
The tool auto-detects which project to search based on the current working directory. You can also explicitly specify `projectPath`.

### Optional: AI Agent Prompt

To encourage your coding agent to actually use Janus, add this to your custom system prompts:
> *"Before answering questions about this project, use the 'semantic_search' tool to find relevant files first. This improves accuracy and reduces context size."*

## Configuration

Create a `.janus-config.json` in your project's root directory to override defaults:

| Option | Default | Description |
|--------|---------|-------------|
| `includeFolders` | `["app", "routes", "database"]` | Specific folders to map |
| `excludePatterns` | `["node_modules", ".git", "vendor", "*.log"]` | Glob patterns to skip |
| `defaultTopK` | `5` | Default number of files returned |
| `fastMode` | `false` | Use tiered embeddings for speed |
| `fastModeDim` | `128` | Dimensions used for fast mode search |
| `normalModeDim` | `1024` | Dimensions used for accurate mode search |
| `embeddingModel` | `"bge-m3:latest"` | Ollama embedding model to use |
| `autoFilter` | `true` | Hints agent to auto-call semantic_search |

## Meta Commands

You can attach manual descriptions to specific files to dramatically improve search accuracy for that file.

```bash
# Add a description
npx -C /path/to/janus-mcp/mcp-server janus meta add "app/Http/Controllers/CampsiteController.php" "Handles campsite CRUD operations"

# List all meta entries
npx -C /path/to/janus-mcp/mcp-server janus meta list

# Delete a meta entry
npx -C /path/to/janus-mcp/mcp-server janus meta delete "app/Http/Controllers/CampsiteController.php"
```

## Supported Embedding Models

- **bge-m3** (recommended) - Best semantic understanding, 1024 dims limit.
- **nomic-embed-text** - Lighter alternative, 768 dims.
- **mxbai-embed-large** - Good quality but may have Ollama compatibility quirks.

## Architecture

```text
Project Files → Janus (semantic filter) → LLM Context
                      ↓
              SQLite (vector index)
              Ollama (embeddings)
```

Janus NEVER modifies your project files - it strictly acts as a read-only filter for what the LLM agent sees.

## Tech Stack

- **MCP Server**: Node.js + TypeScript
- **Embeddings**: Ollama + `bge-m3` (Matryoshka Representation Learning)
- **Vector Store**: SQLite (`sqlite-vec` extension)
- **Protocol**: Standard MCP via stdio

## License

MIT