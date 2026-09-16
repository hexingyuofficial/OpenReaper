import { describe, it, expect } from "vitest";
import { commandsUrlFromRpcBase, resolveStudioPiCommandsUrl } from "../lib/agent-seam/pi-rpc-urls.mjs";
import { fetchPiCommands } from "../lib/agent-seam/fetch-pi-commands.mjs";

describe("pi commands URLs", () => {
  it("derives /commands from prompt URL", () => {
    expect(commandsUrlFromRpcBase("http://127.0.0.1:3847/prompt")).toBe(
      "http://127.0.0.1:3847/commands",
    );
  });

  it("resolves from face config piRpcUrl", () => {
    const url = resolveStudioPiCommandsUrl({
      faceConfig: { piRpcUrl: "http://127.0.0.1:9/prompt" },
    });
    expect(url).toBe("http://127.0.0.1:9/commands");
  });
});

describe("fetchPiCommands", () => {
  it("returns unavailable when no RPC URL", async () => {
    const result = await fetchPiCommands({});
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("unavailable");
    expect(result.commands).toEqual([]);
  });

  it("parses commands from HTTP host", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        commands: [{ name: "skill:demo", description: "Demo skill" }],
      }),
    });
    const result = await fetchPiCommands({
      env: { OPENREAPER_STUDIO_PI_COMMANDS_URL: "http://127.0.0.1:1/commands" },
    });
    globalThis.fetch = originalFetch;
    expect(result.commands[0].name).toBe("skill:demo");
  });
});
