import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  buildLauncherLua,
  buildClaudeCodeConfig,
  buildCodexConfig,
  buildCursorConfig,
  parseRenderInBackground,
  defaultReaperResourcePath,
  launcherInstallPath,
  reaperIniPath,
  mcpServerEntryPath,
} from "../setup.mjs";

describe("buildLauncherLua", () => {
  it("bakes the repo path into the lua and dofiles the bridge", () => {
    const lua = buildLauncherLua("/Users/test/streetlight soundly");
    // Path appears in header comment + in the runtime string.
    expect(lua).toContain("/Users/test/streetlight soundly");
    expect(lua).toContain(
      'local repo = "/Users/test/streetlight soundly"',
    );
    expect(lua).toContain("dofile(bridge)");
    expect(lua).toContain("/reaper/streetlight_bridge.lua");
  });

  it("documents the REAPER Load... registration flow (not auto-discovery)", () => {
    // This is the user-asked-for correction — REAPER does NOT auto-add
    // scripts dropped in Scripts/. The launcher's header must spell out
    // the one-time Load... step or downstream users will be confused.
    const lua = buildLauncherLua("/Users/test/repo");
    expect(lua).toMatch(/Actions → Show action list → ReaScript: Load\.\.\./);
    expect(lua).toMatch(/does NOT auto-discover/i);
  });

  it("emits a guarded io.open check so a missing repo prints a friendly error, not a stack trace", () => {
    const lua = buildLauncherLua("/Users/test/repo");
    expect(lua).toContain("io.open(bridge");
    expect(lua).toContain("[streetlight] launcher: bridge not found");
    expect(lua).toContain("re-run `npm run setup`");
  });

  it("marks the file AUTO-GENERATED so the user does not hand-edit it", () => {
    const lua = buildLauncherLua("/Users/test/repo");
    expect(lua).toContain("AUTO-GENERATED");
    expect(lua).toContain("DO NOT EDIT BY HAND");
  });

  it("handles paths with spaces correctly (the project folder itself has a space)", () => {
    const lua = buildLauncherLua("/Users/test/dir with spaces/repo");
    // Lua double-quoted string handles spaces natively; no escape needed.
    expect(lua).toContain('local repo = "/Users/test/dir with spaces/repo"');
  });

  it("rejects empty or non-string input", () => {
    expect(() => buildLauncherLua("")).toThrow(/non-empty string/);
    expect(() => buildLauncherLua(null)).toThrow(/non-empty string/);
    expect(() => buildLauncherLua(undefined)).toThrow(/non-empty string/);
  });

  it("rejects relative paths (would break dofile resolution from REAPER's CWD)", () => {
    expect(() => buildLauncherLua("relative/path")).toThrow(/absolute/);
    expect(() => buildLauncherLua("./repo")).toThrow(/absolute/);
  });

  it("rejects paths with characters that need lua-escape (defensive)", () => {
    // Backslash + double-quote would force escape handling. macOS clone
    // paths don't contain these in practice; reject hard rather than
    // silently produce broken lua.
    expect(() => buildLauncherLua('/Users/test/with"quote')).toThrow(
      /quote or backslash/,
    );
    expect(() => buildLauncherLua("/Users/test/with\\back")).toThrow(
      /quote or backslash/,
    );
  });
});

describe("MCP client config builders", () => {
  it("Claude Code config points node at the absolute dist entry", () => {
    const json = buildClaudeCodeConfig("/Users/test/streetlight soundly");
    const parsed = JSON.parse(json);
    expect(parsed.mcpServers.streetlight.command).toBe("node");
    expect(parsed.mcpServers.streetlight.args).toEqual([
      "/Users/test/streetlight soundly/packages/mcp-server/dist/index.js",
    ]);
  });

  it("Claude Code config does NOT include STREETLIGHT_QUEUE_DIR (defaults match)", () => {
    // macOS-only v0.1 → both processes default to the same queue dir.
    // An explicit env var would be redundant; keep the snippet minimal.
    const json = buildClaudeCodeConfig("/Users/test/repo");
    const parsed = JSON.parse(json);
    expect(parsed.mcpServers.streetlight.env).toBeUndefined();
  });

  it("Cursor config mirrors Claude Code (same mcpServers shape)", () => {
    // If this ever diverges, both tests still assert their own contract
    // and we'll catch a future drift.
    const claude = buildClaudeCodeConfig("/Users/test/repo");
    const cursor = buildCursorConfig("/Users/test/repo");
    expect(cursor).toEqual(claude);
  });

  it("Codex TOML has [mcp_servers.streetlight] with the absolute dist path", () => {
    const toml = buildCodexConfig("/Users/test/streetlight soundly");
    expect(toml).toContain("[mcp_servers.streetlight]");
    expect(toml).toContain('command = "node"');
    expect(toml).toContain(
      'args = ["/Users/test/streetlight soundly/packages/mcp-server/dist/index.js"]',
    );
  });

  it("Codex TOML quotes paths that contain spaces using JSON-equivalent basic-string escaping", () => {
    // TOML basic strings share JSON's quote/backslash escape rules, so
    // JSON.stringify on the path string IS a valid TOML basic string.
    const toml = buildCodexConfig("/Users/test/dir with spaces/repo");
    expect(toml).toContain(
      'args = ["/Users/test/dir with spaces/repo/packages/mcp-server/dist/index.js"]',
    );
  });

  it("mcpServerEntryPath joins with native path separators", () => {
    expect(mcpServerEntryPath("/Users/test/repo")).toBe(
      path.join("/Users/test/repo", "packages", "mcp-server", "dist", "index.js"),
    );
  });
});

