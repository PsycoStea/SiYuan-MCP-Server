import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SiYuanClient } from "../siyuan-client.js";

const BASE_URL = "http://siyuan.test";
const TOKEN = "test-token";

function makeApiResponse<T>(data: T, code = 0, msg = "OK") {
  return new Response(JSON.stringify({ code, msg, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SiYuanClient", () => {
  let client: SiYuanClient;

  beforeEach(() => {
    client = new SiYuanClient({ baseUrl: BASE_URL, token: TOKEN });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── HTTP request basics ──────────────────────────────────────────────────

  describe("request basics", () => {
    it("sends POST with Authorization and Content-Type headers", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse({ notebooks: [] })
      );

      await client.listNotebooks();

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/api/notebook/lsNotebooks`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Token ${TOKEN}`,
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("throws on non-OK HTTP response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 })
      );

      await expect(client.listNotebooks()).rejects.toThrow("SiYuan HTTP error 500");
    });

    it("throws when SiYuan API returns non-zero code", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse(null, -1, "Something went wrong")
      );

      await expect(client.listNotebooks()).rejects.toThrow(
        "SiYuan API error (-1): Something went wrong"
      );
    });
  });

  // ─── initReadonlyGuard() ──────────────────────────────────────────────────

  describe("initReadonlyGuard()", () => {
    it("caches IDs of notebooks named 'AI Convos' and 'General'", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse({
          notebooks: [
            { id: "nb-ai-convos", name: "AI Convos", icon: "", sort: 0, closed: false },
            { id: "nb-general", name: "General", icon: "", sort: 1, closed: false },
            { id: "nb-ai-memory", name: "AI Memory", icon: "", sort: 2, closed: false },
          ],
        })
      );

      await client.initReadonlyGuard();

      expect(client.isReadonly("nb-ai-convos")).toBe(true);
      expect(client.isReadonly("nb-general")).toBe(true);
      expect(client.isReadonly("nb-ai-memory")).toBe(false);
    });

    it("leaves non-matching notebooks as writable", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse({ notebooks: [{ id: "nb-work", name: "Work", icon: "", sort: 0, closed: false }] })
      );

      await client.initReadonlyGuard();

      expect(client.isReadonly("nb-work")).toBe(false);
    });
  });

  // ─── Read-only guard ──────────────────────────────────────────────────────

  describe("guardWrite via createDoc()", () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse({
          notebooks: [
            { id: "nb-convos", name: "AI Convos", icon: "", sort: 0, closed: false },
          ],
        })
      );
      await client.initReadonlyGuard();
    });

    it("blocks writes to protected notebook IDs", async () => {
      await expect(
        client.createDoc("nb-convos", "/test", "# Test")
      ).rejects.toThrow("WRITE BLOCKED");
    });

    it("allows writes to unprotected notebooks", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse("new-doc-id")
      );

      const docId = await client.createDoc("nb-ai-memory", "/test", "# Test");
      expect(docId).toBe("new-doc-id");
    });
  });

  // ─── listNotebooks() ──────────────────────────────────────────────────────

  describe("listNotebooks()", () => {
    it("returns array of notebooks", async () => {
      const notebooks = [
        { id: "nb1", name: "AI Memory", icon: "", sort: 0, closed: false },
      ];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse({ notebooks })
      );

      const result = await client.listNotebooks();
      expect(result).toEqual(notebooks);
    });
  });

  // ─── fullTextSearch() ─────────────────────────────────────────────────────

  describe("fullTextSearch()", () => {
    it("builds SQL with LIKE clauses for each token", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse([])
      );

      await client.fullTextSearch("password manager");

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.stmt).toContain("content LIKE '%password%'");
      expect(body.stmt).toContain("content LIKE '%manager%'");
    });

    it("restricts to provided notebook IDs when given", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse([])
      );

      await client.fullTextSearch("test", ["nb1", "nb2"]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.stmt).toContain("box IN ('nb1', 'nb2')");
    });

    it("omits notebook filter when no IDs provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse([])
      );

      await client.fullTextSearch("test");

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.stmt).not.toContain("box IN");
    });
  });

  // ─── sql() ────────────────────────────────────────────────────────────────

  describe("sql()", () => {
    it("posts stmt to /api/query/sql and returns rows", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse([{ id: "abc", type: "d" }])
      );

      const result = await client.sql("SELECT * FROM blocks LIMIT 1");

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.stmt).toBe("SELECT * FROM blocks LIMIT 1");
      expect(result).toEqual([{ id: "abc", type: "d" }]);
    });
  });

  // ─── pushNotification() ───────────────────────────────────────────────────

  describe("pushNotification()", () => {
    it("posts to /api/notification/pushMsg with msg and timeout", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse(null)
      );

      await client.pushNotification("Memory saved", 5000);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.msg).toBe("Memory saved");
      expect(body.timeout).toBe(5000);
    });
  });

  describe("pushErrorNotification()", () => {
    it("posts to /api/notification/pushErrMsg", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse(null)
      );

      await client.pushErrorNotification("Something failed");

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("/api/notification/pushErrMsg");
    });
  });

  // ─── isReadonly() and getReadonlyIds() ───────────────────────────────────

  describe("isReadonly() and getReadonlyIds()", () => {
    it("returns false for unknown notebook before guard init", () => {
      expect(client.isReadonly("nb-unknown")).toBe(false);
    });

    it("getReadonlyIds returns a copy of the set", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        makeApiResponse({
          notebooks: [{ id: "nb-gen", name: "General", icon: "", sort: 0, closed: false }],
        })
      );
      await client.initReadonlyGuard();

      const ids = client.getReadonlyIds();
      ids.add("nb-fake"); // mutate copy

      expect(client.isReadonly("nb-fake")).toBe(false); // original unaffected
    });
  });
});
