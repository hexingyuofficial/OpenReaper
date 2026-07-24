import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { createHiddenCorpus, projectLearnerInput } from "../corpus/corpus.mjs";
import { scoreCorpus } from "../corpus/scorer.mjs";

export const PAIRED_AGENT_EXPERIMENT_CONTRACT = "alpha4.shard-e.paired-agent-experiment.v1";
export const REQUIRED_MCP_TOOLS = Object.freeze([
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
  "call_recipe",
]);

function blocker(code, message, details = {}) {
  return { code, message, details };
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertSourceBlindLearnerInput(value) {
  const text = JSON.stringify(value);
  const forbidden = ["teacher_prompt", "transcript", "calls", "evidence", "manifest", "hidden", "source:alpha4-shard-e"];
  const leaked = forbidden.filter((key) => text.includes(key));
  if (leaked.length > 0) throw Object.assign(new Error("Learner input leaked hidden Demonstrator truth."), {
    code: "SOURCE_BLINDNESS_VIOLATION",
    details: { leaked },
  });
  if (value?.capture?.source_blind !== true) throw Object.assign(new Error("Learner input is not marked source-blind."), {
    code: "SOURCE_BLINDNESS_VIOLATION",
    details: { reason: "capture.source_blind" },
  });
}

export function assessRuntimeReadiness({ installedWrapper = null, mcpTools = null, bridge = null } = {}) {
  const blockers = [];
  if (typeof installedWrapper !== "string" || !path.isAbsolute(installedWrapper)) {
    blockers.push(blocker("INSTALLED_WRAPPER_REQUIRED", "A real paired-Agent run requires an absolute installed OpenReaper MCP wrapper."));
  }
  if (!Array.isArray(mcpTools)) {
    blockers.push(blocker("MCP_TOOL_DISCOVERY_REQUIRED", "The installed MCP tool surface must be discovered before live trials."));
  } else {
    const missing = REQUIRED_MCP_TOOLS.filter((tool) => !mcpTools.includes(tool));
    if (missing.length > 0) blockers.push(blocker("MCP_LEARNING_LIFECYCLE_UNAVAILABLE", "The installed MCP surface cannot prove immutable save/list/get and one-call Recipe replay.", { missing_tools: missing }));
  }
  if (!isObject(bridge) || bridge.ready !== true) {
    blockers.push(blocker("LIVE_BRIDGE_NOT_READY", "A matching live Bridge identity is required for real REAPER trials.", { bridge: bridge ?? null }));
  }
  return { ready: blockers.length === 0, blockers };
}

async function runCommand({ command, input, timeoutMs }) {
  if (typeof command !== "string" || command.trim() === "") {
    throw Object.assign(new Error("Learner command is required."), { code: "LEARNER_COMMAND_REQUIRED" });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error("Learner command exceeded the bounded trial timeout."), { code: "LEARNER_TIMEOUT", details: { timeout_ms: timeoutMs } }));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(Object.assign(new Error("Learner command failed."), { code: "LEARNER_COMMAND_FAILED", details: { exit_code: code, stderr: stderr.slice(0, 4096) } }));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(Object.assign(new Error("Learner command must return one JSON submission on stdout."), { code: "LEARNER_OUTPUT_INVALID", details: { stdout_bytes: Buffer.byteLength(stdout), stderr: stderr.slice(0, 4096) } }));
      }
    });
    child.stdin.end(stableJson(input));
  });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, stableJson(value), "utf8");
}

export async function runPairedAgentExperiment({
  learnerCommand = null,
  evidenceRoot = null,
  corpus = createHiddenCorpus(),
  runtime = {},
  timeoutMs = 120_000,
  demonstrator = null,
  learner = null,
} = {}) {
  const root = evidenceRoot ?? await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-"));
  await mkdir(root, { recursive: true });
  const readiness = assessRuntimeReadiness(runtime);
  const report = {
    contract: PAIRED_AGENT_EXPERIMENT_CONTRACT,
    status: readiness.ready ? "running" : "blocked",
    ok: false,
    trial_count: corpus.trials.length,
    operation_counts: Object.fromEntries([5, 10, 20].map((size) => [size, corpus.trials.filter((trial) => trial.demonstration_size === size).length])),
    runtime: { installed_wrapper: runtime.installedWrapper ?? null, mcp_tools: runtime.mcpTools ?? null, bridge: runtime.bridge ?? null },
    blockers: readiness.blockers,
    evidence_root: root,
    source_blindness: { learner_artifacts_contain_hidden_truth: false },
    score: null,
  };
  await writeJson(path.join(root, "report.json"), report);
  if (!readiness.ready) return report;

  const submissions = new Map();
  for (const trial of corpus.trials) {
    if (typeof demonstrator !== "function") {
      report.status = "blocked";
      report.blockers.push(blocker("DEMONSTRATOR_VERIFIER_REQUIRED", "A real paired-Agent trial requires an isolated Demonstrator verifier before the Learner runs."));
      await writeJson(path.join(root, "report.json"), report);
      return report;
    }
    let demonstration;
    try {
      // The Demonstrator is the sole recipient of hidden task truth.
      demonstration = await demonstrator(trial.hidden, { trial_id: trial.trial_id, timeout_ms: timeoutMs });
    } catch (error) {
      report.status = "failed";
      report.blockers.push(blocker(error.code ?? "DEMONSTRATOR_EXECUTION_FAILED", error.message, error.details ?? {}));
      await writeJson(path.join(root, "report.json"), report);
      return report;
    }
    if (demonstration?.verified !== true) {
      report.status = "failed";
      report.blockers.push(blocker("DEMONSTRATION_NOT_VERIFIED", "The Demonstrator did not verify its hidden operation sequence; the Learner is not scored.", { trial_id: trial.trial_id }));
      await writeJson(path.join(root, "report.json"), report);
      return report;
    }
    const learnerInput = projectLearnerInput(trial);
    assertSourceBlindLearnerInput(learnerInput);
    const trialRoot = path.join(root, "learner", trial.trial_id);
    await mkdir(trialRoot, { recursive: true });
    await writeJson(path.join(trialRoot, "input.json"), learnerInput);
    try {
      const submission = learner
        ? await learner(learnerInput, { trial_id: trial.trial_id, timeout_ms: timeoutMs })
        : await runCommand({ command: learnerCommand, input: learnerInput, timeoutMs });
      submissions.set(trial.trial_id, submission);
      await writeJson(path.join(trialRoot, "submission.json"), submission);
    } catch (error) {
      report.status = "failed";
      report.blockers.push(blocker(error.code ?? "LEARNER_EXECUTION_FAILED", error.message, error.details ?? {}));
      await writeJson(path.join(root, "report.json"), report);
      return report;
    }
  }
  report.score = scoreCorpus(corpus, submissions);
  report.status = report.score.all_gates_passed ? "completed" : "failed_score_gate";
  report.ok = report.score.all_gates_passed;
  await writeJson(path.join(root, "report.json"), report);
  return report;
}

export async function readExperimentReport(evidenceRoot) {
  return JSON.parse(await readFile(path.join(evidenceRoot, "report.json"), "utf8"));
}
