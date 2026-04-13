# Janus MCP Server

A standalone **semantic context gatekeeper** for LLMs. Janus sits between your local project and cloud LLMs to prune irrelevant files before context is sent, reducing token costs by **50–99%** while significantly improving model relevance.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why Janus?

In Roman mythology, Janus is the god of gates and transitions. Most RAG systems attempt to index your entire life; Janus is a **zero-daemon middleware filter** designed to "guard the gate" of your LLM’s context window.

By offloading the discovery phase to a lightweight local embedding model, you keep your KV cache lean and response times fast, even on memory-constrained machines like a 16GB Mac Mini.

```text
Project Files → Janus (Gatekeeper) → LLM Context
                ↑
            "Scanned 50 files, 
             passing 5 high-signal files"
```

When the LLM needs context, Janus narrows the field. It's not a general search tool, but a **context pruner** designed to act as an MCP (Model Context Protocol) Server for AI coding agents.

## Key Features

- **Zero-Daemon Architecture**: A standalone CLI and MCP server that only activates when needed. No background services are required.
- **The Matryoshka Advantage**: Uses MRL (Matryoshka Representation Learning) models to offer 5 accuracy tiers (e.g., 64 to 1024 dims). Truncating embeddings to 128 or 256 dimensions provides near-instant search speeds with minimal accuracy loss.
- **Client-Agnostic**: Works seamlessly with OpenCode, Cursor, Cline, Windsurf, or any AI coding agent with MCP support.
- **Local-First Privacy**: All processing and vector storage happens completely on your machine.
- **Smart Delta Indexing**: Powered by SQLite to only re-index files that have been modified, ensuring your index stays fresh without burning CPU. Chunks large files for better semantic matching.
- **Meta-Aware Search**: Manually add explicit semantic descriptions to files to help the model find "that one obscure helper" even if its content is sparse.
- **Configurable**: Define folders, ignore patterns, and topK limits via `.janus-config.json`.
- **Auto-Detect Project**: Walks up the directory tree from `cwd` to find `.janus.db`.

## Why it Wins vs. Standard RAG

- **Speed**: Search times are typically **<200ms**, compared to the multi-second latency of cloud-based vector searches.
- **Privacy**: No code or environment variables ever leave your machine during the indexing or pruning phase.
- **Precision**: By pruning at the file level before the LLM "reads" anything, you prevent "context bloat" in deep directory structures like Laravel or Monorepos.

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

1. **bge-m3** (recommended) - Best-in-class semantic understanding and full Matryoshka support.
2. **EmbeddingGemma** - Extremely lightweight (300M parameters) and highly efficient for local-first workflows.
3. **nomic-embed-text** - A reliable alternative with a 768-dimension base.
4. **mxbai-embed-large** - Good quality but may have Ollama compatibility quirks.

## Architecture

```text
Project Files → Janus (Gatekeeper) → LLM Context
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