import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "@shared/ipc";
import type { ContextAttachment, RunPromptRequest } from "@shared/types";

const api = {
  bootstrap: () => ipcRenderer.invoke(ipcChannels.appBootstrap),
  relaunchElevated: () => ipcRenderer.invoke(ipcChannels.appRelaunchElevated),
  createSession: (prompt?: string) => ipcRenderer.invoke(ipcChannels.chatCreateSession, prompt),
  listSessions: () => ipcRenderer.invoke(ipcChannels.sessionsList),
  openSession: (id: string) => ipcRenderer.invoke(ipcChannels.sessionsOpen, id),
  deleteSession: (id: string) => ipcRenderer.invoke(ipcChannels.sessionsDelete, id),
  sendMessage: (payload: {
    threadId?: string;
    prompt: string;
    attachments: ContextAttachment[];
    workspaceRoot?: string;
  }) =>
    ipcRenderer.invoke(ipcChannels.chatSendMessage, payload),
  cancelRun: (runId: string) => ipcRenderer.invoke(ipcChannels.chatCancelRun, runId),
  submitPrompt: (payload: RunPromptRequest) => ipcRenderer.invoke(ipcChannels.chatSubmitPrompt, payload),
  checkProviderHealth: () => ipcRenderer.invoke(ipcChannels.providerHealth),
  startLogin: () => ipcRenderer.invoke(ipcChannels.providerLogin),
  pickFiles: () => ipcRenderer.invoke(ipcChannels.contextPickFiles),
  pickFolder: () => ipcRenderer.invoke(ipcChannels.contextPickFolder),
  pickWorkspace: () => ipcRenderer.invoke(ipcChannels.workspacePick),
  getWorkspaceTree: (rootPath: string) => ipcRenderer.invoke(ipcChannels.workspaceTree, rootPath),
  listCatalog: () => ipcRenderer.invoke(ipcChannels.catalogList),
  syncSource: (sourceId: string) => ipcRenderer.invoke(ipcChannels.catalogSync, sourceId),
  toggleCatalogItem: (payload: { itemId: string; enabled: boolean }) =>
    ipcRenderer.invoke(ipcChannels.catalogToggle, payload),
  onRunEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(ipcChannels.runEvents, wrapped);
    return () => {
      ipcRenderer.removeListener(ipcChannels.runEvents, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("friendlyAgent", api);

declare global {
  interface Window {
    friendlyAgent: typeof api;
  }
}
