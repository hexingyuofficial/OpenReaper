import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDialogInspectionFailure,
  dialogResultTitle,
  isStudioFaceSafeWindowTitle,
  isStudioSoftBlockerWindowTitle,
  resolveStartupDialogPolicy,
  startupDialogResultIsSafe,
  STUDIO_FACE_SAFE_WINDOW_TITLES,
  STUDIO_SOFT_BLOCKER_WINDOW_TITLES,
} from "../lib/contracts/startup-dialog-result.mjs";
import { packagedMacosStartHelperPath } from "../lib/paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const START_HELPER = packagedMacosStartHelperPath(repoRoot);

const ALWAYS_SAFE = [
  "no_safe_dialog",
  "ignored_reascript_run_status_window",
  "ignored_openreaper_studio_dialog",
];
const INSPECTION_SAFE = [
  "unavailable",
  "inspection_unavailable",
  "inspection_unavailable:status=142",
  "blocked_startup_budget_exhausted:stage=dialog_inspection",
];
const SOFT_SAFE_BLOCKERS = [
  "blocked_manual_dialog:title=Project Settings",
  "blocked_manual_dialog:title=Project Settings / Notes",
  "project_settings_seen_but_not_notes",
];
const UNSAFE = [
  "blocked_dialog_inspection_timeout:seconds=5",
  "blocked_dialog_inspection_failed:status=1",
  "blocked_missing_media:choice=Ignore all missing files",
  "blocked_missing_media_offline_warning:choice=OK",
  "blocked_user_decision:title=Project Load Warning",
  "blocked_unknown_dialog:title=Unexpected",
  "blocked_unknown_dialog:title=License",
  "blocked_manual_dialog:title=Unexpected",
  "blocked_reaper_identity:pid=123",
  "blocked_dialog_classification:title=Untitled:error=permission denied",
];

function extractAppleScriptObserver(source) {
  const startMarker = "<<'APPLESCRIPT'";
  const start = source.indexOf(startMarker);
  if (start < 0) {
    throw new Error("missing AppleScript observer");
  }
  const end = source.indexOf("\nAPPLESCRIPT\n", start);
  if (end < 0) {
    throw new Error("unclosed AppleScript observer");
  }
  return source.slice(start, end);
}

/** AppleScript `--` comments; used so `next repeat` in a warning comment is not a false positive. */
function stripAppleScriptComments(text) {
  return String(text ?? "").replace(/--[^\n]*/g, "");
}

function extractAppleScriptObserverBody(source) {
  const observer = extractAppleScriptObserver(source);
  const newline = observer.indexOf("\n");
  if (newline < 0) {
    throw new Error("AppleScript observer has no body");
  }
  return observer.slice(newline + 1);
}

function runZshHeredoc(body, { quoted } = { quoted: true }) {
  const delimiter = quoted ? "<<'APPLESCRIPT'" : "<<APPLESCRIPT";
  return spawnSync(
    "zsh",
    ["-c", `cat ${delimiter}\n${body}\nAPPLESCRIPT\n`],
    { encoding: "utf8" },
  );
}

function zshAvailable() {
  const check = spawnSync("zsh", ["-c", "exit 0"], { encoding: "utf8" });
  return check.error?.code !== "ENOENT";
}

