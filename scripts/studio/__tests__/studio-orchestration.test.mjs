import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFaceStartupHookBlock,
  startupLuaHasFaceHook,
} from "../lib/face.mjs";
import { existsSync } from "node:fs";
import { installFaceBundle } from "../lib/face/install.mjs";
import { syncPackagedStartHelper } from "../lib/face/start-helper.mjs";
import { START_STEPS } from "../lib/orchestration/start-steps.mjs";
import {
  defaultInstallRoot,
  repoRootFromStudio,
  resolveInstallRoot,
  resolveOpenReaperStartCommand,
  resolvePackagedStartHelper,
  resolveStudioDialogSources,
  resolveStudioPackageRoot,
  packagedMacosStartHelperPath,
  studioDialogEntryFileName,
  studioDialogEntrySourcePath,
  studioDialogModuleSourceDir,
  studioPackageRoot,
  studioStatePath,
} from "../lib/paths.mjs";
import {
  buildPiStartPlan,
  readPiMcpConfig,
  resolvePiExecutable,
} from "../lib/pi.mjs";
import * as studioState from "../lib/state.mjs";
import { parseCli } from "../studio-orchestrate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

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

  it("resolves dialog install sources under scripts/studio/reaper for any caller root", () => {
    const pkg = studioPackageRoot();
    const gitRoot = repoRootFromStudio();
    const expectedEntry = path.join(pkg, "reaper", studioDialogEntryFileName());
    const expectedModules = path.join(pkg, "reaper", "dialog");
    expect(pkg.endsWith(path.join("scripts", "studio"))).toBe(true);
    expect(existsSync(expectedEntry)).toBe(true);
    expect(existsSync(expectedModules)).toBe(true);

    const omitted = resolveStudioDialogSources();
    const fromStudio = resolveStudioDialogSources(pkg);
    const fromRepo = resolveStudioDialogSources(gitRoot);

    for (const sources of [omitted, fromStudio, fromRepo]) {
      expect(sources.studioRoot).toBe(pkg);
      expect(sources.entrySource).toBe(expectedEntry);
      expect(sources.moduleSource).toBe(expectedModules);
      expect(existsSync(sources.entrySource)).toBe(true);
      expect(existsSync(sources.moduleSource)).toBe(true);
    }

    expect(resolveStudioPackageRoot()).toBe(pkg);
    expect(resolveStudioPackageRoot(pkg)).toBe(pkg);
    expect(resolveStudioPackageRoot(gitRoot)).toBe(pkg);
    expect(studioDialogEntrySourcePath(gitRoot)).toBe(expectedEntry);
    expect(studioDialogModuleSourceDir(gitRoot)).toBe(expectedModules);
    expect(studioDialogEntrySourcePath(gitRoot)).not.toBe(
      path.join(gitRoot, "reaper", studioDialogEntryFileName()),
    );

    const fakeRepoRoot = path.join("/tmp", "fake-openreaper-repo-root");
    expect(resolveStudioPackageRoot(fakeRepoRoot)).toBe(pkg);
    expect(studioDialogEntrySourcePath(fakeRepoRoot)).toBe(expectedEntry);
    expect(studioDialogModuleSourceDir(fakeRepoRoot)).toBe(expectedModules);
    expect(existsSync(studioDialogEntrySourcePath(fakeRepoRoot))).toBe(true);
  });

  it("resolves the tracked macOS start helper from packaging/", () => {
    const helper = packagedMacosStartHelperPath(repoRootFromStudio());
    expect(helper.endsWith(path.join("packaging", "macos", "OpenReaper-alpha", "bin", "openreaper-start"))).toBe(
      true,
    );
    expect(existsSync(helper)).toBe(true);
    expect(resolvePackagedStartHelper()).toBe(helper);
    expect(resolvePackagedStartHelper(path.join("/tmp", "fake-openreaper-repo-root"))).toBe(helper);
  });
});

