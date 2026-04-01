import { spawn } from "node:child_process";
import type { RunEvent, RunRequest, UserFacingError } from "@shared/types";
import { ManagedGhService } from "./managed-gh-service";
import { createId, nowIso } from "./utils";

interface ActiveRun {
  threadId: string;
  process: ReturnType<typeof spawn>;
}

export class CopilotProvider {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(private readonly ghService: ManagedGhService) {}

  async checkPrerequisites() {
    return this.ghService.checkHealth();
  }

  async checkAuthState() {
    return this.ghService.checkAuthState();
  }

  async startLogin() {
    return this.ghService.startLogin();
  }

  async submitPrompt(runId: string, input: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active || !active.process.stdin) {
      return;
    }

    active.process.stdin.write(input.endsWith("\n") ? input : `${input}\n`);
  }

  async *run(request: RunRequest): AsyncGenerator<RunEvent> {
    // Health is checked on every run so the desktop app can recover when users
    // install, upgrade, or authenticate the CLI outside the app.
    let health = await this.ghService.checkHealth();
    if (!health.cliInstalled || !health.cliVersion || health.issues.some((issue) => issue.includes("outside the supported range"))) {
      await this.ghService.ensureInstalled();
      health = await this.ghService.checkHealth();
    }
    if (!health.cliInstalled) {
      yield this.failed(
        request.threadId,
        this.cliError("CLI_MISSING", "GitHub CLI is missing. Command Foundry can install it automatically when you sign in or start a run.")
      );
      return;
    }
    if (!health.cliVersion || health.issues.some((issue) => issue.includes("outside the supported range"))) {
      yield this.failed(request.threadId, this.ghService.createVersionMismatchError(health.cliVersion));
      return;
    }
    const copilotReady = health.copilotAvailable || (await this.ghService.ensureCopilotAvailable());
    if (!copilotReady) {
      yield this.failed(
        request.threadId,
        this.cliError(
          "COPILOT_UNAVAILABLE",
          "Copilot CLI is not available. Friendly Agent could not install or activate it automatically."
        )
      );
      return;
    }
    if (health.authState.status !== "authenticated") {
      yield this.failed(
        request.threadId,
        this.cliError("AUTH_REQUIRED", "Please sign in to GitHub before running Copilot.")
      );
      return;
    }

    const copilotCommand = await this.ghService.getCopilotCommand();
    const runId = createId();
    const prompt = this.composePrompt(request);
    // The workspace root is passed both as cwd and as an allowed directory so
    // Copilot stays anchored to the selected project instead of the app root.
    const runtimeArgs = [
      ...copilotCommand.argsPrefix,
      "--allow-all-tools",
      "--stream=on",
      ...(request.workspaceRoot ? [`--add-dir=${request.workspaceRoot}`] : []),
      "-p",
      prompt
    ];
    const child = spawn(copilotCommand.command, runtimeArgs, {
      cwd: request.workspaceRoot,
      env: this.ghService.getCliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.activeRuns.set(runId, { threadId: request.threadId, process: child });
    yield {
      type: "started",
      runId,
      threadId: request.threadId,
      timestamp: nowIso()
    };

    let stdout = "";
    let stderr = "";
    const queue: RunEvent[] = [];
    let closed = false;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      // Raw stdout is the source of truth for the transcript, so we surface it
      // incrementally instead of waiting for the process to finish.
      queue.push({ type: "stdout", runId, chunk: text, timestamp: nowIso() });
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      queue.push({ type: "stderr", runId, chunk: text, timestamp: nowIso() });
    });

    child.on("close", (code) => {
      closed = true;
      this.activeRuns.delete(runId);
      if (code === 0) {
        queue.push({
          type: "completed",
          runId,
          threadId: request.threadId,
          friendlyMessage: stdout.trim(),
          rawOutput: stdout,
          timestamp: nowIso()
        });
      } else {
        queue.push({
          type: "failed",
          runId,
          threadId: request.threadId,
          error: {
            code: "UNKNOWN",
            title: "Copilot run failed",
            message: "The GitHub Copilot CLI exited unexpectedly.",
            detail: stderr || stdout,
            recoverable: true
          },
          timestamp: nowIso()
        });
      }
    });

    child.on("error", (error) => {
      closed = true;
      this.activeRuns.delete(runId);
      queue.push({
        type: "failed",
        runId,
        threadId: request.threadId,
        error: {
          code: "UNKNOWN",
          title: "Copilot run failed",
          message: error.message,
          recoverable: true
        },
        timestamp: nowIso()
      });
    });

    while (!closed || queue.length > 0) {
      const next = queue.shift();
      if (next) {
        yield next;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active) {
      active.process.kill();
      this.activeRuns.delete(runId);
    }
  }

  private composePrompt(request: RunRequest): string {
    // The provider sends a single flattened prompt today so different CLI
    // backends can share the same higher-level request contract.
    const contextPrefix = request.summary ? `Conversation summary: ${request.summary}\n\n` : "";
    const attachments = request.attachments
      .filter((attachment) => attachment.included)
      .map((attachment) => `${attachment.type}: ${attachment.label} -> ${attachment.value}`)
      .join("\n");

    const attachmentSection = attachments ? `Context:\n${attachments}\n\n` : "";
    return `${contextPrefix}${attachmentSection}User request:\n${request.prompt}`;
  }

  private failed(threadId: string, error: UserFacingError): RunEvent {
    return {
      type: "failed",
      runId: createId(),
      threadId,
      error,
      timestamp: nowIso()
    };
  }

  private cliError(code: UserFacingError["code"], message: string): UserFacingError {
    return {
      code,
      title: "GitHub CLI prerequisite issue",
      message,
      recoverable: true
    };
  }
}
