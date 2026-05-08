# siyuan-mcp

An MCP (Model Context Protocol) server that gives Claude persistent memory and reference access via [SiYuan Note](https://github.com/siyuan-note/siyuan).

## What it does

- **Persistent AI memory** — Claude autonomously saves project context, your preferences, decisions, research, and workflows to a dedicated `AI Memory` notebook in SiYuan. This persists across all future conversations.
- **Read-only reference** — Claude can proactively search and read your `AI Convos` and `General` notebooks but can never modify them without your explicit confirmation.
- **Token savings** — instead of re-pasting context at the start of every conversation, Claude loads a structured summary from SiYuan.

---

## Notebook structure

The server creates and manages one notebook: **AI Memory**

```
AI Memory/
├── Projects/
│   └── project::<key>       ← one doc per project
├── Preferences/
│   └── preferences::<key>   ← working style, tool choices, etc.
├── Decisions/
│   └── decision::<key>      ← decisions + rationale
├── Research/
│   └── research::<key>      ← facts and findings
└── Workflows/
    └── workflow::<key>       ← recurring task patterns
```

Each document stores a single JSON block for fast, deterministic retrieval. The structure is optimised for AI — not human browsing.

Your existing notebooks (`AI Convos`, `General`) are **read-only** at the server level. Any attempted write is blocked unless you explicitly approve a confirmation token.

---

## Prerequisites

- Node.js 20+
- SiYuan Note running and accessible (default: `http://10.0.0.101:6806`)
- SiYuan API token (Settings → About → API Token)

---

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/siyuan-mcp.git
cd siyuan-mcp
npm install
npm run build
```

### First-time notebook setup

Run this once to create the `AI Memory` notebook and category structure in SiYuan:

```bash
SIYUAN_TOKEN=your_token_here npm run setup-notebook
```

---

## Running at boot (macOS)

```bash
chmod +x scripts/install-launchd.sh
./scripts/install-launchd.sh
```

This will prompt for your API token, write the launchd plist, and load it. The server will start automatically at every login.

**Useful commands after install:**

```bash
# Check it's running
launchctl list | grep siyuan-mcp

# View logs
tail -f /tmp/siyuan-mcp.log
tail -f /tmp/siyuan-mcp.error.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.siyuan-mcp.plist

# Restart
launchctl kickstart -k gui/$(id -u)/com.siyuan-mcp
```

---

## Connecting to Claude

Add this to your Claude MCP configuration (e.g. `~/.config/claude/mcp.json` or your Claude Desktop config):

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": ["/absolute/path/to/siyuan-mcp/dist/index.js"],
      "env": {
        "SIYUAN_URL": "http://10.0.0.101:6806",
        "SIYUAN_TOKEN": "your_token_here"
      }
    }
  }
}
```

---

## Available tools

| Tool | Permission | Description |
|------|-----------|-------------|
| `siyuan_search` | Read (all notebooks) | Full-text search across all notebooks |
| `siyuan_get_memory` | Read (AI Memory) | Fetch a specific memory entry |
| `siyuan_list_memory` | Read (AI Memory) | List all entries in a category |
| `siyuan_load_context` | Read (AI Memory) | Load all entry summaries (low token cost) |
| `siyuan_save_memory` | Write (AI Memory only) | Autonomously save/update a memory entry |
| `siyuan_delete_memory` | Write (AI Memory only) | Delete a memory entry |
| `siyuan_request_write` | Confirm-required | Request write to a user notebook |
| `siyuan_confirm_write` | Confirm-required | Approve a pending write operation |
| `siyuan_notify` | Write (UI only) | Push a notification to SiYuan desktop |

---

## Memory schema

Every entry stored by Claude follows this structure:

```json
{
  "schema_version": 1,
  "category": "Projects",
  "key": "my-app",
  "title": "My App — Project Context",
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-05-08T12:00:00.000Z",
  "tags": ["typescript", "backend"],
  "data": {
    "status": "active",
    "stack": ["Node.js", "PostgreSQL"],
    "goals": "Build a personal finance tracker",
    "last_discussed": "2026-05-08"
  }
}
```

---

## Security notes

- The `SIYUAN_TOKEN` is read from environment variables — never commit it to git.
- The `.env` file is gitignored. Use `.env.example` as a template.
- The launchd installer stores the token only in `~/Library/LaunchAgents/com.siyuan-mcp.plist`, which is owned by your user.
- Write protection for `AI Convos` and `General` is enforced at the API client layer — blocked before any HTTP request is sent.

---

## Development

```bash
# Run in dev mode (no build step needed)
SIYUAN_TOKEN=your_token npm run dev
```

---

## Licence

MIT
