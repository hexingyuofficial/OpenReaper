#!/usr/bin/env node
import { HarnessEvidenceError, serializeError, viewEvidence } from "./lib/alpha3-4-harness-evidence-v1.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await viewEvidence(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const code = error instanceof HarnessEvidenceError ? error.code : "EVIDENCE_VIEWER_ERROR";
  process.stdout.write(`${JSON.stringify({
    contract: "openreaper.alpha3.4.harness_view.v1",
    type: "alpha3.4_harness_view",
    ok: false,
    error: { code, ...serializeError(error) },
  })}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const result = { evidenceRoot: null, section: "events", status: null, step: null, cursor: null, limit: 20 };
  const seen = new Set();
  const names = new Map([
    ["--evidence-root", "evidenceRoot"],
    ["--section", "section"],
    ["--status", "status"],
    ["--step", "step"],
    ["--cursor", "cursor"],
    ["--limit", "limit"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    if (!names.has(flag)) throw new HarnessEvidenceError("EVIDENCE_VIEWER_ARGUMENT_UNKNOWN", "Unknown evidence viewer option.", { option: argument });
    const key = names.get(flag);
    if (seen.has(key)) throw new HarnessEvidenceError("EVIDENCE_VIEWER_ARGUMENT_DUPLICATE", "Evidence viewer option was supplied more than once.", { option: flag });
    seen.add(key);
    const value = separator === -1 ? args[++index] : argument.slice(separator + 1);
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) throw new HarnessEvidenceError("EVIDENCE_VIEWER_ARGUMENT_VALUE_MISSING", "Evidence viewer option requires a value.", { option: flag });
    if (key === "limit") {
      if (!/^\d+$/u.test(value)) throw new HarnessEvidenceError("EVIDENCE_LIMIT_INVALID", "limit must be an integer between 1 and 100.", { limit: value });
      result.limit = Number(value);
    } else result[key] = value;
  }
  if (!result.evidenceRoot) throw new HarnessEvidenceError("EVIDENCE_ROOT_REQUIRED", "--evidence-root is required.");
  return result;
}
