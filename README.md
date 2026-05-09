# siyuan-mcp

A custom Model Context Protocol (MCP) server that gives [Claude Code](https://claude.ai/code) direct access to a self-hosted [SiYuan](https://b3log.org/siyuan/) knowledge base instance.

## Overview

SiYuan is a personal knowledge management system. This MCP server exposes SiYuan's notebooks, documents, and AI Memory store as tools that Claude Code can use during conversations — enabling persistent, structured context across sessions.

The server enforces a strict **read-only guard** on protected notebooks (`AI Convos.` and `General`), preventing accidental writes to personal notes while allowing full read access for context retrieval.

## Architecture

```
Claude Code
    │  stdio (stdin/stdout)
    ▼
siyuan-mcp (Node.js process)
    │  HTTP + Bearer token
    ▼
SiYuan instance (http://10.0.0.101:6806)
```

The server runs as a child process of Claude Code, spawned automatically at session start via `claude mcp`.

## Tools

| Tool | Description |
|------|-------------|
| `siyuan_search` | Full-text search across all SiYuan notebooks |
| `siyuan_get_document` | Fetch the full markdown content of a document by block ID |
| `siyuan_load_context` | Load a summary of all AI Memory entries (lightweight context load) |
| `siyuan_list_memory` | List all entries in a specific memory category |
| `siyuan_get_memory` | Fetch a single memory entry by key |
| `siyuan_save_memory` | Create or update an AI Memory entry |
| `siyuan_delete_memory` | Delete an AI Memory entry |
| `siyuan_request_write` | Request permission to write to a notebook (returns a confirmation token) |
| `siyuan_confirm_write` | Execute a write operation using a valid confirmation token |
| `siyuan_notify` | Push a notification to the SiYuan desktop UI |

### Memory categories

`siyuan_list_memory`, `siyuan_get_memory`, and `siyuan_save_memory` all operate within one of five categories:

| Category | Purpose |
|----------|---------|
| `Projects` | Active and past projects, status, key context |
| `Preferences` | User preferences, working style, tool choices |
| `Decisions` | Architectural and strategic decisions with rationale |
| `Research` | Findings, evaluations, component research |
| `Workflows` | Recurring processes, patterns, procedures |

## Project structure

```
siyuan-mcp/
├── src/
│   ├── index.ts              # MCP server init, env vars, request routing
│   ├── tools.ts              # Tool definitions and handlers
│   ├── siyuan-client.ts      # SiYuan REST API wrapper + read-only guard
│   ├── notebook-manager.ts   # AI Memory notebook lifecycle management
│   └── setup.ts              # One-time notebook bootstrapping script
├── dist/                     # Compiled output (gitignored)
├── package.json
└── tsconfig.json
```

## Requirements

- Node.js 18+
- A running SiYuan instance with API access enabled
- SiYuan API token (Settings → About → API Token)

## Installation

```bash
git clone http://10.0.0.123:3000/admin/siyuan-mcp.git
cd siyuan-mcp
npm install
npm run build
```

### Register with Claude Code

```bash
claude mcp add -s user siyuan-mcp \
  -e SIYUAN_URL=http://10.0.0.101:6806 \
  -e SIYUAN_TOKEN=<your-api-token> \
  -- node /path/to/siyuan-mcp/dist/index.js
```

## Environment variables

| Variable | Default | Required |
|----------|---------|----------|
| `SIYUAN_URL` | `http://10.0.0.101:6806` | No |
| `SIYUAN_TOKEN` | — | **Yes** |

## Development

```bash
npm run dev    # Run with tsx (no build step, live reload)
npm run build  # Compile TypeScript → dist/
npm start      # Run compiled output
```

## Protected notebooks

The following SiYuan notebooks are treated as **read-only** by this server:

- `AI Convos.` — personal conversation archive
- `General` — personal project notes and documentation

These can be searched and read freely but any write attempt is blocked at the client layer before an API call is made. To write to these notebooks, use `siyuan_request_write` and `siyuan_confirm_write` with explicit user authorisation.

## Notes

- The AI Memory notebook used by this server is separate from the PostgreSQL AI Memory system. See [postgres-mcp-config](http://10.0.0.123:3000/admin/postgres-mcp-config) for the primary long-term memory store used by Claude Code.
- The MCP server is spawned as a child process — it starts and stops with each Claude Code session. No persistent daemon is required.