function extractShellFunction(source, name) {
  const start = source.indexOf(`${name}() {`);
  if (start < 0) {
    throw new Error(`missing ${name}()`);
  }
  let depth = 0;
  const braceAt = source.indexOf("{", start);
  for (let i = braceAt; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed ${name}()`);
}

/** Brace-match a function while skipping quoted heredocs (the node installer has `{` / `}`). */
function extractShellFunctionSkippingQuotedHeredocs(source, name) {
  const start = source.indexOf(`${name}() {`);
  if (start < 0) {
    throw new Error(`missing ${name}()`);
  }
  let depth = 0;
  let i = source.indexOf("{", start);
  while (i < source.length) {
    if (source.startsWith("<<'", i)) {
      const quoteEnd = source.indexOf("'", i + 3);
      if (quoteEnd < 0) {
        throw new Error(`unclosed heredoc tag in ${name}()`);
      }
      const delim = source.slice(i + 3, quoteEnd);
      const endMarker = `\n${delim}\n`;
      const endAt = source.indexOf(endMarker, quoteEnd);
      if (endAt < 0) {
        throw new Error(`unclosed heredoc ${delim} in ${name}()`);
      }
      i = endAt + endMarker.length;
      continue;
    }
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
    i += 1;
  }
  throw new Error(`unclosed ${name}()`);
}

function runShellClassifier(classifier, policy, result) {
  const spawned = spawnSync(
    "bash",
    [
      "-c",
      `${classifier}\nSTARTUP_DIALOG_POLICY="$1"\nstartup_dialog_result_is_safe "$2"`,
      "dialog-classifier",
      policy,
      result,
    ],
    { encoding: "utf8" },
  );
  return spawned.status;
}

function runAxFailureCheck(fnSource, status, result, shell = "bash") {
  const spawned = spawnSync(
    shell,
    [
      "-c",
      `${fnSource}\nstartup_dialog_observer_output_is_ax_failure "$1" "$2"`,
      "ax-failure",
      String(status),
      result,
    ],
    { encoding: "utf8" },
  );
  return spawned.status;
}

describe("startup dialog policy", () => {
  it("defaults to soft under OPENREAPER_STUDIO=1 and strict otherwise", () => {
    expect(resolveStartupDialogPolicy({})).toBe("strict");
    expect(resolveStartupDialogPolicy({ OPENREAPER_STUDIO: "1" })).toBe("soft");
    expect(resolveStartupDialogPolicy({ OPENREAPER_STUDIO: "1", OPENREAPER_STARTUP_DIALOG_POLICY: "strict" })).toBe(
      "strict",
    );
    expect(resolveStartupDialogPolicy({ OPENREAPER_STARTUP_DIALOG_POLICY: "soft" })).toBe("soft");
  });
});

describe("startup dialog result classification", () => {
  it("keeps empty/status windows safe in both policies", () => {
    for (const result of ALWAYS_SAFE) {
      expect(startupDialogResultIsSafe(result, "soft")).toBe(true);
      expect(startupDialogResultIsSafe(result, "strict")).toBe(true);
    }
  });

  it("treats inspection_unavailable and unavailable as safe only under soft policy", () => {
    for (const result of INSPECTION_SAFE) {
      expect(startupDialogResultIsSafe(result, "soft"), result).toBe(true);
      expect(startupDialogResultIsSafe(result, "strict"), result).toBe(false);
    }
  });

  it("treats a lone Project Settings window as a recoverable soft blocker", () => {
    expect(STUDIO_SOFT_BLOCKER_WINDOW_TITLES).toEqual(["Project Settings", "Project Settings / Notes"]);
    expect(isStudioSoftBlockerWindowTitle("Project Settings")).toBe(true);
    expect(isStudioSoftBlockerWindowTitle("Project Settings / Notes")).toBe(true);
    expect(isStudioSoftBlockerWindowTitle("License")).toBe(false);
    expect(dialogResultTitle("blocked_manual_dialog:title=Project Settings")).toBe("Project Settings");

    const studioPolicy = resolveStartupDialogPolicy({ OPENREAPER_STUDIO: "1" });
    expect(studioPolicy).toBe("soft");
    for (const result of SOFT_SAFE_BLOCKERS) {
      expect(startupDialogResultIsSafe(result, "soft"), result).toBe(true);
      expect(startupDialogResultIsSafe(result, studioPolicy), result).toBe(true);
      expect(startupDialogResultIsSafe(result, "strict"), result).toBe(false);
    }
    expect(startupDialogResultIsSafe("blocked_manual_dialog:title=Unexpected", "soft")).toBe(false);
  });

  it("fails closed for real blocked_* dialog classifications", () => {
    for (const result of UNSAFE) {
      expect(startupDialogResultIsSafe(result, "soft"), result).toBe(false);
      expect(startupDialogResultIsSafe(result, "strict"), result).toBe(false);
    }
  });

  it("does not classify the OpenReaper Studio face title as blocked under soft/Studio policy", () => {
    expect(STUDIO_FACE_SAFE_WINDOW_TITLES).toEqual(["OpenReaper Studio"]);
    expect(isStudioFaceSafeWindowTitle("OpenReaper Studio")).toBe(true);
    expect(isStudioFaceSafeWindowTitle("License")).toBe(false);
    expect(dialogResultTitle("blocked_unknown_dialog:title=OpenReaper Studio")).toBe("OpenReaper Studio");

    const studioPolicy = resolveStartupDialogPolicy({ OPENREAPER_STUDIO: "1" });
    expect(studioPolicy).toBe("soft");
    for (const title of STUDIO_FACE_SAFE_WINDOW_TITLES) {
      const unknown = `blocked_unknown_dialog:title=${title}`;
      expect(startupDialogResultIsSafe(unknown, "soft"), unknown).toBe(true);
      expect(startupDialogResultIsSafe(unknown, studioPolicy), unknown).toBe(true);
      expect(startupDialogResultIsSafe(unknown, resolveStartupDialogPolicy({ OPENREAPER_STARTUP_DIALOG_POLICY: "soft" }))).toBe(
        true,
      );
      expect(startupDialogResultIsSafe(unknown, "strict"), unknown).toBe(false);
    }
    expect(startupDialogResultIsSafe("blocked_unknown_dialog:title=License", "soft")).toBe(false);
    expect(startupDialogResultIsSafe("blocked_unknown_dialog:title=Unexpected", "soft")).toBe(false);
    expect(startupDialogResultIsSafe("blocked_manual_dialog:title=Project Settings", "soft")).toBe(true);
    expect(startupDialogResultIsSafe("blocked_manual_dialog:title=Project Settings", "strict")).toBe(false);
    expect(startupDialogResultIsSafe("project_settings_seen_but_not_notes", "soft")).toBe(true);
  });

  it("maps AX/osascript failures to inspection_unavailable", () => {
    expect(classifyDialogInspectionFailure({ status: 142, output: "" })).toBe("inspection_unavailable");
    expect(classifyDialogInspectionFailure({ status: 1, output: "" })).toBe("inspection_unavailable");
    expect(classifyDialogInspectionFailure({ status: 0, output: "" })).toBe("inspection_unavailable");
    expect(
      classifyDialogInspectionFailure({
        status: 1,
        output: "",
        stderr: "System Events got an error: Application isn’t running. (-609)",
      }),
    ).toBe("inspection_unavailable");
    expect(
      classifyDialogInspectionFailure({
        status: 1,
        output: '42:73: syntax error: Expected end of line but found "repeat". (-2741)',
      }),
    ).toBe("inspection_unavailable");
    expect(
      classifyDialogInspectionFailure({
        status: 0,
        output: 'syntax error: Expected end of line but found "repeat". (-2741)',
      }),
    ).toBe("inspection_unavailable");
    expect(
      classifyDialogInspectionFailure({
        status: 0,
        output: "no_safe_dialog",
      }),
    ).toBeNull();
    expect(
      classifyDialogInspectionFailure({
        status: 0,
        output: "blocked_unknown_dialog:title=License",
      }),
    ).toBeNull();
  });
});

describe("packaged openreaper-start dialog observer", () => {
  const source = readFileSync(START_HELPER, "utf8");
  const classifier = extractShellFunction(source, "startup_dialog_result_is_safe");
  const axFailure = extractShellFunction(source, "startup_dialog_observer_output_is_ax_failure");

  it("unique-Cancels lone Project Settings without generic dialog clicks", () => {
    expect(source).not.toMatch(/clickUniqueExactButton|click matchingElement|perform action "click"/);
    expect(source).not.toMatch(/whose name is "OK"/);
    expect(source).not.toMatch(/whose name is "Apply"/);
    expect(source).not.toMatch(/Ignore all missing files" then click/);
    expect(source).toMatch(/click theCancelButton/);
    expect(source).toMatch(/startup_maybe_dismiss_project_settings/);
    expect(source).toMatch(/title_only_unique_cancel_soft/);
    expect(source).toMatch(/unique-Cancel/);
  });

  it("allowlists the OpenReaper Studio ReaImGui face before unknown-dialog classification", () => {
    const observer = extractAppleScriptObserver(source);
    const body = extractAppleScriptObserverBody(source);
    const faceAt = body.indexOf('if windowTitle is "OpenReaper Studio" then');
    const unknownAt = body.indexOf('return "blocked_unknown_dialog:title="');
    expect(observer.startsWith("<<'APPLESCRIPT'")).toBe(true);
    expect(faceAt).toBeGreaterThanOrEqual(0);
    expect(unknownAt).toBeGreaterThan(faceAt);
    expect(stripAppleScriptComments(body)).not.toMatch(/\bnext repeat\b/);
    expect(body).not.toMatch(/studioFaceSafeTitles/);
    expect(body).toMatch(/set sawOpenReaperStudioDialog to true/);
    expect(body).toMatch(/set sawProjectSettings to false/);
    expect(body).toMatch(/else if windowTitle is "Project Settings"/);
    expect(body).toMatch(/set sawProjectSettings to true/);
    expect(body).not.toMatch(/isExactProjectNotesWindow/);
    const faceElseAt = body.indexOf("\n      else\n", faceAt);
    expect(faceElseAt).toBeGreaterThan(faceAt);
    expect(unknownAt).toBeGreaterThan(faceElseAt);
    expect(body).toMatch(/if sawProjectSettings then return "blocked_manual_dialog:title=Project Settings"/);
    expect(body).toMatch(/if sawOpenReaperStudioDialog then return "ignored_openreaper_studio_dialog"/);
    expect(classifier).toMatch(/ignored_openreaper_studio_dialog/);
    expect(classifier).toMatch(/blocked_unknown_dialog\)/);
    expect(classifier).toMatch(/blocked_manual_dialog\)/);
    expect(classifier).toMatch(/"OpenReaper Studio"\)/);
    expect(classifier).toMatch(/"Project Settings"/);
    expect(classifier).not.toMatch(/\blocal status=/);
    expect(source).not.toMatch(/blocked_unknown_dialog:title=OpenReaper Studio/);
    expect(stripAppleScriptComments(source)).not.toMatch(/\bnext repeat\b/);
    const face = readFileSync(
      path.join(repoRoot, "scripts/studio/reaper/dialog/ui_face.lua"),
      "utf8",
    );
    const skin = readFileSync(
      path.join(repoRoot, "scripts/studio/reaper/dialog/studio_skin.lua"),
      "utf8",
    );
    expect(face).toContain("skin.layout.title");
    expect(face).toContain('ImGui_Begin(ctx, skin.layout.title');
    for (const title of STUDIO_FACE_SAFE_WINDOW_TITLES) {
      expect(body).toContain(`if windowTitle is "${title}" then`);
      expect(skin).toContain(`title = "${title}"`);
      expect(runShellClassifier(classifier, "soft", `blocked_unknown_dialog:title=${title}`)).toBe(0);
      expect(runShellClassifier(classifier, "strict", `blocked_unknown_dialog:title=${title}`)).toBe(1);
    }
    expect(startupDialogResultIsSafe("ignored_openreaper_studio_dialog", "soft")).toBe(true);
    expect(startupDialogResultIsSafe("ignored_openreaper_studio_dialog", "strict")).toBe(true);
    expect(startupDialogResultIsSafe("blocked_unknown_dialog:title=OpenReaper Studio", "soft")).toBe(true);
    expect(runShellClassifier(classifier, "soft", "blocked_unknown_dialog:title=License")).toBe(1);
    expect(runShellClassifier(classifier, "soft", "blocked_unknown_dialog:title=Unexpected")).toBe(1);
    expect(runShellClassifier(classifier, "soft", "blocked_manual_dialog:title=Project Settings")).toBe(0);
    expect(runShellClassifier(classifier, "strict", "blocked_manual_dialog:title=Project Settings")).toBe(1);
    expect(runShellClassifier(classifier, "soft", "project_settings_seen_but_not_notes")).toBe(0);
  });

  it("keeps the observer compile-safe in zsh: no brace lists and no HyperTalk next repeat", () => {
    const observer = extractAppleScriptObserver(source);
    const body = extractAppleScriptObserverBody(source);
    expect(observer.startsWith("<<'APPLESCRIPT'")).toBe(true);
    // `next repeat` is HyperTalk. osascript -2741 is "expected end of line, found repeat".
    expect(body).not.toMatch(/\bnext repeat\b/);
    expect(body).not.toMatch(/studioFaceSafeTitles/);
    // Unquoted `{...}` is zsh brace expansion in word context. Do not embed AppleScript lists.
    expect(body).not.toMatch(/\{[^{}\n]*\}/);
    expect(body).toMatch(/if windowTitle is "OpenReaper Studio" then/);
    expect(body).toMatch(/set sawOpenReaperStudioDialog to true/);

    const fragileList = 'set studioFaceSafeTitles to {"OpenReaper Studio"}';
    if (zshAvailable()) {
      const quoted = runZshHeredoc(body, { quoted: true });
      expect(quoted.error?.code).not.toBe("ENOENT");
      expect(quoted.status, quoted.stderr).toBe(0);
      expect(quoted.stdout).toBe(`${body}\n`);
      expect(quoted.stdout).toContain('if windowTitle is "OpenReaper Studio" then');
      expect(quoted.stdout).not.toMatch(/\bnext repeat\b/);
      expect(quoted.stdout).not.toMatch(/\{[^{}\n]*\}/);

      // Word-context expansion strips quotes inside `{...}` even for a one-item list.
      const asWords = spawnSync("zsh", ["-c", `print -r -- ${fragileList}`], { encoding: "utf8" });
      expect(asWords.status, asWords.stderr).toBe(0);
      expect(asWords.stdout.trim()).not.toBe(fragileList);
      expect(asWords.stdout).not.toMatch(/\{"OpenReaper Studio"\}/);
    }
  });

  it("skips Studio face classification with if/else so real blockers still fail closed", () => {
    const observer = extractAppleScriptObserver(source);
    expect(stripAppleScriptComments(observer)).not.toMatch(/\bnext repeat\b/);
    const loopStart = observer.indexOf("repeat with reaperWindow in windows");
    expect(loopStart).toBeGreaterThanOrEqual(0);
    const loopEnd = observer.indexOf("end repeat", loopStart);
    const loop = observer.slice(loopStart, loopEnd);
    expect(loop).toMatch(/if windowTitle is "OpenReaper Studio" then[\s\S]*set sawOpenReaperStudioDialog to true[\s\S]*else if windowTitle is "Project Settings"/);
    expect(loop).toMatch(/set sawProjectSettings to true/);
    expect(loop).not.toContain('return "blocked_manual_dialog:title=Project Settings"');
    expect(loop).toContain('return "blocked_missing_media:choice=Ignore all missing files"');
    expect(loop).toContain('return "blocked_missing_media_offline_warning:choice=OK"');
    expect(loop).toContain('return "blocked_user_decision:title=Project Load Warning"');
    expect(loop).toContain('return "blocked_unknown_dialog:title="');
    const afterLoop = observer.slice(loopEnd);
    const projectSettingsAt = afterLoop.indexOf(
      'if sawProjectSettings then return "blocked_manual_dialog:title=Project Settings"',
    );
    const studioFaceAt = afterLoop.indexOf(
      'if sawOpenReaperStudioDialog then return "ignored_openreaper_studio_dialog"',
    );
    expect(projectSettingsAt).toBeGreaterThanOrEqual(0);
    expect(studioFaceAt).toBeGreaterThan(projectSettingsAt);
    expect(runShellClassifier(classifier, "soft", "ignored_openreaper_studio_dialog")).toBe(0);
    expect(runShellClassifier(classifier, "strict", "ignored_openreaper_studio_dialog")).toBe(0);
    expect(runShellClassifier(classifier, "soft", "blocked_missing_media:choice=Ignore all missing files")).toBe(1);
    expect(runShellClassifier(classifier, "soft", "blocked_manual_dialog:title=Project Settings")).toBe(0);
    expect(runShellClassifier(classifier, "strict", "blocked_manual_dialog:title=Project Settings")).toBe(1);
    expect(runShellClassifier(classifier, "soft", "blocked_manual_dialog:title=Unexpected")).toBe(1);
  });

  it("maps AX failures to inspection_unavailable and logs once", () => {
    expect(source).toMatch(/startup_dialog_inspection_unavailable\(\)/);
    expect(source).toMatch(/STARTUP_DIALOG_INSPECTION_UNAVAILABLE_LOGGED/);
    expect(source).toMatch(/printf '%s\\n' "inspection_unavailable"/);
    expect(source).toMatch(/OPENREAPER_STARTUP_DIALOG_POLICY/);
    expect(source).toMatch(/OPENREAPER_STUDIO:-\}" == "1"/);
    expect(source).toMatch(/studio-relaunch=stale_or_mismatched_bridge_heartbeat/);
    expect(source).toMatch(/studio-relaunch=skipped_prefer_attach/);
    expect(source).toMatch(/OPENREAPER_STUDIO_FACE_HOOK_INSTALLED/);
    expect(source).toMatch(/reclaim_orphan_launchservices_lock/);
    expect(source).toMatch(/acquire_openreaper_start_chain_lock/);
    expect(source).toMatch(/studio-relaunch=process_table_clear;ready_for_clean_launch/);
    expect(source).toMatch(/unavailable\|inspection_unavailable\|project_settings_seen_but_not_notes\|blocked_startup_budget_exhausted/);
    expect(source).toMatch(/startup-dialog-soft-ignore=/);
    expect(source).toMatch(/A lone Project Settings window is a recoverable soft blocker/);
    expect(source).toMatch(/startup-last-chance=bridge_liveness/);
    expect(source).toMatch(/startup-reaper-preserve=soft_policy/);
    expect(source).toMatch(/budget_remaining_ms=/);
    expect(source).toMatch(/startup_status_bridge_loaded/);
    expect(source).toMatch(/bridge-read-probe=skipped_budget_exhausted_soft_policy/);
    expect(source).toMatch(/ready_after_budget_last_chance/);
  });

  it("does not restore LaunchServices env until helper EXIT, and adopts a replacement PID", () => {
    const hookWait = extractShellFunction(source, "wait_for_startup_hook");
    expect(source).toMatch(/launchservices-env=held_until_helper_exit/);
    const waitAt = source.indexOf('wait_for_startup_hook "${reaper_pid}"');
    const heldAt = source.indexOf("launchservices-env=held_until_helper_exit");
    expect(waitAt).toBeGreaterThanOrEqual(0);
    expect(heldAt).toBeGreaterThan(waitAt);
    expect(source.slice(waitAt, heldAt)).not.toMatch(/restore_launchservices_env/);
    expect(source).toMatch(/STARTUP_LAUNCHED_REAPER_PID/);
    expect(hookWait).toMatch(/adopt_startup_reaper_pid_after_launchservices_restore/);
    expect(hookWait).toMatch(/waiting_for_launchservices_restore/);
    expect(hookWait).toMatch(/STARTUP_REAPER_PID_REPLACE_GRACE_TICKS/);
    expect(hookWait).toMatch(/startup_hook_pid_gap_keep_adopting/);
    expect(hookWait).toMatch(/adopt_window_after_soft_safe/);
    expect(hookWait).toMatch(/held_for_successor_publish/);
    expect(hookWait).toMatch(/startup_wait_poll_ticks/);
    expect(hookWait).toMatch(/startup_adopt_live_launchservices_successor_if_unique/);
    expect(hookWait).not.toMatch(
      /\[\[ -n "\$\{last_dialog_result\}" \]\] && startup_dialog_result_is_safe "\$\{last_dialog_result\}"/,
    );
    expect(source).toMatch(/startup-reaper-pid=adopted_after_launchservices_restore/);
    expect(source).toMatch(/select_startup_reaper_successor_pid\(\)/);
    expect(source).toMatch(/adopt_startup_reaper_successor_pid\(\)/);
    expect(source).toMatch(/successor_identity_pending/);
    expect(source).toMatch(/STARTUP_REAPER_PID_REPLACE_GRACE_TICKS=32/);
    expect(hookWait).toMatch(/startup_wait_accept_published_stage/);
    expect(hookWait).toMatch(/startup_dialog_inspect_due/);
    expect(hookWait).toMatch(/STARTUP_HOOK_FAIL_REMAINING_MS/);
    expect(hookWait).toMatch(/startup_last_chance_accept_published_stage/);
    expect(hookWait).toMatch(/startup-hook=leftover_budget_accept/);
    expect(hookWait).toMatch(/startup_poke_trusted_launcher_if_unpublished/);
    expect(hookWait).toMatch(/startup_poke_studio_face_if_needed/);
    expect(hookWait).toMatch(/startup_should_poke_trusted_launcher/);
    expect(hookWait).not.toMatch(
      /startup_budget_require_window "startup_hook" \$\(\( STARTUP_CLEANUP_RESERVE_MS \+ 250 \)\)/,
    );
    expect(hookWait).toMatch(/remaining_ms < STARTUP_HOOK_FAIL_REMAINING_MS/);
    const firstAccept = hookWait.indexOf("startup_wait_accept_published_stage");
    const firstObserver = hookWait.indexOf("run_startup_dialog_observer");
    expect(firstAccept).toBeGreaterThanOrEqual(0);
    expect(firstObserver).toBeGreaterThan(firstAccept);
  });

  it("throttles AX inspection after a stable safe result and caps repeat timeouts", () => {
    expect(source).toMatch(/STARTUP_DIALOG_REPEAT_TIMEOUT_SECONDS=2/);
    expect(source).toMatch(/STARTUP_DIALOG_INSPECT_EVERY_TICKS=8/);
    expect(source).toMatch(/STARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS=0/);
    expect(source).toMatch(/STARTUP_DIALOG_FIRST_TIMEOUT_SECONDS=4/);
    expect(source).toMatch(/OPENREAPER_START_HELPER_REV="studio-hook-publish-v8"/);
    expect(source).toMatch(/start-helper-rev=/);
    expect(source).toMatch(/STARTUP_AX_SKIP_REMAINING_MS=10000/);
    expect(source).toMatch(/STARTUP_HOOK_FAIL_REMAINING_MS=7500/);
    expect(source).toMatch(/STARTUP_HOOK_QUIET_TICKS/);
    expect(source).toMatch(/startup-last-chance=published_stage/);
    expect(source).toMatch(/startup-hook=leftover_budget_accept/);
    expect(source).toMatch(/startup-ax=stopped_after_soft_blocker/);
    expect(source).toMatch(/startup-hook-poke=trusted_launcher/);
    expect(source).toMatch(/ensure_openreaper_startup_hook/);
    expect(source).toMatch(/BEGIN openreaper-kernel-startup/);
    expect(source).toMatch(/START_WAIT_SECONDS="\$\{OPENREAPER_START_WAIT_SECONDS:-52\}"/);
    expect(source).toMatch(/STARTUP_DIALOG_REPEAT_INSPECT/);
    const inspectDue = extractShellFunction(source, "startup_dialog_inspect_due");
    expect(inspectDue).toMatch(/STARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS/);
    expect(inspectDue).toMatch(/STARTUP_HOOK_QUIET_TICKS/);
    const observer = extractShellFunction(source, "run_startup_dialog_observer");
    expect(observer).toMatch(/STARTUP_DIALOG_REPEAT_INSPECT/);
    expect(observer).toMatch(/STARTUP_DIALOG_REPEAT_TIMEOUT_SECONDS/);
    expect(observer).toMatch(/STARTUP_DIALOG_FIRST_TIMEOUT_SECONDS/);
    const readiness = extractShellFunction(source, "wait_for_startup_readiness");
    expect(readiness).toMatch(/startup_dialog_inspect_due/);
    expect(readiness).toMatch(/startup_wait_accept_ready_bridge/);
    expect(readiness).toMatch(/startup_maybe_dismiss_project_settings/);
    expect(readiness).toMatch(/startup_hook_pid_gap_keep_adopting/);
    expect(readiness).toMatch(/adopt_window_after_soft_safe/);
    expect(readiness).toMatch(/startup_wait_poll_ticks/);
    expect(readiness).toMatch(/startup_adopt_live_launchservices_successor_if_unique/);
    expect(readiness).not.toMatch(
      /startup_budget_require_window "bridge_readiness" \$\(\( STARTUP_CLEANUP_RESERVE_MS \+ 250 \)\)/,
    );
  });

  it("accepts a published hook after Project Settings soft-ignore when leftover is 6069ms", () => {
    const zshCheck = spawnSync("zsh", ["-c", "exit 0"], { encoding: "utf8" });
    if (zshCheck.error?.code === "ENOENT") {
      return;
    }
    const accept = extractShellFunction(source, "startup_wait_accept_published_stage");
    const inspectDue = extractShellFunction(source, "startup_dialog_inspect_due");
    const published = spawnSync(
      "zsh",
      [
        "-c",
        `${accept}\nstartup_status_stage_ready() { return 0; }\nstartup_dialog_result_is_safe() { return 0; }\nstartup_wait_accept_published_stage "$1"`,
        "accept-stage",
        "blocked_manual_dialog:title=Project Settings",
      ],
      { encoding: "utf8" },
    );
    expect(published.status, published.stderr).toBe(0);

    const empty = spawnSync(
      "zsh",
      [
        "-c",
        `${accept}\nstartup_status_stage_ready() { return 0; }\nstartup_dialog_result_is_safe() { return 0; }\nstartup_wait_accept_published_stage "$1"`,
        "accept-stage",
        "",
      ],
      { encoding: "utf8" },
    );
    expect(empty.status).toBe(1);

    const emptySoft = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_POLICY=soft\n${accept}\nstartup_status_stage_ready() { return 0; }\nstartup_dialog_result_is_safe() { return 0; }\nstartup_wait_accept_published_stage "$1"`,
        "accept-stage",
        "",
      ],
      { encoding: "utf8" },
    );
    expect(emptySoft.status, emptySoft.stderr).toBe(0);

    const unsafe = spawnSync(
      "zsh",
      [
        "-c",
        `${accept}\nstartup_status_stage_ready() { return 0; }\nstartup_dialog_result_is_safe() { return 1; }\nstartup_wait_accept_published_stage "$1"`,
        "accept-stage",
        "blocked_unknown_dialog:title=License",
      ],
      { encoding: "utf8" },
    );
    expect(unsafe.status).toBe(1);

    const unpublished = spawnSync(
      "zsh",
      [
        "-c",
        `${accept}\nstartup_status_stage_ready() { return 1; }\nstartup_dialog_result_is_safe() { return 0; }\nstartup_wait_accept_published_stage "$1"`,
        "accept-stage",
        "blocked_manual_dialog:title=Project Settings",
      ],
      { encoding: "utf8" },
    );
    expect(unpublished.status).toBe(1);

    const lastChance = extractShellFunction(source, "startup_last_chance_accept_published_stage");
    const leftoverLastChance = spawnSync(
      "zsh",
      [
        "-c",
        `${lastChance}\nSTARTUP_CLEANUP_RESERVE_MS=6000\nTRANSPORT_DIR=${JSON.stringify("/tmp/or-missing-status")}\nstartup_remaining_budget_ms() { print -r -- 6069; }\nstartup_wait_accept_published_stage() { return 0; }\nstartup_should_poke_trusted_launcher() { return 1; }\nstartup_poke_trusted_launcher_if_unpublished() { return 0; }\nstartup_last_chance_accept_published_stage "$1" leftover_6069`,
        "last-chance-stage",
        "blocked_manual_dialog:title=Project Settings",
      ],
      { encoding: "utf8" },
    );
    expect(leftoverLastChance.status, leftoverLastChance.stderr).toBe(0);
    expect(leftoverLastChance.stderr).toMatch(/startup-last-chance=published_stage/);
    expect(leftoverLastChance.stderr).toMatch(/leftover_budget_accept remaining_ms=6069/);

    const dueFirst = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_INSPECT_EVERY_TICKS=8\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "1",
        "0",
        "",
        "",
      ],
      { encoding: "utf8" },
    );
    expect(dueFirst.status).toBe(0);

    const dueThrottled = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_INSPECT_EVERY_TICKS=8\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "5",
        "1",
        "",
        "blocked_manual_dialog:title=Project Settings",
      ],
      { encoding: "utf8" },
    );
    expect(dueThrottled.status).toBe(1);

    const dueEvery = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_INSPECT_EVERY_TICKS=8\nSTARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS=24\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "9",
        "1",
        "",
        "no_safe_dialog",
      ],
      { encoding: "utf8" },
    );
    expect(dueEvery.status).toBe(0);

    const dueSettingsStillThrottled = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_INSPECT_EVERY_TICKS=8\nSTARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS=24\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "9",
        "1",
        "",
        "blocked_manual_dialog:title=Project Settings",
      ],
      { encoding: "utf8" },
    );
    expect(dueSettingsStillThrottled.status).toBe(1);

    const dueSettingsStopped = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_INSPECT_EVERY_TICKS=8\nSTARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS=0\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "25",
        "1",
        "",
        "blocked_manual_dialog:title=Project Settings",
      ],
      { encoding: "utf8" },
    );
    expect(dueSettingsStopped.status).toBe(1);

    const duePending = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_INSPECT_EVERY_TICKS=8\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "5",
        "1",
        "blocked_unknown_dialog:title=License",
        "blocked_unknown_dialog:title=License",
      ],
      { encoding: "utf8" },
    );
    expect(duePending.status).toBe(0);

    const quietSoft = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_POLICY=soft\nSTARTUP_HOOK_QUIET_TICKS=8\nSTARTUP_DIALOG_INSPECT_EVERY_TICKS=8\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "1",
        "0",
        "",
        "",
      ],
      { encoding: "utf8" },
    );
    expect(quietSoft.status).toBe(1);

    const quietExpired = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_POLICY=soft\nSTARTUP_HOOK_QUIET_TICKS=8\nSTARTUP_DIALOG_INSPECT_EVERY_TICKS=8\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "9",
        "0",
        "",
        "",
      ],
      { encoding: "utf8" },
    );
    expect(quietExpired.status).toBe(0);

    const quietStillFailClosed = spawnSync(
      "zsh",
      [
        "-c",
        `STARTUP_DIALOG_POLICY=soft\nSTARTUP_HOOK_QUIET_TICKS=8\nSTARTUP_DIALOG_INSPECT_EVERY_TICKS=8\n${inspectDue}\nstartup_dialog_inspect_due "$1" "$2" "$3" "$4"`,
        "inspect-due",
        "3",
        "0",
        "blocked_unknown_dialog:title=License",
        "",
      ],
      { encoding: "utf8" },
    );
    expect(quietStillFailClosed.status).toBe(0);
  });

  it("shell classifier matches the JS contract", () => {
    for (const result of ALWAYS_SAFE) {
      expect(runShellClassifier(classifier, "soft", result), result).toBe(0);
      expect(runShellClassifier(classifier, "strict", result), result).toBe(0);
    }
    for (const result of INSPECTION_SAFE) {
      expect(runShellClassifier(classifier, "soft", result), `${result} soft`).toBe(0);
      expect(runShellClassifier(classifier, "strict", result), `${result} strict`).toBe(1);
    }
    for (const result of UNSAFE) {
      expect(runShellClassifier(classifier, "soft", result), `${result} soft`).toBe(1);
      expect(runShellClassifier(classifier, "strict", result), `${result} strict`).toBe(1);
    }
    for (const result of SOFT_SAFE_BLOCKERS) {
      expect(runShellClassifier(classifier, "soft", result), `${result} soft`).toBe(0);
      expect(runShellClassifier(classifier, "strict", result), `${result} strict`).toBe(1);
    }
    for (const title of STUDIO_FACE_SAFE_WINDOW_TITLES) {
      const unknown = `blocked_unknown_dialog:title=${title}`;
      expect(runShellClassifier(classifier, "soft", unknown), `${unknown} soft`).toBe(0);
      expect(runShellClassifier(classifier, "strict", unknown), `${unknown} strict`).toBe(1);
    }
  });

  it("treats -609, empty, non-zero, and alarm 142 as AX inspection failure", () => {
    expect(runAxFailureCheck(axFailure, 142, "anything")).toBe(0);
    expect(runAxFailureCheck(axFailure, 1, "no_safe_dialog")).toBe(0);
    expect(runAxFailureCheck(axFailure, 0, "")).toBe(0);
    expect(runAxFailureCheck(axFailure, 0, "System Events got an error: invalid connection (-609)")).toBe(0);
    expect(
      runAxFailureCheck(
        axFailure,
        0,
        '42:73: syntax error: Expected end of line but found "repeat". (-2741)',
      ),
    ).toBe(0);
    expect(runAxFailureCheck(axFailure, 0, "no_safe_dialog")).toBe(1);
    expect(runAxFailureCheck(axFailure, 0, "blocked_unknown_dialog:title=License")).toBe(1);
  });

  it("does not assign to zsh read-only status in the AX failure classifier", () => {
    expect(axFailure).not.toMatch(/\blocal status=/);
    const zshCheck = spawnSync("zsh", ["-c", "exit 0"], { encoding: "utf8" });
    if (zshCheck.error?.code !== "ENOENT") {
      expect(runAxFailureCheck(axFailure, 1, "", "zsh")).toBe(0);
      expect(runAxFailureCheck(axFailure, 0, "no_safe_dialog", "zsh")).toBe(1);
    }
  });
});

