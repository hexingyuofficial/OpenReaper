import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHiddenCorpus } from "../corpus/corpus.mjs";
import {
  ALPHA4_E_AGENT_PROTOCOL,
  MCP_STDIO_TRANSPORT,
  runAlpha4EExperiment,
} from "./alpha4-e-experiment-driver.mjs";
import { scoreAgentEvidence, scoreAlpha4EReport } from "./alpha4-e-experiment-scorer.mjs";

const AGENT_SOURCE = `
const readline = require("node:readline");
const out = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false;
let reconnected = false;
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "init") {
    initialized = true;
    out({ type: "call", id: "ping", tool: "ping", arguments: {} });
    out({ type: "call", id: "state", tool: "get_state", arguments: { scope: "project" } });
    out({ type: "call", id: "run-1", tool: "call_recipe", arguments: { operation: "run", recipe_id: "recipe.alpha4.e", version: "1.0.0", revision: 1, content_hash: "a".repeat(64), validation_result_id: "validation.alpha4.e" } });
    out({ type: "call", id: "run-2", tool: "call_recipe", arguments: { operation: "run", recipe_id: "recipe.alpha4.e", version: "1.0.0", revision: 1, content_hash: "a".repeat(64), validation_result_id: "validation.alpha4.e" } });
    out({ type: "reconnect", id: "reconnect" });
  } else if (message.type === "reconnect_result") {
    reconnected = true;
    out({ type: "call", id: "ping-after", tool: "ping", arguments: {} });
    out({ type: "result", submission: { verified: true, proofs: { readback: { passed: true }, whole_recipe_undo: { scope: "whole_recipe", begin_proof: true, close_proof: true, closed: true }, reconnect_identity: { matched: true }, call_recipe_replay: { same_revision_identity: true } } } });
  }
});
`;

function fakeMcpLifecycle() {
  return {
    transport: MCP_STDIO_TRANSPORT,
    source: "test-only",
    kind: "test-only",
    test_only: true,
    async start({ role, reconnect_index = 0 }) {
      return {
        transport: MCP_STDIO_TRANSPORT,
        identity: { project_ref: "project:test", bridge_owner: "owner:test", bridge_generation: "1", role, reconnect_index },
        async call(tool, arguments_) { return { ok: true, tool, arguments: arguments_ }; },
        async close() {},
      };
    },
  };
}

function command() {
  return { command: process.execPath, args: ["-e", AGENT_SOURCE] };
}

test("runs two isolated Agent processes through a brokered MCP protocol and scores observed proofs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-driver-"));
  const sourceCorpus = createHiddenCorpus();
  const corpus = { ...sourceCorpus, trials: sourceCorpus.trials.slice(0, 1) };
  const agent = command();
  try {
    const report = await runAlpha4EExperiment({
      evidenceRoot: root,
      corpus,
      mcpLifecycle: fakeMcpLifecycle(),
      demonstratorCommand: agent.command,
      demonstratorArgs: agent.args,
      learnerCommand: agent.command,
      learnerArgs: agent.args,
      timeoutMs: 5000,
      allowTestLifecycle: true,
    });
    assert.equal(report.status, "test_only_completed", JSON.stringify(report));
    assert.equal(report.ok, false, JSON.stringify(report.score));
    assert.equal(report.protocol, ALPHA4_E_AGENT_PROTOCOL);
    assert.equal(report.trials[0].demonstrator.trace[0].source, "mcp_lifecycle");
    assert.equal(report.trials[0].learner.reconnects.length, 1);
    assert.notEqual(report.trials[0].demonstrator.evidence_root, report.trials[0].learner.evidence_root);
    assert.equal(report.evidence_class, "synthetic_test_only");
    assert.equal(scoreAlpha4EReport(report).all_gates_passed, false);
    assert.equal(report.score.trials[0].learner.gates.readback.passed, false);
    assert.equal(report.score.trials[0].learner.gates.whole_recipe_undo.passed, false);
    assert.equal(report.score.trials[0].learner.gates.reconnect_identity.passed, true);
    assert.equal(report.score.trials[0].learner.gates.call_recipe_replay.passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not let self-reported lifecycle proofs pass without independently visible responses", () => {
  const result = scoreAgentEvidence({
    transport: "mcp-stdio",
    mcp_trace_source: "driver_observed_lifecycle",
    lifecycle_admissible: true,
    submission: {
      proofs: {
        readback: { passed: true },
        whole_recipe_undo: { scope: "whole_recipe", begin_proof: true, close_proof: true, closed: true },
        reconnect_identity: { matched: true },
        call_recipe_replay: { same_revision_identity: true },
      },
    },
    trace: [
      { source: "mcp_lifecycle", transport: "mcp-stdio", type: "call", request: { tool: "get_state", arguments: {} }, response: { ok: true } },
      { source: "mcp_lifecycle", transport: "mcp-stdio", type: "reconnect", before: {}, after: {} },
    ],
  }, "learner");
  assert.equal(result.passed, false);
  for (const name of ["readback", "whole_recipe_undo", "reconnect_identity", "call_recipe_replay"]) {
    assert.equal(result.gates[name].passed, false, name);
    assert.match(result.gates[name].typed_blocker, /^E_OBSERVED_/u);
  }
});

