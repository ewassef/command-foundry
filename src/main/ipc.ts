import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { ipcChannels } from "@shared/ipc";
import type { ContextAttachment, RunPromptRequest, RunRequest, WorkspaceSnapshot } from "@shared/types";
import { ContextService } from "./services/context-service";
import { CopilotProvider } from "./services/copilot-provider";
import { CatalogSyncService } from "./services/catalog-sync-service";
import { SessionStore } from "./services/session-store";
import { WorkspaceService } from "./services/workspace-service";

export function registerIpcHandlers(
  window: BrowserWindow,
  services: {
    provider: CopilotProvider;
    sessionStore: SessionStore;
    catalogSync: CatalogSyncService;
    contextService: ContextService;
    workspaceService: WorkspaceService;
  }
): void {
  // Bootstrap lets the renderer paint immediately with sessions, provider
  // health, and catalog state from a single round-trip.
  ipcMain.handle(ipcChannels.appBootstrap, async () => {
    const [sessions, health, catalog] = await Promise.all([
      services.sessionStore.listSessions(),
      services.provider.checkPrerequisites(),
      services.catalogSync.listCatalog()
    ]);
    return { sessions, health, catalog };
  });

  ipcMain.handle(ipcChannels.appRelaunchElevated, async () => {
    if (process.platform !== "win32") {
      return false;
    }

    // Relaunching the whole app as admin is more reliable than trying to
    // selectively elevate child processes mid-session.
    const appPath = app.getAppPath();
    const args = process.defaultApp ? [appPath] : [];
    const extraArgs = process.argv.slice(process.defaultApp ? 2 : 1).filter((arg) => arg !== "--inspect");
    const allArgs = [...args, ...extraArgs]
      .map((arg) => `'${arg.replaceAll("'", "''")}'`)
      .join(", ");

    spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath '${process.execPath}' -Verb RunAs -ArgumentList ${allArgs || "@()"}`
      ],
      { detached: true, stdio: "ignore" }
    ).unref();

    setTimeout(() => app.quit(), 200);
    return true;
  });

  ipcMain.handle(ipcChannels.chatCreateSession, async (_event, prompt?: string) => {
    return services.sessionStore.createSession(prompt);
  });
  ipcMain.handle(ipcChannels.sessionsList, async () => services.sessionStore.listSessions());
  ipcMain.handle(ipcChannels.sessionsOpen, async (_event, id: string) =>
    services.sessionStore.getSession(id)
  );
  ipcMain.handle(ipcChannels.sessionsDelete, async (_event, id: string) => {
    await services.sessionStore.deleteSession(id);
    return services.sessionStore.listSessions();
  });

  ipcMain.handle(
    ipcChannels.chatSendMessage,
    async (
      _event,
      request: {
        threadId?: string;
        prompt: string;
        attachments: ContextAttachment[];
        workspaceRoot?: string;
      }
    ) => {
      // User messages are persisted before the provider starts so the session
      // list reflects in-flight work even if the run later fails.
      const session = request.threadId
        ? await services.sessionStore.appendUserMessage(
            request.threadId,
            request.prompt,
            request.attachments,
            request.workspaceRoot
          )
        : await services.sessionStore.createSession(request.prompt, request.workspaceRoot).then(async (created) =>
            services.sessionStore.appendUserMessage(
              created.id,
              request.prompt,
              request.attachments,
              request.workspaceRoot
            )
          );

      const contextBlock = await services.contextService.buildContextBlock(request.attachments);
      const runRequest: RunRequest = {
        threadId: session.id,
        prompt: request.prompt,
        summary: `${session.summary}\n\n${contextBlock}`.trim(),
        workspaceRoot: request.workspaceRoot ?? session.workspaceRoot,
        attachments: request.attachments
      };

      // Provider events are streamed back to the renderer while also updating
      // the durable session record that powers history/reopen flows.
      void (async () => {
        try {
          for await (const runEvent of services.provider.run(runRequest)) {
            await services.sessionStore.applyRunEvent(session.id, runEvent);
            window.webContents.send(ipcChannels.runEvents, runEvent);
          }
        } catch (error) {
          const fallbackEvent = {
            type: "failed" as const,
            runId: "runtime-error",
            threadId: session.id,
            error: {
              code: "UNKNOWN" as const,
              title: "Runtime error",
              message: error instanceof Error ? error.message : String(error),
              recoverable: true
            },
            timestamp: new Date().toISOString()
          };
          await services.sessionStore.applyRunEvent(session.id, fallbackEvent);
          window.webContents.send(ipcChannels.runEvents, fallbackEvent);
        }
      })();

      return session;
    }
  );

  ipcMain.handle(ipcChannels.chatCancelRun, async (_event, runId: string) => {
    await services.provider.cancel(runId);
    return true;
  });
  ipcMain.handle(ipcChannels.chatSubmitPrompt, async (_event, payload: RunPromptRequest) => {
    await services.provider.submitPrompt(payload.runId, payload.input);
    return true;
  });
  ipcMain.handle(ipcChannels.providerHealth, async () => services.provider.checkPrerequisites());
  ipcMain.handle(ipcChannels.providerLogin, async () => services.provider.startLogin());

  ipcMain.handle(ipcChannels.contextPickFiles, async () => {
    // Attachments are kept explicit so the renderer can always show the user
    // exactly what extra context is being sent to the CLI.
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"]
    });
    return result.filePaths.map<ContextAttachment>((filePath) => ({
      id: filePath,
      type: "file",
      label: filePath.split(/[\\/]/).at(-1) ?? filePath,
      value: filePath,
      included: true
    }));
  });

  ipcMain.handle(ipcChannels.contextPickFolder, async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"]
    });
    return result.filePaths.map<ContextAttachment>((folderPath) => ({
      id: folderPath,
      type: "folder",
      label: folderPath.split(/[\\/]/).at(-1) ?? folderPath,
      value: folderPath,
      included: true
    }));
  });

  ipcMain.handle(ipcChannels.workspacePick, async () => {
    // Workspaces are treated differently from generic folder attachments:
    // they define the CLI cwd and drive the explorer view.
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"]
    });

    const rootPath = result.filePaths[0];
    if (!rootPath) {
      return { tree: [] } satisfies WorkspaceSnapshot;
    }

    return services.workspaceService.loadWorkspace(rootPath);
  });

  ipcMain.handle(ipcChannels.workspaceTree, async (_event, rootPath: string) =>
    services.workspaceService.loadWorkspace(rootPath)
  );

  ipcMain.handle(ipcChannels.catalogList, async () => services.catalogSync.listCatalog());
  ipcMain.handle(ipcChannels.catalogSync, async (_event, sourceId: string) => {
    await services.catalogSync.syncSource(sourceId);
    return services.catalogSync.listCatalog();
  });
  ipcMain.handle(ipcChannels.catalogToggle, async (_event, payload: { itemId: string; enabled: boolean }) => {
    await services.catalogSync.toggleCatalogItem(payload.itemId, payload.enabled);
    return services.catalogSync.listCatalog();
  });
}
