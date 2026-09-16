import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENREAPER_PING_TOOL_NAME,
  createOpenReaperExtension,
} from "../../../packages/pi-extension-openreaper/openreaper-extension.mjs";
import {
  installStudioPiExtension,
  resolveStudioPiExtensionFlags,
  studioPiExtensionEntryPath,
} from "../lib/pi/extension.mjs";
import { repoRootFromStudio } from "../lib/paths.mjs";

describe("OpenReaper Pi extension stub", () => {
  it("registers openreaper_ping and returns a native-tool stub payload", async () => {
    const tools = [];
    await createOpenReaperExtension({
      registerTool(def) {
        tools.push(def);
      },
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe(OPENREAPER_PING_TOOL_NAME);
    expect(tools[0].name).toBe("openreaper_ping");
    const result = await tools[0].execute();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.source).toBe("openreaper-pi-extension");
    expect(payload.bridge).toBe("not_wired");
    expect(payload.note).toMatch(/MCP stdio/i);
  });

  it("resolves --no-builtin-tools + --extension (not --no-tools)", () => {
    const flags = resolveStudioPiExtensionFlags({ repoRoot: repoRootFromStudio(), env: {} });
    expect(flags.exists).toBe(true);
    expect(flags.noBuiltinTools).toBe(true);
    expect(flags.args).toEqual([
      "--no-builtin-tools",
      "--no-extensions",
      "--extension",
      studioPiExtensionEntryPath(),
    ]);
    expect(flags.args).not.toContain("--no-tools");
    expect(flags.entry.endsWith("openreaper-extension.mjs")).toBe(true);
  });

  it("installs the extension into the private agentDir/extensions tree", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-ext-install-"));
    const agentDir = path.join(tmp, "agent");
    try {
      const installed = await installStudioPiExtension({
        agentDir,
        repoRoot: repoRootFromStudio(),
      });
      expect(installed.installed).toBe(true);
      const dest = await readFile(installed.destMjs, "utf8");
      expect(dest).toMatch(/openreaper_ping/);
      expect(dest).toMatch(/registerTool/);
      const discovery = await readFile(installed.destTs, "utf8");
      expect(discovery).toMatch(/openreaper-extension\.mjs/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Start does not teach MCP stdio", () => {
  it("start-steps product log is native extension, not mcp.json installer", async () => {
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "orchestration", "start-steps.mjs"),
      "utf8",
    );
    expect(source).toMatch(/native Pi extension/);
    expect(source).not.toMatch(/Wire OpenReaper MCP in a future installer step/);
    expect(source).toMatch(/installStudioPiExtension/);
    expect(source).toMatch(/OPENREAPER_STUDIO_PI_CWD/);
    expect(source).toMatch(/OPENREAPER_STUDIO_REAPER_PID/);
  });
});
