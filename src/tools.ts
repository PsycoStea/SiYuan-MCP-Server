/**
 * MCP Tool definitions and handlers for the SiYuan MCP server.
 *
 * Tools are grouped into three permission tiers:
 *   1. READ-ONLY reference  — search/read any notebook
 *   2. AI MEMORY write      — write only to "AI Memory" notebook
 *   3. CONFIRM-REQUIRED     — any write touching user notebooks requires
 *                             explicit confirmation (returns a pending token
 *                             that the user must approve)
 */

import { SiYuanClient } from "./siyuan-client.js";
import { NotebookManager, Category, CATEGORIES } from "./notebook-manager.js";

// ─── Pending confirmation store ───────────────────────────────────────────────
// In-process map of token → operation. Cleared after use or TTL.

interface PendingOp {
  description: string;
  notebookId: string;
  expiresAt: number; // unix ms
  execute: () => Promise<unknown>;
}

const pendingOps = new Map<string, PendingOp>();
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateToken(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of pendingOps) {
    if (v.expiresAt < now) pendingOps.delete(k);
  }
}

// ─── Tool registry ────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function getToolDefinitions(): ToolDefinition[] {
  return [
    // ── READ: Search across all notebooks ──────────────────────────────────
    {
      name: "siyuan_search",
      description:
        "Full-text search across ALL SiYuan notebooks (including read-only ones). " +
        "Use proactively whenever the user's query might relate to something they've previously noted. " +
        "Returns block content, notebook, and path.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search terms (keywords, project names, topics)",
          },
          notebooks: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional: restrict to specific notebook names, e.g. [\"AI Convos\", \"General\", \"AI Memory\"]",
          },
        },
        required: ["query"],
      },
    },

    // ── READ: Get a specific memory entry ──────────────────────────────────
    {
      name: "siyuan_get_memory",
      description:
        "Retrieve a specific entry from the AI Memory notebook by category and key.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: CATEGORIES,
            description: "Memory category",
          },
          key: {
            type: "string",
            description:
              "Entry key/slug, e.g. \"my-app\", \"dark-mode\", \"use-pnpm\"",
          },
        },
        required: ["category", "key"],
      },
    },

    // ── READ: List all memory entries in a category ─────────────────────────
    {
      name: "siyuan_list_memory",
      description:
        "List all memory entries in a category, returning title, key, tags, and updated_at. " +
        "Use at the start of a conversation to load relevant context.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: CATEGORIES,
            description: "Memory category to list",
          },
        },
        required: ["category"],
      },
    },

    // ── READ: Bulk load context ─────────────────────────────────────────────
    {
      name: "siyuan_load_context",
      description:
        "Load a summary of ALL AI Memory entries across all categories. " +
        "Call this at the beginning of a new conversation to orient yourself. " +
        "Returns titles, keys, tags, and updated_at — not full data — to minimise token usage.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },

    // ── READ: Fetch a document by ID ───────────────────────────────────────
    {
      name: "siyuan_get_document",
      description:
        "Fetch the full markdown content of any SiYuan document by its block ID. " +
        "Use when you have a specific doc ID and need to read the complete contents. " +
        "Works across all notebooks including read-only ones.",
      inputSchema: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "The SiYuan block ID of the document, e.g. \"20260507173524-lv939k9\"",
          },
        },
        required: ["doc_id"],
      },
    },

    // ── WRITE: Upsert a memory entry ────────────────────────────────────────
    {
      name: "siyuan_save_memory",
      description:
        "Save or update an entry in the AI Memory notebook. " +
        "Use autonomously whenever you learn something worth persisting: project status changes, " +
        "user preferences, decisions made, research findings, or workflow patterns. " +
        "Notify the user after saving (do not ask permission first). " +
        "NEVER call this for notebooks 'AI Convos' or 'General'.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: CATEGORIES,
            description: "Which memory category this belongs to",
          },
          key: {
            type: "string",
            description:
              "Unique slug for this entry, e.g. \"my-app\", \"prefers-tabs\". " +
              "Use lowercase-hyphenated. Will be created or overwritten.",
          },
          title: {
            type: "string",
            description: "Human-readable title for this entry",
          },
          data: {
            type: "object",
            description:
              "The structured data to store. Use descriptive keys. " +
              "For Projects: include status, stack, goals, last_discussed. " +
              "For Decisions: include decision, rationale, alternatives_considered, date. " +
              "For Preferences: include preference, context, strength (strong/mild). " +
              "For Research: include summary, source, confidence, topic. " +
              "For Workflows: include steps, trigger, tools.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for cross-referencing, e.g. [\"typescript\", \"backend\"]",
          },
        },
        required: ["category", "key", "title", "data"],
      },
    },

    // ── WRITE: Delete a memory entry ────────────────────────────────────────
    {
      name: "siyuan_delete_memory",
      description:
        "Delete an entry from the AI Memory notebook. " +
        "Use when information is confirmed outdated or explicitly asked to forget.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: CATEGORIES,
          },
          key: { type: "string" },
        },
        required: ["category", "key"],
      },
    },

    // ── CONFIRM-REQUIRED: Request write access to user notebooks ───────────
    {
      name: "siyuan_request_write",
      description:
        "Request permission to write to a user notebook ('AI Convos' or 'General'). " +
        "Returns a confirmation token. The user must call siyuan_confirm_write with that token. " +
        "Only use when the user explicitly asks you to add/edit something in their personal notebooks.",
      inputSchema: {
        type: "object",
        properties: {
          notebook_name: {
            type: "string",
            description: "Name of the notebook to write to",
          },
          operation_description: {
            type: "string",
            description:
              "Plain-English description of exactly what you want to write/change",
          },
          document_path: {
            type: "string",
            description: "Document hpath, e.g. /Projects/my-app",
          },
          content: {
            type: "string",
            description: "Markdown content to append or create",
          },
        },
        required: [
          "notebook_name",
          "operation_description",
          "document_path",
          "content",
        ],
      },
    },

    // ── CONFIRM-REQUIRED: Request deletion of a block/doc/notebook ─────────
    {
      name: "siyuan_request_delete",
      description:
        "Request permission to delete a block, document, or notebook. " +
        "Returns a confirmation token that must be approved via siyuan_confirm_write. " +
        "Only use when the user explicitly asks you to delete something.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["block", "doc", "notebook"],
            description: "What to delete: a single block, a document, or an entire notebook",
          },
          operation_description: {
            type: "string",
            description: "Plain-English description of exactly what will be deleted",
          },
          block_id: {
            type: "string",
            description: "Block ID to delete (required when type=block)",
          },
          doc_id: {
            type: "string",
            description: "Document block ID to delete (required when type=doc)",
          },
          notebook_name: {
            type: "string",
            description: "Notebook name to delete (required when type=notebook)",
          },
        },
        required: ["type", "operation_description"],
      },
    },

    // ── CONFIRM-REQUIRED: Confirm a pending write or delete ─────────────────
    {
      name: "siyuan_confirm_write",
      description:
        "Confirm and execute a previously requested write or delete operation using its token. " +
        "Only call after the user has explicitly approved the operation.",
      inputSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "The confirmation token returned by siyuan_request_write",
          },
        },
        required: ["token"],
      },
    },

    // ── UTILITY: Push a notification to SiYuan UI ──────────────────────────
    {
      name: "siyuan_notify",
      description:
        "Push a notification message to the SiYuan desktop UI. " +
        "Use to notify the user that memory was saved or an operation completed.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          is_error: {
            type: "boolean",
            description: "If true, shows as an error notification",
          },
        },
        required: ["message"],
      },
    },
  ];
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  client: SiYuanClient,
  manager: NotebookManager
): Promise<unknown> {
  cleanExpired();

  switch (name) {
    // ── siyuan_search ───────────────────────────────────────────────────────
    case "siyuan_search": {
      const query = args.query as string;
      const notebookNames = args.notebooks as string[] | undefined;

      let notebookIds: string[] | undefined;
      if (notebookNames && notebookNames.length > 0) {
        const allNbs = await client.listNotebooks();
        notebookIds = allNbs
          .filter((nb) => notebookNames.includes(nb.name))
          .map((nb) => nb.id);
      }

      const results = await client.fullTextSearch(query, notebookIds);

      if (results.length === 0) {
        return { found: 0, results: [] };
      }

      // Enrich with notebook names
      const allNbs = await client.listNotebooks();
      const nbNameMap = Object.fromEntries(allNbs.map((nb) => [nb.id, nb.name]));

      return {
        found: results.length,
        results: results.map((r) => ({
          id: r.id,
          notebook: nbNameMap[r.box as string] ?? r.box,
          notebook_id: r.box,
          readonly: client.isReadonly(r.box as string),
          hpath: r.hpath,
          type: r.type,
          snippet: String(r.content ?? "").slice(0, 300),
          updated: r.updated,
        })),
      };
    }

    // ── siyuan_get_document ─────────────────────────────────────────────────
    case "siyuan_get_document": {
      const docId = args.doc_id as string;
      const exported = await client.exportDocMarkdown(docId);
      const allNbs = await client.listNotebooks();
      // Resolve notebook name from hpath prefix isn't reliable; use SQL instead
      const rows = await client.sql(
        `SELECT box FROM blocks WHERE id = '${docId.replace(/'/g, "''")}' LIMIT 1`
      );
      const notebookId = rows[0]?.box as string | undefined;
      const nbName = allNbs.find((n) => n.id === notebookId)?.name ?? notebookId ?? "unknown";
      return {
        doc_id: docId,
        notebook: nbName,
        readonly: notebookId ? client.isReadonly(notebookId) : false,
        hpath: exported.hPath,
        content: exported.content,
      };
    }

    // ── siyuan_get_memory ───────────────────────────────────────────────────
    case "siyuan_get_memory": {
      const category = args.category as Category;
      const key = args.key as string;
      const entry = await manager.getEntry(category, key);
      if (!entry) return { found: false };
      return { found: true, entry };
    }

    // ── siyuan_list_memory ──────────────────────────────────────────────────
    case "siyuan_list_memory": {
      const category = args.category as Category;
      const entries = await manager.listEntries(category);
      return {
        category,
        count: entries.length,
        entries: entries.map((e) => ({
          key: e.key,
          title: e.title,
          tags: e.tags,
          updated_at: e.updated_at,
        })),
      };
    }

    // ── siyuan_load_context ─────────────────────────────────────────────────
    case "siyuan_load_context": {
      const summary: Record<string, unknown> = {};
      for (const cat of CATEGORIES) {
        const entries = await manager.listEntries(cat);
        summary[cat] = entries.map((e) => ({
          key: e.key,
          title: e.title,
          tags: e.tags,
          updated_at: e.updated_at,
        }));
      }
      return { loaded_at: new Date().toISOString(), categories: summary };
    }

    // ── siyuan_save_memory ──────────────────────────────────────────────────
    case "siyuan_save_memory": {
      const { category, key, title, data, tags } = args as {
        category: Category;
        key: string;
        title: string;
        data: Record<string, unknown>;
        tags?: string[];
      };

      const result = await manager.upsertEntry(
        category,
        key,
        title,
        data,
        tags ?? []
      );

      // Push a quiet notification to SiYuan UI
      const action = result.created ? "Created" : "Updated";
      await client.pushNotification(
        `[AI Memory] ${action}: ${category}/${key} — "${title}"`
      );

      return {
        success: true,
        action: result.created ? "created" : "updated",
        category,
        key,
        title,
        doc_id: result.docId,
        notification: "SiYuan notification sent",
      };
    }

    // ── siyuan_delete_memory ────────────────────────────────────────────────
    case "siyuan_delete_memory": {
      const category = args.category as Category;
      const key = args.key as string;
      const deleted = await manager.deleteEntry(category, key);
      return { success: deleted, category, key };
    }

    // ── siyuan_request_write ────────────────────────────────────────────────
    case "siyuan_request_write": {
      const {
        notebook_name,
        operation_description,
        document_path,
        content,
      } = args as {
        notebook_name: string;
        operation_description: string;
        document_path: string;
        content: string;
      };

      // Resolve notebook ID
      const allNbs = await client.listNotebooks();
      const nb = allNbs.find((n) => n.name === notebook_name);
      if (!nb) {
        return { success: false, error: `Notebook "${notebook_name}" not found` };
      }

      const token = generateToken();
      pendingOps.set(token, {
        description: operation_description,
        notebookId: nb.id,
        expiresAt: Date.now() + PENDING_TTL_MS,
        execute: async () => {
          const existingIds = await client.getDocIdsByHPath(nb.id, document_path);
          if (existingIds && existingIds.length > 0) {
            await client.rawAppendBlock(existingIds[0], content);
          } else {
            await client.rawCreateDoc(nb.id, document_path, content);
          }
          return { written: true, notebook: notebook_name, path: document_path };
        },
      });

      return {
        pending: true,
        token,
        expires_in_minutes: 5,
        message:
          `⚠️ CONFIRMATION REQUIRED\n\n` +
          `Operation: ${operation_description}\n` +
          `Notebook: ${notebook_name} (read-only)\n` +
          `Path: ${document_path}\n\n` +
          `To approve, call siyuan_confirm_write with token: ${token}\n` +
          `This token expires in 5 minutes.`,
      };
    }

    // ── siyuan_request_delete ───────────────────────────────────────────────
    case "siyuan_request_delete": {
      const {
        type: deleteType,
        operation_description: deleteDesc,
        block_id,
        doc_id,
        notebook_name: del_notebook_name,
      } = args as {
        type: "block" | "doc" | "notebook";
        operation_description: string;
        block_id?: string;
        doc_id?: string;
        notebook_name?: string;
      };

      let executeDelete: () => Promise<unknown>;
      let targetSummary: string;

      if (deleteType === "block") {
        if (!block_id) return { success: false, error: "block_id is required when type=block" };
        targetSummary = `block ${block_id}`;
        executeDelete = async () => {
          await client.rawDeleteBlock(block_id);
          return { deleted: true, type: "block", id: block_id };
        };
      } else if (deleteType === "doc") {
        if (!doc_id) return { success: false, error: "doc_id is required when type=doc" };
        targetSummary = `document ${doc_id}`;
        executeDelete = async () => {
          await client.rawRemoveDocById(doc_id);
          return { deleted: true, type: "doc", id: doc_id };
        };
      } else if (deleteType === "notebook") {
        if (!del_notebook_name) return { success: false, error: "notebook_name is required when type=notebook" };
        const allNbs = await client.listNotebooks();
        const nb = allNbs.find((n) => n.name === del_notebook_name);
        if (!nb) return { success: false, error: `Notebook "${del_notebook_name}" not found` };
        targetSummary = `notebook "${del_notebook_name}" (${nb.id})`;
        executeDelete = async () => {
          await client.rawRemoveNotebook(nb.id);
          return { deleted: true, type: "notebook", name: del_notebook_name, id: nb.id };
        };
      } else {
        return { success: false, error: `Unknown delete type: ${deleteType}` };
      }

      const token = generateToken();
      pendingOps.set(token, {
        description: deleteDesc,
        notebookId: "",
        expiresAt: Date.now() + PENDING_TTL_MS,
        execute: executeDelete,
      });

      return {
        pending: true,
        token,
        expires_in_minutes: 5,
        message:
          `⚠️ DELETE CONFIRMATION REQUIRED\n\n` +
          `Operation: ${deleteDesc}\n` +
          `Target: ${targetSummary}\n\n` +
          `⚡ THIS CANNOT BE UNDONE.\n\n` +
          `To approve, call siyuan_confirm_write with token: ${token}\n` +
          `This token expires in 5 minutes.`,
      };
    }

    // ── siyuan_confirm_write ────────────────────────────────────────────────
    case "siyuan_confirm_write": {
      const token = args.token as string;
      const op = pendingOps.get(token);

      if (!op) {
        return {
          success: false,
          error: "Token not found or expired. Request a new confirmation.",
        };
      }

      if (op.expiresAt < Date.now()) {
        pendingOps.delete(token);
        return { success: false, error: "Token expired." };
      }

      pendingOps.delete(token);
      const result = await op.execute();
      return { success: true, result };
    }

    // ── siyuan_notify ───────────────────────────────────────────────────────
    case "siyuan_notify": {
      const message = args.message as string;
      const isError = args.is_error as boolean | undefined;
      if (isError) {
        await client.pushErrorNotification(message);
      } else {
        await client.pushNotification(message);
      }
      return { sent: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
