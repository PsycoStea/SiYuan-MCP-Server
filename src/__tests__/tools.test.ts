import { describe, it, expect, vi, afterEach } from "vitest";
import { handleTool } from "../tools.js";
import type { SiYuanClient, Notebook } from "../siyuan-client.js";
import type { NotebookManager, MemoryEntry } from "../notebook-manager.js";

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeClient() {
  return {
    listNotebooks: vi.fn(),
    createNotebook: vi.fn(),
    exportDocMarkdown: vi.fn(),
    fullTextSearch: vi.fn(),
    sql: vi.fn(),
    isReadonly: vi.fn().mockReturnValue(false),
    pushNotification: vi.fn().mockResolvedValue(undefined),
    pushErrorNotification: vi.fn().mockResolvedValue(undefined),
    getDocIdsByHPath: vi.fn(),
    rawAppendBlock: vi.fn(),
    rawCreateDoc: vi.fn(),
    createDoc: vi.fn(),
  } as unknown as SiYuanClient;
}

function makeManager() {
  return {
    listEntries: vi.fn(),
    getEntry: vi.fn(),
    upsertEntry: vi.fn(),
    deleteEntry: vi.fn(),
    init: vi.fn(),
    getNotebookId: vi.fn().mockReturnValue("nb-mem"),
  } as unknown as NotebookManager;
}

function makeNotebook(id: string, name: string): Notebook {
  return { id, name, icon: "", sort: 0, closed: false };
}

function makeMemoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    schema_version: 1,
    category: "Projects",
    key: "test-project",
    title: "Test Project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    tags: ["ts"],
    data: { status: "active" },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── siyuan_search ────────────────────────────────────────────────────────────

describe("siyuan_search", () => {
  it("calls fullTextSearch without notebook filter when no notebooks arg", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.fullTextSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleTool("siyuan_search", { query: "password manager" }, client, manager) as { found: number };

    expect(client.fullTextSearch).toHaveBeenCalledWith("password manager", undefined);
    expect(result.found).toBe(0);
  });

  it("resolves notebook names to IDs when notebooks filter provided", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-gen", "General"),
      makeNotebook("nb-ai", "AI Memory"),
    ]);
    (client.fullTextSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await handleTool("siyuan_search", { query: "test", notebooks: ["General"] }, client, manager);

    expect(client.fullTextSearch).toHaveBeenCalledWith("test", ["nb-gen"]);
  });

  it("enriches results with notebook names and readonly status", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.fullTextSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "blk1", type: "d", content: "Some content", hpath: "/Projects/test", box: "nb-ai", created: "", updated: "20260101", path: "" },
    ]);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-ai", "AI Memory"),
    ]);
    (client.isReadonly as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await handleTool("siyuan_search", { query: "test" }, client, manager) as { found: number; results: { notebook: string; readonly: boolean }[] };

    expect(result.found).toBe(1);
    expect(result.results[0].notebook).toBe("AI Memory");
    expect(result.results[0].readonly).toBe(false);
  });
});

// ─── siyuan_get_document ──────────────────────────────────────────────────────

describe("siyuan_get_document", () => {
  it("fetches document markdown and resolves notebook info", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.exportDocMarkdown as ReturnType<typeof vi.fn>).mockResolvedValue({
      hPath: "/Projects/test",
      content: "# Test\n\nContent here",
    });
    (client.sql as ReturnType<typeof vi.fn>).mockResolvedValue([{ box: "nb-mem" }]);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", "AI Memory"),
    ]);
    (client.isReadonly as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await handleTool("siyuan_get_document", { doc_id: "20260101-abcdef" }, client, manager) as {
      doc_id: string;
      notebook: string;
      content: string;
    };

    expect(result.doc_id).toBe("20260101-abcdef");
    expect(result.notebook).toBe("AI Memory");
    expect(result.content).toBe("# Test\n\nContent here");
  });
});

// ─── siyuan_get_memory ────────────────────────────────────────────────────────

