import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type {
  AgentManifest,
  CatalogItem,
  SkillManifest,
  SyncJobRecord,
  SyncSource
} from "@shared/types";
import { SessionStore } from "./session-store";
import { createId, nowIso } from "./utils";

interface CatalogManifestFile {
  skills?: SkillManifest[];
  agents?: AgentManifest[];
}

export class CatalogSyncService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly store: SessionStore) {}

  async listCatalog(): Promise<{ items: CatalogItem[]; sources: SyncSource[]; jobs: SyncJobRecord[] }> {
    const state = await this.store.readState();
    return { items: state.catalog, sources: state.sources, jobs: state.syncJobs };
  }

  async syncSource(sourceId: string): Promise<SyncJobRecord> {
    const state = await this.store.readState();
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) {
      throw new Error(`Unknown sync source ${sourceId}`);
    }

    const job: SyncJobRecord = {
      id: createId(),
      sourceId: source.id,
      startedAt: nowIso(),
      status: "running"
    };
    state.syncJobs.unshift(job);
    await this.store.writeState(state);

    try {
      // A sync updates both the source metadata and the catalog surface the UI
      // renders, so the source and resulting items are persisted together.
      const manifest = await this.fetchManifest(source);
      const items = this.toCatalogItems(source, manifest);
      state.catalog = this.mergeCatalog(state.catalog, items, source.id);
      source.lastSyncedAt = nowIso();
      source.lastError = undefined;
      job.finishedAt = nowIso();
      job.status = "success";
      job.detail = `Synced ${items.length} catalog items.`;
      await this.store.writeState(state);
      return job;
    } catch (error) {
      source.lastError = error instanceof Error ? error.message : String(error);
      job.finishedAt = nowIso();
      job.status = "error";
      job.detail = source.lastError;
      await this.store.writeState(state);
      throw error;
    }
  }

  async toggleCatalogItem(itemId: string, enabled: boolean): Promise<CatalogItem | undefined> {
    const state = await this.store.readState();
    const item = state.catalog.find((candidate) => candidate.id === itemId);
    if (item) {
      item.enabled = enabled;
      item.status = enabled ? (item.installed ? "installed" : "available") : "disabled";
      await this.store.writeState(state);
    }
    return item;
  }

  async startBackgroundSync(): Promise<void> {
    const state = await this.store.readState();
    for (const source of state.sources.filter((candidate) => candidate.enabled)) {
      this.scheduleSource(source);
    }
  }

  private scheduleSource(source: SyncSource): void {
    const existing = this.timers.get(source.id);
    if (existing) {
      clearInterval(existing);
    }

    const timer = setInterval(() => {
      // Background sync is intentionally fire-and-forget; failures are recorded
      // in sync jobs and source metadata instead of crashing the app shell.
      void this.syncSource(source.id).catch(() => undefined);
    }, source.syncIntervalMinutes * 60 * 1000);

    this.timers.set(source.id, timer);
  }

  private async fetchManifest(source: SyncSource): Promise<CatalogManifestFile> {
    if (source.type === "http") {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Catalog request failed with status ${response.status}`);
      }
      return (await response.json()) as CatalogManifestFile;
    }

    const workingDir = await mkdtemp(join(tmpdir(), "friendly-agent-sync-"));
    try {
      // Git-backed sources are cloned into a temp workspace so manifests can be
      // read without mutating the user's actual project directories.
      await this.runGitClone(source, workingDir);
      const manifestFile = join(workingDir, source.manifestPath);
      const content = await readFile(manifestFile, "utf8");
      return JSON.parse(content) as CatalogManifestFile;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {};
      }
      throw error;
    } finally {
      await rm(workingDir, { recursive: true, force: true });
    }
  }

  private async runGitClone(source: SyncSource, workingDir: string): Promise<void> {
    await mkdir(workingDir, { recursive: true });
    const args = ["clone", "--depth", "1"];
    if (source.branch) {
      args.push("--branch", source.branch);
    }
    args.push(source.url, workingDir);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn("git", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          rejectPromise(new Error(stderr || "git clone failed"));
        }
      });
    });
  }

  private toCatalogItems(source: SyncSource, manifest: CatalogManifestFile): CatalogItem[] {
    const syncedAt = nowIso();
    const skills = (manifest.skills ?? []).map<CatalogItem>((skill) => ({
      id: skill.id,
      kind: "skill",
      title: skill.title,
      description: skill.description,
      version: skill.version,
      sourceId: source.id,
      repoUrl: skill.repoUrl,
      enabled: skill.enabled,
      installed: skill.installed,
      status: skill.enabled ? (skill.installed ? "installed" : "available") : "disabled",
      lastSyncedAt: syncedAt
    }));
    const agents = (manifest.agents ?? []).map<CatalogItem>((agent) => ({
      id: agent.id,
      kind: "agent",
      title: agent.title,
      description: agent.description,
      version: agent.version,
      sourceId: source.id,
      repoUrl: agent.repoUrl,
      enabled: agent.enabled,
      installed: agent.installed,
      status: agent.enabled ? (agent.installed ? "installed" : "available") : "disabled",
      lastSyncedAt: syncedAt
    }));
    return [...skills, ...agents];
  }

  private mergeCatalog(current: CatalogItem[], incoming: CatalogItem[], sourceId: string): CatalogItem[] {
    // Replacing items source-by-source keeps built-ins and other upstream feeds
    // intact while letting each synced source fully own its own entries.
    const preserved = current.filter((item) => item.sourceId !== sourceId);
    return [...incoming, ...preserved].sort((a, b) => a.title.localeCompare(b.title));
  }
}
