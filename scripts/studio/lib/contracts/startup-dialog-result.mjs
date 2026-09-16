/** Results that are always safe (no blocking window). */
export const STARTUP_DIALOG_SAFE_RESULTS = Object.freeze([
  "no_safe_dialog",
  "ignored_reascript_run_status_window",
  "ignored_openreaper_studio_dialog",
]);

/** AX/osascript inspection could not run. Safe only under soft policy. */
export const STARTUP_DIALOG_INSPECTION_SAFE_RESULTS = Object.freeze([
  "unavailable",
  "inspection_unavailable",
]);

export function resolveStartupDialogPolicy(env = {}) {
  const explicit = String(env.OPENREAPER_STARTUP_DIALOG_POLICY ?? "").trim();
  if (explicit === "soft" || explicit === "strict") {
    return explicit;
  }
  if (String(env.OPENREAPER_STUDIO ?? "") === "1") {
    return "soft";
  }
  return "strict";
}

export function dialogResultToken(result) {
  return String(result ?? "").split(":")[0];
}

/**
 * Fail-closed for real blocked_* classifications.
 * Soft policy: inspection_unavailable / unavailable do not block startup.
 */
export function startupDialogResultIsSafe(result, policy = "strict") {
  const token = dialogResultToken(result);
  if (STARTUP_DIALOG_SAFE_RESULTS.includes(token)) {
    return true;
  }
  if (STARTUP_DIALOG_INSPECTION_SAFE_RESULTS.includes(token)) {
    return policy === "soft";
  }
  return false;
}

/**
 * Map osascript/perl-alarm inspection failures to inspection_unavailable.
 * Returns null when the observer output should be used as-is.
 */
export function classifyDialogInspectionFailure({
  status = 0,
  output = "",
  stderr = "",
} = {}) {
  const combined = `${output}\n${stderr}`;
  const trimmed = String(output ?? "").trim();
  if (status === 142 || status !== 0 || trimmed === "") {
    return "inspection_unavailable";
  }
  if (
    /-609\b/.test(combined) ||
    /invalid connection/i.test(combined) ||
    /not allowed assistive access/i.test(combined) ||
    /System Events got an error/i.test(combined)
  ) {
    return "inspection_unavailable";
  }
  return null;
}
