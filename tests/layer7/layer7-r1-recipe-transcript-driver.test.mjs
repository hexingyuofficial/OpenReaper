import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  TOOL_ABI_V1_TOOL_NAMES,
} from "../../packages/mcp-server/src/tool-abi-v1.mjs";
import {
  LAYER7_R1_ARTIFACT_LABEL,
  LAYER7_R1_ARTIFACT_SCHEMA,
  LAYER7_R1_EXPECTED_STEP_IDS,
  LAYER7_R1_RECIPE_ID,
  LAYER7_R1_TEMPLATE_ID,
  OFFICIAL_LAYER7_R1_RECIPE_FILE,
  assertLayer7R1Recipe,
  loadLayer7R1Recipe,
  runLayer7R1RecipeTranscript,
} from "../../scripts/run-layer7-r1-recipe-transcript.mjs";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DRIVER_SOURCE = path.join(REPO_ROOT, "scripts", "run-layer7-r1-recipe-transcript.mjs");

describe("Layer 7 R1 cleanup recipe transcript driver", () => {
  it("loads only the selected R1 cleanup fingerprint report recipe", async () => {
    const recipe = await loadLayer7R1Recipe();
    assert.equal(recipe.id, LAYER7_R1_RECIPE_ID);

    const explicit = await loadLayer7R1Recipe({ recipePath: OFFICIAL_LAYER7_R1_RECIPE_FILE });
    assert.equal(explicit.id, LAYER7_R1_RECIPE_ID);

    const tmp = mkdtempSync(path.join(os.tmpdir(), "openreaper-r1-wrong-recipe-"));
    const wrongRecipePath = path.join(tmp, "project.cleanup_fingerprint_report.recipe.json");
    writeFileSync(wrongRecipePath, JSON.stringify(recipe));
    await assert.rejects(
      () => loadLayer7R1Recipe({ recipePath: wrongRecipePath }),
      hasDriverCode("LAYER7_R1_RECIPE_FILE_REJECTED"),
    );
  });

  it("rejects wrong recipe identity, lifecycle, step order, and dependency set", async () => {
    const recipe = await loadLayer7R1Recipe();
    assertLayer7R1Recipe(recipe);

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.id = "recipe.project.other_cleanup_report";
      })),
      "LAYER7_R1_RECIPE_ID_MISMATCH",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.lifecycle = "live_smoked";
      })),
      "LAYER7_R1_RECIPE_LIFECYCLE_MISMATCH",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps = [copy.steps[1], copy.steps[0], copy.steps[2]];
      })),
      "LAYER7_R1_STEP_ORDER_MISMATCH",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps[0].call_template.id = "template.project.read_summary";
      })),
      "LAYER7_R1_RECIPE_CONTRACT_INVALID",
    );
  });

  it("rejects non-frozen tools, raw targets, public aliases, canonical artifact refs, and external labels", async () => {
    const recipe = await loadLayer7R1Recipe();

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps[0].uses = "run_job";
      })),
      "LAYER7_R1_RECIPE_CONTRACT_INVALID",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps[0].call_template.id = "run_job:project.create_cleanup_report";
      })),
      "LAYER7_R1_RECIPE_CONTRACT_INVALID",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps[1].get_state.refs = ["last_result:artifact:N"];
      })),
      "LAYER7_R1_ARTIFACT_ALIAS_REJECTED",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps[1].get_state.refs = [
          "artifact:project:cleanup_report:art_20260704000000000_001_abcdef",
        ];
      })),
      "LAYER7_R1_ARTIFACT_ALIAS_REJECTED",
    );

    expectDriverCode(
      () => assertLayer7R1Recipe(mutated(recipe, (copy) => {
        copy.steps[1].get_state.refs = ["external_cleanup_report"];
      })),
      "LAYER7_R1_GET_STATE_LABEL_MISMATCH",
    );
  });

  it("binds cleanup_report only from the produced template artifact evidence", async () => {
    const transcriptPath = tempPath("transcript.jsonl");
    const result = await runLayer7R1RecipeTranscript({
      runId: "r1-fake-bind",
      transcriptPath,
      now: fixedNow,
    });

    assert.equal(result.status, "succeeded");
    assert.match(result.artifact_labels.cleanup_report, /^artifact:project:cleanup_report:/);
    const events = readJsonl(transcriptPath);
    assert.deepEqual(
      events.filter((event) => event.event === "artifact_label_bound").map((event) => ({
        label: event.label,
        artifact_ref: event.artifact_ref,
        source_step: event.source_step,
      })),
      [{
        label: LAYER7_R1_ARTIFACT_LABEL,
        artifact_ref: result.artifact_labels.cleanup_report,
        source_step: "create_cleanup_report",
      }],
    );

    const missingArtifact = await runLayer7R1RecipeTranscript({
      runId: "r1-fake-missing-artifact",
      transcriptPath: tempPath("missing-artifact.jsonl"),
      callTemplateRuntime: fakeCallTemplateRuntime({ artifacts: [], evidenceArtifactCount: 1 }),
      getStateRuntime: throwingGetStateRuntime(),
      now: fixedNow,
    });
    assert.equal(missingArtifact.status, "failed");
    assert.equal(missingArtifact.reason, "LAYER7_R1_ARTIFACT_BINDING_MISSING");

    const wrongScopeRef = "artifact:project:other_report:art_20260704000000000_002_abcdef";
    const wrongScope = await runLayer7R1RecipeTranscript({
      runId: "r1-fake-wrong-scope",
      transcriptPath: tempPath("wrong-scope.jsonl"),
      callTemplateRuntime: fakeCallTemplateRuntime({
        artifacts: [artifactRefObject(wrongScopeRef, { schema: LAYER7_R1_ARTIFACT_SCHEMA })],
        evidenceArtifactCount: 1,
      }),
      getStateRuntime: throwingGetStateRuntime(),
      now: fixedNow,
    });
    assert.equal(wrongScope.status, "failed");
    assert.equal(wrongScope.reason, "LAYER7_R1_ARTIFACT_BINDING_MISSING");
  });

  it("records all checkpoints and transcript events in recipe step order", async () => {
    const transcriptPath = tempPath("ordered-transcript.jsonl");
    const result = await runLayer7R1RecipeTranscript({
      runId: "r1-fake-order",
      transcriptPath,
      now: fixedNow,
    });
    const events = readJsonl(transcriptPath);

    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.step_order, [...LAYER7_R1_EXPECTED_STEP_IDS]);
    assert.deepEqual(
      events.filter((event) => event.event === "step_started").map((event) => event.step_id),
      [...LAYER7_R1_EXPECTED_STEP_IDS],
    );
    assert.deepEqual(
      events.filter((event) => event.event === "frozen_tool_request_summary").map((event) => event.tool),
      ["call_template", "get_state", "get_state"],
    );
    assert.deepEqual(
      events.filter((event) => event.event === "checkpoint_reached").map((event) => event.checkpoint),
      [
        "checkpoint_create_cleanup_report",
        "checkpoint_read_cleanup_summary",
        "checkpoint_read_cleanup_payload",
      ],
    );
    assert.deepEqual(events.map((event) => event.event), [
      "run_started",
      "step_started",
      "frozen_tool_request_summary",
      "frozen_tool_response_summary",
      "artifact_label_bound",
      "checkpoint_reached",
      "step_started",
      "frozen_tool_request_summary",
      "frozen_tool_response_summary",
      "checkpoint_reached",
      "step_started",
      "frozen_tool_request_summary",
      "frozen_tool_response_summary",
      "checkpoint_reached",
      "run_succeeded",
    ]);
    assert.equal(
      events.some((event) => event.event === "frozen_tool_response_summary" &&
        event.summary.artifact_refs?.some((ref) => ref === result.artifact_labels.cleanup_report)),
      true,
    );
  });

  it("blocks live mode without required non-spawning env/config", async () => {
    const result = await runLayer7R1RecipeTranscript({
      live: true,
      env: {
        OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: mkdtempSync(path.join(os.tmpdir(), "openreaper-r1-artifacts-")),
      },
      runId: "r1-live-blocked",
      transcriptPath: tempPath("live-blocked.jsonl"),
      now: fixedNow,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "LAYER7_R1_LIVE_EXECUTOR_BLOCKED");
    assert.equal(result.spawned_reaper, false);
    const events = readJsonl(result.transcript_path);
    assert.equal(events.at(-1).event, "run_blocked");
    assert.equal(events.at(-1).error.details.spawned_reaper, false);
  });

  it("does not add REAPER spawning, live matrix mutation, or a public recipe tool surface", () => {
    const source = readFileSync(DRIVER_SOURCE, "utf8");

    assert.doesNotMatch(source, /node:child_process|spawn\(|execFile|execSync|REAPER\.app/);
    assert.doesNotMatch(source, /LIVE_SMOKE_MATRIX/);
    assert.doesNotMatch(source, /\bcall_recipe\b/);
    assert.equal(source.includes("createCallTemplateRuntime"), true);
    assert.equal(source.includes("createGetStateArtifactRuntime"), true);
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.includes("call_recipe"), false);
  });
});

