import { clearOpenFaceOnLoad } from "../face/runtime-config.mjs";
import { removeFaceStartupHook } from "../face/hook.mjs";
import { studioStatePath } from "../paths.mjs";
import { clearStudioState, readStudioState } from "../state.mjs";
import { runProcess } from "./process.mjs";

export const STOP_STEPS = [
  {
    id: "agent.pi_rpc",
    label: "Stop Pi RPC started by Studio",
    async run(ctx) {
      const state = ctx.state;
      if (state.pi?.mode === "started" && state.pi.pid) {
        ctx.log(`Stopping Pi RPC pid=${state.pi.pid}…`);
        try {
          process.kill(state.pi.pid, "SIGTERM");
        } catch (error) {
          ctx.log(`Could not signal Pi (${error?.message ?? error}); may have exited.`);
        }
      } else if (state.pi?.mode === "absent") {
        ctx.log("Pi was not started by Studio.");
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
        ctx.log("REAPER left running (default). MCP bridge stops when you quit REAPER.");
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
  if (!state) {
    return null;
  }
  return { homeDir, state };
}
