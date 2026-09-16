import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { runPipeline } from "../lib/orchestration/run-pipeline.mjs";
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
import { parseCli, studioFailureExitCode, recordedStudioStartExitCode, studioStartProcessExitCode, applySuccessfulStartGateProcessExit } from "../studio-orchestrate.mjs";
import { exitCodeFromChild, runProcess } from "../lib/orchestration/process.mjs";

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
      expect(synced).toContain("adopt_window_after_soft_safe");
      expect(synced).toContain("held_for_successor_publish");
      expect(synced).toContain("successor_identity_pending");
      expect(synced).toContain("startup_hook_pid_gap_keep_adopting");
      expect(synced).toContain("startup_wait_accept_published_stage");
      expect(synced).toContain("STARTUP_DIALOG_INSPECT_EVERY_TICKS");
      expect(synced).toContain("STARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS");
      expect(synced).toContain("STARTUP_DIALOG_FIRST_TIMEOUT_SECONDS");
      expect(synced).toContain("startup_wait_poll_ticks");
      expect(synced).toContain('OPENREAPER_START_HELPER_REV="studio-hook-budget-v5"');
      expect(synced).toContain("start-helper-rev=");
      expect(synced).toContain('if windowTitle is "OpenReaper Studio" then');
      expect(synced).toContain("startup-last-chance=published_stage");
      expect(synced).toContain("startup-last-chance=bridge_liveness");
      expect(synced).toContain("startup-hook=leftover_budget_accept");
      expect(synced).toContain("STARTUP_AX_SKIP_REMAINING_MS");
      expect(synced).toContain("budget_remaining_ms=");
      expect(synced).toContain("startup-ax=stopped_after_soft_blocker");
      expect(synced).toContain("startup-dialog-dismiss=project_settings_cancel");
      expect(synced).toContain("startup-dialog-project-settings-dismiss=title_only_unique_cancel_soft");
      expect(synced).toContain("click theCancelButton");
      expect(synced).toContain("startup-reaper-preserve=soft_policy");
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
    expect(result.rev).toBe("studio-hook-budget-v5");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      const copied = await readFile(result.dest, "utf8");
      expect(copied).toContain("inspection_unavailable");
      expect(copied).toContain("held_until_helper_exit");
      expect(copied).toContain("adopt_window_after_soft_safe");
      expect(copied).toContain("held_for_successor_publish");
      expect(copied).toContain("successor_identity_pending");
      expect(copied).toContain("startup_wait_accept_published_stage");
      expect(copied).toContain('OPENREAPER_START_HELPER_REV="studio-hook-budget-v5"');
      expect(copied).toContain("STARTUP_DIALOG_FIRST_TIMEOUT_SECONDS");
      expect(copied).toContain("startup_wait_poll_ticks");
      expect(copied).toContain("startup-last-chance=published_stage");
      expect(copied).toContain("startup-hook=leftover_budget_accept");
      expect(copied).toContain('if windowTitle is "OpenReaper Studio" then');
      expect(copied).toContain("startup-ax=stopped_after_soft_blocker");
      expect(copied).toContain("startup-dialog-dismiss=project_settings_cancel");
      expect(copied).toContain("click theCancelButton");
      expect(copied).toContain("startup-last-chance=bridge_liveness");
      expect(copied).toContain("startup-reaper-preserve=soft_policy");
      expect(copied).not.toContain("next repeat");
      expect(copied).not.toContain("studioFaceSafeTitles");
      expect(copied).not.toContain("old\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("overwrites a stale openreaper-start.sh so it cannot win over the synced helper", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-stale-sh-"));
    try {
      const installRoot = path.join(tmp, "current");
      const bin = path.join(installRoot, "bin");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, "openreaper-start.sh"), "#!/bin/sh\nold-sh\n", {
        encoding: "utf8",
        mode: 0o755,
      });
      const result = await syncPackagedStartHelper({
        installRoot,
        repoRoot: repoRootFromStudio(),
        platform: "darwin",
      });
      expect(result.synced).toBe(true);
      expect(result.overwrittenStaleSh).toBe(true);
      expect(result.dest).toBe(path.join(bin, "openreaper-start"));
      const dest = await readFile(result.dest, "utf8");
      const sh = await readFile(path.join(bin, "openreaper-start.sh"), "utf8");
      expect(dest).toContain('OPENREAPER_START_HELPER_REV="studio-hook-budget-v5"');
      expect(sh).toContain('OPENREAPER_START_HELPER_REV="studio-hook-budget-v5"');
      expect(sh).not.toContain("old-sh");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("pins face.prepare startCmd to the synced dest even when only a stale .sh existed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-pin-helper-"));
    const homeDir = path.join(tmp, "home");
    const installRoot = path.join(tmp, "install");
    try {
      await mkdir(path.join(installRoot, "bin"), { recursive: true });
      await writeFile(path.join(installRoot, "bin", "openreaper-start.sh"), "#!/bin/sh\nold-only-sh\n", {
        encoding: "utf8",
        mode: 0o755,
      });
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
      expect(ctx.startCmd?.command).toBe(path.join(installRoot, "bin", "openreaper-start"));
      expect(ctx.startHelperSync?.rev).toBe("studio-hook-budget-v5");
      const synced = await readFile(ctx.startCmd.command, "utf8");
      expect(synced).toContain('OPENREAPER_START_HELPER_REV="studio-hook-budget-v5"');
      expect(synced).not.toContain("old-only-sh");
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
    expect(source).toMatch(/helperSync\.dest/);
    expect(source).toMatch(/START_HELPER_REV/);
    expect(source).toMatch(/probeOpenReaperEngine/);
    expect(source).toMatch(/openreaperStartSoftContinued/);
    expect(source).toMatch(/engineDegraded/);
    expect(source).toMatch(/exitCodeFromChild/);
    expect(source).toMatch(/assertRunnableStartHelper/);
    expect(source).toMatch(/is not the synced helper/);
    const engine = START_STEPS.find((step) => step.id === "engine.openreaper_start");
    expect(engine?.label).toMatch(/openreaper-start/);
    const finalize = START_STEPS.find((step) => step.id === "face.finalize");
    expect(finalize?.alwaysRun).toBe(true);
  });

  it("refuses to spawn a stale dest even when startHelperSync claims it is current", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-stale-spawn-"));
    try {
      const dest = path.join(tmp, "openreaper-start");
      await writeFile(dest, "#!/bin/sh\nold-helper\n", { encoding: "utf8", mode: 0o755 });
      const engine = START_STEPS.find((step) => step.id === "engine.openreaper_start");
      const ctx = {
        startCmd: { command: dest, args: [], cwd: tmp },
        startHelperSync: {
          synced: true,
          dest,
          rev: "studio-hook-budget-v5",
        },
        options: {},
        env: { OPENREAPER_STUDIO: "1" },
        faceInstall: {},
        homeDir: tmp,
        installRoot: tmp,
        state: { openreaperStartExitCode: null },
        log() {},
        runProcess: async () => {
          throw new Error("stale helper must not spawn");
        },
      };
      await expect(engine.run(ctx)).rejects.toThrow(/stale openreaper-start|missing/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("soft-continues when openreaper-start is non-zero but Bridge is live", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-engine-soft-"));
    const homeDir = path.join(tmp, "home");
    const installRoot = path.join(tmp, "install");
    try {
      const ctx = {
        homeDir,
        installRoot,
        env: { OPENREAPER_STUDIO: "1" },
        options: {},
        startCmd: { command: "true", args: [], cwd: installRoot },
        faceInstall: { hookInstalled: true },
        state: { openreaperStartExitCode: null },
        engineProbeGraceMs: 0,
        log() {},
        runProcess: async () => ({ code: 1 }),
        probeOpenReaperEngine: async () => ({
          usable: true,
          stage: "bridge_dofile_succeeded",
          heartbeatReady: true,
          reason: "heartbeat_live",
        }),
      };
      const engine = START_STEPS.find((step) => step.id === "engine.openreaper_start");
      await expect(engine.run(ctx)).resolves.toBeUndefined();
      expect(ctx.state.openreaperStartExitCode).toBe(1);
      expect(ctx.state.openreaperStartSoftContinued).toBe(true);
      expect(ctx.state.engineDegraded).toBe(false);
      expect(ctx.state.engineProbe.heartbeatReady).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("still continues to Pi when Bridge is not live, with engineDegraded", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-engine-degraded-"));
    const homeDir = path.join(tmp, "home");
    const logs = [];
    try {
      const ctx = {
        homeDir,
        installRoot: path.join(tmp, "install"),
        env: {},
        options: {},
        startCmd: { command: "false", args: [], cwd: tmp },
        state: { openreaperStartExitCode: null },
        engineProbeGraceMs: 0,
        log(message) {
          logs.push(message);
        },
        runProcess: async () => ({ code: 1 }),
        probeOpenReaperEngine: async () => ({
          usable: false,
          stage: null,
          heartbeatReady: false,
          reason: "no_transport_dir",
        }),
      };
      const engine = START_STEPS.find((step) => step.id === "engine.openreaper_start");
      await expect(engine.run(ctx)).resolves.toBeUndefined();
      expect(ctx.state.openreaperStartExitCode).toBe(1);
      expect(ctx.state.openreaperStartSoftContinued).toBe(true);
      expect(ctx.state.engineDegraded).toBe(true);
      expect(logs.join("\n")).toMatch(/engineDegraded=true/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("face.finalize publishes rpc_background URLs even when engineDegraded", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-face-finalize-"));
    const homeDir = path.join(tmp, "home");
    try {
      const ctx = {
        homeDir,
        env: {},
        piBridgeScript: "/tmp/studio-pi-send.mjs",
        piCommandsScript: "/tmp/studio-pi-commands.mjs",
        repoRoot: "/tmp/repo",
        piLayout: { agentDir: path.join(homeDir, ".openreaper", "studio", "pi", "agent") },
        state: {
          engineDegraded: true,
          openreaperStartExitCode: 124,
          pi: {
            mode: "started",
            rpcPromptUrl: "http://127.0.0.1:9/prompt",
            rpcCommandsUrl: "http://127.0.0.1:9/commands",
            pid: 42,
          },
          piPrivate: { agentDir: path.join(homeDir, ".openreaper", "studio", "pi", "agent") },
        },
        log() {},
      };
      const finalize = START_STEPS.find((step) => step.id === "face.finalize");
      await finalize.run(ctx);
      const raw = await readFile(
        path.join(homeDir, ".openreaper", "studio", "face-config-v1.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.piMode).toBe("rpc_background");
      expect(parsed.piRpcUrl).toBe("http://127.0.0.1:9/prompt");
      expect(parsed.piCommandsUrl).toBe("http://127.0.0.1:9/commands");
      expect(parsed.engineDegraded).toBe(true);
      expect(parsed.piPrivateAgentDir).toContain(path.join(".openreaper", "studio", "pi"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("openreaper-start exit propagation", () => {
  it("maps missing child codes to non-zero so 124 cannot become 0", async () => {
    expect(exitCodeFromChild(0, null)).toBe(0);
    expect(exitCodeFromChild(124, null)).toBe(124);
    expect(exitCodeFromChild(null, "SIGTERM")).toBe(1);
    expect(exitCodeFromChild(null, null)).toBe(1);
    expect(exitCodeFromChild(undefined, undefined)).toBe(1);
    expect(studioFailureExitCode({ exitCode: 124 })).toBe(124);
    expect(studioFailureExitCode(new Error("no code"))).toBe(1);
    expect(recordedStudioStartExitCode({ openreaperStartExitCode: 124, engineDegraded: true })).toBe(
      124,
    );
    expect(recordedStudioStartExitCode({ openreaperStartExitCode: 1, engineDegraded: true })).toBe(1);
    expect(recordedStudioStartExitCode({ openreaperStartExitCode: 0, engineDegraded: false })).toBe(0);
    expect(parseCli(["start"]).command).toBe("start");
    const orchestrate = await readFile(
      path.join(studioPackageRoot(), "studio-orchestrate.mjs"),
      "utf8",
    );
    expect(orchestrate).toMatch(/recordedStudioStartExitCode/);
    expect(orchestrate).toMatch(/studioStartProcessExitCode/);
    expect(orchestrate).toMatch(/applySuccessfulStartGateProcessExit/);
    expect(orchestrate).not.toMatch(/process\.exitCode = recorded/);
  });

  it("Start exits 0 when Pi gate is ok even if helper was 124 / engineDegraded", () => {
    expect(
      studioStartProcessExitCode({
        gateOk: true,
        openreaperStartExitCode: 124,
        engineDegraded: true,
      }),
    ).toBe(0);
    expect(
      studioStartProcessExitCode({
        gateOk: true,
        openreaperStartExitCode: 1,
        engineDegraded: true,
      }),
    ).toBe(0);
    expect(
      studioStartProcessExitCode({
        gateOk: true,
        openreaperStartExitCode: 0,
        engineDegraded: false,
      }),
    ).toBe(0);
  });

  it("Start stays non-zero when Pi gate fails", () => {
    expect(
      studioStartProcessExitCode({
        gateOk: false,
        openreaperStartExitCode: 124,
        engineDegraded: true,
      }),
    ).toBe(1);
    expect(studioFailureExitCode(new Error("Studio Start gate failed (pi_rpc_unhealthy)"))).toBe(1);
    expect(
      studioFailureExitCode({
        message: "Studio Start gate failed (piMode_pending)",
        exitCode: 1,
      }),
    ).toBe(1);
  });

  it("does not copy helper 124 onto process.exitCode after a successful Pi gate", () => {
    const previousExitCode = process.exitCode;
    const logs = [];
    try {
      process.exitCode = 124;
      applySuccessfulStartGateProcessExit({
        state: { openreaperStartExitCode: 124, engineDegraded: true },
        log(message) {
          logs.push(message);
        },
      });
      expect(process.exitCode).toBe(0);
      expect(logs.join("\n")).toMatch(/STARTUP_BUDGET_EXHAUSTED \(124\) recorded in state\/face-config/);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("propagates helper exit 124 through runProcess and engine.openreaper_start", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-start-exit-"));
    const helper = path.join(tmp, "openreaper-start");
    const previousExitCode = process.exitCode;
    try {
      await writeFile(helper, "#!/bin/sh\nexit 124\n", { encoding: "utf8", mode: 0o755 });
      await chmod(helper, 0o755);
      const spawned = await runProcess(helper, [], { cwd: tmp, inherit: false });
      expect(spawned.code).toBe(124);

      const engine = START_STEPS.find((step) => step.id === "engine.openreaper_start");
      const ctx = {
        startCmd: { command: helper, args: [], cwd: tmp },
        options: {},
        env: { OPENREAPER_STUDIO: "1" },
        faceInstall: {},
        homeDir: tmp,
        installRoot: tmp,
        state: { ...studioState.emptyStudioState(), openreaperStartExitCode: null },
        engineProbeGraceMs: 0,
        log() {},
        probeOpenReaperEngine: async () => ({
          usable: true,
          stage: "bridge_dofile_succeeded",
          heartbeatReady: true,
          reason: "heartbeat_live",
        }),
      };
      await expect(engine.run(ctx)).resolves.toBeUndefined();
      expect(ctx.state.openreaperStartExitCode).toBe(124);
      expect(ctx.state.openreaperStartSoftContinued).toBe(true);
      expect(ctx.state.engineDegraded).toBe(false);
      expect(
        recordedStudioStartExitCode({
          openreaperStartExitCode: ctx.state.openreaperStartExitCode,
          engineDegraded: ctx.state.engineDegraded,
        }),
      ).toBe(124);
      const saved = await studioState.readStudioState(studioStatePath(tmp));
      expect(saved?.openreaperStartExitCode).toBe(124);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tmp, { recursive: true, force: true });
    }
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

describe("runPipeline alwaysRun", () => {
  it("still runs face.finalize after an earlier step fails", async () => {
    const ran = [];
    const steps = [
      {
        id: "agent.pi_rpc",
        label: "fail",
        async run() {
          ran.push("pi");
          throw new Error("pi down");
        },
      },
      {
        id: "face.finalize",
        label: "finalize",
        alwaysRun: true,
        async run() {
          ran.push("finalize");
        },
      },
    ];
    await expect(runPipeline({ steps, ctx: { log() {} } })).rejects.toThrow(/pi down/);
    expect(ran).toEqual(["pi", "finalize"]);
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
