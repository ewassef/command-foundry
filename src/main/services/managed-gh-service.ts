import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { shell } from "electron";
import type { AuthState, ProviderHealth, UserFacingError, VersionManifest } from "@shared/types";
import { versionManifest } from "@shared/version-manifest";
import { nowIso } from "./utils";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
  ): Promise<CommandResult>;
}

class NodeProcessRunner implements ProcessRunner {
  async run(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
  ): Promise<CommandResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        env: options?.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let timeout: NodeJS.Timeout | undefined;

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        resolvePromise({ code: code ?? 1, stdout, stderr });
      });

      if (options?.timeoutMs) {
        timeout = setTimeout(() => {
          child.kill();
          rejectPromise(new Error(`Timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      }
    });
  }
}

export class ManagedGhService {
  private readonly runner: ProcessRunner;
  private readonly manifest: VersionManifest;
  private pendingAuthNotice?: string;

  constructor(
    private readonly userDataPath: string,
    runner?: ProcessRunner,
    manifest: VersionManifest = versionManifest
  ) {
    this.runner = runner ?? new NodeProcessRunner();
    this.manifest = manifest;
  }

  getManagedInstallDir(): string {
    return join(this.userDataPath, "runtime", "gh", this.manifest.ghVersion);
  }

  getCliEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // The desktop app manages stored auth itself; inherited shell tokens can
    // interfere with gh auth flows and should not bleed into child processes.
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    return env;
  }

  getManagedBinaryPath(): string {
    const target = this.findSupportedPlatform();
    if (!target) {
      throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
    }
    return join(this.getManagedInstallDir(), target.binaryRelativePath);
  }

  getManagedCopilotInstallDir(): string {
    return join(this.userDataPath, "runtime", "copilot");
  }

  getManagedCopilotBinaryPath(): string {
    const executable = process.platform === "win32" ? "copilot.cmd" : "copilot";
    return join(this.getManagedCopilotInstallDir(), "node_modules", ".bin", executable);
  }

  async ensureInstalled(): Promise<string> {
    const existing = await this.findUsableBinary();
    if (existing.path && existing.version === this.manifest.ghVersion) {
      return existing.path;
    }

    const target = this.findSupportedPlatform();
    if (!target) {
      throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
    }

    // GitHub CLI is treated like a managed runtime dependency so every app
    // release can pin to a tested version.
    const tempArchive = join(tmpdir(), basename(target.downloadUrl));
    await this.downloadFile(target.downloadUrl, tempArchive, target.checksumSha256);
    await this.extractArchive(tempArchive, this.getManagedInstallDir(), target.archiveExtension);

    const binaryPath = join(this.getManagedInstallDir(), target.binaryRelativePath);
    await stat(binaryPath);
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }
    return binaryPath;
  }

  async checkAuthState(): Promise<AuthState> {
    const usable = await this.findUsableBinary();
    if (!usable.path) {
      return {
        status: "unauthenticated",
        detail: "GitHub CLI is not installed yet.",
        lastCheckedAt: nowIso()
      };
    }

    const executable = usable.path;
    try {
      const sanitizedResult = await this.runner.run(executable, ["auth", "status"], {
        timeoutMs: 30_000,
        env: this.getCliEnvironment()
      });
      if (sanitizedResult.code === 0) {
        const usernameMatch = sanitizedResult.stdout.match(/account ([^\s]+)/i);
        return {
          status: "authenticated",
          username: usernameMatch?.[1],
          detail: sanitizedResult.stdout.trim(),
          lastCheckedAt: nowIso()
        };
      }

      return {
        status: "unauthenticated",
        detail: this.pendingAuthNotice ?? (sanitizedResult.stderr || sanitizedResult.stdout).trim(),
        lastCheckedAt: nowIso()
      };
    } catch (error) {
      return {
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
        lastCheckedAt: nowIso()
      };
    }
  }

  async startLogin(): Promise<AuthState> {
    const executable = await this.ensureInstalled();
    this.pendingAuthNotice = "Starting GitHub sign-in...";
    await this.runInteractiveLogin(executable);
    this.pendingAuthNotice = undefined;
    return this.checkAuthState();
  }

  async checkHealth(): Promise<ProviderHealth> {
    const usable = await this.findUsableBinary();
    const authState = await this.checkAuthState();
    const issues: string[] = [];

    if (!usable.path) {
      issues.push("GitHub CLI is not installed.");
    } else if (usable.version !== this.manifest.ghVersion) {
      issues.push(
        `GitHub CLI version ${usable.version ?? "unknown"} does not match the pinned version ${this.manifest.ghVersion}.`
      );
    }

    const copilotAvailable = usable.path ? await this.checkCopilotAvailable(usable.path) : false;
    if (!copilotAvailable) {
      issues.push("GitHub Copilot CLI is not available through the managed GitHub CLI.");
    }

    if (authState.status !== "authenticated") {
      issues.push("GitHub authentication is required.");
    }

    return {
      cliInstalled: Boolean(usable.path),
      cliVersion: usable.version,
      pinnedVersion: this.manifest.ghVersion,
      copilotAvailable,
      isElevated: this.isElevated(),
      authState,
      platform: process.platform,
      arch: process.arch,
      issues,
      managedCliPath: usable.path ?? this.getManagedBinaryPath()
    };
  }

  async getCliPathForChecks(): Promise<string> {
    const usable = await this.findUsableBinary();
    if (usable.path) {
      return usable.path;
    }
    return this.ensureInstalled();
  }

  async ensureCopilotAvailable(): Promise<boolean> {
    const copilotBinary = this.getManagedCopilotBinaryPath();
    if (await this.hasManagedCopilotBinary(copilotBinary)) {
      return true;
    }

    const installDir = this.getManagedCopilotInstallDir();
    await mkdir(installDir, { recursive: true });
    // Installing via npm keeps the Copilot CLI isolated inside the app runtime
    // instead of relying on a mutable global user installation.
    const result = await this.runner.run("npm", ["install", "--prefix", installDir, "@github/copilot"], {
      timeoutMs: 5 * 60_000,
      env: this.getCliEnvironment()
    });
    if (result.code !== 0) {
      return false;
    }

    return this.hasManagedCopilotBinary(copilotBinary);
  }

  async getCopilotCommand(): Promise<{ command: string; argsPrefix: string[] }> {
    const copilotBinary = this.getManagedCopilotBinaryPath();
    if (await this.hasManagedCopilotBinary(copilotBinary)) {
      return { command: copilotBinary, argsPrefix: [] };
    }

    const ghBinary = await this.getCliPathForChecks();
    return { command: ghBinary, argsPrefix: ["copilot"] };
  }

  createVersionMismatchError(currentVersion?: string): UserFacingError {
    return {
      code: "CLI_VERSION_MISMATCH",
      title: "Unsupported GitHub CLI version",
      message: `Command Foundry is pinned to GitHub CLI ${this.manifest.ghVersion}, but found ${currentVersion ?? "an unknown version"}.`,
      recoverable: true
    };
  }

  private async findUsableBinary(): Promise<{ path?: string; version?: string }> {
    const managedPath = this.getManagedBinaryPath();
    const managed = await this.tryVersion(managedPath);
    if (managed.version) {
      return { path: managedPath, version: managed.version };
    }

    const systemCommand = process.platform === "win32" ? "where" : "which";
    const systemLookup = await this.runner.run(systemCommand, ["gh"]).catch(() => undefined);
    const systemPath = systemLookup?.stdout.split(/\r?\n/).find(Boolean)?.trim();
    if (!systemPath) {
      return {};
    }

    const system = await this.tryVersion(systemPath);
    if (system.version) {
      return { path: systemPath, version: system.version };
    }

    return {};
  }

  private async tryVersion(binaryPath: string): Promise<{ version?: string }> {
    try {
      await stat(binaryPath);
      const result = await this.runner.run(binaryPath, ["--version"], {
        timeoutMs: 15_000,
        env: this.getCliEnvironment()
      });
      const versionMatch = result.stdout.match(/gh version\s+([0-9.]+)/i);
      return { version: versionMatch?.[1] };
    } catch {
      return {};
    }
  }

  private async checkCopilotAvailable(executable: string): Promise<boolean> {
    const result = await this.runner.run(executable, ["help", "copilot"], {
      timeoutMs: 20_000,
      env: this.getCliEnvironment()
    });
    if (result.code !== 0) {
      return false;
    }

    if (/Copilot CLI not installed/i.test(`${result.stdout}\n${result.stderr}`)) {
      return false;
    }

    return true;
  }

  private async hasManagedCopilotBinary(binaryPath: string): Promise<boolean> {
    try {
      await stat(binaryPath);
      return true;
    } catch {
      return false;
    }
  }

  private findSupportedPlatform() {
    return this.manifest.supportedPlatforms.find(
      (target) => target.platform === process.platform && target.arch === process.arch
    );
  }

  private async downloadFile(url: string, destination: string, checksumSha256?: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const file = createWriteStream(destination);
      get(url, (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          rejectPromise(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolvePromise();
        });
      }).on("error", rejectPromise);
    });

    if (checksumSha256) {
      const hash = createHash("sha256");
      hash.update(await readFile(destination));
      if (hash.digest("hex") !== checksumSha256) {
        throw new Error("Checksum verification failed.");
      }
    }
  }

  private async extractArchive(
    archivePath: string,
    destinationDir: string,
    extension: "zip" | "tar.gz"
  ): Promise<void> {
    await rm(destinationDir, { recursive: true, force: true });
    await mkdir(destinationDir, { recursive: true });

    if (extension === "zip") {
      await this.runner.run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destinationDir}' -Force`
      ]);
      return;
    }

    await this.runner.run("tar", ["-xzf", archivePath, "-C", destinationDir]);
  }

  private async runInteractiveLogin(executable: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(
        executable,
        [
          "auth",
          "login",
          "--web",
          "--clipboard",
          "--git-protocol",
          "https",
          "--skip-ssh-key",
          "--hostname",
          "github.com"
        ],
        {
          env: this.getCliEnvironment(),
          stdio: ["pipe", "pipe", "pipe"]
        }
      );

      let settled = false;
      let output = "";
      let enterSent = false;
      let browserOpened = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          child.kill();
          settled = true;
          rejectPromise(new Error("Timed out waiting for GitHub login to complete."));
        }
      }, 5 * 60_000);

      const maybeAdvanceBrowserPrompt = (text: string) => {
        output += text;
        if (!enterSent && /Press Enter to open github\.com in your browser/i.test(output)) {
          child.stdin.write("\n");
          enterSent = true;
        }

        const codeMatch = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
        if (codeMatch) {
          this.pendingAuthNotice = `Paste code ${codeMatch[0]} at https://github.com/login/device`;
          if (!browserOpened) {
            browserOpened = true;
            void shell.openExternal("https://github.com/login/device");
          }
        }
      };

      child.stdout.on("data", (chunk) => {
        maybeAdvanceBrowserPrompt(chunk.toString());
      });

      child.stderr.on("data", (chunk) => {
        maybeAdvanceBrowserPrompt(chunk.toString());
      });

      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          rejectPromise(error);
        }
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        if (code === 0) {
          this.pendingAuthNotice = undefined;
          resolvePromise();
          return;
        }

        rejectPromise(new Error(output.trim() || `GitHub auth login exited with code ${code ?? 1}.`));
      });
    });
  }

  isElevated(): boolean {
    if (process.platform !== "win32") {
      return typeof process.getuid === "function" ? process.getuid() === 0 : false;
    }

    const userName = process.env.USERNAME ?? "";
    return userName.toLowerCase() === "administrator";
  }
}
