#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { inspectAlpha34TaskScope } from "./lib/alpha3-4-task-packet-v1.mjs";

const INSPECTION_CONTRACT = "openreaper.alpha3.4.task_scope_inspection.v1";
const MAX_PACKET_BYTES = 1_048_576;

let report;
let exitCode = 1;

try {
  const options = parseArguments(process.argv.slice(2));
  const packetBytes = await readFile(options.packetPath);
  if (packetBytes.length > MAX_PACKET_BYTES) {
    report = failureReport("PACKET_FILE_TOO_LARGE", "Task packet JSON exceeds the 1 MiB input ceiling.", options.repoRoot);
    exitCode = 2;
  } else {
    let packet;
    try {
      packet = JSON.parse(packetBytes.toString("utf8"));
    } catch {
      report = failureReport("PACKET_JSON_INVALID", "Task packet file is not valid JSON.", options.repoRoot);
      exitCode = 2;
    }
    if (packet !== undefined) {
      report = inspectAlpha34TaskScope({ repoRoot: options.repoRoot, packet });
      exitCode = report.ok ? 0 : 1;
    }
  }
} catch (error) {
  report = failureReport(
    error?.code ?? "CLI_INVALID",
    boundedMessage(error?.message ?? String(error)),
    process.cwd(),
  );
  exitCode = 2;
}

process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = exitCode;

function parseArguments(args) {
  let packetPath = null;
  let repoRoot = process.cwd();
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--packet" && option !== "--repo-root") {
      throw cliError("CLI_ARGUMENT_UNKNOWN", `Unknown option: ${boundedMessage(option)}.`);
    }
    if (seen.has(option)) throw cliError("CLI_ARGUMENT_DUPLICATE", `Duplicate option: ${option}.`);
    seen.add(option);
    const value = args[++index];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw cliError("CLI_ARGUMENT_VALUE_MISSING", `${option} requires a value.`);
    }
    if (option === "--packet") packetPath = path.resolve(value);
    else repoRoot = path.resolve(value);
  }
  if (!packetPath) throw cliError("CLI_PACKET_REQUIRED", "Missing required --packet <json-path> option.");
  return { packetPath, repoRoot };
}

function failureReport(code, reason, repoRoot) {
  return {
    contract: INSPECTION_CONTRACT,
    type: "alpha3.4_task_scope_inspection",
    ok: false,
    status: "cli_invalid",
    task_id: null,
    repo_root: path.resolve(repoRoot),
    packet_validation: null,
    head: { expected: null, actual: null, matches: false },
    changed_files: [],
    changed_paths: [],
    violations: [{
      code,
      path: null,
      field: null,
      reason,
      recovery: {
        automatic: false,
        guidance: "Correct the CLI input and run the read-only inspection again.",
        suggested_commands: [],
      },
    }],
    recovery_performed: false,
  };
}

function cliError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedMessage(value) {
  return String(value).replace(/[\r\n\t]+/gu, " ").slice(0, 512);
}