describe("packaged openreaper-start LaunchServices successor PID picker", () => {
  const source = readFileSync(START_HELPER, "utf8");
  const picker = extractShellFunction(source, "select_startup_reaper_successor_pid");

  function runPicker(launchedPid, beforePids, candidates) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "or-ls-successor-"));
    const beforeFile = path.join(tmp, "before.pids");
    writeFileSync(beforeFile, beforePids.map((pid) => `${pid}\n`).join(""), "utf8");
    const spawned = spawnSync(
      "zsh",
      [
        "-c",
        `${picker}\nselect_startup_reaper_successor_pid "$@"`,
        "successor-picker",
        launchedPid,
        beforeFile,
        ...candidates,
      ],
      { encoding: "utf8" },
    );
    rmSync(tmp, { recursive: true, force: true });
    return spawned;
  }

  it("adopts the unique new PID and fails closed on 0 or 2+ successors", () => {
    const zshCheck = spawnSync("zsh", ["-c", "exit 0"], { encoding: "utf8" });
    if (zshCheck.error?.code === "ENOENT") {
      return;
    }
    const unique = runPicker("100", ["100", "200"], ["200", "300"]);
    expect(unique.status, unique.stderr).toBe(0);
    expect(unique.stdout.trim()).toBe("300");

    const stillListed = runPicker("100", ["200"], ["100", "300"]);
    expect(stillListed.status, stillListed.stderr).toBe(0);
    expect(stillListed.stdout.trim()).toBe("300");

    const none = runPicker("100", ["200"], ["100", "200"]);
    expect(none.status).toBe(1);
    expect(none.stdout.trim()).toBe("");

    const multiple = runPicker("100", ["200"], ["300", "400"]);
    expect(multiple.status).toBe(1);

    const emptyBefore = runPicker("100", [], ["300"]);
    expect(emptyBefore.status).toBe(0);
    expect(emptyBefore.stdout.trim()).toBe("300");
  });
});

