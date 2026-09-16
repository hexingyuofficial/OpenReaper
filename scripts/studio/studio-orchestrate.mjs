#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultReaperResourceRoot,
  resolveInstallRoot,
  resolveOpenReaperStartCommand,
  studioFaceInstallPath,
  studioFaceSourcePath,
  studioStatePath,
} from "./lib/paths.mjs";
import {
  ensureFaceStartupHook,
  installFaceScript,
  removeFaceStartupHook,
} from "./lib/face.mjs";
import {
  buildPiStartPlan,
  defaultPiMcpJsonPath,
  readPiMcpConfig,
  resolvePiExecutable,
} from "./lib/pi.mjs";
import {
  clearStudioState,
  emptyStudioState,
  readStudioState,
  writeStudioState,
} from "./lib/state.mjs";

function printHelp() {
  process.stdout.write(`OpenReaper Studio orchestration (Day 2–3)

Usage:
  node scripts/studio/studio-orchestrate.mjs start [--project-path /path/to.rpp]
  node scripts/studio/studio-orchestrate.mjs stop
  node scripts/studio/studio-orchestrate.mjs status

macOS wrappers:
  scripts/studio/studio-start.sh [--project-path /path/to.rpp]
  scripts/studio/studio-stop.sh

Requires a packaged OpenReaper install at ~/.openreaper/current (from the
release installer) or OPENREAPER_INSTALL_ROOT pointing at that layout.

Pi: detected on PATH; reads ~/.pi/agent/mcp.json only (never overwrites).
Set OPENREAPER_STUDIO_SKIP_PI=1 to skip launching Pi RPC in the background.
Set OPENREAPER_STUDIO_STOP_REAPER=1 on stop to quit REAPER (default: preserve).
`);
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = { projectPath: null };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--project-path") {
      options.projectPath = rest[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token.startsWith("--project-path=")) {
      options.projectPath = token.slice("--project-path=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return { command, options };
}

function runProcess(command, args, { cwd, env, logPath }) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    const out = logPath ? { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] } : {
      cwd,
      env: childEnv,
      stdio: "inherit",
    };
    const child = spawn(command, args, out);
    let stdout = "";
    let stderr = "";
    if (logPath) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        process.stdout.write(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
        process.stderr.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr, pid: child.pid });
    });
  });
}

async function startStudio(options, env = process.env) {
  const homeDir = os.homedir();
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error(
      "OpenReaper Studio start/stop is verified on macOS; Windows scripts are experimental.",
    );
  }

  const installRoot = resolveInstallRoot(env, homeDir);
  const startCmd = resolveOpenReaperStartCommand(installRoot, platform);
  if (!startCmd) {
    throw new Error(
      "Could not find openreaper-start. Install OpenReaper from the latest release " +
        "(~/.openreaper/current) or set OPENREAPER_INSTALL_ROOT.",
    );
  }

  const reaperResourceRoot = defaultReaperResourceRoot(platform, homeDir, env);
  const faceTarget = studioFaceInstallPath(reaperResourceRoot);
  const faceSource = studioFaceSourcePath();
  if (!existsSync(faceSource)) {
    throw new Error(`Studio dialog stub source is missing: ${faceSource}`);
  }
  await installFaceScript({ sourcePath: faceSource, targetPath: faceTarget });
  const startupLuaPath = path.join(reaperResourceRoot, "Scripts", "__startup.lua");
  const hookResult = await ensureFaceStartupHook({
    startupLuaPath,
    faceScriptPath: faceTarget,
  });

  const piExecutable = resolvePiExecutable(env);
  const piMcp = await readPiMcpConfig(defaultPiMcpJsonPath(homeDir));
  const piPlan = buildPiStartPlan({ piExecutable, env });

  const state = emptyStudioState();
  state.startedAt = new Date().toISOString();
  state.installRoot = installRoot;
  state.face = {
    installed: true,
    hookInstalled: hookResult.hookInstalled,
    scriptPath: faceTarget,
    startupLuaPath,
  };
  state.reaper.stopPolicy =
    env.OPENREAPER_STUDIO_STOP_REAPER === "1" ? "stop_on_studio_stop" : "preserve";

  const sessionLogDir = path.join(installRoot, "session", "logs");
  await mkdir(sessionLogDir, { recursive: true });

  process.stdout.write("[OpenReaper Studio] Step 1/3: REAPER + MCP bridge (openreaper-start)…\n");
  const startArgs = [...startCmd.args];
  if (options.projectPath) {
    startArgs.push("--project-path", options.projectPath);
  }
  const startResult = await runProcess(startCmd.command, startArgs, {
    cwd: startCmd.cwd,
    env,
  });
  state.openreaperStartExitCode = startResult.code;
  if (startResult.code !== 0) {
    await writeStudioState(studioStatePath(homeDir), state);
    throw new Error(`openreaper-start exited with code ${startResult.code}`);
  }

  process.stdout.write("[OpenReaper Studio] Step 2/3: Pi agent…\n");
  if (piPlan.mode === "absent") {
    state.pi = { mode: "absent", mcp: piMcp };
    process.stdout.write(`[OpenReaper Studio] ${piPlan.message}\n`);
  } else if (piPlan.mode === "skipped") {
    state.pi = { mode: "skipped", mcp: piMcp, message: piPlan.message };
    process.stdout.write(`[OpenReaper Studio] ${piPlan.message}\n`);
  } else if (piPlan.mode === "start") {
    state.pi = {
      mode: "started",
      mcp: piMcp,
      pid: null,
      command: piPlan.command,
      args: piPlan.args,
      logPath: path.join(sessionLogDir, "studio-pi-rpc.log"),
    };
    if (!piMcp.openreaperConfigured && piMcp.exists) {
      process.stdout.write(
        "[OpenReaper Studio] Pi mcp.json exists but no openreaper server entry was detected. " +
          "Add openreaper manually; Studio did not modify mcp.json.\n",
      );
    } else if (!piMcp.exists) {
      process.stdout.write(
        "[OpenReaper Studio] ~/.pi/agent/mcp.json was not found. Configure Pi separately; " +
          "Studio did not create ~/.pi.\n",
      );
    } else {
      process.stdout.write(
        "[OpenReaper Studio] Reusing existing Pi install and mcp.json (read-only check).\n",
      );
    }
    const piLog = state.pi.logPath;
    const logFd = openSync(piLog, "a");
    const piChild = spawn(piPlan.command, piPlan.args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...env, OPENREAPER_STUDIO: "1" },
    });
    piChild.unref();
    state.pi.pid = piChild.pid;
    process.stdout.write(
      `[OpenReaper Studio] Pi RPC background pid=${piChild.pid} log=${piLog}\n`,
    );
  }

  process.stdout.write(
    "[OpenReaper Studio] Step 3/3: AI dialog placeholder installed " +
      `(hook ${hookResult.hookInstalled ? "added" : "already present"}).\n`,
  );
  process.stdout.write(
    "[OpenReaper Studio] Restart REAPER once if it was already running before this start " +
      "so __startup.lua loads the face slot.\n",
  );

  await writeStudioState(studioStatePath(homeDir), state);
  process.stdout.write("[OpenReaper Studio] Start chain complete.\n");
}

