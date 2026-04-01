export type MessageRole = "user" | "assistant" | "system";
export type SessionStatus = "idle" | "running" | "error" | "complete";
export type ContextAttachmentType = "file" | "folder" | "machine-fact";
export type CatalogItemKind = "skill" | "agent";
export type CatalogItemStatus =
  | "installed"
  | "available"
  | "update-available"
  | "disabled"
  | "sync-error";

export interface ContextAttachment {
  id: string;
  type: ContextAttachmentType;
  label: string;
  value: string;
  // Included lets the UI keep discovered attachments around while still giving
  // users an explicit opt-in toggle over what actually gets sent to the model.
  included: boolean;
  bytes?: number;
}

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export interface WorkspaceSnapshot {
  rootPath?: string;
  tree: FileTreeNode[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  // rawContent preserves the unformatted CLI output even when the UI later
  // chooses to render a derived display form.
  rawContent?: string;
  status?: "streaming" | "complete" | "error";
}

export interface ConversationThread {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  provider: string;
  workspaceRoot?: string;
  messages: ChatMessage[];
  attachments: ContextAttachment[];
}

export interface SessionRecord extends ConversationThread {
  lastRunId?: string;
}

export interface RunRequest {
  threadId: string;
  prompt: string;
  // summary is a flattened context envelope built by the app before handing
  // control to the provider-specific runtime.
  summary: string;
  workspaceRoot?: string;
  attachments: ContextAttachment[];
}

export interface RunPromptOption {
  label: string;
  value: string;
}

export interface RunPromptRequest {
  runId: string;
  input: string;
}

export type RunEvent =
  | { type: "started"; runId: string; threadId: string; timestamp: string }
  | { type: "stdout"; runId: string; chunk: string; timestamp: string }
  | { type: "stderr"; runId: string; chunk: string; timestamp: string }
  | {
      type: "prompt";
      runId: string;
      threadId: string;
      promptId: string;
      message: string;
      options?: RunPromptOption[];
      timestamp: string;
    }
  | {
      type: "completed";
      runId: string;
      threadId: string;
      friendlyMessage: string;
      rawOutput: string;
      timestamp: string;
    }
  | {
      type: "failed";
      runId: string;
      threadId: string;
      error: UserFacingError;
      timestamp: string;
    }
  | { type: "cancelled"; runId: string; threadId: string; timestamp: string };

export interface ProviderHealth {
  cliInstalled: boolean;
  cliVersion?: string;
  minimumSupportedVersion: string;
  recommendedVersion: string;
  supportedVersionRange: string;
  cliManagedByApp: boolean;
  copilotAvailable: boolean;
  isElevated?: boolean;
  authState: AuthState;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  issues: string[];
  managedCliPath?: string;
}

export interface AuthState {
  status: "unknown" | "authenticated" | "unauthenticated" | "error" | "in-progress";
  username?: string;
  detail?: string;
  lastCheckedAt: string;
}

export interface SkillManifest {
  id: string;
  kind: "skill";
  title: string;
  description: string;
  version: string;
  sourceId: string;
  repoUrl?: string;
  enabled: boolean;
  installed: boolean;
  lastSyncedAt?: string;
}

export interface AgentManifest {
  id: string;
  kind: "agent";
  title: string;
  description: string;
  version: string;
  sourceId: string;
  repoUrl?: string;
  enabled: boolean;
  installed: boolean;
  lastSyncedAt?: string;
}

export interface SyncSource {
  id: string;
  title: string;
  type: "git" | "http";
  url: string;
  // manifestPath is used for git-backed sources after cloning into temp space.
  manifestPath: string;
  branch?: string;
  enabled: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt?: string;
  lastError?: string;
}

export interface SyncJobRecord {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "success" | "error";
  detail?: string;
}

export interface CatalogItem {
  id: string;
  kind: CatalogItemKind;
  title: string;
  description: string;
  version: string;
  sourceId: string;
  repoUrl?: string;
  enabled: boolean;
  installed: boolean;
  status: CatalogItemStatus;
  lastSyncedAt?: string;
}

export interface UserFacingError {
  code:
    | "CLI_MISSING"
    | "CLI_VERSION_MISMATCH"
    | "COPILOT_UNAVAILABLE"
    | "AUTH_REQUIRED"
    | "AUTH_FAILED"
    | "TIMEOUT"
    | "CANCELLED"
    | "UNSUPPORTED_CONTEXT"
    | "SYNC_FAILED"
    | "UNKNOWN";
  title: string;
  message: string;
  detail?: string;
  recoverable: boolean;
}

export interface VersionManifest {
  minimumGhVersion: string;
  recommendedGhVersion: string;
  supportedGhVersionRange: string;
  copilotCompatibility: string;
  supportedPlatforms: Array<{
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    archiveExtension: "zip" | "tar.gz";
    downloadUrl: string;
    checksumSha256?: string;
    binaryRelativePath: string;
  }>;
}

export interface PersistedState {
  // Everything needed for the desktop shell is stored locally so sessions,
  // catalog state, and sync history survive app restarts without cloud state.
  sessions: SessionRecord[];
  sources: SyncSource[];
  catalog: CatalogItem[];
  syncJobs: SyncJobRecord[];
}
