import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { clearOpenFaceOnLoad } from "../face/runtime-config.mjs";
import { removeFaceStartupHook } from "../face/hook.mjs";
import { studioStatePath } from "../paths.mjs";
import { clearStudioState, readStudioState } from "../state.mjs";
import { runProcess } from "./process.mjs";
import { stopStudioSteward } from "./steward.mjs";
import { studioPiRpcEndpointPath } from "./pi-rpc-lifecycle.mjs";

async function readEndpointSnapshot(endpointFile) {
  if (!endpointFile || !existsSync(endpointFile)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(endpointFile, "utf8"));
  } catch {
    return null;
  }
}

export const STOP_STEPS = [
  {
    id: "agent.pi_rpc",
    label: "Stop Studio steward (Pi RPC host + Pi)",
    async run(ctx) {
      const state = ctx.state;
      const endpointFile = state.pi?.endpointFile ?? studioPiRpcEndpointPath(ctx.homeDir);
      const hostPid = state.pi?.hostPid;
      const piPid = state.pi?.pid;
      if (state.pi?.mode === "started" && (hostPid || piPid || endpointFile)) {
        ctx.log(
          hostPid
            ? `Stopping Studio steward host pid=${hostPid}…`
            : `Stopping Studio steward (endpoint ${endpointFile})…`,
        );
        const stop = ctx.stopStudioSteward ?? stopStudioSteward;
        const result = await stop({
          hostPid,
          piPid,
          endpointFile,
        });
        if (result.host && !result.host.killed && !result.host.alreadyDead) {
          ctx.log("Steward host did not exit after SIGTERM/SIGKILL.");
        }
      } else if (state.pi?.mode === "absent") {
        ctx.log("Private Pi was not started by Studio.");
      }
    },
  },
  {
    id: "face.hook",
    label: "Remove Studio-owned __startup.lua face hook",
    async run(ctx) {
      if (ctx.state.face?.startupLuaPath && ctx.state.face.hookInstalled) {
        const removed = await removeFaceStartupHook(ctx.state.face.startupLuaPath);
        if (removed.removed) {
          ctx.log("Removed Studio face hook from __startup.lua.");
        }
      }
    },
  },
  {
    id: "engine.reaper_policy",
    label: "Apply REAPER stop policy",
    async run(ctx) {
      const { env } = ctx;
      if (
        ctx.state.reaper?.stopPolicy === "stop_on_studio_stop" ||
        env.OPENREAPER_STUDIO_STOP_REAPER === "1"
      ) {
        ctx.log("OPENREAPER_STUDIO_STOP_REAPER — requesting REAPER quit (ask to save).");
        if (process.platform === "darwin") {
          await runProcess(
            "/usr/bin/osascript",
            ["-e", 'tell application "REAPER" to quit saving "ask"'],
            { env },
          ).catch(() => {});
        }
      } else {
        ctx.log(
          "REAPER left running (default). The Studio steward watches REAPER and stops Pi when REAPER quits.",
        );
      }
    },
  },
  {
    id: "session.clear",
    label: "Clear Studio session markers",
    async run(ctx) {
      await clearOpenFaceOnLoad(ctx.homeDir);
      await clearStudioState(studioStatePath(ctx.homeDir));
    },
  },
];

export async function loadStopContext(homeDir) {
  const state = await readStudioState(studioStatePath(homeDir));
  if (state) {
    return { homeDir, state };
  }
  const endpointFile = studioPiRpcEndpointPath(homeDir);
  const parsed = await readEndpointSnapshot(endpointFile);
  const hostPid = parsed?.hostPid;
  const piPid = parsed?.piPid;
  if (!hostPid && !piPid) {
    return null;
  }
  return {
    homeDir,
    state: {
      pi: {
        mode: "started",
        hostPid: hostPid ?? null,
        pid: piPid ?? null,
        endpointFile,
      },
      face: { installed: false, hookInstalled: false, scriptPath: null },
      reaper: { stopPolicy: "preserve" },
    },
    orphanEndpoint: true,
  };
}
