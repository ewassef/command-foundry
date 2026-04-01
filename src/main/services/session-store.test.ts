import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "friendly-agent-session-test-"));
  tempDirs.push(dir);
  return new SessionStore(dir);
}

describe("SessionStore", () => {
  it("creates and persists sessions", async () => {
    const store = await createStore();
    const created = await store.createSession("Summarize this repository");

    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(created.id);
    expect(sessions[0]?.title).toContain("Summarize");
  });

  it("applies completed run events to the active session", async () => {
    const store = await createStore();
    const session = await store.createSession("Help with auth");
    await store.appendUserMessage(session.id, "Help with auth", []);
    await store.applyRunEvent(session.id, {
      type: "completed",
      runId: "run-1",
      threadId: session.id,
      friendlyMessage: "Here is a friendly answer.",
      rawOutput: "Raw output",
      timestamp: new Date().toISOString()
    });

    const updated = await store.getSession(session.id);
    expect(updated?.status).toBe("complete");
    expect(updated?.messages.at(-1)?.content).toBe("Here is a friendly answer.");
    expect(updated?.messages.at(-1)?.rawContent).toBe("Raw output");
  });
});
