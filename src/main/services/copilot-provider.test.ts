import { describe, expect, it, vi } from "vitest";
import type { ProviderHealth, RunRequest } from "@shared/types";
import { CopilotProvider } from "./copilot-provider";

describe("CopilotProvider", () => {
  it("returns an auth-required failure before spawning when auth is missing", async () => {
    const provider = new CopilotProvider({
      checkHealth: async () =>
        ({
          cliInstalled: true,
          cliVersion: "2.89.0",
          minimumSupportedVersion: "2.88.1",
          recommendedVersion: "2.89.0",
          supportedVersionRange: ">=2.88.1 <3.0.0",
          cliManagedByApp: false,
          copilotAvailable: true,
          authState: {
            status: "unauthenticated",
            lastCheckedAt: new Date().toISOString()
          },
          platform: process.platform,
          arch: process.arch,
          issues: ["GitHub authentication is required."]
        }) satisfies ProviderHealth,
      createVersionMismatchError: vi.fn(),
      ensureInstalled: vi.fn(),
      getCliPathForChecks: vi.fn(),
      checkAuthState: vi.fn(),
      startLogin: vi.fn()
    } as never);

    const events: unknown[] = [];
    const request: RunRequest = {
      threadId: "thread-1",
      prompt: "Summarize the repo",
      summary: "",
      attachments: []
    };

    for await (const event of provider.run(request)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("failed");
    expect((events[0] as { error: { code: string } }).error.code).toBe("AUTH_REQUIRED");
  });
});
