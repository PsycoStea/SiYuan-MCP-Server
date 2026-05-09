import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotebookManager, AI_NOTEBOOK_NAME, CATEGORIES } from "../notebook-manager.js";
import type { SiYuanClient, Notebook } from "../siyuan-client.js";

// ─── Mock client factory ──────────────────────────────────────────────────────

function makeClient() {
  return {
    listNotebooks: vi.fn(),
    createNotebook: vi.fn(),
    createDoc: vi.fn(),
    getDocIdsByHPath: vi.fn(),
    exportDocMarkdown: vi.fn(),
    appendBlock: vi.fn(),
    updateBlock: vi.fn(),
    deleteBlock: vi.fn(),
    getChildBlocks: vi.fn(),
    sql: vi.fn(),
    setBlockAttrs: vi.fn(),
    getBlockAttrs: vi.fn(),
    rawAppendBlock: vi.fn(),
    rawCreateDoc: vi.fn(),
    pushNotification: vi.fn(),
    isReadonly: vi.fn().mockReturnValue(false),
    initReadonlyGuard: vi.fn(),
  } as unknown as SiYuanClient;
}

function makeNotebook(id: string, name: string): Notebook {
  return { id, name, icon: "", sort: 0, closed: false };
}

function wrapEntry(data: object): string {
  const entry = {
    schema_version: 1,
    category: "Projects",
    key: "test-key",
    title: "Test",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    tags: [],
    data,
  };
  return `# Test\n\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``;
}

// ─── init() ───────────────────────────────────────────────────────────────────

describe("NotebookManager.init()", () => {
  let client: ReturnType<typeof makeClient>;
  let manager: NotebookManager;

  beforeEach(() => {
    client = makeClient();
    manager = new NotebookManager(client as unknown as SiYuanClient);
  });

  it("uses existing AI Memory notebook when found", async () => {
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-existing", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["doc-id"]);

    const id = await manager.init();

    expect(id).toBe("nb-existing");
    expect(client.createNotebook).not.toHaveBeenCalled();
  });

  it("creates AI Memory notebook when absent", async () => {
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-other", "Other Notebook"),
    ]);
    (client.createNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeNotebook("nb-new", AI_NOTEBOOK_NAME)
    );
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["doc-id"]);

    const id = await manager.init();

    expect(client.createNotebook).toHaveBeenCalledWith(AI_NOTEBOOK_NAME);
    expect(id).toBe("nb-new");
  });

  it("creates all 5 category index documents when missing", async () => {
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (client.createDoc as ReturnType<typeof vi.fn>).mockResolvedValue("new-doc-id");

    await manager.init();

    expect(client.createDoc).toHaveBeenCalledTimes(CATEGORIES.length);
    for (const cat of CATEGORIES) {
      expect(client.createDoc).toHaveBeenCalledWith(
        "nb-mem",
        `/${cat}/_index`,
        expect.stringContaining(cat)
      );
    }
  });

  it("skips creating category index when it already exists", async () => {
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["existing-doc"]);

    await manager.init();

    expect(client.createDoc).not.toHaveBeenCalled();
  });
});

// ─── getEntry() ───────────────────────────────────────────────────────────────

describe("NotebookManager.getEntry()", () => {
  let client: ReturnType<typeof makeClient>;
  let manager: NotebookManager;

  beforeEach(async () => {
    client = makeClient();
    manager = new NotebookManager(client as unknown as SiYuanClient);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["doc-id"]);
    await manager.init();
    vi.clearAllMocks();
  });

  it("returns null when no doc found at path", async () => {
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await manager.getEntry("Projects", "missing-key");
    expect(result).toBeNull();
  });

  it("returns parsed MemoryEntry when doc exists", async () => {
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["doc-id"]);
    (client.exportDocMarkdown as ReturnType<typeof vi.fn>).mockResolvedValue({
      hPath: "/Projects/project::test-key",
      content: wrapEntry({ status: "active" }),
    });

    const result = await manager.getEntry("Projects", "test-key");

    expect(result).not.toBeNull();
    expect(result?.key).toBe("test-key");
    expect(result?.data).toEqual({ status: "active" });
  });
});

// ─── listEntries() ────────────────────────────────────────────────────────────

describe("NotebookManager.listEntries()", () => {
  let client: ReturnType<typeof makeClient>;
  let manager: NotebookManager;

  beforeEach(async () => {
    client = makeClient();
    manager = new NotebookManager(client as unknown as SiYuanClient);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["doc-id"]);
    await manager.init();
    vi.clearAllMocks();
  });

  it("returns empty array when no entries found", async () => {
    (client.sql as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await manager.listEntries("Research");
    expect(result).toEqual([]);
  });

  it("returns parsed entries from SQL results", async () => {
    (client.sql as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "doc1", hpath: "/Projects/project::my-app", content: "", updated: "20260101" },
    ]);
    (client.exportDocMarkdown as ReturnType<typeof vi.fn>).mockResolvedValue({
      hPath: "/Projects/project::my-app",
      content: wrapEntry({ phase: "production" }),
    });

    const result = await manager.listEntries("Projects");

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("test-key");
  });

  it("queries correct notebook ID and category in SQL", async () => {
    (client.sql as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await manager.listEntries("Decisions");

    const sqlCall = (client.sql as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain("nb-mem");
    expect(sqlCall).toContain("/Decisions/%");
  });
});

// ─── upsertEntry() ────────────────────────────────────────────────────────────

describe("NotebookManager.upsertEntry()", () => {
  let client: ReturnType<typeof makeClient>;
  let manager: NotebookManager;

  beforeEach(async () => {
    client = makeClient();
    manager = new NotebookManager(client as unknown as SiYuanClient);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["init-doc"]);
    await manager.init();
    vi.clearAllMocks();
  });

  it("creates new doc when entry does not exist", async () => {
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (client.createDoc as ReturnType<typeof vi.fn>).mockResolvedValue("new-doc-id");

    const result = await manager.upsertEntry("Projects", "brand-new", "Brand New Project", { status: "active" });

    expect(client.createDoc).toHaveBeenCalledWith(
      "nb-mem",
      "/Projects/project::brand-new",
      expect.stringContaining("Brand New Project")
    );
    expect(result.created).toBe(true);
    expect(result.docId).toBe("new-doc-id");
  });

  it("replaces doc content when entry already exists", async () => {
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(["existing-doc"])  // exists check
      .mockResolvedValueOnce(["existing-doc"]); // getEntry inner call
    (client.exportDocMarkdown as ReturnType<typeof vi.fn>).mockResolvedValue({
      hPath: "/Projects/project::my-app",
      content: wrapEntry({ status: "old" }),
    });
    (client.getChildBlocks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "child-1", type: "p" },
      { id: "child-2", type: "c" },
    ]);
    (client.deleteBlock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (client.appendBlock as ReturnType<typeof vi.fn>).mockResolvedValue("new-block-id");

    const result = await manager.upsertEntry("Projects", "my-app", "My App", { status: "updated" });

    expect(client.deleteBlock).toHaveBeenCalledTimes(2);
    expect(client.appendBlock).toHaveBeenCalledWith("nb-mem", "existing-doc", expect.stringContaining("My App"));
    expect(result.created).toBe(false);
  });
});

// ─── deleteEntry() ────────────────────────────────────────────────────────────

describe("NotebookManager.deleteEntry()", () => {
  let client: ReturnType<typeof makeClient>;
  let manager: NotebookManager;

  beforeEach(async () => {
    client = makeClient();
    manager = new NotebookManager(client as unknown as SiYuanClient);
    (client.listNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeNotebook("nb-mem", AI_NOTEBOOK_NAME),
    ]);
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["init-doc"]);
    await manager.init();
    vi.clearAllMocks();
  });

  it("returns false when entry does not exist", async () => {
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await manager.deleteEntry("Research", "nonexistent");
    expect(result).toBe(false);
    expect(client.deleteBlock).not.toHaveBeenCalled();
  });

  it("deletes the doc and returns true when entry exists", async () => {
    (client.getDocIdsByHPath as ReturnType<typeof vi.fn>).mockResolvedValue(["doc-to-delete"]);
    (client.deleteBlock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await manager.deleteEntry("Decisions", "old-decision");

    expect(client.deleteBlock).toHaveBeenCalledWith("nb-mem", "doc-to-delete");
    expect(result).toBe(true);
  });
});