describe("face install", () => {
  async function expectBundleCopied(reaperResourceRoot) {
    const entry = path.join(
      reaperResourceRoot,
      "Scripts",
      "OpenReaper",
      studioDialogEntryFileName(),
    );
    const moduleDir = path.join(
      reaperResourceRoot,
      "Scripts",
      "OpenReaper",
      "studio",
      "dialog",
    );
    expect(existsSync(entry)).toBe(true);
    expect(existsSync(path.join(moduleDir, "bootstrap.lua"))).toBe(true);
    const source = await readFile(
      path.join(studioPackageRoot(), "reaper", studioDialogEntryFileName()),
      "utf8",
    );
    expect(await readFile(entry, "utf8")).toBe(source);
  }

  it("copies dialog lua when caller passes git repo root, studio root, or omits root", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-face-install-"));
    try {
      const gitRoot = repoRootFromStudio();
      const pkg = studioPackageRoot();
      const cases = [
        { reaperResourceRoot: path.join(tmp, "from-repo"), repoRoot: gitRoot },
        { reaperResourceRoot: path.join(tmp, "from-studio"), repoRoot: pkg },
        { reaperResourceRoot: path.join(tmp, "omitted") },
        {
          reaperResourceRoot: path.join(tmp, "from-fake-repo"),
          repoRoot: path.join(tmp, "not-a-git-checkout"),
        },
      ];
      for (const args of cases) {
        const result = await installFaceBundle(args);
        expect(result.entryScriptPath).toContain(studioDialogEntryFileName());
        await expectBundleCopied(args.reaperResourceRoot);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("face.prepare", () => {
  it("does not ENOENT the dialog lua when Start passes git repo root (macOS layout)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-face-prepare-"));
    const homeDir = path.join(tmp, "home");
    const installRoot = path.join(tmp, "install");
    try {
      await mkdir(path.join(installRoot, "bin"), { recursive: true });
      await writeFile(path.join(installRoot, "bin", "openreaper-start"), "#!/bin/sh\n", "utf8");

      const ctx = {
        homeDir,
        platform: "darwin",
        env: {
          OPENREAPER_INSTALL_ROOT: installRoot,
          OPENREAPER_STUDIO_SKIP_PI: "1",
          PATH: "/nonexistent",
        },
        options: {},
        log() {},
      };

      const facePrepare = START_STEPS.find((step) => step.id === "face.prepare");
      await expect(facePrepare.run(ctx)).resolves.toBeUndefined();

      const installed = path.join(
        homeDir,
        "Library",
        "Application Support",
        "REAPER",
        "Scripts",
        "OpenReaper",
        studioDialogEntryFileName(),
      );
      expect(existsSync(installed)).toBe(true);
      expect(ctx.faceInstall.entryScriptPath).toBe(installed);
      expect(existsSync(path.join(ctx.faceInstall.moduleDir, "ui_face.lua"))).toBe(true);
      expect(ctx.startHelperSync?.synced).toBe(true);
      expect(ctx.startCmd?.command).toBe(path.join(installRoot, "bin", "openreaper-start"));
      const synced = await readFile(path.join(installRoot, "bin", "openreaper-start"), "utf8");
      expect(synced).toContain("startup_dialog_result_is_safe()");
      expect(synced).toContain("inspection_unavailable");
      expect(synced).toContain('OPENREAPER_STUDIO:-}" == "1"');
      expect(synced).toContain("else if windowTitle is \"Project Settings\"");
      expect(synced).toContain("set sawProjectSettings to true");
      expect(synced).toContain("startup-dialog-soft-ignore=");
      expect(synced).toContain("held_until_helper_exit");
      expect(synced).toContain("adopted_after_launchservices_restore");
      expect(synced).toContain('if windowTitle is "OpenReaper Studio" then');
      expect(synced).not.toContain("next repeat");
      expect(synced).not.toContain("studioFaceSafeTitles");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("start helper sync + studio env", () => {
  it("copies the tracked helper into INSTALL_ROOT/bin without changing install root", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-start-helper-"));
    try {
      const installRoot = path.join(tmp, "current");
      await mkdir(path.join(installRoot, "bin"), { recursive: true });
      await writeFile(path.join(installRoot, "bin", "openreaper-start"), "#!/bin/sh\nold\n", "utf8");
      const result = await syncPackagedStartHelper({
        installRoot,
        repoRoot: repoRootFromStudio(),
        platform: "darwin",
      });
      expect(result.synced).toBe(true);
      expect(result.dest).toBe(path.join(installRoot, "bin", "openreaper-start"));
      const copied = await readFile(result.dest, "utf8");
      expect(copied).toContain("inspection_unavailable");
      expect(copied).toContain("held_until_helper_exit");
      expect(copied).toContain('if windowTitle is "OpenReaper Studio" then');
      expect(copied).not.toContain("next repeat");
      expect(copied).not.toContain("studioFaceSafeTitles");
      expect(copied).not.toContain("old\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("passes OPENREAPER_STUDIO=1 from engine.openreaper_start", async () => {
    const source = await readFile(
      path.join(studioPackageRoot(), "lib", "orchestration", "start-steps.mjs"),
      "utf8",
    );
    expect(source).toMatch(/OPENREAPER_STUDIO:\s*"1"/);
    expect(source).toMatch(/OPENREAPER_STUDIO_FACE_HOOK_INSTALLED/);
    const engine = START_STEPS.find((step) => step.id === "engine.openreaper_start");
    expect(engine?.label).toMatch(/openreaper-start/);
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

describe("studioStatePath module split", () => {
  it("exports studioStatePath from paths.mjs, not state.mjs", () => {
    expect(typeof studioStatePath).toBe("function");
    expect(studioStatePath("/Users/test")).toBe(
      path.join("/Users/test", ".openreaper", "studio", "session-v1.json"),
    );
    expect(studioState.studioStatePath).toBeUndefined();
  });

  it("loads orchestrate and pi-send CLIs without a missing named export", async () => {
    await expect(import("../studio-orchestrate.mjs")).resolves.toBeTruthy();
    await expect(import("../studio-pi-send.mjs")).resolves.toBeTruthy();
  });

  it("runs status without SyntaxError on studioStatePath", async () => {
    const result = await runNode(["scripts/studio/studio-orchestrate.mjs", "status"]);
    expect(result.stderr).not.toMatch(/does not provide an export named ['"]studioStatePath['"]/);
    expect(result.stderr).not.toMatch(/SyntaxError/);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/status=idle|"contract"/);
  });
});
