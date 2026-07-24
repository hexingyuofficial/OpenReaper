import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHiddenCorpus, projectLearnerInput } from "../corpus/corpus.mjs";
import { makeOraclePerfectSubmission } from "../corpus/oracle.mjs";
import {
  REQUIRED_MCP_TOOLS,
  assertSourceBlindLearnerInput,
  assessRuntimeReadiness,
  runPairedAgentExperiment,
} from "./paired-agent-runner.mjs";

test("source-blind paired runner locks thirty 5/10/20-operation learner trials and scores them through the holdout scorer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-runner-"));
  const corpus = createHiddenCorpus();
  try {
    const report = await runPairedAgentExperiment({
      evidenceRoot: root,
      corpus,
      runtime: { installedWrapper: "/tmp/openreaper-mcp", mcpTools: REQUIRED_MCP_TOOLS, bridge: { ready: true, owner: "test", generation: 1 } },
      demonstrator: async () => ({ verified: true }),
      learner: async (input) => makeOraclePerfectSubmission(corpus.trials.find((trial) => trial.trial_id === input.trial_id)),
    });
    assert.equal(report.ok, true, JSON.stringify(report.score?.gates));
    assert.deepEqual(report.operation_counts, { 5: 10, 10: 10, 20: 10 });
    assert.equal(report.score.trial_count, 30);
    const learnerInput = await readFile(path.join(root, "learner", corpus.trials[0].trial_id, "input.json"), "utf8");
    for (const forbidden of ["teacher_prompt", "transcript", "source:alpha4-shard-e", "hidden"]) assert.equal(learnerInput.includes(forbidden), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed with typed blockers when the installed Recipe lifecycle or matching live Bridge is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-blocked-"));
  try {
    const readiness = assessRuntimeReadiness({ installedWrapper: "/tmp/openreaper-mcp", mcpTools: REQUIRED_MCP_TOOLS.filter((tool) => tool !== "call_recipe"), bridge: { ready: false } });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.map((entry) => entry.code), ["MCP_LEARNING_LIFECYCLE_UNAVAILABLE", "LIVE_BRIDGE_NOT_READY"]);
    const report = await runPairedAgentExperiment({ evidenceRoot: root, runtime: { installedWrapper: "/tmp/openreaper-mcp", mcpTools: ["ping"], bridge: null } });
    assert.equal(report.status, "blocked");
    assert.equal(report.ok, false);
    assert.equal(report.blockers.some((entry) => entry.code === "MCP_LEARNING_LIFECYCLE_UNAVAILABLE"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects source leakage before any Learner command is invoked", () => {
  const input = structuredClone(projectLearnerInput(createHiddenCorpus().trials[0]));
  input.capture.note = "teacher_prompt";
  assert.throws(() => assertSourceBlindLearnerInput(input), { code: "SOURCE_BLINDNESS_VIOLATION" });
});

test("does not score a Learner when an independent Demonstrator verifier is missing or unverified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-demonstrator-"));
  try {
    const runtime = { installedWrapper: "/tmp/openreaper-mcp", mcpTools: REQUIRED_MCP_TOOLS, bridge: { ready: true } };
    const missing = await runPairedAgentExperiment({ evidenceRoot: path.join(root, "missing"), runtime });
    assert.equal(missing.blockers.at(-1).code, "DEMONSTRATOR_VERIFIER_REQUIRED");
    const unverified = await runPairedAgentExperiment({ evidenceRoot: path.join(root, "unverified"), runtime, demonstrator: async () => ({ verified: false }) });
    assert.equal(unverified.blockers.at(-1).code, "DEMONSTRATION_NOT_VERIFIED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
