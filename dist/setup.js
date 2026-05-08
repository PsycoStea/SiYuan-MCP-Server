/**
 * Setup script — run once to bootstrap the AI Memory notebook structure.
 * Usage: npm run setup-notebook
 */
import { SiYuanClient } from "./siyuan-client.js";
import { NotebookManager, CATEGORIES } from "./notebook-manager.js";
const SIYUAN_URL = process.env.SIYUAN_URL ?? "http://10.0.0.101:6806";
const SIYUAN_TOKEN = process.env.SIYUAN_TOKEN ?? "";
if (!SIYUAN_TOKEN) {
    console.error("ERROR: Set SIYUAN_TOKEN before running setup.");
    process.exit(1);
}
async function setup() {
    console.log(`Connecting to SiYuan at ${SIYUAN_URL}...`);
    const client = new SiYuanClient({ baseUrl: SIYUAN_URL, token: SIYUAN_TOKEN });
    const manager = new NotebookManager(client);
    await client.initReadonlyGuard();
    const readonlyIds = client.getReadonlyIds();
    console.log(`Read-only notebooks protected: ${[...readonlyIds].join(", ")}`);
    const notebookId = await manager.init();
    console.log(`\n✅ AI Memory notebook ready: ${notebookId}`);
    console.log(`   Categories created: ${CATEGORIES.join(", ")}`);
    // Seed a starter Preferences entry
    await manager.upsertEntry("Preferences", "initial-setup", "Initial Setup Record", {
        note: "AI Memory notebook bootstrapped.",
        setup_date: new Date().toISOString(),
        siyuan_url: SIYUAN_URL,
    }, ["system"]);
    console.log(`\n✅ Seeded initial Preferences entry.`);
    console.log(`\nSetup complete. You can now start the MCP server.`);
}
setup().catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
});