test("passes lifecycle gates from observed response contracts without learner proofs", () => {
  const identity = { recipe_id: "recipe.alpha4.e", version: "1.0.0", revision: 1, content_hash: "a".repeat(64), validation_result_id: "validation.alpha4.e" };
  const runResponse = {
    contract: "recipe.executable.run.v1", ok: true, operation: "run", status: "succeeded", ...identity,
    verified_outputs: [{ id: "readback", verified: true }],
    execution_truth: { readback_count: 1 },
    undo: { scope: "whole_recipe", status: "closed", proven: true, opened: true, closed: true },
  };
  const trace = [
    { source: "mcp_lifecycle", transport: "mcp-stdio", type: "call", request: { tool: "ping", arguments: {} }, response: { content: [{ type: "text", text: JSON.stringify({ live_bridge: { observed: { owner: "owner", generation: 3 } }, project_index: { project_ref: "project:test", bridge_owner: "owner", bridge_generation: 3 } }) }] } },
    { source: "mcp_lifecycle", transport: "mcp-stdio", type: "call", request: { tool: "call_recipe", arguments: { operation: "run", ...identity } }, response: runResponse },
    { source: "mcp_lifecycle", transport: "mcp-stdio", type: "call", request: { tool: "call_recipe", arguments: { operation: "run", ...identity } }, response: runResponse },
    { source: "mcp_lifecycle", transport: "mcp-stdio", type: "reconnect", before: { role: "learner", reconnect_index: 0 }, after: { role: "learner", reconnect_index: 1 } },
    { source: "mcp_lifecycle", transport: "mcp-stdio", type: "call", request: { tool: "ping", arguments: {} }, response: { content: [{ type: "text", text: JSON.stringify({ live_bridge: { observed: { owner: "owner", generation: 3 } }, project_index: { project_ref: "project:test", bridge_owner: "owner", bridge_generation: 3 } }) }] } },
  ];
  const result = scoreAgentEvidence({
    transport: "mcp-stdio", mcp_trace_source: "driver_observed_lifecycle", lifecycle_admissible: true,
    submission: {}, trace,
  }, "learner");
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.gates.readback.observed.source, "call_recipe.response.execution_truth");
  assert.equal(result.gates.whole_recipe_undo.observed.source, "call_recipe.response.undo");
  assert.equal(result.gates.reconnect_identity.observed.source, "ping.response");
  assert.equal(result.gates.call_recipe_replay.observed.source, "call_recipe.response.identity");
});

test("fails closed for callbacks, missing commands, and missing stdio lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-blockers-"));
  try {
    const callback = await runAlpha4EExperiment({ evidenceRoot: path.join(root, "callback"), demonstrator: () => {}, learner: () => {} });
    assert.equal(callback.status, "blocked");
    assert.equal(callback.blockers[0].code, "STATIC_CALLBACK_HARNESS_FORBIDDEN");

    const missing = await runAlpha4EExperiment({ evidenceRoot: path.join(root, "missing") });
    assert.deepEqual(missing.blockers.map((entry) => entry.code), [
      "DEMONSTRATOR_COMMAND_REQUIRED",
      "LEARNER_COMMAND_REQUIRED",
      "MCP_STDIO_LIFECYCLE_REQUIRED",
    ]);

    const staticAgent = { command: process.execPath, args: ["-e", "process.stdout.write(JSON.stringify({ type: 'result', static_harness: true, submission: { verified: true } }) + '\\n')"] };
    const staticResult = await runAlpha4EExperiment({
      evidenceRoot: path.join(root, "static-result"),
      mcpLifecycle: fakeMcpLifecycle(),
      demonstratorCommand: staticAgent.command,
      demonstratorArgs: staticAgent.args,
      learnerCommand: staticAgent.command,
      learnerArgs: staticAgent.args,
      timeoutMs: 5000,
      allowTestLifecycle: true,
    });
    assert.equal(staticResult.status, "blocked");
    assert.equal(staticResult.blockers.at(-1).code, "STATIC_CALLBACK_HARNESS_FORBIDDEN");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a non-stdio static lifecycle before any Agent process starts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-static-"));
  const agent = command();
  try {
    const report = await runAlpha4EExperiment({
      evidenceRoot: root,
      mcpLifecycle: { transport: "callback", static: true, start: async () => ({}) },
      demonstratorCommand: agent.command,
      demonstratorArgs: agent.args,
      learnerCommand: agent.command,
      learnerArgs: agent.args,
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.blockers[0].code, "MCP_STDIO_LIFECYCLE_REQUIRED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an injected stdio lifecycle as live evidence unless explicitly test-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-injected-"));
  const agent = command();
  try {
    const report = await runAlpha4EExperiment({
      evidenceRoot: root,
      mcpLifecycle: fakeMcpLifecycle(),
      demonstratorCommand: agent.command,
      demonstratorArgs: agent.args,
      learnerCommand: agent.command,
      learnerArgs: agent.args,
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.blockers[0].code, "MCP_LIVE_LIFECYCLE_REQUIRED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
