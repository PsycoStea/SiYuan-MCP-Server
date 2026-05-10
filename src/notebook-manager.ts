/**
 * AI Memory Notebook Manager
 *
 * Manages the "AI Memory" notebook with a two-level structure:
 *
 *   AI Memory/
 *   ├── [CAT] Projects/
 *   │   ├── project::my-app
 *   │   └── project::other-thing
 *   ├── [CAT] Preferences/
 *   │   └── preferences::user
 *   ├── [CAT] Decisions/
 *   │   └── decision::topic
 *   ├── [CAT] Research/
 *   │   └── research::topic
 *   └── [CAT] Workflows/
 *       └── workflow::name
 *
 * All documents store data as structured JSON blocks (markdown code fences
 * with lang "json") for fast, deterministic AI retrieval.
 */

import { SiYuanClient } from "./siyuan-client.js";

export const AI_NOTEBOOK_NAME = "AI Memory";

export type Category =
  | "Projects"
  | "Preferences"
  | "Decisions"
  | "Research"
  | "Workflows";

export const CATEGORIES: Category[] = [
  "Projects",
  "Preferences",
  "Decisions",
  "Research",
  "Workflows",
];

// Maps category → document slug prefix (used in hpath)
export const CATEGORY_PREFIX: Record<Category, string> = {
  Projects: "project",
  Preferences: "preferences",
  Decisions: "decision",
  Research: "research",
  Workflows: "workflow",
};

export interface MemoryEntry {
  schema_version: number;
  category: Category;
  key: string; // slug, e.g. "my-app" or "dark-mode"
  title: string;
  created_at: string; // ISO
  updated_at: string; // ISO
  tags: string[];
  data: Record<string, unknown>;
}

export class NotebookManager {
  private client: SiYuanClient;
  private notebookId: string | null = null;

  constructor(client: SiYuanClient) {
    this.client = client;
  }

  // ─── Initialisation ───────────────────────────────────────────────────────

  /**
   * Finds the AI Memory notebook if it exists. Does NOT create it.
   * Memory is now stored in PostgreSQL — the SiYuan notebook is no longer used.
   * Returns the notebook ID if found, or null if the notebook has been deleted.
   */
  async init(): Promise<string | null> {
    const notebooks = await this.client.listNotebooks();
    const nb = notebooks.find((n) => n.name === AI_NOTEBOOK_NAME);

    if (!nb) {
      console.error(`[siyuan-mcp] AI Memory notebook not found — memory has moved to PostgreSQL`);
      return null;
    }

    this.notebookId = nb.id;
    return this.notebookId;
  }

  getNotebookId(): string {
    if (!this.notebookId) throw new Error("AI Memory notebook not available — memory has moved to PostgreSQL");
    return this.notebookId;
  }

  // ─── Document path helpers ────────────────────────────────────────────────

  docPath(category: Category, key: string): string {
    const prefix = CATEGORY_PREFIX[category];
    return `/${category}/${prefix}::${key}`;
  }

  // ─── Read operations ──────────────────────────────────────────────────────

  async getEntry(
    category: Category,
    key: string
  ): Promise<MemoryEntry | null> {
    const ids = await this.client.getDocIdsByHPath(
      this.getNotebookId(),
      this.docPath(category, key)
    );
    if (!ids || ids.length === 0) return null;

    const exported = await this.client.exportDocMarkdown(ids[0]);
    return this.parseEntryMarkdown(exported.content);
  }

