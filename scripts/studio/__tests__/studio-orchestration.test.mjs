import { describe, it, expect } from "vitest";
import {
  buildFaceStartupHookBlock,
  startupLuaHasFaceHook,
} from "../lib/face.mjs";
import {
  defaultInstallRoot,
  resolveInstallRoot,
  resolveOpenReaperStartCommand,
} from "../lib/paths.mjs";
import {
  buildPiStartPlan,
  readPiMcpConfig,
  resolvePiExecutable,
} from "../lib/pi.mjs";
import { parseCli } from "../studio-orchestrate.mjs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("paths", () => {
  it("prefers OPENREAPER_INSTALL_ROOT when start helper exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-studio-"));
    const bin = path.join(tmp, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "openreaper-start.sh"), "#!/bin/sh\n", "utf8");
    const root = resolveInstallRoot({ OPENREAPER_INSTALL_ROOT: tmp }, os.homedir());
    expect(root).toBe(tmp);
    const cmd = resolveOpenReaperStartCommand(root, "darwin");
    expect(cmd?.command).toBe(path.join(bin, "openreaper-start.sh"));
    await rm(tmp, { recursive: true, force: true });
  });

  it("accepts packaged bin/openreaper-start without .sh extension", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-studio-bare-"));
    const bin = path.join(tmp, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "openreaper-start"), "#!/bin/sh\n", "utf8");
    const root = resolveInstallRoot({ OPENREAPER_INSTALL_ROOT: tmp }, os.homedir());
    expect(root).toBe(tmp);
    const cmd = resolveOpenReaperStartCommand(root, "darwin");
    expect(cmd?.command).toBe(path.join(bin, "openreaper-start"));
    await rm(tmp, { recursive: true, force: true });
  });

  it("default install root matches alpha layout", () => {
    expect(defaultInstallRoot("/Users/test")).toBe("/Users/test/.openreaper/current");
  });
});

describe("face hook", () => {
  it("builds a marked __startup.lua block with the stub path", () => {
    const block = buildFaceStartupHookBlock("/tmp/OpenReaper/stub.lua");
    expect(block).toContain("BEGIN openreaper-studio-face");
    expect(block).toContain("/tmp/OpenReaper/stub.lua");
    expect(startupLuaHasFaceHook(block)).toBe(true);
  });
});

describe("pi", () => {
  it("does not plan start when pi is missing", () => {
    const plan = buildPiStartPlan({ piExecutable: null, env: {} });
    expect(plan.mode).toBe("absent");
  });

  it("respects OPENREAPER_STUDIO_SKIP_PI", () => {
    const plan = buildPiStartPlan({
      piExecutable: "/usr/local/bin/pi",
      env: { OPENREAPER_STUDIO_SKIP_PI: "1" },
    });
    expect(plan.mode).toBe("skipped");
  });

  it("detects openreaper in mcp.json without writing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-pi-"));
    const mcpPath = path.join(tmp, "mcp.json");
    await writeFile(
      mcpPath,
      JSON.stringify({ mcpServers: { openreaper: { command: "node", args: [] } } }),
      "utf8",
    );
    const info = await readPiMcpConfig(mcpPath);
    expect(info.openreaperConfigured).toBe(true);
    await rm(tmp, { recursive: true, force: true });
  });

  it("resolvePiExecutable returns null in empty PATH", () => {
    expect(resolvePiExecutable({ PATH: "/nonexistent" })).toBeNull();
  });
});

describe("parseCli", () => {
  it("parses start with project path", () => {
    expect(parseCli(["start", "--project-path", "/tmp/a.RPP"])).toEqual({
      command: "start",
      options: { projectPath: "/tmp/a.RPP" },
    });
  });
});
