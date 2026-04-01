import { app } from "electron";
import { createMainWindow } from "./window";
import { registerIpcHandlers } from "./ipc";
import { CatalogSyncService } from "./services/catalog-sync-service";
import { ContextService } from "./services/context-service";
import { CopilotProvider } from "./services/copilot-provider";
import { ManagedGhService } from "./services/managed-gh-service";
import { SessionStore } from "./services/session-store";
import { WorkspaceService } from "./services/workspace-service";

async function bootstrap() {
  await app.whenReady();

  const userData = app.getPath("userData");
  const sessionStore = new SessionStore(userData);
  const ghService = new ManagedGhService(userData);
  const provider = new CopilotProvider(ghService);
  const catalogSync = new CatalogSyncService(sessionStore);
  const contextService = new ContextService();
  const workspaceService = new WorkspaceService();

  const window = createMainWindow();
  registerIpcHandlers(window, {
    provider,
    sessionStore,
    catalogSync,
    contextService,
    workspaceService
  });

  await catalogSync.startBackgroundSync();

  app.on("activate", () => {
    if (window.isDestroyed()) {
      createMainWindow();
    }
  });
}

void bootstrap();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
