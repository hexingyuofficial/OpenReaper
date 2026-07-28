import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createExecutableDependencyCatalog,
} from "../../../packages/core/src/executable-recipe-contract-v1.mjs";
import {
  createExecutableRecipeRevisionStore,
} from "../../../packages/core/src/executable-recipe-revision-store-v1.mjs";
import {
  createCallRecipeRuntime,
} from "../../../packages/mcp-server/src/call-recipe-runtime-v1.mjs";

const PROJECT_REF = "project:tab:alpha4-shard-b-fixture";
const BRIDGE_OWNER = "owner:alpha4-shard-b";
const BRIDGE_GENERATION = "1";

describe("Alpha4 Shard B Recipe truth", () => {
  it("distinguishes not_applied, applied_unverified, and applied_verified and suppresses later stages", async () => {
    const fixture = makeRuntime();
    const dispatches = [];
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      assert.equal(saved.ok, true, JSON.stringify(saved));

      const zeroWrite = await runFixture(fixture, saved, draft, {
        dispatches,
        template: (stage) => {
          if (stage.id === "readback") return templateFailure({ zero_write: true });
          dispatches.push(stage.id);
          return templateSuccess();
        },
      });
      assert.equal(zeroWrite.ok, false, JSON.stringify(zeroWrite));
      assert.equal(zeroWrite.execution_truth.mutation, "not_applied");
      assert.equal(zeroWrite.resume_safe, true);
      assert.equal(zeroWrite.next_call.arguments.operation, "resume");
      assert.deepEqual(dispatches, ["run_macro"]);
      assert.deepEqual(zeroWrite.stages.failed, ["readback"]);
      assert.deepEqual(zeroWrite.stages.not_started, ["later_write"]);

      dispatches.length = 0;
      const uncertain = await runFixture(fixture, saved, draft, {
        dispatches,
        template: (stage) => {
          if (stage.id === "readback") return templateFailure({ mutation_before_readback: true });
          dispatches.push(stage.id);
          return templateSuccess();
        },
      });
      assert.equal(uncertain.ok, false, JSON.stringify(uncertain));
      assert.equal(uncertain.execution_truth.mutation, "applied_unverified");
      assert.equal(uncertain.resume_safe, false);
      assert.equal(uncertain.next_call.arguments.operation, "get");
      assert.deepEqual(dispatches, ["run_macro"]);
      assert.equal(uncertain.recovery.strategy, "inspect_and_repair");

      const evidence = await fixture.runtime.call_recipe({
        operation: "get",
        evidence_ref: uncertain.evidence_ref,
      });
      assert.equal(evidence.ok, true, JSON.stringify(evidence));
      const readbackEvidence = evidence.items.find((item) => item.stage_id === "readback");
      assert.equal(readbackEvidence.verified, false, JSON.stringify(readbackEvidence));
      assert.equal(readbackEvidence.counters.native_mutation_count, 1, JSON.stringify(readbackEvidence));
      assert.equal(evidence.items.find((item) => item.stage_id === "later_write"), undefined);

      dispatches.length = 0;
      const laterStageFailure = await runFixture(fixture, saved, draft, {
        dispatches,
        template: (stage) => {
          dispatches.push(stage.id);
          return stage.id === "later_write" ? templateFailure({ zero_write: true }) : templateSuccess();
        },
      });
      assert.equal(laterStageFailure.ok, false, JSON.stringify(laterStageFailure));
      assert.equal(laterStageFailure.execution_truth.mutation, "applied_verified");
      assert.equal(laterStageFailure.resume_safe, true);
      assert.equal(laterStageFailure.next_call.arguments.operation, "resume");
      assert.deepEqual(laterStageFailure.stages.failed, ["later_write"]);
      assert.deepEqual(laterStageFailure.stages.completed, ["run_macro", "readback"]);
      assert.deepEqual(dispatches, ["run_macro", "readback", "later_write"]);

      dispatches.length = 0;
      const verified = await runFixture(fixture, saved, draft, {
        dispatches,
        template: (stage) => {
          dispatches.push(stage.id);
          return templateSuccess();
        },
      });
      assert.equal(verified.ok, true, JSON.stringify(verified));
      assert.equal(verified.execution_truth.mutation, "applied_verified");
      assert.deepEqual(dispatches, ["run_macro", "readback", "later_write"]);
      assert.equal(verified.undo.status, "closed");
      const verifiedEvidence = fixture.evidenceStore.get(verified.evidence_ref);
      assert.deepEqual(
        verifiedEvidence.items.map((item) => [item.stage_id, item.mutation_truth]),
        [["run_macro", "not_applied"], ["readback", "applied_verified"], ["later_write", "applied_verified"]],
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps Whole-Recipe Undo identity and close failure truth separate from mutation truth", async () => {
    const undoCalls = [];
    const fixture = makeRuntime({
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return {
            ok: true,
            opened: true,
            handle: "undo:alpha4-shard-b:1",
            project_ref: request.project_ref,
            evidence_refs: ["evidence:undo:begin"],
          };
        },
        async end(request) {
          undoCalls.push(request);
          return { ok: false, closed: false, handle: request.handle, project_ref: request.project_ref };
        },
      },
    });
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const failed = await runFixture(fixture, saved, draft, {
        template: (stage) => stage.id === "readback"
          ? templateFailure({ mutation_before_readback: true })
          : templateSuccess(),
      });
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(failed.execution_truth.mutation, "applied_unverified");
      assert.equal(failed.undo.scope, "whole_recipe");
      assert.equal(failed.undo.status, "close_unknown");
      assert.equal(failed.undo.project_ref, PROJECT_REF);
      assert.equal(failed.resume_safe, false);
      assert.equal(failed.next_call.arguments.operation, "get");
      assert.deepEqual(undoCalls.map((request) => request.operation), ["begin", "end"]);
      assert.equal(undoCalls[0].scope, "whole_recipe");
      assert.equal(undoCalls[1].handle, "undo:alpha4-shard-b:1");
      assert.equal(undoCalls[1].mutation_truth, "unknown");
      assert.equal(new Set(undoCalls.map((request) => request.project_ref)).size, 1);
    } finally {
      fixture.cleanup();
    }
  });

  it("reports delayed begin timeout as open_unknown without zero-write or no-recovery claims", async () => {
    const timeout = new Error("Timed out waiting for delayed Recipe Undo begin proof.");
    timeout.code = "BRIDGE_TIMEOUT";
    timeout.outcome = "unknown";
    timeout.reconciliation_required = true;
    timeout.handle = "run-delayed:attempt:1";
    const fixture = makeRuntime({
      undoController: {
        async begin() { throw timeout; },
        async end() { throw new Error("end must not be called"); },
      },
    });
    const dispatches = [];
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const blocked = await runFixture(fixture, saved, draft, {
        dispatches,
        template: () => templateSuccess(),
      });
      assert.equal(blocked.ok, false, JSON.stringify(blocked));
      assert.equal(blocked.undo.status, "open_unknown");
      assert.equal(blocked.execution_truth.mutation, "unknown");
      assert.equal(blocked.execution_truth.transport_call_count, 0);
      assert.equal(blocked.error.details.stage_dispatch_count, 0);
      assert.equal(blocked.error.details.transaction_reconciliation_required, true);
      assert.equal(Object.hasOwn(blocked.error.details, "zero_write"), false);
      assert.equal(blocked.recovery.strategy, "reconcile_recipe_undo");
      assert.equal(blocked.recovery.required_action, "reconcile_exact_not_run_transaction_before_retry");
      assert.deepEqual(dispatches, []);
    } finally {
      fixture.cleanup();
    }
  });

  it("preserves structured dispatcher throw truth through stage normalization", async () => {
    const fixture = makeRuntime();
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const thrown = Object.assign(new Error("Bridge liveness became stale during dispatch."), {
        code: "BRIDGE_NOT_RUNNING",
        details: {
          zero_write: true,
          liveness_status: "stale",
          recovery_required: true,
        },
      });
      const runtime = createCallRecipeRuntime({
        store: fixture.runtime.store,
        catalog: fixture.catalog,
        evidenceStore: fixture.evidenceStore,
        runStore: fixture.runStore,
        undoController: fixture.undoController,
        dispatchers: {
          macro: async () => { throw thrown; },
          template: async ({ stage }) => templateSuccess(stage),
        },
        runtimeFactsProvider: async ({ revision }) => runtimeFacts(revision, fixture.catalog),
      });
      const failed = await runtime.call_recipe({
        operation: "run",
        ...identity(saved),
        inputs: { track_name: "Dialog" },
      });
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(failed.error.code, "BRIDGE_NOT_RUNNING");
      assert.deepEqual(failed.error.details, thrown.details);
      assert.equal(failed.execution_truth.mutation, "not_applied");
      assert.equal(failed.execution_truth.transport_call_count, 0);
      const evidence = fixture.evidenceStore.get(failed.evidence_ref);
      assert.equal(evidence.items.find((item) => item.stage_id === "run_macro").status, "failed");
      assert.equal(Object.hasOwn(evidence.items.find((item) => item.stage_id === "run_macro"), "error"), false);
    } finally {
      fixture.cleanup();
    }
  });

  it("retains output, mutation, run, Undo, recovery, and evidence identity when response projection overflows", async () => {
    const fixture = makeRuntime({
      undoController: {
        async begin(request) {
          return { ok: true, opened: true, handle: "undo:alpha4-shard-b:overflow", project_ref: request.project_ref };
        },
        async end(request) {
          return { ok: true, closed: true, verified: true, handle: request.handle, project_ref: request.project_ref };
        },
      },
    });
    try {
      const draft = makeOutputDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const minimum = await fixture.runtime.call_recipe({
        operation: "run",
        ...identity(saved),
        inputs: { track_name: "Dialog" },
        budget: { max_response_bytes: 4096 },
      });
      assert.equal(minimum.error.code, "RESPONSE_BUDGET_INSUFFICIENT");

      const response = await fixture.runtime.call_recipe({
        operation: "run",
        ...identity(saved),
        inputs: { track_name: "Dialog" },
        budget: { max_response_bytes: minimum.error.details.required },
      });
      assert.equal(response.ok, true, JSON.stringify(response));

      const overflow = await runFixture(fixture, saved, draft, {
        budget: { max_response_bytes: minimum.error.details.required },
        template: () => templateSuccess({ overflow_refs: true }),
      });
      assert.equal(overflow.response_compacted, true, JSON.stringify({ minimum, overflow }));
      assert.equal(overflow.ok, true, JSON.stringify(overflow));
      assert.equal(overflow.run_id?.startsWith("run_"), true);
      assert.equal(overflow.execution_truth.mutation, "applied_verified");
      assert.equal(overflow.undo.status, "closed");
      assert.equal(overflow.recovery?.strategy, "no_recovery_needed");
      assert.equal(typeof overflow.evidence_ref, "string");
      assert.equal(overflow.verified_outputs?.find((output) => output.id === "track_ref")?.verified, true);
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps late mutating stage truth and closes the Whole-Recipe Undo after deadline expiry", async () => {
    const undoCalls = [];
    const fixture = makeRuntime({
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: "undo:alpha4-shard-b:deadline", project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return { ok: true, closed: true, verified: true, handle: request.handle, project_ref: request.project_ref };
        },
      },
    });
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const response = await runFixture(fixture, saved, draft, {
        // Leave enough budget for fixture validation; the delayed mutating
        // stage itself must still expire before it can return readback proof.
        deadline_ms: 70,
        template: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return templateSuccess();
        },
      });

      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.details.deadline_exceeded, true, JSON.stringify(response));
      assert.equal(response.execution_truth.mutation, "applied_unverified", JSON.stringify(response));
      assert.equal(response.execution_truth.native_mutation_count, 0, JSON.stringify(response));
      assert.equal(response.undo.status, "closed", JSON.stringify(response));
      assert.equal(response.resume_safe, false);
      assert.deepEqual(undoCalls.map((request) => request.operation), ["begin", "end"]);
      const evidence = fixture.evidenceStore.get(response.evidence_ref);
      const lateStage = evidence.items.find((item) => item.stage_id === "readback");
      assert.equal(lateStage.status, "failed");
      assert.equal(lateStage.verified, false);
      assert.equal(lateStage.mutation_truth, "applied_unverified");
      assert.equal(lateStage.counters.transport_call_count, 0);
    } finally {
      fixture.cleanup();
    }
  });

  it("reports one complete Recipe performance envelope while preserving optional deadline behavior", async () => {
    const fixture = makeRuntime();
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const result = await runFixture(fixture, saved, draft, {
        template: () => templateSuccess(),
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.performance.contract, "openreaper.execution_performance.v1");
      assert.equal(result.performance.gate_mode, "internal_acceptance_only");
      assert.equal(result.performance.runtime_cancellation, false);
      assert.equal(result.performance.counters.undo_call_count, 2);
      assert.equal(result.performance.counters.evidence_count, 1);
      assert.equal(result.performance.counters.transport_call_count, 0);
      assert.equal(result.execution_truth.stage_dispatch_count, 3);
      assert.equal(result.execution_truth.transport_call_count, 0);
      assert.equal(result.execution_truth.performance.contract, "openreaper.execution_performance.v1");
      assert.equal(result.execution_truth.performance.gate_ok, true);

      const evidence = fixture.evidenceStore.get(result.evidence_ref);
      assert.equal(evidence.run_summary.performance.contract, "openreaper.execution_performance.v1");
      assert.equal(evidence.run_summary.performance.gate_mode, "internal_acceptance_only");
      assert.equal(evidence.run_summary.counters.stage_dispatch_count, 3);
      assert.equal(evidence.run_summary.counters.transport_call_count, 0);
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps early hydration blockers on the shared Recipe performance envelope", async () => {
    const fixture = makeRuntime();
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const blockedRuntime = createCallRecipeRuntime({
        store: fixture.runtime.store,
        catalog: fixture.catalog,
        evidenceStore: fixture.evidenceStore,
        runStore: fixture.runStore,
        undoController: fixture.undoController,
        dispatchers: {
          macro: async () => macroSuccess(),
          template: async ({ stage }) => templateSuccess(stage),
        },
        runtimeFactsProvider: async ({ revision }) => runtimeFacts(revision, fixture.catalog),
        runHydrator: async () => ({
          ok: false,
          message: "typed hydration blocker",
          details: { blocker_code: "HYDRATION_TEST_BLOCKED" },
        }),
      });
      const response = await blockedRuntime.call_recipe({
        operation: "run",
        ...identity(saved),
        inputs: { track_name: "Dialog" },
      });

      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "PREFLIGHT_FAILED");
      assert.equal(response.performance.contract, "openreaper.execution_performance.v1");
      assert.equal(response.execution_truth.performance.contract, "openreaper.execution_performance.v1");
      assert.equal(response.performance.total_ms, response.execution_truth.performance.total_ms);
      assert.equal(response.performance.gate_ok, true);
    } finally {
      fixture.cleanup();
    }
  });

  it("passes one shared performance envelope through every Recipe stage", async () => {
    const fixture = makeRuntime();
    const seen = [];
    try {
      const draft = makeDraft();
      const saved = await saveDraft(fixture.runtime, draft);
      const result = await runFixture(fixture, saved, draft, {
        macro: (_stage, options) => {
          seen.push(options.performance);
          return macroSuccess();
        },
        template: (_stage, options) => {
          seen.push(options.performance);
          options.performance.counters.transport_call_count += 1;
          return templateSuccess();
        },
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(seen.length, 3);
      assert.ok(seen.every((performance) => performance === seen[0]));
      assert.equal(seen[0].contract, result.execution_truth.performance.contract);
      assert.equal(seen[0].gate_mode, result.execution_truth.performance.gate_mode);
      assert.equal(result.execution_truth.stage_dispatch_count, 3);
      assert.equal(result.execution_truth.transport_call_count, 2);
      assert.equal(result.performance.counters.transport_call_count, 2);
    } finally {
      fixture.cleanup();
    }
  });

  it("preserves mutation truth when evidence or run-state persistence fails", async () => {
    const evidenceFailure = makeRuntime({
      evidenceStore: new ThrowingPutStore("evidence write failed"),
    });
    try {
      const draft = makeDraft();
      const saved = await saveDraft(evidenceFailure.runtime, draft);
      const response = await runFixture(evidenceFailure, saved, draft, {
        template: () => templateSuccess(),
      });

      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "STORE_ERROR");
      assert.equal(response.error.details.persistence_failure, "evidence_store");
      assert.equal(response.error.details.mutation_truth, "applied_verified");
      assert.equal(response.execution_truth.mutation, "applied_verified");
      assert.equal(response.error.details.zero_write, false);
      assert.equal(response.evidence_ref, null);
      assert.equal(response.undo.status, "closed");
    } finally {
      evidenceFailure.cleanup();
    }

    const runStateFailure = makeRuntime({
      runStore: new ThrowingPutStore("run state write failed", { fail_after: 3 }),
    });
    try {
      const draft = makeDraft();
      const saved = await saveDraft(runStateFailure.runtime, draft);
      const response = await runFixture(runStateFailure, saved, draft, {
        template: () => templateSuccess(),
      });

      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "STORE_ERROR");
      assert.equal(response.error.details.persistence_failure, "run_store");
      assert.equal(response.error.details.mutation_truth, "applied_verified");
      assert.equal(response.execution_truth.mutation, "applied_verified");
      assert.equal(response.error.details.zero_write, false);
      assert.equal(typeof response.evidence_ref, "string");
      assert.ok(runStateFailure.evidenceStore.get(response.evidence_ref));
      assert.equal(response.undo.status, "closed");
    } finally {
      runStateFailure.cleanup();
    }
  });
});

