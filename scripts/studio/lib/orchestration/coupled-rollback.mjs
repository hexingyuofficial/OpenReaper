import { runProcess } from "./process.mjs";

/**
 * When private Pi fails after REAPER/bridge already started, avoid leaving a coupled mismatch.
 * Default: leave REAPER running with clear logs (easier cold-start debugging).
 * Set OPENREAPER_STUDIO_STRICT_COUPLING=1 to quit REAPER (legacy coupled rollback).
 * OPENREAPER_STUDIO_LOOSE_COUPLING=1 is an alias for the default skip-quit behavior.
 */
export async function coupledRollbackOnPiFailure(ctx) {
  const { env, platform, log } = ctx;
  if (ctx.piPlan?.mode !== "start") {
    return;
  }
  const strictCoupling =
    env.OPENREAPER_STUDIO_STRICT_COUPLING === "1" &&
    env.OPENREAPER_STUDIO_LOOSE_COUPLING !== "1";
  if (!strictCoupling) {
    log?.(
      "Private Pi failed after REAPER + bridge started. REAPER was left running. " +
        "Fix Pi (logs under ~/.openreaper/studio/logs/) and run Studio Start again. " +
        "Set OPENREAPER_STUDIO_STRICT_COUPLING=1 to quit REAPER on Pi failure.",
    );
    return;
  }
  log?.(
    "Private Pi failed after REAPER started — OPENREAPER_STUDIO_STRICT_COUPLING=1 requests REAPER quit. " +
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
