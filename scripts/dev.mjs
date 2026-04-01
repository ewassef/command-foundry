import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import electron from "electron";

const children = [];

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    ...options
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

async function waitForReady() {
  const mainFile = resolve("dist/main/index.cjs");
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const rendererReady = await isPortOpen(5173, "127.0.0.1");
    const mainReady = await access(mainFile)
      .then(() => true)
      .catch(() => false);

    if (attempt === 0 || attempt % 10 === 0) {
      console.log(
        `[dev] waiting for services: renderer=${rendererReady ? "ready" : "pending"} main=${mainReady ? "ready" : "pending"}`
      );
    }

    if (rendererReady && mainReady) {
      console.log("[dev] renderer and main process are ready. Launching Electron...");
      return;
    }

    await delay(500);
  }

  throw new Error("Timed out waiting for Vite and main-process build output.");
}

function isPortOpen(port, host) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    const finish = (ready) => {
      socket.destroy();
      resolvePromise(ready);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("renderer", "npm", ["run", "dev:renderer"]);
start("main", "npm", ["run", "dev:main"]);

await waitForReady();

start("electron", electron, ["."], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
  }
});
