import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  markOpenFaceOnLoad,
  resolveNodeCommand,
  resolvePiBridgeScript,
  resolvePiCommandsCli,
  writeFaceConfig,
} from "../face/runtime-config.mjs";
import { writeEngineBundleManifest } from "../face/bundle-engine.mjs";
import { installFaceBundle } from "../face/install.mjs";
import { syncPackagedStartHelper } from "../face/start-helper.mjs";
import {
  defaultReaperResourceRoot,
  repoRootFromStudio,
  resolveInstallRoot,
  resolveOpenReaperStartCommand,
  studioStatePath,
} from "../paths.mjs";
import { readPiMcpConfig, resolveStudioPiForStart } from "../pi.mjs";
import { emptyStudioState, writeStudioState } from "../state.mjs";
import { coupledRollbackOnPiFailure } from "./coupled-rollback.mjs";
import { launchPrivatePiRpcHost } from "./pi-rpc-lifecycle.mjs";
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
      ctx.piCommandsScript = resolvePiCommandsCli(repoRoot);
      ctx.reaperResourceRoot = reaperResourceRoot;

      ctx.engineBundle = await writeEngineBundleManifest({
        homeDir,
        installRoot,
        repoRoot,
      });
      ctx.log(
        `Bundled engine slot: ${installRoot} (manifest ${ctx.engineBundle.path})`,
      );

      const faceInstall = await installFaceBundle({ reaperResourceRoot, repoRoot });
      ctx.faceInstall = faceInstall;

      const { layout: piLayout, plan: piPlan } = resolveStudioPiForStart({
        homeDir,
        installRoot,
        env,
      });
      ctx.piLayout = piLayout;
      ctx.piPlan = piPlan;
      ctx.piMcp = await readPiMcpConfig(piLayout.mcpJsonPath);
      await mkdir(piLayout.agentDir, { recursive: true });
      await mkdir(piLayout.sessionsDir, { recursive: true });

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
      state.piPrivate = {
        piRoot: piLayout.piRoot,
        agentDir: piLayout.agentDir,
        sessionsDir: piLayout.sessionsDir,
        authJsonPath: piLayout.authJsonPath,
        isolatedFromPersonalPi: piLayout.isolatedFromPersonalPi,
      };
      ctx.state = state;

      await mkdir(path.join(installRoot, "session", "logs"), { recursive: true });

      await writeFaceConfig(homeDir, {
        nodeCommand: resolveNodeCommand(env),
        piBridgeScript,
        piCommandsScript: ctx.piCommandsScript,
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
    label: "Private Pi agent (RPC host + pi --mode rpc)",
    async run(ctx) {
      const { piPlan, piMcp, piLayout, env, homeDir, repoRoot } = ctx;
      if (piPlan.mode === "absent") {
        ctx.state.pi = { mode: "absent", mcp: piMcp, privateRoot: piLayout.piRoot };
        ctx.log(piPlan.message);
        return;
      }
      if (piPlan.mode === "skipped") {
        ctx.state.pi = {
          mode: "skipped",
          mcp: piMcp,
          message: piPlan.message,
          privateRoot: piLayout.piRoot,
        };
        ctx.log(piPlan.message);
        return;
      }
      if (piPlan.mode !== "start") {
        return;
      }

      ctx.log(
        `Private Pi agentDir=${piLayout.agentDir} (isolated from personal Pi). ` +
          `Auth will live at ${piLayout.authJsonPath} for in-app login.`,
      );

      if (!piMcp.exists) {
        ctx.log(
          "Private mcp.json not found yet; Studio did not create one. Wire OpenReaper MCP in a future installer step.",
        );
      } else if (!piMcp.openreaperConfigured) {
        ctx.log("Private mcp.json exists but no openreaper server entry detected (read-only).");
      }

      const nodeCommand = resolveNodeCommand(env);
      let rpc;
      try {
        rpc = await launchPrivatePiRpcHost({
          nodeCommand,
          repoRoot,
          env: piPlan.processEnv ?? { ...env, OPENREAPER_STUDIO: "1" },
          homeDir,
          log: ctx.log,
        });
      } catch (error) {
        await coupledRollbackOnPiFailure(ctx);
        throw error;
      }

      ctx.state.pi = {
        mode: "started",
        mcp: piMcp,
        privateRoot: piLayout.piRoot,
        agentDir: piLayout.agentDir,
        hostPid: rpc.hostPid,
        pid: rpc.piPid,
        rpcPromptUrl: rpc.promptUrl,
        rpcCommandsUrl: rpc.commandsUrl,
        rpcHealthUrl: rpc.healthUrl,
        endpointFile: rpc.endpointFile,
        command: piPlan.command,
        args: piPlan.args,
      };
      ctx.piRpc = rpc;
      ctx.log(`Private Pi RPC ready promptUrl=${rpc.promptUrl} hostPid=${rpc.hostPid}`);
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
        piRpcUrl: ctx.state.pi?.rpcPromptUrl ?? null,
        piCommandsUrl: ctx.state.pi?.rpcCommandsUrl ?? null,
        piCommandsScript: ctx.piCommandsScript,
        piPrivateAgentDir: ctx.state.piPrivate?.agentDir ?? null,
      });
      await writeStudioState(studioStatePath(ctx.homeDir), ctx.state);
      ctx.log(
        "If REAPER was already running, restart once so __startup.lua loads the face hook.",
      );
    },
  },
];