describe("parseRenderInBackground", () => {
  it("returns ON for workrender=1 under [reaper] section", () => {
    const ini = `[other]
foo=1

[reaper]
workrender=1
something=else
`;
    expect(parseRenderInBackground(ini)).toBe("ON");
  });

  it("returns OFF for workrender=0 under [reaper] section", () => {
    const ini = `[reaper]
workrender=0
`;
    expect(parseRenderInBackground(ini)).toBe("OFF");
  });

  it("returns ON for any non-zero workrender value (defensive — some builds use bitfields)", () => {
    const ini = `[reaper]\nworkrender=257\n`;
    expect(parseRenderInBackground(ini)).toBe("ON");
  });

  it("returns unknown when [reaper] section is missing", () => {
    expect(parseRenderInBackground("[other]\nfoo=1\n")).toBe("unknown");
  });

  it("returns unknown when workrender key is missing from [reaper] section", () => {
    expect(parseRenderInBackground("[reaper]\nfoo=1\n")).toBe("unknown");
  });

  it("returns unknown when input is not a string", () => {
    expect(parseRenderInBackground(null)).toBe("unknown");
    expect(parseRenderInBackground(undefined)).toBe("unknown");
    expect(parseRenderInBackground(42)).toBe("unknown");
  });

  it("does not pick workrender from a different section (e.g. [project])", () => {
    // Defensive: workrender belongs to [reaper]; a same-named key under
    // another section must not be misread as the global pref.
    const ini = `[project]
workrender=1

[reaper]
otherkey=0
`;
    expect(parseRenderInBackground(ini)).toBe("unknown");
  });

  it("tolerates whitespace around the = sign", () => {
    expect(parseRenderInBackground("[reaper]\nworkrender =  1\n")).toBe("ON");
    expect(parseRenderInBackground("[reaper]\nworkrender= 0 \n")).toBe("OFF");
  });
});

describe("defaultReaperResourcePath", () => {
  it("returns the macOS Application Support path for darwin", () => {
    expect(defaultReaperResourcePath("darwin", "/Users/test")).toBe(
      "/Users/test/Library/Application Support/REAPER",
    );
  });

  it("throws on non-darwin (v0.1 macOS only — explicit fail-fast)", () => {
    expect(() => defaultReaperResourcePath("linux", "/home/test")).toThrow(
      /macOS only/,
    );
    expect(() => defaultReaperResourcePath("win32", "C:\\Users\\test")).toThrow(
      /macOS only/,
    );
  });
});

describe("launcherInstallPath / reaperIniPath", () => {
  it("launcher lands under Scripts/Streetlight/start_bridge.lua", () => {
    expect(
      launcherInstallPath("/Users/test/Library/Application Support/REAPER"),
    ).toBe(
      "/Users/test/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua",
    );
  });

  it("reaper.ini sits directly under the resource path", () => {
    expect(
      reaperIniPath("/Users/test/Library/Application Support/REAPER"),
    ).toBe("/Users/test/Library/Application Support/REAPER/reaper.ini");
  });

  it("respects a custom resource path (--reaper-resource-path)", () => {
    expect(launcherInstallPath("/custom/path")).toBe(
      "/custom/path/Scripts/Streetlight/start_bridge.lua",
    );
    expect(reaperIniPath("/custom/path")).toBe("/custom/path/reaper.ini");
  });
});
