import { existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  markOpenFaceOnLoad,
  resolveNodeCommand,
  resolvePiBridgeScript,
  writeFaceConfig,
} from "../face/runtime-config.mjs";
import { installFaceBundle } from "../face/install.mjs";
import { syncPackagedStartHelper } from "../face/start-helper.mjs";
import {
  defaultReaperResourceRoot,
  repoRootFromStudio,
  resolveInstallRoot,
  resolveOpenReaperStartCommand,
  studioStatePath,
} from "../paths.mjs";
import {
  buildPiStartPlan,
  defaultPiMcpJsonPath,
  readPiMcpConfig,
  resolvePiExecutable,
} from "../pi.mjs";
import { emptyStudioState, writeStudioState } from "../state.mjs";
import { runProcess } from "./process.mjs";

/**
 * Start pipeline steps. Each step mutates `ctx.state` and may write Studio-owned files.
 * Order is product contract — change ids/labels here, not ad-hoc in the CLI.
 */
export const START_STEPS = [
  {
    id: "face.prepare",
    label: "Install dialog face + Studio runtime config",
    async run(ctx) {
      const { homeDir, platform, env, options } = ctx;
      const installRoot = resolveInstallRoot(env, homeDir);
      const startCmd = resolveOpenReaperStartCommand(installRoot, platform);
      if (!installRoot || !startCmd) {
        throw new Error(
          "Could not find openreaper-start. Install OpenReaper to ~/.openreaper/current " +
            "or set OPENREAPER_INSTALL_ROOT.",
        );
      }
      ctx.installRoot = installRoot;
      ctx.startCmd = startCmd;

      const reaperResourceRoot = defaultReaperResourceRoot(platform, homeDir, env);
      const repoRoot = repoRootFromStudio();
      const helperSync = await syncPackagedStartHelper({
        installRoot,
        repoRoot,
        platform,
      });
      ctx.startHelperSync = helperSync;
      if (helperSync.synced && helperSync.dest) {
        ctx.log(`Synced start helper → ${helperSync.dest}`);
        ctx.startCmd = resolveOpenReaperStartCommand(installRoot, platform) ?? startCmd;
      }
      const piBridgeScript = resolvePiBridgeScript(repoRoot);
      if (!existsSync(piBridgeScript)) {
        throw new Error(`Studio agent seam CLI missing: ${piBridgeScript}`);
      }
      ctx.repoRoot = repoRoot;
      ctx.piBridgeScript = piBridgeScript;
      ctx.reaperResourceRoot = reaperResourceRoot;

      const faceInstall = await installFaceBundle({ reaperResourceRoot, repoRoot });
      ctx.faceInstall = faceInstall;

      const piPlan = buildPiStartPlan({
        piExecutable: resolvePiExecutable(env),
        env,
      });
      ctx.piPlan = piPlan;
      ctx.piMcp = await readPiMcpConfig(defaultPiMcpJsonPath(homeDir));

      const state = emptyStudioState();
      state.startedAt = new Date().toISOString();
      state.installRoot = installRoot;
      state.face = {
        installed: true,
        hookInstalled: faceInstall.hookInstalled,
        scriptPath: faceInstall.entryScriptPath,
        startupLuaPath: faceInstall.startupLuaPath,
        moduleDir: faceInstall.moduleDir,
        piBridgeScript,
      };
      state.reaper.stopPolicy =
        env.OPENREAPER_STUDIO_STOP_REAPER === "1" ? "stop_on_studio_stop" : "preserve";
      ctx.state = state;

      await mkdir(path.join(installRoot, "session", "logs"), { recursive: true });

      await writeFaceConfig(homeDir, {
        nodeCommand: resolveNodeCommand(env),
        piBridgeScript,
        piMode: piPlan.mode === "start" ? "pending" : piPlan.mode,
        repoRoot,
      });
      await markOpenFaceOnLoad(homeDir);
    },
  },
  {
    id: "engine.openreaper_start",
    label: "REAPER + MCP bridge (openreaper-start)",
    async run(ctx) {
      const startArgs = [...ctx.startCmd.args];
      if (ctx.options.projectPath) {
        startArgs.push("--project-path", ctx.options.projectPath);
      }
      const result = await runProcess(ctx.startCmd.command, startArgs, {
        cwd: ctx.startCmd.cwd,
        env: { ...ctx.env, OPENREAPER_STUDIO: "1" },
      });
      ctx.state.openreaperStartExitCode = result.code;
      if (result.code !== 0) {
        await writeStudioState(studioStatePath(ctx.homeDir), ctx.state);
        throw new Error(`openreaper-start exited with code ${result.code}`);
      }
    },
  },
  {
    id: "agent.pi_rpc",
    label: "Pi agent (optional background RPC)",
    async run(ctx) {
      const { piPlan, piMcp, env, installRoot, homeDir } = ctx;
      if (piPlan.mode === "absent") {
        ctx.state.pi = { mode: "absent", mcp: piMcp };
        ctx.log(piPlan.message);
        return;
      }
      if (piPlan.mode === "skipped") {
        ctx.state.pi = { mode: "skipped", mcp: piMcp, message: piPlan.message };
        ctx.log(piPlan.message);
        return;
      }
      if (piPlan.mode !== "start") {
        return;
      }

      const logPath = path.join(installRoot, "session", "logs", "studio-pi-rpc.log");
      ctx.state.pi = {
        mode: "started",
        mcp: piMcp,
        pid: null,
        command: piPlan.command,
        args: piPlan.args,
        logPath,
      };

      if (!piMcp.openreaperConfigured && piMcp.exists) {
        ctx.log(
          "Pi mcp.json exists but no openreaper entry detected (read-only). Add openreaper manually.",
        );
      } else if (!piMcp.exists) {
        ctx.log("~/.pi/agent/mcp.json not found; Studio did not create ~/.pi.");
      } else {
        ctx.log("Reusing existing Pi install and mcp.json (read-only check).");
      }

      const logFd = openSync(logPath, "a");
      const piChild = spawn(piPlan.command, piPlan.args, {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...env, OPENREAPER_STUDIO: "1" },
      });
      piChild.unref();
      ctx.state.pi.pid = piChild.pid;
      ctx.log(`Pi RPC background pid=${piChild.pid} log=${logPath}`);
    },
  },
  {
    id: "face.finalize",
    label: "Finalize face runtime config + session state",
    async run(ctx) {
      const piMode =
        ctx.state.pi?.mode === "started"
          ? "rpc_background"
          : ctx.state.pi?.mode ?? "absent";
      await writeFaceConfig(ctx.homeDir, {
        nodeCommand: resolveNodeCommand(ctx.env),
        piBridgeScript: ctx.piBridgeScript,
        piMode,
        repoRoot: ctx.repoRoot,
        piPid: ctx.state.pi?.pid ?? null,
      });
      await writeStudioState(studioStatePath(ctx.homeDir), ctx.state);
      ctx.log(
        "If REAPER was already running, restart once so __startup.lua loads the face hook.",
      );
    },
  },
];