describe("siyuan_get_memory", () => {
  it("returns found:false when entry not in manager", async () => {
    const client = makeClient();
    const manager = makeManager();
    (manager.getEntry as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handleTool("siyuan_get_memory", { category: "Projects", key: "missing" }, client, manager) as { found: boolean };

    expect(result.found).toBe(false);
  });

  it("returns found:true with entry when found", async () => {
    const client = makeClient();
    const manager = makeManager();
    const entry = makeMemoryEntry();
    (manager.getEntry as ReturnType<typeof vi.fn>).mockResolvedValue(entry);

    const result = await handleTool("siyuan_get_memory", { category: "Projects", key: "test-project" }, client, manager) as { found: boolean; entry: MemoryEntry };

    expect(result.found).toBe(true);
    expect(result.entry).toEqual(entry);
  });
});

// ─── siyuan_list_memory ───────────────────────────────────────────────────────

describe("siyuan_list_memory", () => {
  it("returns entries summary for the given category", async () => {
    const client = makeClient();
    const manager = makeManager();
    const entries = [makeMemoryEntry(), makeMemoryEntry({ key: "proj-2", title: "Project 2" })];
    (manager.listEntries as ReturnType<typeof vi.fn>).mockResolvedValue(entries);

    const result = await handleTool("siyuan_list_memory", { category: "Projects" }, client, manager) as { count: number; entries: { key: string }[] };

    expect(manager.listEntries).toHaveBeenCalledWith("Projects");
    expect(result.count).toBe(2);
    expect(result.entries[0].key).toBe("test-project");
  });
});

// ─── siyuan_load_context ──────────────────────────────────────────────────────

describe("siyuan_load_context", () => {
  it("calls listEntries for all 5 categories", async () => {
    const client = makeClient();
    const manager = makeManager();
    (manager.listEntries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleTool("siyuan_load_context", {}, client, manager) as { loaded_at: string; categories: Record<string, unknown> };

    expect(manager.listEntries).toHaveBeenCalledTimes(5);
    expect(result.categories).toHaveProperty("Projects");
    expect(result.categories).toHaveProperty("Preferences");
    expect(result.categories).toHaveProperty("Decisions");
    expect(result.categories).toHaveProperty("Research");
    expect(result.categories).toHaveProperty("Workflows");
  });
});

// ─── siyuan_save_memory ───────────────────────────────────────────────────────

describe("siyuan_save_memory", () => {
  it("calls upsertEntry and pushNotification, returns success", async () => {
    const client = makeClient();
    const manager = makeManager();
    (manager.upsertEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ created: true, docId: "new-doc" });

    const result = await handleTool("siyuan_save_memory", {
      category: "Projects",
      key: "my-project",
      title: "My Project",
      data: { status: "active" },
      tags: ["ts"],
    }, client, manager) as { success: boolean; action: string };

    expect(manager.upsertEntry).toHaveBeenCalledWith("Projects", "my-project", "My Project", { status: "active" }, ["ts"]);
    expect(client.pushNotification).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
  });

  it("returns action:updated when entry already existed", async () => {
    const client = makeClient();
    const manager = makeManager();
    (manager.upsertEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ created: false, docId: "existing-doc" });

    const result = await handleTool("siyuan_save_memory", {
      category: "Preferences",
      key: "pref-tabs",
      title: "Use Tabs",
      data: { preference: "tabs" },
    }, client, manager) as { action: string };

    expect(result.action).toBe("updated");
  });
});

// ─── siyuan_delete_memory ─────────────────────────────────────────────────────

