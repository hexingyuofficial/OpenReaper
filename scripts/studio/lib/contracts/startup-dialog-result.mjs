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

/**
 * Exact ImGui/AX titles for the Studio face. These are not REAPER decision
 * modals. Soft/Studio policy must not treat them as blocked_unknown_dialog.
 */
export const STUDIO_FACE_SAFE_WINDOW_TITLES = Object.freeze(["OpenReaper Studio"]);

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

/** Title payload from observer tokens such as blocked_unknown_dialog:title=…. */
export function dialogResultTitle(result) {
  const text = String(result ?? "");
  const marker = ":title=";
  const at = text.indexOf(marker);
  if (at < 0) {
    return "";
  }
  return text.slice(at + marker.length);
}

export function isStudioFaceSafeWindowTitle(title) {
  return STUDIO_FACE_SAFE_WINDOW_TITLES.includes(String(title ?? ""));
}

/**
 * Fail-closed for real blocked_* classifications.
 * Soft policy: inspection_unavailable / unavailable do not block startup.
 * Soft/Studio policy: allowlisted Studio face titles are non-blocking even if
 * the observer still emits blocked_unknown_dialog:title=….
 */
export function startupDialogResultIsSafe(result, policy = "strict") {
  const token = dialogResultToken(result);
  if (STARTUP_DIALOG_SAFE_RESULTS.includes(token)) {
    return true;
  }
  if (STARTUP_DIALOG_INSPECTION_SAFE_RESULTS.includes(token)) {
    return policy === "soft";
  }
  if (
    policy === "soft" &&
    token === "blocked_unknown_dialog" &&
    isStudioFaceSafeWindowTitle(dialogResultTitle(result))
  ) {
    return true;
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
    /-2741\b/.test(combined) ||
    /invalid connection/i.test(combined) ||
    /not allowed assistive access/i.test(combined) ||
    /System Events got an error/i.test(combined) ||
    /syntax error/i.test(combined) ||
    /expected end of line/i.test(combined)
  ) {
    return "inspection_unavailable";
  }
  return null;
}