describe("packaged openreaper-start LaunchServices adopt-window", () => {
  const source = readFileSync(START_HELPER, "utf8");

  function runKeepAdopting(lastResult, missed, remainingMs, policy = "") {
    const keep = extractShellFunction(source, "startup_hook_pid_gap_keep_adopting");
    return spawnSync(
      "zsh",
      [
        "-c",
        [
          "STARTUP_REAPER_PID_REPLACE_GRACE_TICKS=32",
          "STARTUP_CLEANUP_RESERVE_MS=6000",
          `STARTUP_DIALOG_POLICY=${JSON.stringify(policy)}`,
          'startup_dialog_result_is_safe() {',
          '  [[ "$1" == *Project\\ Settings* ]] && return 0',
          "  return 1",
          "}",
          keep,
          'startup_hook_pid_gap_keep_adopting "$1" "$2" "$3"',
        ].join("\n"),
        "pid-gap",
        lastResult,
        String(missed),
        String(remainingMs),
      ],
      { encoding: "utf8" },
    );
  }

  it("keeps adopting after soft-safe PID gap instead of hard-failing at grace ticks", () => {
    if (!zshAvailable()) {
      return;
    }
    const withinGrace = runKeepAdopting("", 12, 20_000);
    expect(withinGrace.status, withinGrace.stderr).toBe(0);

    const graceWithoutSafe = runKeepAdopting("", 32, 20_000);
    expect(graceWithoutSafe.status).toBe(1);

    const graceSoftBeforeAx = runKeepAdopting("", 40, 20_000, "soft");
    expect(graceSoftBeforeAx.status, graceSoftBeforeAx.stderr).toBe(0);

    const afterSoftIgnore = runKeepAdopting(
      "blocked_manual_dialog:title=Project Settings",
      40,
      20_000,
    );
    expect(afterSoftIgnore.status, afterSoftIgnore.stderr).toBe(0);

    const budgetGone = runKeepAdopting(
      "blocked_manual_dialog:title=Project Settings",
      40,
      100,
    );
    expect(budgetGone.status).toBe(1);

    const unsafeDialog = runKeepAdopting(
      "blocked_unknown_dialog:title=License",
      40,
      20_000,
    );
    expect(unsafeDialog.status).toBe(1);

    const unsafeSoft = runKeepAdopting(
      "blocked_unknown_dialog:title=License",
      40,
      20_000,
      "soft",
    );
    expect(unsafeSoft.status).toBe(1);
  });

  it("adopts a unique successor even when identity fingerprint is still pending", () => {
    if (!zshAvailable()) {
      return;
    }
    const adopt = extractShellFunction(source, "adopt_startup_reaper_successor_pid");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "or-ls-adopt-"));
    const pidFile = path.join(tmp, "reaper.pid");
    writeFileSync(pidFile, "100\n", "utf8");
    const spawned = spawnSync(
      "zsh",
      [
        "-c",
        [
          `PID_FILE=${JSON.stringify(pidFile)}`,
          "STARTUP_LAUNCHED_REAPER_PID=100",
          "STARTUP_LAUNCHED_REAPER_IDENTITY=",
          "capture_startup_reaper_identity() { return 1; }",
          adopt,
          'adopt_startup_reaper_successor_pid "$1" "$2"',
        ].join("\n"),
        "adopt-pending",
        "100",
        "200",
      ],
      { encoding: "utf8" },
    );
    const pidWritten = readFileSync(pidFile, "utf8").trim();
    rmSync(tmp, { recursive: true, force: true });
    expect(spawned.status, spawned.stderr).toBe(0);
    expect(spawned.stdout.trim()).toBe("200");
    expect(pidWritten).toBe("200");
    expect(spawned.stderr).toMatch(/successor_identity_pending/);
    expect(spawned.stderr).toMatch(/adopted_after_launchservices_restore from=100 to=200/);
  });
});

