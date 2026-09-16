import { fetchPiCommands } from "../agent-seam/fetch-pi-commands.mjs";
import { readFaceConfig } from "../face/runtime-config.mjs";
import { studioStatePath } from "../paths.mjs";
import { writeStudioState } from "../state.mjs";
import { probePiRpcHealth } from "./pi-rpc-lifecycle.mjs";

/**
 * Product gate for Studio Start/Restart: dialog face ↔ private Pi RPC.
 * Engine/Bridge may be degraded; that is a warning, not this gate.
 */
export function evaluateStudioStartGate({
  piPlanMode,
  faceConfig,
  piHealthy,
  commandsCount,
} = {}) {
  if (piPlanMode === "skipped" || piPlanMode === "absent") {
    return {
      ok: true,
      skipped: true,
      piMode: faceConfig?.piMode ?? piPlanMode,
      hasUrls: false,
      piHealthy: false,
      commandsCount: Number(commandsCount) || 0,
      reason: `pi_${piPlanMode}`,
    };
  }
  const piMode = faceConfig?.piMode ?? null;
  const hasUrls = Boolean(faceConfig?.piRpcUrl?.trim()) && Boolean(faceConfig?.piCommandsUrl?.trim());
  const count = Number(commandsCount) || 0;
  const healthy = Boolean(piHealthy);
  const ok = piMode === "rpc_background" && hasUrls && healthy && count > 0;
  let reason = "ok";
  if (!ok) {
    if (piMode !== "rpc_background") {
      reason = `piMode_${piMode ?? "missing"}`;
    } else if (!hasUrls) {
      reason = "missing_rpc_urls";
    } else if (!healthy) {
      reason = "pi_rpc_unhealthy";
    } else {
      reason = "empty_commands";
    }
  }
  return {
    ok,
    skipped: false,
    piMode,
    hasUrls,
    piHealthy: healthy,
    commandsCount: count,
    reason,
  };
}

export async function finishStudioStartGate(ctx) {
  const faceConfig = await readFaceConfig(ctx.homeDir);
  let piHealthy = false;
  if (ctx.state?.pi?.rpcHealthUrl) {
    const probe = ctx.probePiRpcHealth ?? probePiRpcHealth;
    piHealthy = await probe(ctx.state.pi.rpcHealthUrl);
  }
  let commandsCount = Number(ctx.state?.pi?.commandsCount) || 0;
  if (commandsCount < 1) {
    const fetched = await fetchPiCommands({
      env: ctx.env,
      faceConfig,
      studioState: ctx.state,
    });
    commandsCount = fetched.commands?.length ?? 0;
    if (ctx.state?.pi) {
      ctx.state.pi.commandsCount = commandsCount;
    }
  }
  const gate = evaluateStudioStartGate({
    piPlanMode: ctx.piPlan?.mode,
    faceConfig,
    piHealthy,
    commandsCount,
  });
  if (ctx.state) {
    ctx.state.startGate = gate;
    ctx.state.engineDegraded = Boolean(ctx.state.engineDegraded);
    await writeStudioState(studioStatePath(ctx.homeDir), ctx.state);
  }
  if (ctx.state?.engineDegraded) {
    ctx.log?.(
      "WARN engineDegraded=true — openreaper-start did not leave a live Bridge. " +
        "Private Pi RPC + face-config still completed (dialog↔Pi is the Start gate).",
    );
  }
  if (!gate.ok) {
    throw new Error(
      `Studio Start gate failed (${gate.reason}): face↔Pi RPC is not live ` +
        `(piMode=${gate.piMode ?? "missing"} urls=${gate.hasUrls} health=${gate.piHealthy} commands=${gate.commandsCount}).`,
    );
  }
  ctx.log?.(
    `Start gate ok piMode=${gate.piMode} commands=${gate.commandsCount} ` +
      `engine=${ctx.state?.engineDegraded ? "degraded" : "ready"}`,
  );
  return gate;
}
