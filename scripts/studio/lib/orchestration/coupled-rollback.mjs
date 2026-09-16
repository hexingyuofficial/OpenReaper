import { runProcess } from "./process.mjs";

/**
 * When private Pi fails after REAPER/bridge already started, avoid leaving a coupled mismatch.
 * Set OPENREAPER_STUDIO_LOOSE_COUPLING=1 to skip REAPER quit (dev only).
 */
export async function coupledRollbackOnPiFailure(ctx) {
  const { env, platform, log } = ctx;
  if (env.OPENREAPER_STUDIO_LOOSE_COUPLING === "1") {
    log?.("OPENREAPER_STUDIO_LOOSE_COUPLING=1 — leaving REAPER running after Pi failure.");
    return;
  }
  if (ctx.piPlan?.mode !== "start") {
    return;
  }
  log?.(
    "Private Pi failed after REAPER started — coupled rollback requests REAPER quit. " +
      "Run Studio Start again after fixing Pi.",
  );
  if (platform === "darwin") {
    await runProcess(
      "/usr/bin/osascript",
      ["-e", 'tell application "REAPER" to quit saving "ask"'],
      { env },
    ).catch(() => {});
  }
}
