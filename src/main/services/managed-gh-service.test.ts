import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VersionManifest } from "@shared/types";
import { ManagedGhService, type ProcessRunner } from "./managed-gh-service";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class FakeRunner implements ProcessRunner {
  constructor(private readonly responses: Record<string, { code: number; stdout: string; stderr: string }>) {}

  async run(command: string, args: string[]) {
    return this.responses[[command, ...args].join(" ")] ?? { code: 1, stdout: "", stderr: "missing" };
  }
}

async function createManagedGhFixture(version = "2.88.1") {
  const dir = await mkdtemp(join(tmpdir(), "friendly-agent-gh-test-"));
  tempDirs.push(dir);
  const binaryDir = join(dir, "runtime", "gh", version, `gh_${version}_windows_amd64`, "bin");
  await mkdir(binaryDir, { recursive: true });
  const binaryPath = join(binaryDir, "gh.exe");
  await writeFile(binaryPath, "placeholder");
  return { dir, binaryPath };
}

const manifest: VersionManifest = {
  ghVersion: "2.88.1",
  copilotCompatibility: "test",
  supportedPlatforms: [
    {
      platform: process.platform,
      arch: process.arch,
      archiveExtension: "zip",
      downloadUrl: "https://example.com/gh.zip",
      binaryRelativePath: "gh_2.88.1_windows_amd64/bin/gh.exe"
    }
  ]
};

describe("ManagedGhService", () => {
  it("reports a healthy pinned install when version, copilot, and auth are valid", async () => {
    const { dir, binaryPath } = await createManagedGhFixture();
    const runner = new FakeRunner({
      [`${binaryPath} --version`]: { code: 0, stdout: "gh version 2.88.1", stderr: "" },
      [`${binaryPath} help copilot`]: { code: 0, stdout: "copilot help", stderr: "" },
      [`${binaryPath} auth status`]: {
        code: 0,
        stdout: "Logged in to github.com account codex",
        stderr: ""
      }
    });
    const service = new ManagedGhService(dir, runner, manifest);

    const health = await service.checkHealth();
    expect(health.cliInstalled).toBe(true);
    expect(health.cliVersion).toBe("2.88.1");
    expect(health.authState.status).toBe("authenticated");
    expect(health.issues).toEqual([]);
  });

  it("flags version mismatch when the discovered cli version differs from the pin", async () => {
    const { dir, binaryPath } = await createManagedGhFixture("2.88.1");
    const runner = new FakeRunner({
      [`${binaryPath} --version`]: { code: 0, stdout: "gh version 2.87.0", stderr: "" },
      [`${binaryPath} help copilot`]: { code: 0, stdout: "copilot help", stderr: "" },
      [`${binaryPath} auth status`]: { code: 0, stdout: "Logged in to github.com account codex", stderr: "" }
    });
    const service = new ManagedGhService(dir, runner, manifest);

    const health = await service.checkHealth();
    expect(health.issues.join(" ")).toContain("does not match the pinned version");
  });
});