  async listEntries(category: Category): Promise<MemoryEntry[]> {
    const rows = await this.client.sql(`
      SELECT id, hpath, content, updated
      FROM blocks
      WHERE box = '${this.getNotebookId()}'
        AND type = 'd'
        AND hpath LIKE '/${category}/%'
        AND hpath NOT LIKE '%/_index'
      ORDER BY updated DESC
    `);

    const entries: MemoryEntry[] = [];
    for (const row of rows) {
      const exported = await this.client.exportDocMarkdown(row.id as string);
      const entry = this.parseEntryMarkdown(exported.content);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  async searchEntries(query: string, categories?: Category[]): Promise<MemoryEntry[]> {
    const notebookId = this.getNotebookId();
    const catFilter =
      categories && categories.length > 0
        ? `AND (${categories.map((c) => `hpath LIKE '/${c}/%'`).join(" OR ")})`
        : "";

    const rows = await this.client.sql(`
      SELECT id, hpath, content, updated
      FROM blocks
      WHERE box = '${notebookId}'
        AND type = 'd'
        AND hpath NOT LIKE '%/_index'
        AND content LIKE '%${query.replace(/'/g, "''")}%'
        ${catFilter}
      ORDER BY updated DESC
      LIMIT 15
    `);

    const entries: MemoryEntry[] = [];
    for (const row of rows) {
      const exported = await this.client.exportDocMarkdown(row.id as string);
      const entry = this.parseEntryMarkdown(exported.content);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  // ─── Write operations ─────────────────────────────────────────────────────

  async upsertEntry(
    category: Category,
    key: string,
    title: string,
    data: Record<string, unknown>,
    tags: string[] = []
  ): Promise<{ created: boolean; docId: string }> {
    const notebookId = this.getNotebookId();
    const path = this.docPath(category, key);

    const existing = await this.client.getDocIdsByHPath(notebookId, path);
    const now = new Date().toISOString();

    let createdAt = now;
    if (existing && existing.length > 0) {
      // Preserve original created_at if entry already exists
      const old = await this.getEntry(category, key);
      if (old) createdAt = old.created_at;
    }

    const entry: MemoryEntry = {
      schema_version: 1,
      category,
      key,
      title,
      created_at: createdAt,
      updated_at: now,
      tags,
      data,
    };

    const markdown = this.renderEntryMarkdown(entry);

    if (!existing || existing.length === 0) {
      const docId = await this.client.createDoc(notebookId, path, markdown);
      return { created: true, docId };
    } else {
      // Replace the doc content by updating the root block
      const docId = existing[0];
      const children = await this.client.getChildBlocks(docId);

      // Delete all existing children then append fresh content
      for (const child of children) {
        await this.client.deleteBlock(notebookId, child.id);
      }
      await this.client.appendBlock(notebookId, docId, markdown);
      return { created: false, docId };
    }
  }

  async deleteEntry(category: Category, key: string): Promise<boolean> {
    const notebookId = this.getNotebookId();
    const path = this.docPath(category, key);
    const ids = await this.client.getDocIdsByHPath(notebookId, path);
    if (!ids || ids.length === 0) return false;

    // Remove using the block delete on the doc root
    for (const id of ids) {
      await this.client.deleteBlock(notebookId, id);
    }
    return true;
  }

  // ─── Serialisation ────────────────────────────────────────────────────────

  private renderEntryMarkdown(entry: MemoryEntry): string {
    return [
      `# ${entry.title}`,
      ``,
      "```json",
      JSON.stringify(entry, null, 2),
      "```",
    ].join("\n");
  }

  private parseEntryMarkdown(markdown: string): MemoryEntry | null {
    try {
      const match = markdown.match(/```json\s*([\s\S]*?)\s*```/);
      if (!match) return null;
      return JSON.parse(match[1]) as MemoryEntry;
    } catch {
      return null;
    }
  }

  private renderCategoryIndex(category: Category): string {
    const descriptions: Record<Category, string> = {
      Projects:
        "Active and past project context, status, stack, and goals. Each document = one project.",
      Preferences:
        "User working style, preferences, communication style, and tool choices.",
      Decisions:
        "Important decisions with rationale. Prevents re-litigating past choices.",
      Research:
        "Facts, findings, and knowledge gathered across sessions.",
      Workflows:
        "Recurring processes, templates, and task patterns.",
    };

    return [
      `# ${category}`,
      ``,
      `> ${descriptions[category]}`,
      ``,
      "```json",
      JSON.stringify({
        _index: true,
        category,
        description: descriptions[category],
      }),
      "```",
    ].join("\n");
  }
}