async function stopStudio(env = process.env) {
  const homeDir = os.homedir();
  const statePath = studioStatePath(homeDir);
  const state = await readStudioState(statePath);
  if (!state) {
    process.stdout.write("[OpenReaper Studio] No active Studio session state file.\n");
    return;
  }

  if (state.pi?.mode === "started" && state.pi.pid) {
    process.stdout.write(`[OpenReaper Studio] Stopping Pi RPC pid=${state.pi.pid}…\n`);
    try {
      process.kill(state.pi.pid, "SIGTERM");
    } catch (error) {
      process.stdout.write(
        `[OpenReaper Studio] Could not signal Pi (${error?.message ?? error}); it may have already exited.\n`,
      );
    }
  } else if (state.pi?.mode === "absent") {
    process.stdout.write("[OpenReaper Studio] Pi was not started by Studio; nothing to stop for Pi.\n");
  }

  if (state.face?.startupLuaPath && state.face.hookInstalled) {
    const removed = await removeFaceStartupHook(state.face.startupLuaPath);
    if (removed.removed) {
      process.stdout.write("[OpenReaper Studio] Removed Studio face hook from __startup.lua.\n");
    }
  }

  if (state.reaper?.stopPolicy === "stop_on_studio_stop" || env.OPENREAPER_STUDIO_STOP_REAPER === "1") {
    process.stdout.write(
      "[OpenReaper Studio] OPENREAPER_STUDIO_STOP_REAPER is set — prefer quitting REAPER from the app " +
        "to avoid losing unsaved work. Sending graceful Apple quit on macOS when possible.\n",
    );
    if (process.platform === "darwin") {
      await runProcess("/usr/bin/osascript", [
        "-e",
        'tell application "REAPER" to quit saving "ask"',
      ], { cwd: process.cwd(), env }).catch(() => {});
    }
  } else {
    process.stdout.write(
      "[OpenReaper Studio] REAPER left running (default). MCP bridge stops when you quit REAPER.\n",
    );
  }

  await clearStudioState(statePath);
  process.stdout.write("[OpenReaper Studio] Stop complete.\n");
}

async function statusStudio() {
  const state = await readStudioState(studioStatePath());
  if (!state) {
    process.stdout.write("[OpenReaper Studio] status=idle\n");
    return;
  }
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function main() {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    printHelp();
    process.exit(2);
  }

  const { command, options } = parsed;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  try {
    if (command === "start") {
      await startStudio(options);
      return;
    }
    if (command === "stop") {
      await stopStudio();
      return;
    }
    if (command === "status") {
      await statusStudio();
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`[OpenReaper Studio] ${error?.message ?? error}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { parseCli, startStudio, stopStudio, statusStudio };
