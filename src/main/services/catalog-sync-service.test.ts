import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogSyncService } from "./catalog-sync-service";
import { SessionStore } from "./session-store";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createServices() {
  const dir = await mkdtemp(join(tmpdir(), "friendly-agent-catalog-test-"));
  tempDirs.push(dir);
  const store = new SessionStore(dir);
  const state = await store.readState();
  state.sources = [
    {
      id: "http-test-source",
      title: "HTTP Test Source",
      type: "http",
      url: "https://example.com/catalog.json",
      manifestPath: "catalog.json",
      enabled: true,
      syncIntervalMinutes: 60
    }
  ];
  state.catalog = [];
  state.syncJobs = [];
  await store.writeState(state);
  const catalog = new CatalogSyncService(store);
  return { store, catalog };
}

describe("CatalogSyncService", () => {
  it("syncs http catalog manifests into friendly catalog items", async () => {
    const { catalog } = await createServices();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          skills: [
            {
              id: "excel-skill",
              kind: "skill",
              title: "Excel Maker",
              description: "Generate spreadsheets",
              version: "1.0.0",
              sourceId: "default-friendly-catalog",
              enabled: true,
              installed: false
            }
          ],
          agents: []
        })
      }))
    );

    await catalog.syncSource("http-test-source");
    const result = await catalog.listCatalog();
    const syncedItem = result.items.find((item) => item.id === "excel-skill");
    expect(syncedItem?.title).toBe("Excel Maker");
    expect(syncedItem?.status).toBe("available");
  });
});
