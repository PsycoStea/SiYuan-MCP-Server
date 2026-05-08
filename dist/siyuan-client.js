/**
 * SiYuan API client
 *
 * Read-only notebooks ("AI Convos", "General") are enforced at this layer.
 * Any write operation targeting a protected notebook ID will throw before
 * the request is ever sent to SiYuan.
 */
// Notebooks the AI may NEVER write to (enforced server-side)
const READONLY_NOTEBOOK_NAMES = ["AI Convos", "General"];
export class SiYuanClient {
    baseUrl;
    token;
    readonlyNotebookIds = new Set();
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/$/, "");
        this.token = config.token;
    }
    // ─── Core request helper ──────────────────────────────────────────────────
    async request(endpoint, body = {}) {
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
        const json = (await res.json());
        if (json.code !== 0) {
            throw new Error(`SiYuan API error (${json.code}): ${json.msg}`);
        }
        return json.data;
    }
    // ─── Read-only guard ──────────────────────────────────────────────────────
    /**
     * Must be called once at startup. Caches the IDs of protected notebooks.
     */
    async initReadonlyGuard() {
        const data = await this.request("/api/notebook/lsNotebooks");
        for (const nb of data.notebooks) {
            if (READONLY_NOTEBOOK_NAMES.includes(nb.name)) {
                this.readonlyNotebookIds.add(nb.id);
            }
        }
    }
    /**
     * Throws if a notebook ID is read-only. Always call before any write.
     */
    guardWrite(notebookId, context) {
        if (this.readonlyNotebookIds.has(notebookId)) {
            throw new Error(`WRITE BLOCKED: Notebook "${notebookId}" is read-only. ` +
                `Context: ${context}. ` +
                `Only the "AI Memory" notebook may be written to.`);
        }
    }
    /**
     * Returns true if a notebook ID is read-only (for informational use).
     */
    isReadonly(notebookId) {
        return this.readonlyNotebookIds.has(notebookId);
    }
    getReadonlyIds() {
        return new Set(this.readonlyNotebookIds);
    }
    // ─── Notebooks ────────────────────────────────────────────────────────────
    async listNotebooks() {
        const data = await this.request("/api/notebook/lsNotebooks");
        return data.notebooks;
    }
    async createNotebook(name) {
        const data = await this.request("/api/notebook/createNotebook", { name });
        return data.notebook;
    }
    // ─── Documents ───────────────────────────────────────────────────────────
    async createDoc(notebookId, path, markdown) {
        this.guardWrite(notebookId, `createDoc at ${path}`);
        return await this.request("/api/filetree/createDocWithMd", {
            notebook: notebookId,
            path,
            markdown,
        });
    }
    async getDocIdsByHPath(notebookId, hpath) {
        return await this.request("/api/filetree/getIDsByHPath", {
            notebook: notebookId,
            path: hpath,
        });
    }
    async exportDocMarkdown(docId) {
        return await this.request("/api/export/exportMdContent", { id: docId });
    }
    // ─── Blocks ───────────────────────────────────────────────────────────────
    async appendBlock(notebookId, parentId, markdown) {
        this.guardWrite(notebookId, `appendBlock to parent ${parentId}`);
        const data = await this.request("/api/block/appendBlock", {
            data: markdown,
            dataType: "markdown",
            parentID: parentId,
        });
        return data[0]?.doOperations[0]?.id ?? "";
    }
    async updateBlock(notebookId, blockId, markdown) {
        this.guardWrite(notebookId, `updateBlock ${blockId}`);
        await this.request("/api/block/updateBlock", {
            dataType: "markdown",
            data: markdown,
            id: blockId,
        });
    }
    async deleteBlock(notebookId, blockId) {
        this.guardWrite(notebookId, `deleteBlock ${blockId}`);
        await this.request("/api/block/deleteBlock", { id: blockId });
    }
    async getBlockKramdown(blockId) {
        const data = await this.request("/api/block/getBlockKramdown", { id: blockId });
        return data.kramdown;
    }
    async getChildBlocks(parentId) {
        return await this.request("/api/block/getChildBlocks", { id: parentId });
    }
    async setBlockAttrs(notebookId, blockId, attrs) {
        this.guardWrite(notebookId, `setBlockAttrs on ${blockId}`);
        await this.request("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs,
        });
    }
    async getBlockAttrs(blockId) {
        return await this.request("/api/attr/getBlockAttrs", { id: blockId });
    }
    // ─── SQL ──────────────────────────────────────────────────────────────────
    async sql(stmt) {
        return await this.request("/api/query/sql", { stmt });
    }
    // ─── Search ───────────────────────────────────────────────────────────────
    async fullTextSearch(query, notebookIds) {
        // SiYuan full-text search via SQL on the blocks table
        const notebookFilter = notebookIds && notebookIds.length > 0
            ? `AND box IN (${notebookIds.map((id) => `'${id}'`).join(", ")})`
            : "";
        const stmt = `
      SELECT id, type, content, hpath, box, path, created, updated
      FROM blocks
      WHERE content LIKE '%${query.replace(/'/g, "''")}%'
        AND type IN ('d', 'p', 'h', 'l', 'i', 't', 'b')
        ${notebookFilter}
      ORDER BY updated DESC
      LIMIT 20
    `;
        return (await this.sql(stmt));
    }
    // ─── Notifications ────────────────────────────────────────────────────────
    async pushNotification(msg, timeout = 7000) {
        await this.request("/api/notification/pushMsg", { msg, timeout });
    }
    async pushErrorNotification(msg, timeout = 7000) {
        await this.request("/api/notification/pushErrMsg", { msg, timeout });
    }
}