function makeRuntime(overrides = {}) {
  const catalog = createCatalog();
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha4-b-recipe-"));
  const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
  const evidenceStore = overrides.evidenceStore ?? new MapStore();
  const runStore = overrides.runStore ?? new MapStore();
  const undoController = overrides.undoController ?? {
    async begin(request) {
      return { ok: true, opened: true, handle: `undo:alpha4-shard-b:${request.run_id}`, project_ref: request.project_ref };
    },
    async end(request) {
      return { ok: true, closed: true, verified: true, handle: request.handle, project_ref: request.project_ref };
    },
  };
  const runtime = createCallRecipeRuntime({
    store,
    catalog,
    evidenceStore,
    runStore,
    undoController,
    dispatchers: {
      macro: async () => macroSuccess(),
      template: async ({ stage }) => templateSuccess(stage),
    },
    runtimeFactsProvider: async ({ revision }) => runtimeFacts(revision, catalog),
  });
  return { runtime, catalog, undoController, evidenceStore, runStore, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function saveDraft(runtime, draft) {
  return runtime.call_recipe({
    operation: "save",
    draft,
    version: "1.0.0",
    revision_number: 1,
    saved_at: "1970-01-01T00:00:00.000Z",
  });
}

async function runFixture(fixture, saved, draft, { macro, template, dispatches = [], budget, deadline_ms } = {}) {
  const runtime = createCallRecipeRuntime({
    store: fixture.runtime.store,
    catalog: fixture.catalog,
    evidenceStore: fixture.evidenceStore,
    runStore: fixture.runStore,
    undoController: fixture.undoController,
    dispatchers: {
      macro: async ({ stage, ...options }) => {
        dispatches.push(stage.id);
        return macro ? macro(stage, options) : macroSuccess();
      },
      template: async ({ stage, ...options }) => template(stage, options),
    },
    runtimeFactsProvider: async ({ revision }) => runtimeFacts(revision, fixture.catalog),
  });
  return runtime.call_recipe({
    operation: "run",
    ...identity(saved),
    inputs: { track_name: "Dialog" },
    ...(budget ? { budget } : {}),
    ...(deadline_ms !== undefined ? { deadline_ms } : {}),
  });
}

class MapStore {
  #values = new Map();

  put(key, value) { this.#values.set(key, value); }
  get(key) { return this.#values.get(key) ?? null; }
}

class ThrowingPutStore extends MapStore {
  #message;
  #failAfter;
  #putCount = 0;

  constructor(message, { fail_after = 0 } = {}) {
    super();
    this.#message = message;
    this.#failAfter = fail_after;
  }

  put(key, value) {
    this.#putCount += 1;
    if (this.#putCount > this.#failAfter) throw new Error(this.#message);
    super.put(key, value);
  }
}

function createCatalog() {
  return createExecutableDependencyCatalog({
    macros: [{
      id: "macro.project.inspect",
      version: "1.0.0",
      risk: "read",
      descriptor_hash: "a".repeat(64),
      capabilities: ["project.index"],
    }],
    templates: [{
      id: "template.tracks.create_track",
      version: "1.0.0",
      risk: "write",
      descriptor_hash: "b".repeat(64),
      capabilities: ["tracks.write"],
    }],
    capabilities: ["project.index", "tracks.write"],
  });
}

function makeDraft() {
  return {
    contract: "recipe.executable.draft.v1",
    id: "recipe.alpha4.shard_b.truth_fixture",
    title: "Alpha4 Shard B truth fixture",
    summary: "Test-only recipe for mutation and recovery truth.",
    pack: "tracks",
    risk: "write",
    inputs: [{ id: "track_name", type: "string", required: true }],
    outputs: [{ id: "track_ref", type: "ref.track", required: true }],
    stages: [
      {
        id: "run_macro",
        kind: "macro",
        dependency: { kind: "macro", id: "macro.project.inspect", version: "1.0.0", fallback_reason: null },
        inputs: ["track_name"],
        outputs: ["project_summary"],
        risk: "read",
        checkpoint: "checkpoint_run_macro",
      },
      {
        id: "readback",
        kind: "template",
        dependency: { kind: "template", id: "template.tracks.create_track", version: "1.0.0", fallback_reason: "official_template_atom_required" },
        inputs: ["project_summary", "track_name"],
        outputs: ["track_ref"],
        risk: "write",
        checkpoint: "checkpoint_readback",
      },
      {
        id: "later_write",
        kind: "template",
        dependency: { kind: "template", id: "template.tracks.create_track", version: "1.0.0", fallback_reason: "official_template_atom_required" },
        inputs: [],
        outputs: [],
        risk: "write",
        checkpoint: "checkpoint_later_write",
      },
    ],
    bindings: [
      { from: { scope: "recipe_input", id: null, port: "track_name" }, to: { scope: "stage", id: "run_macro", port: "track_name" } },
      { from: { scope: "stage", id: "run_macro", port: "project_summary" }, to: { scope: "stage", id: "readback", port: "project_summary" } },
      { from: { scope: "recipe_input", id: null, port: "track_name" }, to: { scope: "stage", id: "readback", port: "track_name" } },
      { from: { scope: "stage", id: "readback", port: "track_ref" }, to: { scope: "recipe_output", id: null, port: "track_ref" } },
    ],
    dependencies: [
      { kind: "macro", id: "macro.project.inspect", version: "1.0.0", risk: "read", fallback_reason: null, descriptor_hash: "a".repeat(64) },
      { kind: "template", id: "template.tracks.create_track", version: "1.0.0", risk: "write", fallback_reason: "official_template_atom_required", descriptor_hash: "b".repeat(64) },
    ],
    required_capabilities: ["project.index", "tracks.write"],
    risk_grants: ["read", "write"],
    checkpoints: [
      { id: "checkpoint_run_macro", after_stage: "run_macro", evidence_id: "evidence_run_macro", resume_identity: "resume.run_macro", summary: "Macro checkpoint." },
      { id: "checkpoint_readback", after_stage: "readback", evidence_id: "evidence_readback", resume_identity: "resume.readback", summary: "Readback checkpoint." },
      { id: "checkpoint_later_write", after_stage: "later_write", evidence_id: "evidence_later_write", resume_identity: "resume.later_write", summary: "Later write checkpoint." },
    ],
    preflight: { contract: "recipe.executable.preflight.v1", complete_graph: true, stage_count: 3, dependency_count: 2, requires_validation_before_save: true, requires_save_before_run: true, forbids_inline_execution: true },
    portability: { project_identity: PROJECT_REF, bridge_owner: BRIDGE_OWNER, bridge_generation: BRIDGE_GENERATION, platform: "darwin" },
  };
}

function makeOutputDraft() {
  const draft = makeDraft();
  draft.id = "recipe.alpha4.shard_b.response_fixture";
  draft.title = "Alpha4 Shard B response fixture";
  draft.summary = "Test-only recipe for compact response identity.";
  draft.stages = [draft.stages[0], { ...draft.stages[1], id: "readback", checkpoint: "checkpoint_readback" }];
  draft.outputs = [{ id: "track_ref", type: "ref.track", required: true }];
  draft.checkpoints = draft.checkpoints.slice(0, 2);
  draft.preflight.stage_count = 2;
  return draft;
}

function runtimeFacts(revision, catalog) {
  return {
    content_hash: revision.content_hash,
    risk_grants: [...revision.draft.risk_grants],
    project_identity: revision.draft.portability.project_identity,
    bridge_owner: revision.draft.portability.bridge_owner,
    bridge_generation: revision.draft.portability.bridge_generation,
    available_capabilities: [...catalog.capabilities],
    checkpoint_evidence: revision.draft.checkpoints.map((checkpoint) => ({
      checkpoint_id: checkpoint.id,
      evidence_id: checkpoint.evidence_id,
      resume_identity: checkpoint.resume_identity,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
    })),
    dependency_versions: revision.dependency_lock.entries.map(({ kind, id, version }) => ({ kind, id, version })),
    dependency_descriptors: revision.dependency_lock.entries.map(({ kind, id, descriptor_hash }) => ({ kind, id, descriptor_hash })),
  };
}

function identity(saved) {
  return {
    recipe_id: saved.recipe_id,
    version: saved.version,
    revision: saved.revision,
    content_hash: saved.content_hash,
    validation_result_id: saved.validation_result_id,
  };
}

function macroSuccess() {
  const envelope = {
    contract: "macro.execution.v1",
    ok: true,
    macro: { id: "macro.project.inspect", program_id: "openreaper.macro.project.inspect", program_version: "1.0.0", risk: "read" },
    request: { request_id: "alpha4-b-macro", dry_run: false },
    execution: { status: "completed", started_at: "2026-07-24T00:00:00.000Z", completed_at: "2026-07-24T00:00:00.001Z", stage_count: 1, stages: [{ id: "inspect", kind: "verify", status: "completed", evidence_refs: ["evidence:macro"] }] },
    sqlite: { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false },
    result: { summary: "verified", canonical_refs: [], changes: [], verification: { status: "passed", evidence_refs: ["evidence:macro"] }, artifact_refs: [], data: { project_summary: { project_ref: PROJECT_REF } } },
    blockers: [],
    error: null,
    recovery: null,
    budget: { max_bytes: 65536, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  for (let attempt = 0; attempt < 4; attempt += 1) envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  return envelope;
}

function templateSuccess({ overflow_refs = false } = {}) {
  const refs = overflow_refs
    ? Array.from({ length: 16 }, (_, index) => ({ ref: `track:guid:{ALPHA4-B-${index}}:${"x".repeat(1_000)}` }))
    : [{ ref: "track:guid:{ALPHA4-B}" }];
  return {
    contract: "template.execution.v1",
    ok: true,
    template: { id: "template.tracks.create_track", pack: "tracks", risk: "write" },
    request: { id: "alpha4-b-template" },
    verification: { status: "passed", evidence_refs: ["evidence:template"] },
    result: { summary: { status: "applied" }, refs, artifacts: [], jobs: [], readback: { track_ref: "track:guid:{ALPHA4-B}" } },
    error: null,
  };
}

function templateFailure({ zero_write = false, mutation_before_readback = false } = {}) {
  return {
    contract: "template.execution.v1",
    ok: false,
    template: { id: "template.tracks.create_track", pack: "tracks", risk: "write" },
    request: { id: "alpha4-b-template-failure" },
    verification: { status: "failed" },
    result: mutation_before_readback
      ? { summary: { status: "failed" }, refs: [{ ref: "track:guid:{ALPHA4-B-MUTATED}" }], readback: null, mutation: { attempted: true, completed_count: 1 } }
      : { summary: { status: "blocked" }, refs: [], readback: null },
    error: { code: "READBACK_FAILED", message: "Injected readback failure.", details: { zero_write, mutation_before_readback, mutation: { attempted: mutation_before_readback, completed_count: mutation_before_readback ? 1 : 0 } } },
  };
}