describe("packaged openreaper-start kernel hook install + launcher poke", () => {
  const source = readFileSync(START_HELPER, "utf8");

  function extractEnsureHookNode() {
    const fnAt = source.indexOf("ensure_openreaper_startup_hook() {");
    if (fnAt < 0) {
      throw new Error("missing ensure_openreaper_startup_hook");
    }
    const heredocAt = source.indexOf("<<'NODE'", fnAt);
    const start = source.indexOf("\n", heredocAt) + 1;
    const end = source.indexOf("\nNODE\n", start);
    if (heredocAt < 0 || start <= 0 || end < 0) {
      throw new Error("missing ensure_openreaper_startup_hook node installer");
    }
    return source.slice(start, end);
  }

  function runEnsureStartupHook({ resourceRoot, transportDir, launcherPath }) {
    const fn = extractShellFunctionSkippingQuotedHeredocs(source, "ensure_openreaper_startup_hook");
    return spawnSync(
      "zsh",
      [
        "-c",
        [
          "set -euo pipefail",
          `startup_reaper_resource_root() { print -r -- ${JSON.stringify(resourceRoot)}; }`,
          `TRANSPORT_DIR=${JSON.stringify(transportDir)}`,
          `BRIDGE_LAUNCHER_SCRIPT=${JSON.stringify(launcherPath)}`,
          fn,
          "ensure_openreaper_startup_hook",
        ].join("\n"),
        "ensure-hook",
      ],
      { encoding: "utf8" },
    );
  }

  it("treats node hook install success as return 0 (not the inverted if ! node path)", () => {
    const fn = extractShellFunctionSkippingQuotedHeredocs(source, "ensure_openreaper_startup_hook");
    expect(fn).toMatch(/if node --input-type=module -/);
    expect(fn).not.toMatch(/if ! node --input-type=module -/);
    expect(fn).toMatch(/startup-hook=installed path=/);
    expect(fn).toMatch(/return 0/);
    expect(fn).toMatch(/return 1/);
    const thenAt = fn.indexOf("then\n    echo \"[OpenReaper] startup-hook=installed");
    const return0At = fn.indexOf("return 0", thenAt);
    const fiAt = fn.indexOf("\n  fi\n  return 1", return0At);
    expect(thenAt).toBeGreaterThan(fn.indexOf("if node --input-type=module -"));
    expect(return0At).toBeGreaterThan(thenAt);
    expect(fiAt).toBeGreaterThan(return0At);
  });

  it("returns 0 when the kernel hook node install succeeds and non-zero when it fails", () => {
    if (!zshAvailable()) {
      return;
    }
    const tmp = mkdtempSync(path.join(os.tmpdir(), "or-ensure-hook-rc-"));
    const resourceRoot = path.join(tmp, "resource");
    const transportDir = path.join(tmp, "transport");
    const launcherPath = path.join(tmp, "openreaper-start-mcp-bridge.lua");
    try {
      mkdirSync(path.join(resourceRoot, "Scripts"), { recursive: true });
      mkdirSync(transportDir, { recursive: true });
      writeFileSync(launcherPath, "-- launcher\n", "utf8");
      writeFileSync(
        path.join(resourceRoot, "Scripts", "__startup.lua"),
        "-- BEGIN openreaper-studio-face (managed by OpenReaper Studio)\nreaper.defer(function() end)\n-- END openreaper-studio-face\n",
        "utf8",
      );

      const ok = runEnsureStartupHook({ resourceRoot, transportDir, launcherPath });
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stderr).toMatch(/startup-hook=installed path=/);
      expect(ok.stderr).toContain(path.join(resourceRoot, "Scripts", "__startup.lua"));
      expect(ok.stderr).toContain(path.join(transportDir, "openreaper-startup-status-v1.json"));
      const installed = readFileSync(path.join(resourceRoot, "Scripts", "__startup.lua"), "utf8");
      expect(installed).toMatch(/BEGIN openreaper-kernel-startup/);
      expect(installed).toContain(path.join(transportDir, "openreaper-startup-status-v1.json"));

      const missingLauncher = runEnsureStartupHook({
        resourceRoot,
        transportDir,
        launcherPath: path.join(tmp, "missing-launcher.lua"),
      });
      expect(missingLauncher.status).not.toBe(0);
      expect(missingLauncher.stderr).toMatch(/trusted Bridge launcher is missing/);
      expect(missingLauncher.stderr).not.toMatch(/startup-hook=installed path=/);

      const unsafeTransport = path.join(tmp, "bad]]status");
      mkdirSync(unsafeTransport, { recursive: true });
      const nodeFailed = runEnsureStartupHook({
        resourceRoot,
        transportDir: unsafeTransport,
        launcherPath,
      });
      expect(nodeFailed.status).not.toBe(0);
      expect(nodeFailed.stderr).toMatch(/startup hook install failed/);
      expect(nodeFailed.stderr).not.toMatch(/startup-hook=installed path=/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("installs a kernel __startup.lua block with this run's status path before the face hook", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "or-kernel-hook-"));
    const scriptsDir = path.join(tmp, "Scripts");
    mkdirSync(scriptsDir, { recursive: true });
    const startupLua = path.join(scriptsDir, "__startup.lua");
    const statusPath = path.join(tmp, "openreaper-startup-status-v1.json");
    const launcherPath = path.join(tmp, "openreaper-start-mcp-bridge.lua");
    try {
      writeFileSync(
        startupLua,
        "-- BEGIN openreaper-studio-face (managed by OpenReaper Studio)\nreaper.defer(function() end)\n-- END openreaper-studio-face\n",
        "utf8",
      );
      writeFileSync(launcherPath, "-- launcher\n", "utf8");
      const nodeScript = extractEnsureHookNode();
      const spawned = spawnSync(
        "node",
        ["--input-type=module", "-", startupLua, statusPath, launcherPath],
        { encoding: "utf8", input: nodeScript },
      );
      expect(spawned.status, spawned.stderr).toBe(0);
      const installed = readFileSync(startupLua, "utf8");
      expect(installed).toMatch(/BEGIN openreaper-kernel-startup/);
      expect(installed).toContain(statusPath);
      expect(installed).toContain(launcherPath);
      expect(installed).toMatch(/write_status\("hook_seen"\)/);
      expect(installed).toMatch(/openreaper\.startup_status\.v1/);
      expect(installed).toMatch(/bridge_dofile_succeeded/);
      const kernelAt = installed.indexOf("BEGIN openreaper-kernel-startup");
      const faceAt = installed.indexOf("BEGIN openreaper-studio-face");
      expect(kernelAt).toBeGreaterThanOrEqual(0);
      expect(faceAt).toBeGreaterThan(kernelAt);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("pokes the trusted launcher once when Project Settings is soft-ignored and status is missing", () => {
    if (!zshAvailable()) {
      return;
    }
    const poke = extractShellFunction(source, "startup_poke_trusted_launcher_if_unpublished");
    const should = extractShellFunction(source, "startup_should_poke_trusted_launcher");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "or-hook-poke-"));
    const launcher = path.join(tmp, "openreaper-start-mcp-bridge.lua");
    const logFile = path.join(tmp, "start.log");
    writeFileSync(launcher, "-- launcher\n", "utf8");
    writeFileSync(logFile, "", "utf8");
    try {
      const allow = spawnSync(
        "zsh",
        [
          "-c",
          `${should}\nSTARTUP_DIALOG_POLICY=soft\nstartup_should_poke_trusted_launcher "$1"`,
          "should-poke",
          "blocked_manual_dialog:title=Project Settings",
        ],
        { encoding: "utf8" },
      );
      expect(allow.status, allow.stderr).toBe(0);

      const denyLicense = spawnSync(
        "zsh",
        [
          "-c",
          `${should}\nSTARTUP_DIALOG_POLICY=soft\nstartup_should_poke_trusted_launcher "$1"`,
          "should-poke",
          "blocked_unknown_dialog:title=License",
        ],
        { encoding: "utf8" },
      );
      expect(denyLicense.status).toBe(1);

      const denyStrict = spawnSync(
        "zsh",
        [
          "-c",
          `${should}\nSTARTUP_DIALOG_POLICY=strict\nstartup_should_poke_trusted_launcher "$1"`,
          "should-poke",
          "blocked_manual_dialog:title=Project Settings",
        ],
        { encoding: "utf8" },
      );
      expect(denyStrict.status).toBe(1);

      const poked = spawnSync(
        "zsh",
        [
          "-c",
          [
            `TRANSPORT_DIR=${JSON.stringify(tmp)}`,
            `BRIDGE_LAUNCHER_SCRIPT=${JSON.stringify(launcher)}`,
            `START_LOG=${JSON.stringify(logFile)}`,
            "STARTUP_LAUNCHER_POKE_ATTEMPTED=false",
            "REAPER_BIN=/usr/bin/true",
            "REAPER_APP=",
            "startup_remaining_budget_ms() { print -r -- 50000; }",
            "startup_run_bounded_external() { shift; printf 'poked %s\\n' \"$*\"; return 0; }",
            poke,
            "startup_poke_trusted_launcher_if_unpublished",
            "startup_poke_trusted_launcher_if_unpublished",
          ].join("\n"),
          "poke-launcher",
        ],
        { encoding: "utf8" },
      );
      expect(poked.status, poked.stderr).toBe(0);
      expect(poked.stderr).toMatch(/startup-hook-poke=trusted_launcher remaining_ms=50000/);
      expect(poked.stderr).toMatch(/startup-hook-poke=submitted/);
      const pokeCount = (poked.stderr.match(/startup-hook-poke=trusted_launcher/g) || []).length;
      expect(pokeCount).toBe(1);

      writeFileSync(
        path.join(tmp, "openreaper-startup-status-v1.json"),
        '{"contract":"openreaper.startup_status.v1","stage":"hook_seen"}\n',
        "utf8",
      );
      const skipped = spawnSync(
        "zsh",
        [
          "-c",
          [
            `TRANSPORT_DIR=${JSON.stringify(tmp)}`,
            `BRIDGE_LAUNCHER_SCRIPT=${JSON.stringify(launcher)}`,
            "STARTUP_LAUNCHER_POKE_ATTEMPTED=false",
            "startup_remaining_budget_ms() { print -r -- 50000; }",
            'startup_run_bounded_external() { echo "should-not-poke" >&2; return 0; }',
            poke,
            "startup_poke_trusted_launcher_if_unpublished",
          ].join("\n"),
          "poke-skip",
        ],
        { encoding: "utf8" },
      );
      expect(skipped.status, skipped.stderr).toBe(0);
      expect(skipped.stderr).not.toMatch(/startup-hook-poke=trusted_launcher/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("pokes the Studio face script once under OPENREAPER_STUDIO=1", () => {
    if (!zshAvailable()) {
      return;
    }
    const pokeFace = extractShellFunction(source, "startup_poke_studio_face_if_needed");
    const trusted = extractShellFunction(source, "startup_trusted_lua_is_runnable");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "or-face-poke-"));
    const face = path.join(tmp, "openreaper_studio_dialog.lua");
    const logFile = path.join(tmp, "start.log");
    writeFileSync(face, "-- face\n", "utf8");
    writeFileSync(logFile, "", "utf8");
    try {
      const poked = spawnSync(
        "zsh",
        [
          "-c",
          [
            "OPENREAPER_STUDIO=1",
            "STARTUP_DIALOG_POLICY=soft",
            `OPENREAPER_STUDIO_FACE_SCRIPT=${JSON.stringify(face)}`,
            `START_LOG=${JSON.stringify(logFile)}`,
            "STARTUP_FACE_POKE_ATTEMPTED=false",
            "REAPER_BIN=/usr/bin/true",
            "REAPER_APP=",
            "startup_remaining_budget_ms() { print -r -- 50000; }",
            "startup_run_bounded_external() { shift; printf 'poked %s\\n' \"$*\"; return 0; }",
            trusted,
            pokeFace,
            "startup_poke_studio_face_if_needed",
            "first=$?",
            "startup_poke_studio_face_if_needed",
            "second=$?",
            'print -r -- "first=$first second=$second attempted=$STARTUP_FACE_POKE_ATTEMPTED"',
            "exit $first",
          ].join("\n"),
          "poke-face",
        ],
        { encoding: "utf8" },
      );
      expect(poked.status, poked.stderr).toBe(0);
      expect(poked.stderr).toMatch(/startup-hook-poke=studio_face remaining_ms=50000/);
      expect(poked.stderr).toMatch(/startup-hook-poke=studio_face_submitted/);
      expect(poked.stdout).toMatch(/first=0 second=1 attempted=true/);

      const skipped = spawnSync(
        "zsh",
        [
          "-c",
          [
            "OPENREAPER_STUDIO=1",
            "STARTUP_DIALOG_POLICY=soft",
            `OPENREAPER_STUDIO_FACE_SCRIPT=${JSON.stringify(path.join(tmp, "not-the-face.lua"))}`,
            "STARTUP_FACE_POKE_ATTEMPTED=false",
            trusted,
            pokeFace,
            "startup_poke_studio_face_if_needed",
          ].join("\n"),
          "poke-face-skip",
        ],
        { encoding: "utf8" },
      );
      expect(skipped.status).toBe(1);
      expect(skipped.stderr).not.toMatch(/startup-hook-poke=studio_face remaining_ms=/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refreshes the kernel hook on launch before wait_for_startup_hook", () => {
    const launchAt = source.indexOf("launch_reaper()");
    const waitAt = source.indexOf('wait_for_startup_hook "${reaper_pid}"', launchAt);
    const ensureAt = source.indexOf("ensure_openreaper_startup_hook", launchAt);
    expect(launchAt).toBeGreaterThanOrEqual(0);
    expect(ensureAt).toBeGreaterThan(launchAt);
    expect(waitAt).toBeGreaterThan(ensureAt);
    expect(source).toMatch(/startup-hook=installed path=/);
  });
});
