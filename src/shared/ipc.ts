export const ipcChannels = {
  appBootstrap: "app:bootstrap",
  appRelaunchElevated: "app:relaunch-elevated",
  chatSendMessage: "chat:send-message",
  chatCancelRun: "chat:cancel-run",
  chatSubmitPrompt: "chat:submit-prompt",
  chatCreateSession: "chat:create-session",
  sessionsList: "sessions:list",
  sessionsOpen: "sessions:open",
  sessionsDelete: "sessions:delete",
  contextPickFiles: "context:pick-files",
  contextPickFolder: "context:pick-folder",
  workspacePick: "workspace:pick",
  workspaceTree: "workspace:tree",
  providerHealth: "provider:health",
  providerLogin: "provider:login",
  catalogList: "catalog:list",
  catalogSync: "catalog:sync",
  catalogToggle: "catalog:toggle",
  runEvents: "run:events"
} as const;

export type IpcChannel = (typeof ipcChannels)[keyof typeof ipcChannels];