describe("siyuan_delete_memory", () => {
  it("calls deleteEntry and returns success/category/key", async () => {
    const client = makeClient();
    const manager = makeManager();
    (manager.deleteEntry as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await handleTool("siyuan_delete_memory", {
      category: "Research",
      key: "old-research",
    }, client, manager) as { success: boolean; category: string; key: string };

    expect(manager.deleteEntry).toHaveBeenCalledWith("Research", "old-research");
    expect(result.success).toBe(true);
    expect(result.category).toBe("Research");
    expect(result.key).toBe("old-research");
  });
});

// ─── siyuan_request_write ─────────────────────────────────────────────────────

describe("siyuan_request_write", () => {
  it("returns a pending token and human-readable message", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-gen", "General"),
    ]);

    const result = await handleTool("siyuan_request_write", {
      notebook_name: "General",
      operation_description: "Add a note",
      document_path: "/test-doc",
      content: "# Note",
    }, client, manager) as { pending: boolean; token: string; expires_in_minutes: number };

    expect(result.pending).toBe(true);
    expect(typeof result.token).toBe("string");
    expect(result.token).toHaveLength(8);
    expect(result.expires_in_minutes).toBe(5);
  });

  it("returns error when notebook not found", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleTool("siyuan_request_write", {
      notebook_name: "Nonexistent",
      operation_description: "test",
      document_path: "/path",
      content: "content",
    }, client, manager) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("Nonexistent");
  });
});

// ─── siyuan_confirm_write ─────────────────────────────────────────────────────

describe("siyuan_confirm_write", () => {
  it("executes operation and removes token on valid confirmation", async () => {
    const client = makeClient();
    const manager = makeManager();
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-gen", "General"),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (client.rawCreateDoc as ReturnType<typeof vi.fn>).mockResolvedValue("created-doc");

    // Get a token
    const requestResult = await handleTool("siyuan_request_write", {
      notebook_name: "General",
      operation_description: "Write a note",
      document_path: "/my-doc",
      content: "# My Note",
    }, client, manager) as { token: string };

    const confirmResult = await handleTool("siyuan_confirm_write", {
      token: requestResult.token,
    }, client, manager) as { success: boolean };

    expect(confirmResult.success).toBe(true);
    expect(client.rawCreateDoc).toHaveBeenCalled();
  });

  it("returns error for unknown/already-used token", async () => {
    const client = makeClient();
    const manager = makeManager();

    const result = await handleTool("siyuan_confirm_write", {
      token: "FAKTOKEN",
    }, client, manager) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("returns error when token has expired", async () => {
    vi.useFakeTimers();

    const client = makeClient();
    const manager = makeManager();
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-gen", "General"),
    ]);

    const requestResult = await handleTool("siyuan_request_write", {
      notebook_name: "General",
      operation_description: "Delayed write",
      document_path: "/delayed",
      content: "content",
    }, client, manager) as { token: string };

    // Advance past the 5-minute TTL so cleanExpired() removes the token
    vi.advanceTimersByTime(6 * 60 * 1000);

    const confirmResult = await handleTool("siyuan_confirm_write", {
      token: requestResult.token,
    }, client, manager) as { success: boolean; error: string };

    expect(confirmResult.success).toBe(false);
    expect(confirmResult.error).toMatch(/expired|not found/i);
  });
});

// ─── siyuan_notify ────────────────────────────────────────────────────────────

describe("siyuan_notify", () => {
  it("calls pushNotification for regular messages", async () => {
    const client = makeClient();
    const manager = makeManager();

    const result = await handleTool("siyuan_notify", { message: "Done!" }, client, manager) as { sent: boolean };

    expect(client.pushNotification).toHaveBeenCalledWith("Done!");
    expect(client.pushErrorNotification).not.toHaveBeenCalled();
    expect(result.sent).toBe(true);
  });

  it("calls pushErrorNotification when is_error is true", async () => {
    const client = makeClient();
    const manager = makeManager();

    const result = await handleTool("siyuan_notify", { message: "Failure!", is_error: true }, client, manager) as { sent: boolean };

    expect(client.pushErrorNotification).toHaveBeenCalledWith("Failure!");
    expect(client.pushNotification).not.toHaveBeenCalled();
    expect(result.sent).toBe(true);
  });
});

// ─── Unknown tool ─────────────────────────────────────────────────────────────

describe("unknown tool", () => {
  it("throws for unrecognised tool name", async () => {
    const client = makeClient();
    const manager = makeManager();

    await expect(
      handleTool("siyuan_does_not_exist", {}, client, manager)
    ).rejects.toThrow("Unknown tool: siyuan_does_not_exist");
  });
});
