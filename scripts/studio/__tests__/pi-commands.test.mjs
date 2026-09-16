import { describe, it, expect } from "vitest";
import { commandsUrlFromRpcBase, resolveStudioPiCommandsUrl } from "../lib/agent-seam/pi-rpc-urls.mjs";
import { fetchPiCommands } from "../lib/agent-seam/fetch-pi-commands.mjs";
import { BUILTIN_HINTS, withBuiltinCommandFallback } from "../lib/agent-seam/pi-command-hints.mjs";

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
  it("returns unavailable with builtin hints when no RPC URL", async () => {
    const result = await fetchPiCommands({});
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("unavailable");
    expect(result.fallback).toBe(true);
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.commands.map((cmd) => cmd.name)).toContain("help");
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
    expect(result.fallback).toBe(false);
  });

  it("falls back to builtin hints when get_commands returns an empty list", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ ok: true, commands: [] }),
    });
    const result = await fetchPiCommands({
      env: { OPENREAPER_STUDIO_PI_COMMANDS_URL: "http://127.0.0.1:1/commands" },
    });
    globalThis.fetch = originalFetch;
    expect(result.ok).toBe(true);
    expect(result.fallback).toBe(true);
    expect(result.commands).toEqual([...BUILTIN_HINTS]);
  });

  it("falls back to builtin hints when fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await fetchPiCommands({
      env: { OPENREAPER_STUDIO_PI_COMMANDS_URL: "http://127.0.0.1:1/commands" },
    });
    globalThis.fetch = originalFetch;
    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
    expect(result.commands.length).toBeGreaterThan(0);
  });
});

describe("builtin command fallback", () => {
  it("prefers real Pi commands when present", () => {
    const live = [{ name: "skill:mix", description: "Mix" }];
    expect(withBuiltinCommandFallback(live)).toBe(live);
    expect(withBuiltinCommandFallback([])).toEqual([...BUILTIN_HINTS]);
    expect(withBuiltinCommandFallback(null)).toEqual([...BUILTIN_HINTS]);
  });
});

describe("pi-rpc-host commands endpoint", () => {
  it("uses builtin fallback when Pi get_commands is empty or fails", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../lib/agent-seam/pi-rpc-host.mjs", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/withBuiltinCommandFallback/);
    expect(source).toMatch(/pi_rpc_fallback/);
    expect(source).not.toMatch(/mode: "pi_rpc_error"/);
  });
});
