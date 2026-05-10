#!/usr/bin/env node
/**
 * SiYuan MCP Server — main entry point
 *
 * Exposes SiYuan Note as an MCP server with:
 *   - Read access to all notebooks
 *   - Write access only to "AI Memory" notebook (autonomous)
 *   - Confirmation-required writes to user notebooks
 *
 * Configuration via environment variables:
 *   SIYUAN_URL   — e.g. http://10.0.0.101:6806
 *   SIYUAN_TOKEN — API token from SiYuan Settings → About
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { SiYuanClient } from "./siyuan-client.js";
import { NotebookManager } from "./notebook-manager.js";
import { getToolDefinitions, handleTool } from "./tools.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const SIYUAN_URL = process.env.SIYUAN_URL ?? "http://10.0.0.101:6806";
const SIYUAN_TOKEN = process.env.SIYUAN_TOKEN ?? "";

if (!SIYUAN_TOKEN) {
  console.error(
    "[siyuan-mcp] ERROR: SIYUAN_TOKEN environment variable is not set.\n" +
      "Find your token in SiYuan → Settings → About → API Token."
  );
  process.exit(1);
}

// ─── Initialise SiYuan client & notebook manager ─────────────────────────────

const client = new SiYuanClient({ baseUrl: SIYUAN_URL, token: SIYUAN_TOKEN });
const manager = new NotebookManager(client);

// ─── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "siyuan-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: getToolDefinitions() };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleTool(
      name,
      (args ?? {}) as Record<string, unknown>,
      client,
      manager
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[siyuan-mcp] Tool error (${name}):`, message);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  console.error(`[siyuan-mcp] Connecting to SiYuan at ${SIYUAN_URL}...`);

  // Initialise read-only guard
  await client.initReadonlyGuard();
  console.error("[siyuan-mcp] Read-only guards loaded.");

  // Find AI Memory notebook if it exists (no longer auto-created — memory moved to PostgreSQL)
  const notebookId = await manager.init();
  if (notebookId) {
    console.error(`[siyuan-mcp] AI Memory notebook found (${notebookId})`);
  } else {
    console.error("[siyuan-mcp] AI Memory notebook not present — PostgreSQL memory in use");
  }

  // Start MCP server over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[siyuan-mcp] Server running. Waiting for tool calls...");
}

main().catch((err) => {
  console.error("[siyuan-mcp] Fatal error:", err);
  process.exit(1);
});
