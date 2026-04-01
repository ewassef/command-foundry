import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "Command Foundry",
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f5f5f5",
    icon: join(process.cwd(), "public", "app-icon.ico"),
    webPreferences: {
      preload: join(process.cwd(), "dist", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(join(process.cwd(), "dist", "renderer", "index.html"));
  }

  return window;
}

