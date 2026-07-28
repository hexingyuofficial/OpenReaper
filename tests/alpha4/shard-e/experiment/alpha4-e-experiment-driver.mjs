import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createHiddenCorpus, projectLearnerInput } from "../corpus/corpus.mjs";
import { assertSourceBlindLearnerInput } from "./paired-agent-runner.mjs";
import {
  deriveObservedLifecycleEvidence,
  scoreAlpha4EReport,
} from "./alpha4-e-experiment-scorer.mjs";

export const ALPHA4_E_EXPERIMENT_CONTRACT = "alpha4.shard-e.dual-agent-experiment.v1";
export const ALPHA4_E_AGENT_PROTOCOL = "alpha4.shard-e.agent-broker.v1";
export const MCP_STDIO_TRANSPORT = "mcp-stdio";
export const AGENT_ROLES = Object.freeze(["demonstrator", "learner"]);
const REAL_MCP_LIFECYCLE_KIND = "sdk-stdio-real";

function blocker(code, message, details = {}) {
  return { code, message, details };
}

function errorBlocker(error, fallbackCode) {
  return blocker(error?.code ?? fallbackCode, error?.message ?? "Alpha4 E experiment failed.", error?.details ?? {});
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function hashJson(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function protocolError(message, details = {}) {
  return Object.assign(new Error(message), { code: "AGENT_PROTOCOL_INVALID", details });
}

function validateAgentCommand(command, role) {
  if (typeof command !== "string" || !path.isAbsolute(command) || command.trim() === "") {
    return blocker(`${role.toUpperCase()}_COMMAND_REQUIRED`, `A real ${role} requires an absolute executable command.`, { role });
  }
  return null;
}

async function ensureFreshEvidenceRoot(evidenceRoot) {
  const root = evidenceRoot ?? path.join(os.tmpdir(), `openreaper-alpha4-e-live-${process.pid}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root);
  if (entries.length > 0) {
    throw Object.assign(new Error("Evidence root must be fresh; refusing to overwrite existing evidence."), {
      code: "EVIDENCE_ROOT_NOT_FRESH",
      details: { evidence_root: root, entries },
    });
  }
  return root;
}

function rejectStaticHarness(options) {
  const callbackFields = ["demonstrator", "learner", "submission", "staticHarness", "static_harness"];
  const present = callbackFields.filter((field) => typeof options?.[field] === "function" || options?.[field] === true);
  if (present.length > 0) {
    return blocker(
      "STATIC_CALLBACK_HARNESS_FORBIDDEN",
      "Static callback harnesses cannot produce Alpha4 E evidence; Agents must run as isolated processes through the MCP broker.",
      { fields: present, protocol: ALPHA4_E_AGENT_PROTOCOL },
    );
  }
  return null;
}

function validateMcpLifecycle(lifecycle, { allowTestLifecycle = false } = {}) {
  if (!isObject(lifecycle) || lifecycle.transport !== MCP_STDIO_TRANSPORT || typeof lifecycle.start !== "function") {
    return blocker(
      "MCP_STDIO_LIFECYCLE_REQUIRED",
      "A real Alpha4 E run requires an injectable MCP stdio lifecycle with start().",
      { required_transport: MCP_STDIO_TRANSPORT },
    );
  }
  if (lifecycle.static === true || lifecycle.kind === "static-callback") {
    return blocker(
      "STATIC_CALLBACK_HARNESS_FORBIDDEN",
      "Static MCP callback lifecycles are not admissible evidence.",
      { transport: lifecycle.transport, kind: lifecycle.kind ?? null },
    );
  }
  if (lifecycle.test_only === true) {
    if (allowTestLifecycle) return null;
    return blocker(
      "MCP_LIVE_LIFECYCLE_REQUIRED",
      "Injected MCP lifecycles are test-only; live evidence must use the driver-owned SDK stdio lifecycle.",
      { kind: lifecycle.kind ?? null },
    );
  }
  if (lifecycle.source !== "sdk-stdio-client" || lifecycle.kind !== REAL_MCP_LIFECYCLE_KIND || lifecycle.admissible !== true) {
    return blocker(
      "MCP_LIVE_LIFECYCLE_REQUIRED",
      "Live evidence requires the driver-owned SDK stdio lifecycle and cannot trust an arbitrary injected callback.",
      { source: lifecycle.source ?? null, kind: lifecycle.kind ?? null, admissible: lifecycle.admissible === true },
    );
  }
  return null;
}

/**
 * Real wrapper lifecycle used by live Alpha4 E runs. Tests may inject the same
 * start/close/call boundary, but the scorer only accepts broker-observed traces.
 */
export function createMcpStdioLifecycle({ command, args = [], cwd = process.cwd(), env = process.env, clientName = "openreaper-alpha4-e" } = {}) {
  const commandBlocker = validateAgentCommand(command, "mcp");
  if (commandBlocker) throw Object.assign(new Error(commandBlocker.message), { code: commandBlocker.code, details: commandBlocker.details });
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw Object.assign(new Error("MCP stdio args must be an array of strings."), { code: "MCP_STDIO_ARGS_INVALID" });
  }
  return Object.freeze({
    transport: MCP_STDIO_TRANSPORT,
    source: "sdk-stdio-client",
    kind: REAL_MCP_LIFECYCLE_KIND,
    admissible: true,
    async start({ role, workdir, reconnect_index = 0 } = {}) {
      const client = new Client({ name: `${clientName}-${role}-${reconnect_index}`, version: "0.0.0" });
      const transport = new StdioClientTransport({
        command,
        args,
        cwd: workdir ?? cwd,
        env: { ...env, OPENREAPER_ALPHA4_E_ROLE: role ?? "unknown" },
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      await client.connect(transport);
      const server = typeof client.getServerVersion === "function" ? client.getServerVersion() : null;
      return {
        transport: MCP_STDIO_TRANSPORT,
        identity: { role, reconnect_index, server: server ?? null },
        async call(tool, arguments_) {
          return client.callTool({ name: tool, arguments: arguments_ ?? {} });
        },
        async close() {
          await client.close();
        },
        stderr: () => stderr.slice(0, 4096),
      };
    },
  });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, stableJson(value), "utf8");
}

async function runAgentProcess({ role, command, args, input, workdir, evidenceRoot, lifecycle, timeoutMs }) {
  const inputPath = path.join(workdir, "input.json");
  await writeJson(inputPath, input);
  const trace = [];
  const reconnects = [];
  let reconnectIndex = 0;
  let session = await lifecycle.start({ role, workdir, evidenceRoot, reconnect_index: reconnectIndex });
  if (!isObject(session) || session.transport !== MCP_STDIO_TRANSPORT || typeof session.call !== "function") {
    throw Object.assign(new Error("MCP stdio lifecycle returned an invalid session."), { code: "MCP_STDIO_SESSION_INVALID" });
  }
  const firstIdentity = clone(session.identity);
  const child = spawn(command, args, {
    cwd: workdir,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENREAPER_ALPHA4_E_ROLE: role,
      OPENREAPER_ALPHA4_E_PROTOCOL: ALPHA4_E_AGENT_PROTOCOL,
      OPENREAPER_ALPHA4_E_INPUT_FILE: inputPath,
      OPENREAPER_ALPHA4_E_WORKDIR: workdir,
      OPENREAPER_ALPHA4_E_EVIDENCE_ROOT: evidenceRoot,
    },
  });
  let stderr = "";
  let transportFailure = null;
  const recordTransportFailure = (error) => {
    if (transportFailure) return;
    transportFailure = Object.assign(new Error("Agent stdio write failed."), {
      code: "AGENT_STDIO_WRITE_FAILED",
      details: { role, cause_code: error?.code ?? null },
    });
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", recordTransportFailure);
  const exitPromise = new Promise((resolve) => child.once("close", resolve));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const send = (value) => {
    try {
      if (child.stdin.destroyed || !child.stdin.writable) {
        recordTransportFailure(Object.assign(new Error("Agent stdin is closed."), { code: "EPIPE" }));
        return;
      }
      child.stdin.write(stableJson(value), (error) => {
        if (error) recordTransportFailure(error);
      });
    } catch (error) {
      recordTransportFailure(error);
    }
  };
  send({ type: "init", contract: ALPHA4_E_AGENT_PROTOCOL, role, input });
  let submission = null;
  let protocolFailure = null;
  let sequence = 0;
  let hardTimer = null;

  const timer = setTimeout(() => {
    protocolFailure = Object.assign(new Error("Agent exceeded the bounded protocol timeout."), {
      code: "AGENT_TIMEOUT",
      details: { role, timeout_ms: timeoutMs },
    });
    child.kill("SIGTERM");
    hardTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
  }, timeoutMs);

  try {
    for await (const line of lines) {
      if (protocolFailure) break;
      let message;
      try { message = JSON.parse(line); } catch { throw protocolError("Agent stdout must contain one JSON object per line.", { role }); }
      if (!isObject(message) || typeof message.type !== "string") throw protocolError("Agent protocol message must be an object with type.", { role });
      if (message.type === "call") {
        if (typeof message.id !== "string" || typeof message.tool !== "string" || !isObject(message.arguments)) {
          throw protocolError("Agent call requires string id/tool and object arguments.", { role, message });
        }
        const request = { tool: message.tool, arguments: clone(message.arguments) };
        const response = await session.call(message.tool, message.arguments);
        trace.push({ seq: ++sequence, type: "call", source: "mcp_lifecycle", transport: MCP_STDIO_TRANSPORT, role, identity: clone(session.identity), request, response: clone(response) });
        send({ type: "call_result", id: message.id, result: response });
        continue;
      }
      if (message.type === "reconnect") {
        if (typeof message.id !== "string") throw protocolError("Agent reconnect requires a string id.", { role });
        const before = clone(session.identity);
        await session.close?.();
        reconnectIndex += 1;
        session = await lifecycle.start({ role, workdir, evidenceRoot, reconnect: true, reconnect_index: reconnectIndex });
        if (!isObject(session) || session.transport !== MCP_STDIO_TRANSPORT || typeof session.call !== "function") {
          throw Object.assign(new Error("MCP stdio lifecycle returned an invalid reconnect session."), { code: "MCP_STDIO_SESSION_INVALID" });
        }
        const after = clone(session.identity);
        const reconnect = { seq: ++sequence, type: "reconnect", source: "mcp_lifecycle", transport: MCP_STDIO_TRANSPORT, role, before, after };
        reconnects.push(reconnect);
        trace.push(reconnect);
        send({ type: "reconnect_result", id: message.id, identity: after });
        continue;
      }
      if (message.type === "result") {
        if (!isObject(message.submission)) throw protocolError("Agent result requires a submission object.", { role });
        if (message.static_harness === true || message.harness === "static-callback") {
          throw Object.assign(new Error("Static callback evidence is forbidden."), { code: "STATIC_CALLBACK_HARNESS_FORBIDDEN", details: { role } });
        }
        submission = clone(message.submission);
        break;
      }
      throw protocolError("Unknown Agent protocol message type.", { role, type: message.type });
    }
  } finally {
    clearTimeout(timer);
    if (hardTimer) clearTimeout(hardTimer);
    lines.close();
    try { await session.close?.(); } catch {}
    try { child.stdin.end(); } catch (error) { recordTransportFailure(error); }
  }

  const exitCode = await exitPromise;
  if (protocolFailure) throw protocolFailure;
  if (transportFailure) throw transportFailure;
  if (submission === null) throw protocolError("Agent exited without a result submission.", { role, exit_code: exitCode });
  if (exitCode !== 0) throw Object.assign(new Error("Agent process failed."), { code: "AGENT_PROCESS_FAILED", details: { role, exit_code: exitCode, stderr: stderr.slice(0, 4096) } });
  const agentEvidence = {
    role,
    pid: child.pid,
    workdir,
    evidence_root: evidenceRoot,
    input_sha256: hashJson(input),
    input_path: inputPath,
    transport: MCP_STDIO_TRANSPORT,
    mcp_trace_source: "driver_observed_lifecycle",
    lifecycle_admissible: lifecycle.admissible === true && lifecycle.test_only !== true,
    first_identity: firstIdentity,
    reconnects,
    trace,
    submission,
    stderr: stderr.slice(0, 4096),
  };
  return {
    ...agentEvidence,
    observed_lifecycle: deriveObservedLifecycleEvidence(agentEvidence),
  };
}

export async function runAlpha4EExperiment({
  demonstratorCommand = null,
  demonstratorArgs = [],
  learnerCommand = null,
  learnerArgs = [],
  mcpLifecycle = null,
  mcpCommand = null,
    mcpArgs = [],
  allowTestLifecycle = false,
  evidenceRoot = null,
  corpus = createHiddenCorpus(),
  timeoutMs = 120_000,
  environment = {},
  demonstrator = null,
  learner = null,
  staticHarness = false,
} = {}) {
  const root = evidenceRoot ?? path.join(os.tmpdir(), `openreaper-alpha4-e-live-${process.pid}-${Date.now()}`);
  const report = {
    contract: ALPHA4_E_EXPERIMENT_CONTRACT,
    protocol: ALPHA4_E_AGENT_PROTOCOL,
    status: "blocked",
    ok: false,
    evidence_root: root,
    execution_mode: "process_brokered_mcp_stdio",
    evidence_class: "blocked",
    blockers: [],
    trials: [],
    isolation: { verified: false, workdirs: [], input_hashes: [] },
    score: null,
  };
  let writableRoot = null;
  try {
    const rootReady = await ensureFreshEvidenceRoot(root);
    writableRoot = rootReady;
    const staticBlocker = rejectStaticHarness({ ...environment, demonstrator, learner, staticHarness });
    const blockers = [
      staticBlocker,
      validateAgentCommand(demonstratorCommand, "demonstrator"),
      validateAgentCommand(learnerCommand, "learner"),
    ].filter(Boolean);
    let lifecycle = mcpLifecycle;
    if (!lifecycle && mcpCommand) lifecycle = createMcpStdioLifecycle({ command: mcpCommand, args: mcpArgs });
    const lifecycleBlocker = validateMcpLifecycle(lifecycle, { allowTestLifecycle });
    if (lifecycleBlocker) blockers.push(lifecycleBlocker);
    if (blockers.length > 0) {
      report.blockers = blockers;
      await writeJson(path.join(rootReady, "report.json"), report);
      return report;
    }
    report.evidence_class = lifecycle.test_only === true ? "synthetic_test_only" : "live";
    report.status = "running";
    await writeJson(path.join(rootReady, "report.json"), report);
    for (const trial of corpus.trials) {
      const trialRoot = path.join(rootReady, "trials", trial.trial_id);
      const demonstratorRoot = path.join(trialRoot, "demonstrator");
      const learnerRoot = path.join(trialRoot, "learner");
      await mkdir(demonstratorRoot, { recursive: true });
      await mkdir(learnerRoot, { recursive: true });
      const demonstratorInput = clone(trial.hidden);
      const learnerInput = projectLearnerInput(trial);
      assertSourceBlindLearnerInput(learnerInput);
      const demonstrator = await runAgentProcess({ role: "demonstrator", command: demonstratorCommand, args: demonstratorArgs, input: demonstratorInput, workdir: demonstratorRoot, evidenceRoot: demonstratorRoot, lifecycle, timeoutMs });
      if (demonstrator.submission.verified !== true) {
        throw Object.assign(new Error("Demonstrator did not return verified hidden-operation evidence."), { code: "DEMONSTRATOR_NOT_VERIFIED", details: { trial_id: trial.trial_id } });
      }
      const learner = await runAgentProcess({ role: "learner", command: learnerCommand, args: learnerArgs, input: learnerInput, workdir: learnerRoot, evidenceRoot: learnerRoot, lifecycle, timeoutMs });
      const trialReport = { trial_id: trial.trial_id, demonstration_size: trial.demonstration_size, scenario_id: trial.scenario_id, demonstrator, learner };
      report.trials.push(trialReport);
      report.isolation.workdirs.push(demonstrator.workdir, learner.workdir);
      report.isolation.input_hashes.push(demonstrator.input_sha256, learner.input_sha256);
      await writeJson(path.join(trialRoot, "trace.json"), { contract: ALPHA4_E_EXPERIMENT_CONTRACT, trial_id: trial.trial_id, demonstrator: demonstrator.trace, learner: learner.trace });
      await writeJson(path.join(rootReady, "report.json"), report);
    }
    report.isolation.verified = report.trials.every((trial) => trial.demonstrator.workdir !== trial.learner.workdir && trial.demonstrator.input_sha256 !== trial.learner.input_sha256);
    report.score = scoreAlpha4EReport(report, corpus);
    report.ok = report.evidence_class === "live" && report.score.all_gates_passed;
    report.status = report.ok
      ? "completed"
      : report.evidence_class === "synthetic_test_only" ? "test_only_completed" : "failed_score_gate";
  } catch (error) {
    report.status = "blocked";
    report.blockers.push(errorBlocker(error, "ALPHA4_E_DRIVER_FAILED"));
  }
  if (writableRoot) await writeJson(path.join(writableRoot, "report.json"), report);
  return report;
}
