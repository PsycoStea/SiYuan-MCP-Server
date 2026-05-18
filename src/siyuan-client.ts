/**
 * SiYuan API client
 *
 * Read-only notebooks ("AI Convos", "General") are enforced at this layer.
 * Any write operation targeting a protected notebook ID will throw before
 * the request is ever sent to SiYuan.
 */

export interface SiYuanConfig {
  baseUrl: string;
  token: string;
}

export interface Notebook {
  id: string;
  name: string;
  icon: string;
  sort: number;
  closed: boolean;
}

export interface Block {
  id: string;
  type: string;
  content: string;
  hpath: string;
  box: string; // notebook id
  path: string;
  created: string;
  updated: string;
  [key: string]: unknown;
}

export interface SqlRow {
  [key: string]: unknown;
}

// Notebooks the AI may NEVER write to (enforced server-side)
const READONLY_NOTEBOOK_NAMES = ["AI Convos", "General"];

export class SiYuanClient {
  private baseUrl: string;
  private token: string;
  private readonlyNotebookIds: Set<string> = new Set();

  constructor(config: SiYuanConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  // ─── Core request helper ──────────────────────────────────────────────────

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown> = {}
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`SiYuan HTTP error ${res.status} on ${endpoint}`);
    }

    const json = (await res.json()) as { code: number; msg: string; data: T };

    if (json.code !== 0) {
      throw new Error(`SiYuan API error (${json.code}): ${json.msg}`);
    }

    return json.data;
  }

  // ─── Read-only guard ──────────────────────────────────────────────────────

  /**
   * Must be called once at startup. Caches the IDs of protected notebooks.
   */
  async initReadonlyGuard(): Promise<void> {
    const data = await this.request<{ notebooks: Notebook[] }>(
      "/api/notebook/lsNotebooks"
    );
    for (const nb of data.notebooks) {
      if (READONLY_NOTEBOOK_NAMES.includes(nb.name)) {
        this.readonlyNotebookIds.add(nb.id);
      }
    }
  }

  /**
   * Throws if a notebook ID is read-only. Always call before any write.
   */
  private guardWrite(notebookId: string, context: string): void {
    if (this.readonlyNotebookIds.has(notebookId)) {
      throw new Error(
        `WRITE BLOCKED: Notebook "${notebookId}" is read-only. ` +
          `Context: ${context}. ` +
          `Only the "AI Memory" notebook may be written to.`
      );
    }
  }

  /**
   * Returns true if a notebook ID is read-only (for informational use).
   */
  isReadonly(notebookId: string): boolean {
    return this.readonlyNotebookIds.has(notebookId);
  }

  getReadonlyIds(): Set<string> {
    return new Set(this.readonlyNotebookIds);
  }

  // ─── Notebooks ────────────────────────────────────────────────────────────

  async listNotebooks(): Promise<Notebook[]> {
    const data = await this.request<{ notebooks: Notebook[] }>(
      "/api/notebook/lsNotebooks"
    );
    return data.notebooks;
  }

  async createNotebook(name: string): Promise<Notebook> {
    const data = await this.request<{ notebook: Notebook }>(
      "/api/notebook/createNotebook",
      { name }
    );
    return data.notebook;
  }

  // ─── Documents ───────────────────────────────────────────────────────────

  async createDoc(
    notebookId: string,
    path: string,
    markdown: string
  ): Promise<string> {
    this.guardWrite(notebookId, `createDoc at ${path}`);
    return await this.request<string>("/api/filetree/createDocWithMd", {
      notebook: notebookId,
      path,
      markdown,
    });
  }

  async getDocIdsByHPath(
    notebookId: string,
    hpath: string
  ): Promise<string[]> {
    return await this.request<string[]>("/api/filetree/getIDsByHPath", {
      notebook: notebookId,
      path: hpath,
    });
  }

  async exportDocMarkdown(
    docId: string
  ): Promise<{ hPath: string; content: string }> {
    return await this.request<{ hPath: string; content: string }>(
      "/api/export/exportMdContent",
      { id: docId }
    );
  }

  // ─── Blocks ───────────────────────────────────────────────────────────────

  async appendBlock(
    notebookId: string,
    parentId: string,
    markdown: string
  ): Promise<string> {
    this.guardWrite(notebookId, `appendBlock to parent ${parentId}`);
    const data = await this.request<
      Array<{ doOperations: Array<{ id: string }> }>
    >("/api/block/appendBlock", {
      data: markdown,
      dataType: "markdown",
      parentID: parentId,
    });
    return data[0]?.doOperations[0]?.id ?? "";
  }

  async updateBlock(
    notebookId: string,
    blockId: string,
    markdown: string
  ): Promise<void> {
    this.guardWrite(notebookId, `updateBlock ${blockId}`);
    await this.request("/api/block/updateBlock", {
      dataType: "markdown",
      data: markdown,
      id: blockId,
    });
  }

  async deleteBlock(notebookId: string, blockId: string): Promise<void> {
    this.guardWrite(notebookId, `deleteBlock ${blockId}`);
    await this.request("/api/block/deleteBlock", { id: blockId });
  }

  async getBlockKramdown(blockId: string): Promise<string> {
    const data = await this.request<{ id: string; kramdown: string }>(
      "/api/block/getBlockKramdown",
      { id: blockId }
    );
    return data.kramdown;
  }

  async getChildBlocks(
    parentId: string
  ): Promise<Array<{ id: string; type: string; subType?: string }>> {
    return await this.request<Array<{ id: string; type: string; subType?: string }>>(
      "/api/block/getChildBlocks",
      { id: parentId }
    );
  }

  async setBlockAttrs(
    notebookId: string,
    blockId: string,
    attrs: Record<string, string>
  ): Promise<void> {
    this.guardWrite(notebookId, `setBlockAttrs on ${blockId}`);
    await this.request("/api/attr/setBlockAttrs", {
      id: blockId,
      attrs,
    });
  }

  async getBlockAttrs(
    blockId: string
  ): Promise<Record<string, string>> {
    return await this.request<Record<string, string>>(
      "/api/attr/getBlockAttrs",
      { id: blockId }
    );
  }

  // ─── SQL ──────────────────────────────────────────────────────────────────

  async sql(stmt: string): Promise<SqlRow[]> {
    return await this.request<SqlRow[]>("/api/query/sql", { stmt });
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async fullTextSearch(
    query: string,
    notebookIds?: string[]
  ): Promise<Block[]> {
    const notebookFilter =
      notebookIds && notebookIds.length > 0
        ? `AND box IN (${notebookIds.map((id) => `'${id}'`).join(", ")})`
        : "";

    // Split into tokens so "Password Manager" matches regardless of surrounding punctuation.
    // Each token must appear in either content (block text) or hpath (document title path).
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/'/g, "''"));

    const tokenFilter =
      tokens.length > 0
        ? tokens
            .map((t) => `(content LIKE '%${t}%' OR hpath LIKE '%${t}%')`)
            .join("\n        AND ")
        : "1=1";

    const stmt = `
      SELECT id, type, content, hpath, box, path, created, updated
      FROM blocks
      WHERE ${tokenFilter}
        AND type IN ('d', 'p', 'h', 'l', 'i', 't', 'b')
        ${notebookFilter}
      ORDER BY updated DESC
      LIMIT 20
    `;
    return (await this.sql(stmt)) as Block[];
  }

  // ─── Confirmed-delete bypass (user-approved operations only) ────────────

  async rawDeleteBlock(blockId: string): Promise<void> {
    await this.request("/api/block/deleteBlock", { id: blockId });
  }

  async rawRemoveDocById(docId: string): Promise<void> {
    await this.request("/api/filetree/removeDocByID", { id: docId });
  }

  async rawRemoveDoc(notebookId: string, path: string): Promise<void> {
    await this.request("/api/filetree/removeDoc", { notebook: notebookId, path });
  }

  async rawRemoveNotebook(notebookId: string): Promise<void> {
    await this.request("/api/notebook/removeNotebook", { notebook: notebookId });
  }

  // ─── Confirmed-write bypass (user-approved operations only) ──────────────

  async rawAppendBlock(parentId: string, markdown: string): Promise<string> {
    const data = await this.request<
      Array<{ doOperations: Array<{ id: string }> }>
    >("/api/block/appendBlock", {
      data: markdown,
      dataType: "markdown",
      parentID: parentId,
    });
    return data[0]?.doOperations[0]?.id ?? "";
  }

  async rawCreateDoc(
    notebookId: string,
    path: string,
    markdown: string
  ): Promise<string> {
    return await this.request<string>("/api/filetree/createDocWithMd", {
      notebook: notebookId,
      path,
      markdown,
    });
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  async pushNotification(msg: string, timeout = 7000): Promise<void> {
    await this.request("/api/notification/pushMsg", { msg, timeout });
  }

  async pushErrorNotification(msg: string, timeout = 7000): Promise<void> {
    await this.request("/api/notification/pushErrMsg", { msg, timeout });
  }
}