function fixedNow() {
  return new Date("2026-07-04T00:00:00.000Z");
}

function tempPath(file) {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "openreaper-r1-driver-")), file);
}

function readJsonl(file) {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function mutated(recipe, mutate) {
  const copy = JSON.parse(JSON.stringify(recipe));
  mutate(copy);
  return copy;
}

function expectDriverCode(fn, code) {
  assert.throws(fn, hasDriverCode(code));
}

function hasDriverCode(code) {
  return (error) => {
    assert.equal(error?.code, code, error?.message);
    return true;
  };
}

function fakeCallTemplateRuntime({ artifacts, evidenceArtifactCount }) {
  let lastEvidence = null;
  return {
    async call_template() {
      lastEvidence = {
        contract: "template.runtime.evidence.v1",
        template: {
          id: LAYER7_R1_TEMPLATE_ID,
          pack: "project",
          risk: "read",
        },
        ok: true,
        request_id: "req_fake_bad_artifact",
        counts: {
          refs: 0,
          artifacts: evidenceArtifactCount,
          jobs: 0,
          last_result_refs: 0,
        },
      };
      return {
        contract: "template.execution.v1",
        ok: true,
        template: {
          id: LAYER7_R1_TEMPLATE_ID,
          pack: "project",
          risk: "read",
        },
        request: { id: "req_fake_bad_artifact" },
        result: {
          summary: {},
          refs: [],
          artifacts,
          jobs: [],
          last_result: {
            updated: false,
            refs: [],
            truncated: false,
          },
        },
        budget: {
          response_bytes: 512,
          truncated: false,
        },
      };
    },
    last_evidence() {
      return lastEvidence;
    },
  };
}

function artifactRefObject(ref, summary = {}) {
  return {
    kind: "artifact",
    ref,
    identity: {
      scheme: "artifact_ref",
      value: ref,
    },
    summary,
  };
}

function throwingGetStateRuntime() {
  return {
    async get_state() {
      throw new Error("get_state should not be reached without a produced cleanup_report binding");
    },
  };
}
