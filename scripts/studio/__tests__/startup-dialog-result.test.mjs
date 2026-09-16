import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDialogInspectionFailure,
  dialogResultTitle,
  isStudioFaceSafeWindowTitle,
  resolveStartupDialogPolicy,
  startupDialogResultIsSafe,
  STUDIO_FACE_SAFE_WINDOW_TITLES,
} from "../lib/contracts/startup-dialog-result.mjs";
import { packagedMacosStartHelperPath } from "../lib/paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const START_HELPER = packagedMacosStartHelperPath(repoRoot);

const ALWAYS_SAFE = [
  "no_safe_dialog",
  "ignored_reascript_run_status_window",
  "ignored_openreaper_studio_dialog",
];
const INSPECTION_SAFE = ["unavailable", "inspection_unavailable", "inspection_unavailable:status=142"];
const UNSAFE = [
  "blocked_dialog_inspection_timeout:seconds=5",
  "blocked_dialog_inspection_failed:status=1",
  "blocked_missing_media:choice=Ignore all missing files",
  "blocked_missing_media_offline_warning:choice=OK",
  "blocked_user_decision:title=Project Load Warning",
  "blocked_unknown_dialog:title=Unexpected",
  "blocked_unknown_dialog:title=License",
  "blocked_manual_dialog:title=Project Settings",
  "blocked_reaper_identity:pid=123",
  "blocked_dialog_classification:title=Untitled:error=permission denied",
  "blocked_startup_budget_exhausted:stage=dialog_inspection",
  "project_settings_seen_but_not_notes",
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
    expect(startupDialogResultIsSafe("blocked_manual_dialog:title=Project Settings", "soft")).toBe(false);
    expect(startupDialogResultIsSafe("project_settings_seen_but_not_notes", "soft")).toBe(false);
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

  it("does not re-add dialog click automation", () => {
    expect(source).not.toMatch(/clickUniqueExactButton|click matchingElement|perform action "click"/);
    expect(source).toMatch(/never clicks or closes REAPER windows/);
  });

  it("allowlists the OpenReaper Studio ReaImGui face before unknown-dialog classification", () => {
    const observer = extractAppleScriptObserver(source);
    const allowlistAt = observer.indexOf('set studioFaceSafeTitles to {"OpenReaper Studio"}');
    const unknownAt = observer.indexOf('return "blocked_unknown_dialog:title="');
    expect(allowlistAt).toBeGreaterThanOrEqual(0);
    expect(unknownAt).toBeGreaterThan(allowlistAt);
    expect(observer).toMatch(/if studioFaceSafeTitles contains windowTitle then/);
    expect(observer).toMatch(/set sawOpenReaperStudioDialog to true/);
    expect(observer).toMatch(/next repeat/);
    expect(observer).toMatch(/if sawOpenReaperStudioDialog then return "ignored_openreaper_studio_dialog"/);
    expect(classifier).toMatch(/ignored_openreaper_studio_dialog/);
    expect(classifier).toMatch(/blocked_unknown_dialog\)/);
    expect(classifier).toMatch(/"OpenReaper Studio"\)/);
    expect(classifier).not.toMatch(/\blocal status=/);
    expect(source).not.toMatch(/blocked_unknown_dialog:title=OpenReaper Studio/);
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
      expect(observer).toContain(`"${title}"`);
      expect(skin).toContain(`title = "${title}"`);
      expect(runShellClassifier(classifier, "soft", `blocked_unknown_dialog:title=${title}`)).toBe(0);
      expect(runShellClassifier(classifier, "strict", `blocked_unknown_dialog:title=${title}`)).toBe(1);
    }
    expect(startupDialogResultIsSafe("ignored_openreaper_studio_dialog", "soft")).toBe(true);
    expect(startupDialogResultIsSafe("ignored_openreaper_studio_dialog", "strict")).toBe(true);
    expect(startupDialogResultIsSafe("blocked_unknown_dialog:title=OpenReaper Studio", "soft")).toBe(true);
    expect(runShellClassifier(classifier, "soft", "blocked_unknown_dialog:title=License")).toBe(1);
    expect(runShellClassifier(classifier, "soft", "blocked_unknown_dialog:title=Unexpected")).toBe(1);
  });

  it("maps AX failures to inspection_unavailable and logs once", () => {
    expect(source).toMatch(/startup_dialog_inspection_unavailable\(\)/);
    expect(source).toMatch(/STARTUP_DIALOG_INSPECTION_UNAVAILABLE_LOGGED/);
    expect(source).toMatch(/printf '%s\\n' "inspection_unavailable"/);
    expect(source).toMatch(/OPENREAPER_STARTUP_DIALOG_POLICY/);
    expect(source).toMatch(/OPENREAPER_STUDIO:-\}" == "1"/);
    expect(source).toMatch(/studio-relaunch=stale_or_mismatched_bridge_heartbeat/);
    expect(classifier).toMatch(/unavailable\|inspection_unavailable/);
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
