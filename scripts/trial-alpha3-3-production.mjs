#!/usr/bin/env node
import path from "node:path";
import { runInstalledTrial } from "./lib/alpha3-3-installed-trial-runner.mjs";

const SCENARIOS = Object.freeze(["large-production", "editing-sfx", "mixing-delivery"]);
class CliUsageError extends Error {}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const mode = options.describe ? "describe" : options.dry_run ? "dry-run" : "execute";
  const scenarios = options.all ? SCENARIOS : [options.scenario];
  if (mode === "execute") validateExecutionOptions(options);

  const report = await runInstalledTrial({
    scenarios,
    mode,
    installedWrapper: options.installed_wrapper,
    sourceProject: options.source_project,
    evidenceProject: options.evidence_project,
    managedRenderRoot: options.managed_render_root,
    mediaRoots: options.media_roots,
    mediaAssets: options.media_assets,
    thirdPartyFxQuery: options.third_party_fx_query,
    evidenceRoot: options.evidence_root,
  });
  if (mode === "execute" && !options.full_report) console.log(JSON.stringify(compactExecutionEnvelope(report)));
  else console.log(JSON.stringify(report, null, 2));
  if (mode === "execute" && report.ok !== true) process.exitCode = 1;
} catch (error) {
  if (error instanceof CliUsageError) {
    console.log(JSON.stringify(compactErrorEnvelope(error, 2)));
    process.exit(2);
  }
  console.log(JSON.stringify(compactErrorEnvelope(error, 1)));
  process.exit(1);
}

function parseArgs(argv) {
  const result = {
    all: false,
    describe: false,
    dry_run: false,
    help: false,
    media_roots: [],
    media_assets: [],
    full_report: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") {
      result.all = true;
      continue;
    }
    if (argument === "--describe") {
      result.describe = true;
      continue;
    }
    if (argument === "--dry-run") {
      result.dry_run = true;
      continue;
    }
    if (argument === "--full-report") {
      result.full_report = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new CliUsageError(`Unexpected positional argument: ${argument}`);

    const equalsAt = argument.indexOf("=");
    const key = argument.slice(2, equalsAt === -1 ? undefined : equalsAt);
    const value = equalsAt === -1 ? argv[++index] : argument.slice(equalsAt + 1);
    if (value === undefined || value === "" || value.startsWith("--")) throw new CliUsageError(`Flag --${key} needs a value.`);

    if (key === "media-root" || key === "media-asset") {
      assertAbsolutePath(value, `--${key}`);
      result[key === "media-root" ? "media_roots" : "media_assets"].push(path.resolve(value));
      continue;
    }

    const property = {
      scenario: "scenario",
      "installed-wrapper": "installed_wrapper",
      "source-project": "source_project",
      "evidence-project": "evidence_project",
      "evidence-root": "evidence_root",
      "managed-render-root": "managed_render_root",
      "third-party-fx-query": "third_party_fx_query",
    }[key];
    if (!property) throw new CliUsageError(`Unknown flag --${key}.`);
    if (result[property] !== undefined) throw new CliUsageError(`Flag --${key} may be passed only once.`);
    result[property] = value;
  }

  if (result.help) return result;
  if (result.describe && result.dry_run) throw new CliUsageError("Choose only one of --describe or --dry-run.");
  if (result.all === Boolean(result.scenario)) throw new CliUsageError("Choose exactly one of --scenario <name> or --all.");
  if (result.scenario && !SCENARIOS.includes(result.scenario)) {
    throw new CliUsageError(`--scenario must be one of: ${SCENARIOS.join(", ")}.`);
  }
  return result;
}

function validateExecutionOptions(options) {
  for (const [property, flag] of [
    ["installed_wrapper", "--installed-wrapper"],
    ["source_project", "--source-project"],
    ["evidence_project", "--evidence-project"],
    ["evidence_root", "--evidence-root"],
    ["managed_render_root", "--managed-render-root"],
  ]) {
    if (!options[property]) throw new CliUsageError(`Actual execution requires ${flag} <absolute-path>.`);
    assertAbsolutePath(options[property], flag);
    options[property] = path.resolve(options[property]);
  }
}

function assertAbsolutePath(value, label) {
  if (!path.isAbsolute(value)) throw new CliUsageError(`${label} must be an absolute path.`);
}

function printHelp() {
  console.log(`Usage:
  trial-alpha3-3-production.mjs --scenario large-production|editing-sfx|mixing-delivery --describe
  trial-alpha3-3-production.mjs --all --dry-run
  trial-alpha3-3-production.mjs --scenario <name> --installed-wrapper <absolute-path> \\
    --source-project <absolute-.RPP-path> --evidence-project <absolute-.RPP-path> \\
    --evidence-root <fresh-absolute-directory> --managed-render-root <absolute-directory> [--media-root <absolute-directory>] \\
    [--media-asset <absolute-file>] [--third-party-fx-query <exact-query>]

Modes:
  --describe   Print the immutable manifests; never connect or claim success.
  --dry-run    Print the execution plan; never connect or claim success.
  execute      Default when neither planning flag is present.`);
}

function compactExecutionEnvelope(report) {
  return {
    contract: "openreaper.alpha3.4.trial_execution_envelope.v1",
    type: "alpha3.4_trial_execution",
    ok: report?.ok === true,
    status: report?.status ?? "failed",
    summary_path: report?.evidence?.summary_path ?? null,
    events_path: report?.evidence?.events_path ?? null,
    error: report?.error ?? report?.evidence_error ?? null,
    recovery_posture: report?.backup_recovery_posture ?? null,
  };
}

function compactErrorEnvelope(error, exitCode) {
  return {
    contract: "openreaper.alpha3.4.trial_execution_envelope.v1",
    type: "alpha3.4_trial_execution",
    ok: false,
    status: "cli_invalid",
    summary_path: null,
    events_path: null,
    error: {
      code: error?.code ?? "TRIAL_CLI_ERROR",
      message: String(error?.message ?? error).replace(/[\r\n\t]+/gu, " ").slice(0, 512),
      exit_code: exitCode,
    },
    recovery_posture: null,
  };
}
