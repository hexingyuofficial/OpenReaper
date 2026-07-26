import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createHiddenCorpus } from "../corpus/corpus.mjs";
import { runAlpha4EExperiment } from "./alpha4-e-experiment-driver.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_FIXTURE = path.join(HERE, "fixtures", "alpha4-e-mcp-stdio-fixture.mjs");
const AGENT_FIXTURE = path.join(HERE, "fixtures", "alpha4-e-agent-stdio-fixture.mjs");

test("runs the full 30-trial Demonstrator/Learner stdio fixtures against the hidden corpus holdout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-e-stdio-"));
  const corpus = createHiddenCorpus();
  try {
    const report = await runAlpha4EExperiment({
      evidenceRoot: root,
      corpus,
      mcpCommand: process.execPath,
      mcpArgs: [MCP_FIXTURE],
      demonstratorCommand: process.execPath,
      demonstratorArgs: [AGENT_FIXTURE],
      learnerCommand: process.execPath,
      learnerArgs: [AGENT_FIXTURE],
      timeoutMs: 10_000,
    });
    assert.equal(report.status, "completed", JSON.stringify(report, null, 2));
    assert.equal(report.ok, true, JSON.stringify(report.score, null, 2));
    assert.equal(report.trials.length, 30);
    assert.equal(report.score.corpus_holdout.passed, true, JSON.stringify(report.score.corpus_holdout, null, 2));
    assert.equal(report.score.corpus_score.all_gates_passed, true, JSON.stringify(report.score.corpus_score.gates, null, 2));
    assert.equal(report.trials.every((trial) => trial.demonstrator.submission.verified === true), true);
    assert.equal(report.score.trials.every((trial) => trial.corpus?.passed === true), true);
    assert.equal(report.trials.every((trial) => trial.demonstrator.trace.some((event) => event.request?.tool === "call_recipe")), true);
    assert.equal(report.trials.every((trial) => trial.learner.reconnects.length === 1), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
