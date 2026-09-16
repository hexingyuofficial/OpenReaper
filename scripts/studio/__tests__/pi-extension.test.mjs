import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENREAPER_PING_TOOL_NAME,
  TOOL_NAMES,
  createOpenReaperExtension,
} from "../../../packages/pi-extension-openreaper/openreaper-extension.mjs";
import {
  denyAudioAssetFileMutation,
  executeCallTemplate,
  executeGetState,
  executeListTemplates,
  executePing,
} from "../../../packages/pi-extension-openreaper/tools.mjs";
import {
  resetMcpKernelCache,
  setBridgeClientForTests,
} from "../../../packages/pi-extension-openreaper/kernel.mjs";
import {
  installStudioPiExtension,
  resolveStudioPiExtensionFlags,
  studioPiExtensionEntryPath,
} from "../lib/pi/extension.mjs";
import { installStudioWorkspaceContract } from "../lib/pi/studio-contract.mjs";
import { repoRootFromStudio } from "../lib/paths.mjs";
import { buildPiStartPlan } from "../lib/pi.mjs";
import { resolveStudioPiLayout } from "../lib/pi/private-layout.mjs";

afterEach(() => {
  setBridgeClientForTests(null);
  resetMcpKernelCache();
});

describe("OpenReaper Pi extension tools", () => {
  it("registers ping, get_state, list_*, and call_template", async () => {
    const tools = [];
    await createOpenReaperExtension({
      registerTool(def) {
        tools.push(def);
      },
    });
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        TOOL_NAMES.callTemplate,
        TOOL_NAMES.getState,
        TOOL_NAMES.listRecipes,
        TOOL_NAMES.listTemplates,
        TOOL_NAMES.ping,
      ].sort(),
    );
    expect(OPENREAPER_PING_TOOL_NAME).toBe("openreaper_ping");
  });

  it("ping fails clearly when the Bridge is down", async () => {
    setBridgeClientForTests({
      client: {
        send: async () => ({
          ok: false,
          error: {
            code: "BRIDGE_NOT_RUNNING",
            message: "No response from REAPER bridge within 50ms.",
            recoverable: true,
          },
        }),
      },
      kernel: {
        ping: async (client, timeoutMs) => client.send("ping", {}, { timeoutMs }),
      },
      registry: {},
    });
    const result = await executePing("1", {}, { timeoutMs: 50 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("BRIDGE_NOT_RUNNING");
  });

  it("ping returns Bridge payload when the queue answers", async () => {
    setBridgeClientForTests({
      client: {},
      kernel: {
        ping: async () => ({
          ok: true,
          result: { bridge: "connected", reaper_version: "7.0" },
        }),
      },
      registry: {},
    });
    const result = await executePing();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.result.bridge).toBe("connected");
  });

  it("get_state fails clearly when the Bridge is down", async () => {
    setBridgeClientForTests({
      client: {
        send: async () => ({
          ok: false,
          error: {
            code: "BRIDGE_NOT_RUNNING",
            message: "No response from REAPER bridge within 50ms.",
            recoverable: true,
          },
        }),
      },
      kernel: {
        getState: async (client, params, timeoutMs) =>
          client.send("get_state", params, { timeoutMs }),
      },
      registry: {},
    });
    const result = await executeGetState("1", { scope: "project" }, { timeoutMs: 50 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("BRIDGE_NOT_RUNNING");
  });

  it("list_templates uses the in-process kernel registry (no Bridge, no mcp.json)", async () => {
    const result = await executeListTemplates();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.result.templates)).toBe(true);
    expect(payload.result.templates.length).toBeGreaterThan(0);
    expect(payload.result.templates.some((t) => t.name === "media_import")).toBe(true);
  });

  it("refuses rename/move of original audio asset files", async () => {
    expect(
      denyAudioAssetFileMutation({
        name: "media_import",
        params: { rename_source: true, path: "/audio/take.wav" },
      })?.error.code,
    ).toBe("PERMISSION_DENIED");
    const result = await executeCallTemplate("1", {
      name: "media_import",
      params: { move_source: "/tmp/a.wav" },
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("Pi flags never use --no-tools", () => {
  it("resolveStudioPiExtensionFlags omits --no-tools", () => {
    const flags = resolveStudioPiExtensionFlags({ repoRoot: repoRootFromStudio(), env: {} });
    expect(flags.exists).toBe(true);
    expect(flags.noBuiltinTools).toBe(true);
    expect(flags.args).toContain("--no-builtin-tools");
    expect(flags.args).not.toContain("--no-tools");
    expect(flags.args).not.toContain("-nt");
    expect(flags.args).toContain("--extension");
    expect(flags.entry).toBe(studioPiExtensionEntryPath());
  });

  it("strips --no-tools from OPENREAPER_STUDIO_PI_ARGS extras", () => {
    const layout = resolveStudioPiLayout({
      homeDir: "/Users/test",
      installRoot: "/Users/test/.openreaper/current",
      env: {},
    });
    const plan = buildPiStartPlan({
      piExecutable: "/usr/local/bin/pi",
      env: { OPENREAPER_STUDIO_PI_ARGS: "--no-tools --foo" },
      layout,
    });
    expect(plan.args).toContain("--no-builtin-tools");
    expect(plan.args).toContain("--foo");
    expect(plan.args).not.toContain("--no-tools");
    expect(plan.args).not.toContain("-nt");
  });
});

describe("Studio contract + no mcp.json writes", () => {
  it("copies AGENTS.md and .pi/SYSTEM.md into the workspace if missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-contract-"));
    const workspaceDir = path.join(tmp, "workspace");
    try {
      const first = await installStudioWorkspaceContract({
        workspaceDir,
        repoRoot: repoRootFromStudio(),
      });
      expect(first.installed).toBe(true);
      expect(first.copied).toEqual(["AGENTS.md", ".pi/SYSTEM.md"]);
      const agents = await readFile(first.agentsDest, "utf8");
      expect(agents).toMatch(/MUST NOT rename or move original audio asset files/);
      expect(agents).not.toMatch(/sk-|api[_-]?key/i);
      const system = await readFile(first.systemDest, "utf8");
      expect(system).toMatch(/not a general-purpose software engineer/i);
      await writeFile(first.agentsDest, "user edited\n", "utf8");
      const second = await installStudioWorkspaceContract({
        workspaceDir,
        repoRoot: repoRootFromStudio(),
      });
      expect(second.skippedExisting).toBe(true);
      expect(await readFile(first.agentsDest, "utf8")).toBe("user edited\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("installStudioPiExtension does not write mcp.json", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-ext-mcp-"));
    const agentDir = path.join(tmp, "agent");
    try {
      const installed = await installStudioPiExtension({
        agentDir,
        repoRoot: repoRootFromStudio(),
      });
      expect(installed.installed).toBe(true);
      expect(existsSync(path.join(agentDir, "mcp.json"))).toBe(false);
      expect(existsSync(path.join(installed.destDir, "tools.mjs"))).toBe(true);
      expect(existsSync(path.join(installed.destDir, "kernel.mjs"))).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("start-steps never writes mcp.json", async () => {
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "orchestration", "start-steps.mjs"),
      "utf8",
    );
    expect(source).toMatch(/installStudioWorkspaceContract/);
    expect(source).not.toMatch(/writeFile\([^)]*mcp\.json/);
    expect(source).not.toMatch(/mcpServers/);
  });

  it("kernel loader never imports mcp-server stdio index", async () => {
    const kernel = await readFile(
      path.join(repoRootFromStudio(), "packages", "pi-extension-openreaper", "kernel.mjs"),
      "utf8",
    );
    expect(kernel).toMatch(/file-queue/);
    expect(kernel).not.toMatch(/import\([^)]*mcp-server\/(?:src|dist)\/index/);
    expect(kernel).not.toMatch(/streetlight-mcp/);
    expect(kernel).not.toMatch(/mcp\.json/);
  });
});
