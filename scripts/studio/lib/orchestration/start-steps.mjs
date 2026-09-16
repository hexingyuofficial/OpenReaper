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
import {
  assertRunnableStartHelper,
  syncPackagedStartHelper,
  START_HELPER_REV,
} from "../face/start-helper.mjs";
import {
  defaultReaperResourceRoot,
  repoRootFromStudio,
  resolveInstallRoot,
  resolveOpenReaperStartCommand,
  studioStatePath,
} from "../paths.mjs";
import { readPiMcpConfig, resolveStudioPiForStart } from "../pi.mjs";
import { emptyStudioState, writeStudioState } from "../state.mjs";
import { fetchPiCommands } from "../agent-seam/fetch-pi-commands.mjs";
import { probeOpenReaperEngine } from "../engine/bridge-liveness.mjs";
import { coupledRollbackOnPiFailure } from "./coupled-rollback.mjs";
import { launchPrivatePiRpcHost, probePiRpcHealth } from "./pi-rpc-lifecycle.mjs";
import { runProcess, exitCodeFromChild } from "./process.mjs";

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
      if (platform !== "win32") {
        if (!helperSync.synced || !helperSync.dest) {
          throw new Error(
            `Could not sync openreaper-start into ${installRoot}/bin (${helperSync.reason ?? "unknown"}).`,
          );
        }
        ctx.startCmd = {
          command: helperSync.dest,
          args: [],
          cwd: installRoot,
        };
        ctx.log(
          `Synced start helper → ${helperSync.dest} rev=${helperSync.rev ?? START_HELPER_REV}` +
            (helperSync.sha256 ? ` sha256=${helperSync.sha256.slice(0, 12)}` : "") +
            (helperSync.overwrittenStaleSh ? " (replaced stale openreaper-start.sh)" : ""),
        );
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
        startHelper: helperSync.synced
          ? {
              path: helperSync.dest,
              rev: helperSync.rev ?? START_HELPER_REV,
              sha256: helperSync.sha256,
            }
          : undefined,
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
      if (ctx.startHelperSync?.dest) {
        const dest = path.resolve(ctx.startHelperSync.dest);
        const command = path.resolve(ctx.startCmd.command);
        if (command !== dest) {
          throw new Error(
            `startCmd ${ctx.startCmd.command} is not the synced helper ${ctx.startHelperSync.dest}`,
          );
        }
        const fp = await assertRunnableStartHelper(ctx.startCmd.command);
        ctx.log(
          `Running start helper ${ctx.startCmd.command} rev=${fp.rev}` +
            (fp.sha256 ? ` sha256=${fp.sha256.slice(0, 12)}` : ""),
        );
      }
      const openreaperEnv = { ...ctx.env, OPENREAPER_STUDIO: "1" };
      if (ctx.faceInstall?.hookInstalled) {
        openreaperEnv.OPENREAPER_STUDIO_FACE_HOOK_INSTALLED = "1";
      }
      const run = ctx.runProcess ?? runProcess;
      const result = await run(ctx.startCmd.command, startArgs, {
        cwd: ctx.startCmd.cwd,
        env: openreaperEnv,
      });
      const exitCode = exitCodeFromChild(result.code, result.signal);
      ctx.state.openreaperStartExitCode = exitCode;
      if (exitCode === 0) {
        ctx.state.openreaperStartSoftContinued = false;
        ctx.state.engineDegraded = false;
        return;
      }

      const probeFn = ctx.probeOpenReaperEngine ?? probeOpenReaperEngine;
      const probe = await probeFn({
        installRoot: ctx.installRoot,
        log: ctx.log,
        graceMs: ctx.engineProbeGraceMs,
      });
      const bridgeLive = Boolean(probe?.heartbeatReady);
      ctx.state.engineProbe = {
        usable: Boolean(probe?.usable),
        stage: probe?.stage ?? null,
        heartbeatReady: bridgeLive,
        reason: probe?.reason ?? null,
      };
      ctx.state.openreaperStartSoftContinued = true;
      ctx.state.engineDegraded = !bridgeLive;
      await writeStudioState(studioStatePath(ctx.homeDir), ctx.state);
      if (bridgeLive) {
        ctx.log(
          `openreaper-start exited ${exitCode} but Bridge heartbeat is live ` +
            `(stage=${probe.stage ?? "unknown"}). Soft-continuing to private Pi RPC + face.finalize.`,
        );
        return;
      }
      ctx.log(
        `WARN engineDegraded=true: openreaper-start exited ${exitCode} ` +
          `(${probe?.reason ?? "bridge_not_live"}). Not treating REAPER/Bridge as ready, ` +
          "but still continuing to private Pi RPC + face.finalize so face-config is not left pending.",
      );
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
        ctx.state.pi = {
          mode: "error",
          mcp: piMcp,
          privateRoot: piLayout.piRoot,
          agentDir: piLayout.agentDir,
          message: error?.message ?? String(error),
        };
        await coupledRollbackOnPiFailure(ctx);
        throw error;
      }

      const healthy = await probePiRpcHealth(rpc.healthUrl);
      const commands = await fetchPiCommands({
        env,
        faceConfig: {
          piRpcUrl: rpc.promptUrl,
          piCommandsUrl: rpc.commandsUrl,
        },
        studioState: {
          pi: { rpcPromptUrl: rpc.promptUrl, rpcCommandsUrl: rpc.commandsUrl },
        },
      });
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
        healthy,
        commandsCount: commands.commands?.length ?? 0,
        reused: Boolean(rpc.reused),
      };
      ctx.piRpc = rpc;
      ctx.log(
        `Private Pi RPC ready promptUrl=${rpc.promptUrl} hostPid=${rpc.hostPid} ` +
          `health=${healthy ? "ok" : "down"} commands=${ctx.state.pi.commandsCount}` +
          (rpc.reused ? " reused=1" : ""),
      );
    },
  },
  {
    id: "face.finalize",
    label: "Finalize face runtime config + session state",
    alwaysRun: true,
    async run(ctx) {
      if (!ctx.state) {
        return;
      }
      const started = ctx.state.pi?.mode === "started" && Boolean(ctx.state.pi?.rpcPromptUrl);
      const piMode = started
        ? "rpc_background"
        : ctx.state.pi?.mode && ctx.state.pi.mode !== "unknown"
          ? ctx.state.pi.mode
          : "absent";
      await writeFaceConfig(ctx.homeDir, {
        nodeCommand: resolveNodeCommand(ctx.env),
        piBridgeScript: ctx.piBridgeScript,
        piMode,
        repoRoot: ctx.repoRoot,
        piPid: ctx.state.pi?.pid ?? null,
        piRpcUrl: ctx.state.pi?.rpcPromptUrl ?? null,
        piCommandsUrl: ctx.state.pi?.rpcCommandsUrl ?? null,
        piCommandsScript: ctx.piCommandsScript,
        piPrivateAgentDir: ctx.state.piPrivate?.agentDir ?? ctx.piLayout?.agentDir ?? null,
        engineDegraded: Boolean(ctx.state.engineDegraded),
        openreaperStartExitCode: ctx.state.openreaperStartExitCode ?? null,
      });
      await writeStudioState(studioStatePath(ctx.homeDir), ctx.state);
      ctx.log(
        started
          ? `Face config published piMode=${piMode} promptUrl=${ctx.state.pi.rpcPromptUrl}` +
            (ctx.state.engineDegraded ? " engineDegraded=true" : "")
          : `Face config published piMode=${piMode} (private Pi did not start).`,
      );
      ctx.log(
        "If REAPER was already running, restart once so __startup.lua loads the face hook.",
      );
    },
  },
];
