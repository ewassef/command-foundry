import { join } from "node:path";
import type {
  ChatMessage,
  ContextAttachment,
  PersistedState,
  RunEvent,
  SessionRecord,
  SessionStatus
} from "@shared/types";
import { JsonStore } from "./json-store";
import { createId, nowIso, summarizeText } from "./utils";

const defaultState = (): PersistedState => ({
  sessions: [],
  sources: [
    {
      id: "default-friendly-catalog",
      title: "Command Foundry Catalog",
      type: "git",
      url: "https://github.com/openai/codex",
      manifestPath: "catalog/friendly-agent-catalog.json",
      enabled: true,
      syncIntervalMinutes: 60
    },
    {
      id: "default-mcp-catalog",
      title: "Command Foundry MCP Catalog",
      type: "git",
      url: "https://github.com/modelcontextprotocol/servers",
      manifestPath: "catalog/mcp-catalog.json",
      enabled: false,
      syncIntervalMinutes: 120
    }
  ],
  catalog: [
    {
      id: "builtin-workspace-skill",
      kind: "skill",
      title: "Workspace Guide",
      description: "Use the selected workspace as the main project context and ask for summaries, plans, or safe edits.",
      version: "1.0.0",
      sourceId: "builtin",
      enabled: true,
      installed: true,
      status: "installed",
      lastSyncedAt: nowIso()
    },
    {
      id: "builtin-review-skill",
      kind: "skill",
      title: "Review Skill",
      description: "Focus Copilot on bug hunting, regression review, and code-quality checks in the current workspace.",
      version: "1.0.0",
      sourceId: "builtin",
      enabled: true,
      installed: true,
      status: "installed",
      lastSyncedAt: nowIso()
    },
    {
      id: "builtin-builder-agent",
      kind: "agent",
      title: "Builder Agent",
      description: "Drive a feature or refactor task from request to code change using the current workspace.",
      version: "1.0.0",
      sourceId: "builtin",
      enabled: true,
      installed: true,
      status: "installed",
      lastSyncedAt: nowIso()
    },
    {
      id: "builtin-research-agent",
      kind: "agent",
      title: "Research Agent",
      description: "Inspect files, summarize architecture, and explain unfamiliar parts of a codebase before changing it.",
      version: "1.0.0",
      sourceId: "builtin",
      enabled: true,
      installed: true,
      status: "installed",
      lastSyncedAt: nowIso()
    }
  ],
  syncJobs: []
});

export class SessionStore {
  private readonly store: JsonStore<PersistedState>;

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "friendly-agent-state.json"), defaultState);
  }

  async readState(): Promise<PersistedState> {
    const state = await this.store.read();
    let changed = false;

    const defaultSources = defaultState().sources;
    for (const source of defaultSources) {
      if (!state.sources.some((existing) => existing.id === source.id)) {
        state.sources.push(source);
        changed = true;
      }
    }

    const defaultCatalogItems = defaultState().catalog;
    for (const item of defaultCatalogItems) {
      if (!state.catalog.some((existing) => existing.id === item.id)) {
        state.catalog.push(item);
        changed = true;
      }
    }

    if (changed) {
      await this.store.write(state);
    }

    return state;
  }

  async writeState(state: PersistedState): Promise<void> {
    await this.store.write(state);
  }

  async listSessions(): Promise<SessionRecord[]> {
    const state = await this.store.read();
    return state.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const state = await this.store.read();
    return state.sessions.find((session) => session.id === id);
  }

  async createSession(prompt?: string, workspaceRoot?: string): Promise<SessionRecord> {
    const timestamp = nowIso();
    const title = prompt ? summarizeText(prompt, 48) : "New session";
    const session: SessionRecord = {
      id: createId(),
      title,
      summary: prompt ? summarizeText(prompt, 120) : "Start a new conversation",
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "idle",
      provider: "github-copilot-cli",
      workspaceRoot,
      messages: [],
      attachments: []
    };

    const state = await this.store.read();
    state.sessions.unshift(session);
    await this.store.write(state);
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    const state = await this.store.read();
    state.sessions = state.sessions.filter((session) => session.id !== id);
    await this.store.write(state);
  }

  async upsertSession(session: SessionRecord): Promise<void> {
    const state = await this.store.read();
    const index = state.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      state.sessions[index] = session;
    } else {
      state.sessions.unshift(session);
    }
    await this.store.write(state);
  }

  async appendUserMessage(
    threadId: string,
    prompt: string,
    attachments: ContextAttachment[],
    workspaceRoot?: string
  ): Promise<SessionRecord> {
    const session = (await this.getSession(threadId)) ?? (await this.createSession(prompt));
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: prompt,
      createdAt: nowIso(),
      status: "complete"
    };

    session.messages = [...session.messages, userMessage];
    session.attachments = attachments;
    session.workspaceRoot = workspaceRoot ?? session.workspaceRoot;
    session.title = session.messages.length === 1 ? summarizeText(prompt, 48) : session.title;
    session.summary = summarizeText(prompt, 120);
    session.updatedAt = nowIso();
    session.status = "running";
    await this.upsertSession(session);
    return session;
  }

  async applyRunEvent(threadId: string, event: RunEvent): Promise<SessionRecord | undefined> {
    const session = await this.getSession(threadId);
    if (!session) {
      return undefined;
    }

    session.updatedAt = nowIso();
    session.lastRunId = event.runId;

    if (event.type === "started") {
      session.status = "running";
    }

    if (event.type === "stdout" || event.type === "stderr") {
      const lastMessage = session.messages.at(-1);
      const chunk = event.chunk;
      if (lastMessage?.role === "assistant" && lastMessage.status === "streaming") {
        lastMessage.content = `${lastMessage.content}${chunk}`;
        lastMessage.rawContent = `${lastMessage.rawContent ?? ""}${chunk}`;
      } else {
        session.messages.push({
          id: createId(),
          role: "assistant",
          content: chunk,
          rawContent: chunk,
          createdAt: nowIso(),
          status: "streaming"
        });
      }
    }

    if (event.type === "completed") {
      this.setAssistantResult(
        session,
        event.rawOutput || event.friendlyMessage,
        event.rawOutput,
        "complete",
        "complete"
      );
    }

    if (event.type === "failed") {
      const errorText = [event.error.title, event.error.message, event.error.detail]
        .filter(Boolean)
        .join("\n\n");
      this.setAssistantResult(
        session,
        errorText,
        errorText,
        "error",
        "error"
      );
    }

    if (event.type === "cancelled") {
      this.setAssistantResult(
        session,
        "Cancelled before completion.",
        "Cancelled before completion.",
        "error",
        "idle"
      );
    }

    await this.upsertSession(session);
    return session;
  }

  private setAssistantResult(
    session: SessionRecord,
    content: string,
    rawContent: string,
    messageStatus: ChatMessage["status"],
    sessionStatus: SessionStatus
  ): void {
    const lastMessage = session.messages.at(-1);
    if (lastMessage?.role === "assistant") {
      lastMessage.content = content;
      lastMessage.rawContent = rawContent;
      lastMessage.status = messageStatus;
    } else {
      session.messages.push({
        id: createId(),
        role: "assistant",
        content,
        rawContent,
        createdAt: nowIso(),
        status: messageStatus
      });
    }
    session.summary = summarizeText(content, 120);
    session.status = sessionStatus;
  }
}
