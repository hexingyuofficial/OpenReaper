import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createExecutableDependencyCatalog,
  sealExecutableRecipeRevision,
} from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  createExecutableRecipeRevisionStore,
} from "../../packages/core/src/executable-recipe-revision-store-v1.mjs";
import {
  EXECUTABLE_RECIPE_RUN_CONTRACT,
  buildExactRunRevisionIdentity,
  rejectInlineExecutionPayload,
} from "../../packages/core/src/executable-recipe-run-v1.mjs";
import {
  CALL_RECIPE_OPERATIONS,
  CALL_RECIPE_RUNTIME_CONTRACT,
  CALL_RECIPE_TOOL_NAME,
  createAuthoritativeRuntimeFactsProvider,
  createCallRecipeRuntime,
} from "../../packages/mcp-server/src/call-recipe-runtime-v1.mjs";
import {
  CALL_RECIPE_STAGE_BUDGET,
  createStdioCallRecipeRuntime,
  createStdioRecipeUndoController,
  readFreshOpenProjectInventory,
} from "../../packages/mcp-server/src/openreaper-mcp-stdio.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";
import { OPENREAPER_PUBLIC_TOOL_IDS } from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { CALL_TEMPLATE_INTERNAL_RECIPE_UNDO } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { createExecutableRecipeProductCatalog } from "../../packages/mcp-server/src/executable-recipe-product-catalog-v1.mjs";

const STDIO_SERVER = path.resolve("packages/mcp-server/src/openreaper-mcp-stdio.mjs");

describe("Alpha3.4-E2 call_recipe runtime", () => {
  it("fails closed before official seeding when user and official Recipe roots resolve identically", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-root-collision-"));
    const sentinel = path.join(root, "user-sentinel.recipe.json");
    writeFileSync(sentinel, "user-owned\n", "utf8");
    try {
      const binding = createStdioCallRecipeRuntime({
        env: {
          OPENREAPER_EXECUTABLE_RECIPE_ROOT: root,
          OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT: path.join(root, "."),
        },
      });
      assert.equal(binding, null);
      assert.equal(readFileSync(sentinel, "utf8"), "user-owned\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers exactly six public tools including call_recipe and preserves product counts", () => {
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_recipe",
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 6);
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.includes("call_recipe"), true);
    assert.deepEqual([...OPENREAPER_PUBLIC_TOOL_IDS].sort(), [...TOOL_ABI_V1_TOOL_NAMES].sort());
    assert.equal(CALL_RECIPE_TOOL_NAME, "call_recipe");
    assert.equal(CALL_RECIPE_RUNTIME_CONTRACT, "call_recipe.runtime.v1");
    assert.deepEqual([...CALL_RECIPE_OPERATIONS], [
      "validate", "save", "list", "get", "delete", "run", "resume",
    ]);
    assert.equal(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length, 15);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 242);

    const stdio = readFileSync(new URL("../../packages/mcp-server/src/openreaper-mcp-stdio.mjs", import.meta.url), "utf8");
    assert.equal((stdio.match(/server\.tool\(/g) ?? []).length, 6);
    assert.match(stdio, /"call_recipe"/);
    assert.match(stdio, /createCallRecipeRuntime/);

    const packageSource = readFileSync(new URL("../../scripts/package-openreaper-alpha.mjs", import.meta.url), "utf8");
    assert.match(packageSource, /bridge_handler_count:\s*91/);

    const store = readFileSync(new URL("../../packages/core/src/executable-recipe-revision-store-v1.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(store, /packages\/mcp-server/);
    assert.doesNotMatch(store, /\b(?:runExecutable|resumeExecutable|dispatchExecutable)\b/);
  });

  it("covers validate/save/list/get/delete with zero-write validation and exact identity", async () => {
    const { runtime, root, catalog } = makeRuntime();
    const draft = makeDraft();
    const before = listTree(root);

    const invalid = await runtime.call_recipe({
      operation: "validate",
      draft: { ...draft, stages: [] },
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.mutates_project, false);
    assert.equal(invalid.mutates_recipe_root, false);
    assert.deepEqual(listTree(root), before);

    const validated = await runtime.call_recipe({ operation: "validate", draft });
    assert.equal(validated.ok, true);
    assert.equal(validated.status, "validated");
    assert.equal(validated.mutates_recipe_root, false);
    assert.deepEqual(listTree(root), before);

    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.status, "saved");
    assert.equal(saved.immutable, true);
    assert.equal(typeof saved.content_hash, "string");
    assert.equal(typeof saved.validation_result_id, "string");

    const listed = await runtime.call_recipe({ operation: "list" });
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 1);
    assert.equal(listed.executable_truth, "saved_validated_revisions_only");
    assert.equal(listed.items[0].executable, true);

    const got = await runtime.call_recipe({
      operation: "get",
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
    });
    assert.equal(got.ok, true);
    assert.equal(got.content_hash, saved.content_hash);
    assert.equal(got.source, "user");
    assert.equal(got.draft.id, saved.recipe_id);

    const deleted = await runtime.call_recipe({
      operation: "delete",
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
      confirm: true,
    });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.deleted, true);
    assert.equal((await runtime.call_recipe({ operation: "list" })).count, 0);
    assert.equal(catalog.macros.length > 0, true);
  });

  it("uses the full default get budget for every official revision while preserving explicit compact budgets", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-official-get-budget-"));
    const binding = createStdioCallRecipeRuntime({
      env: {
        OPENREAPER_EXECUTABLE_RECIPE_ROOT: root,
        OPENREAPER_EXECUTABLE_RECIPE_SOURCE: "user",
        OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON: JSON.stringify(["read", "write"]),
      },
    });
    try {
      assert.ok(binding);
      const listed = await binding.runtime.call_recipe({ operation: "list", limit: 16 });
      const official = listed.items.filter((item) => item.source === "official");
      assert.equal(official.length, 2);

      for (const item of official) {
        const loaded = await binding.runtime.call_recipe({ operation: "get", ...exactIdentity(item) });
        assert.equal(loaded.ok, true, item.recipe_id);
        assert.equal(loaded.source, "official", item.recipe_id);
        assert.equal(loaded.response_compacted, undefined, item.recipe_id);
        assert.equal(loaded.draft.id, item.recipe_id, item.recipe_id);
      }

      const busRecipe = official.find((item) => item.recipe_id === "recipe.mix.create_bus_processing");
      const compact = await binding.runtime.call_recipe({
        operation: "get",
        ...exactIdentity(busRecipe),
        budget: { max_response_bytes: 1_024 },
      });
      assert.equal(compact.ok, true);
      assert.equal(compact.response_compacted, true);
      assert.equal(compact.draft, undefined);

      for (const recipe_id of [
        "recipe.media.create_layered_sound_effect_variants",
        "recipe.items.create_sound_variations",
      ]) {
        const withdrawn = await binding.runtime.call_recipe({
          operation: "run",
          recipe_id,
          version: "1.0.0",
          revision: 1,
          content_hash: "f".repeat(64),
          validation_result_id: "validation:withdrawn-recipe",
          inputs: {},
        });
        assert.equal(withdrawn.ok, false, recipe_id);
        assert.equal(withdrawn.error.code, "REVISION_NOT_FOUND", recipe_id);
        assert.equal(withdrawn.resume_safe, false, recipe_id);
        assert.equal(withdrawn.execution_truth.mutation, "not_applied", recipe_id);
        assert.equal(withdrawn.execution_truth.stage_dispatch_count, 0, recipe_id);
        assert.equal(withdrawn.execution_truth.transport_call_count, 0, recipe_id);
        assert.equal(withdrawn.execution_truth.native_mutation_count, 0, recipe_id);
        assert.equal(withdrawn.execution_truth.readback_count, 0, recipe_id);
        assert.equal(withdrawn.undo.claimed, false, recipe_id);
        assert.equal(withdrawn.undo.opened, false, recipe_id);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}.official`, { recursive: true, force: true });
    }
  });

  it("rejects inline draft/graph execution and incomplete identity before dispatch", async () => {
    const { runtime } = makeRuntime();
    const draft = makeDraft();
    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    assert.throws(
      () => rejectInlineExecutionPayload({ operation: "run", draft, stages: [] }),
      (error) => error.code === "INLINE_EXECUTION_FORBIDDEN",
    );

    const inline = await runtime.call_recipe({
      operation: "run",
      draft,
      stages: draft.stages,
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(inline.ok, false);
    assert.equal(inline.error.code, "INLINE_EXECUTION_FORBIDDEN");

    const objectRevision = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      revision: { note: "object revisions are always inline payloads" },
      revision_number: saved.revision,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(objectRevision.ok, false);
    assert.equal(objectRevision.error.code, "INLINE_EXECUTION_FORBIDDEN");

    const objectResumeRevision = await runtime.call_recipe({
      operation: "resume",
      ...exactIdentity(saved),
      revision: { note: "object revisions are always inline payloads" },
      revision_number: saved.revision,
      run_id: "run_missing",
      checkpoint_id: "checkpoint_missing",
    });
    assert.equal(objectResumeRevision.ok, false);
    assert.equal(objectResumeRevision.error.code, "INLINE_EXECUTION_FORBIDDEN");

    const incomplete = await runtime.call_recipe({
      operation: "run",
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      // missing content_hash + validation_result_id
      inputs: { track_name: "Dialog" },
    });
    assert.equal(incomplete.ok, false);
    assert.ok(["REVISION_IDENTITY_INCOMPLETE", "PARAMS_INVALID"].includes(incomplete.error.code));

    const fuzzy = await runtime.call_recipe({
      operation: "run",
      recipe_id: saved.recipe_id,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(fuzzy.ok, false);

    const callerFacts = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      runtime_facts: completeFacts(saved),
    });
    assert.equal(callerFacts.ok, false);
    assert.equal(callerFacts.error.code, "INLINE_EXECUTION_FORBIDDEN");

    const callerRunId = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      run_id: "caller-owned-run-id",
      inputs: { track_name: "Dialog" },
    });
    assert.equal(callerRunId.ok, false);
    assert.equal(callerRunId.error.code, "PARAMS_INVALID");
    assert.equal(callerRunId.error.details.server_owned, true);
  });

  it("runs ordered stages with verified readback and compact pageable evidence", async () => {
    const events = [];
    const { runtime, sealed } = makeRuntime({
      dispatchers: {
        macro: async ({ stage, inputs }) => {
          events.push(["macro", stage.id, inputs]);
          return macroEnvelope({ project_summary: { ok: true, name: inputs.track_name } });
        },
        template: async ({ stage, inputs }) => {
          events.push(["template", stage.id, inputs]);
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });

    const saved = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const identity = {
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
    };
    assert.deepEqual(buildExactRunRevisionIdentity(identity).recipe_id, identity.recipe_id);

    const ran = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(ran.ok, true);
    assert.equal(ran.contract, EXECUTABLE_RECIPE_RUN_CONTRACT);
    assert.equal(ran.status, "succeeded");
    assert.equal(ran.counts.processed, 2);
    assert.equal(ran.counts.applied, 2);
    assert.equal(ran.verified_outputs.some((item) => item.id === "track_ref"), true);
    assert.equal(typeof ran.evidence_ref, "string");
    assert.equal(events.map((entry) => entry[0]).join(","), "macro,template");

    const page = await runtime.call_recipe({
      operation: "get",
      evidence_ref: ran.evidence_ref,
      limit: 1,
    });
    assert.equal(page.ok, true);
    assert.equal(page.items.length, 1);
    assert.equal(page.page.has_more, true);
    assert.equal(typeof page.page.next_cursor, "string");
    assert.equal(page.run_summary.contract, "call_recipe.run_summary.v1");
    assert.equal(page.run_summary.timing.stage_timing_count, 2);
    assert.deepEqual(page.run_summary.counters, {
      counter_scope: "recipe_stage_dispatch_and_accepted_native_proof",
      counter_source: "call_recipe_runtime",
      transport_call_count: 0,
      native_mutation_count: 1,
      readback_count: 2,
    });
    assert.doesNotMatch(JSON.stringify(page), /child_envelope|raw_request|full_schema/);
    assert.equal(sealed, undefined);
  });

  it("opens one Whole-Recipe Undo scope, binds child stages, and closes once", async () => {
    const undoCalls = [];
    const childUndo = [];
    const undoController = {
      async begin(request) {
        undoCalls.push(request);
        return {
          ok: true,
          opened: true,
          handle: "recipe-undo-fixture",
          project_ref: request.project_ref,
          evidence_refs: ["bridge:undo-begin"],
        };
      },
      async end(request) {
        undoCalls.push(request);
        return {
          ok: true,
          closed: true,
          verified: true,
          handle: request.handle,
          project_ref: request.project_ref,
          evidence_refs: ["bridge:undo-end"],
        };
      },
    };
    const { runtime } = makeRuntime({
      undoController,
      dispatchers: {
        macro: async ({ recipe_undo }) => {
          childUndo.push(recipe_undo);
          return macroEnvelope({ project_summary: { name: "Dialog" } });
        },
        template: async ({ recipe_undo }) => {
          childUndo.push(recipe_undo);
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await saveFixture(runtime);
    const ran = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });

    assert.equal(ran.ok, true, JSON.stringify(ran));
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
    assert.deepEqual(undoCalls[0].stage_ids, ["run_macro", "readback"]);
    assert.equal(undoCalls[1].handle, "recipe-undo-fixture");
    assert.equal(ran.execution_truth.mutation, "applied_verified");
    assert.equal(undoCalls[1].mutation_truth, "applied");
    assert.equal(childUndo.length, 2);
    assert.equal(childUndo.every((truth) => truth.suppress_child_undo === true), true);
    assert.equal(childUndo.every((truth) => truth.handle === "recipe-undo-fixture"), true);
    assert.deepEqual(ran.undo, {
      scope: "whole_recipe",
      binding: "bound",
      status: "closed",
      claimed: true,
      proven: true,
      opened: true,
      closed: true,
      project_ref: "project:tab:fixture-a",
      rollback_attempted: false,
      rollback_proven: false,
    });
  });

  it("rejects string fx_chain nodes with a typed zero-write patch before Recipe Undo", async () => {
    const draft = makeDraft();
    draft.inputs.push({ id: "fx_chain", type: "json", required: false });
    draft.stages[0].inputs.push("fx_chain");
    draft.bindings.push({
      from: { scope: "recipe_input", id: null, port: "fx_chain" },
      to: { scope: "stage", id: "run_macro", port: "fx_chain" },
    });
    let dispatches = 0;
    let undoBegins = 0;
    const { runtime } = makeRuntime({
      facts: (revision) => completeFacts(revision, draft),
      dispatchers: {
        macro: async () => { dispatches += 1; return macroEnvelope(); },
        template: async () => { dispatches += 1; return templateEnvelope(); },
      },
      undoController: {
        async begin() { undoBegins += 1; throw new Error("must not open"); },
        async end() { throw new Error("must not close"); },
      },
    });
    const saved = await saveFixture(runtime, draft);
    assert.equal(saved.ok, true, JSON.stringify(saved));

    const blocked = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Bus", fx_chain: ["ReaVerbate", "ReaComp"] },
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "PREFLIGHT_FAILED");
    assert.equal(blocked.error.details.code, "RECIPE_FX_CHAIN_NODE_SHAPE_INVALID");
    assert.equal(blocked.error.details.zero_write, true);
    assert.deepEqual(blocked.error.details.request_patch, {
      inputs: {
        fx_chain: [
          { plugin_query: "ReaVerbate" },
          { plugin_query: "ReaComp" },
        ],
      },
    });
    assert.equal(blocked.resume_safe, false);
    assert.equal(blocked.execution_truth.mutation, "not_applied");
    assert.equal(dispatches, 0);
    assert.equal(undoBegins, 0);
  });

  it("binds Recipe take_ref and verified fx_ref through the generic runner with one Whole-Recipe Undo", async () => {
    const draft = makeRecipeRefDraft();
    const dispatches = [];
    const undoCalls = [];
    const { runtime } = makeRuntime({
      facts: (revision) => completeFacts(revision, draft),
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: "recipe-ref-undo", project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
            rollback_attempted: request.disposition === "rollback",
            rollback_proven: request.disposition === "rollback",
          };
        },
      },
      dispatchers: {
        macro: async ({ stage, refs, recipe_undo }) => {
          dispatches.push({ stage_id: stage.id, refs, recipe_undo });
          if (stage.id === "add_take_fx") {
            assert.equal(refs.take_ref, "take:guid:{TAKE-ONE}");
            return macroEnvelopeWithChange({ fx_ref: "fx:take:{TAKE-ONE}:0" });
          }
          assert.equal(refs.fx_ref, "fx:take:{TAKE-ONE}:0");
          return macroEnvelopeWithChange({ parameter_value: 0.25 });
        },
      },
    });
    const saved = await saveFixture(runtime, draft);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const ran = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { take_ref: "take:guid:{TAKE-ONE}" },
    });

    assert.equal(ran.ok, true, JSON.stringify(ran));
    assert.deepEqual(dispatches.map((entry) => entry.stage_id), ["add_take_fx", "control_fx"]);
    assert.equal(dispatches.every((entry) => entry.recipe_undo?.suppress_child_undo === true), true);
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
    assert.equal(ran.verified_outputs.find((item) => item.id === "parameter_value")?.value, 0.25);
  });

  it("fails invalid Recipe refs closed without stale generation bindings", async () => {
    const draft = makeRecipeRefDraft();
    const dispatches = [];
    const undoCalls = [];
    let generation = "1";
    const { runtime } = makeRuntime({
      facts: (revision) => ({ ...completeFacts(revision, draft), bridge_generation: generation }),
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: `recipe-ref-undo-${generation}`, project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
            rollback_attempted: request.disposition === "rollback",
            rollback_proven: request.disposition === "rollback",
          };
        },
      },
      dispatchers: {
        macro: async ({ stage, refs }) => {
          dispatches.push({ generation, stage_id: stage.id, refs });
          return stage.id === "add_take_fx"
            ? macroEnvelopeWithChange({ fx_ref: "fx:take:{TAKE-ONE}:0" })
            : macroEnvelopeWithChange({ parameter_value: 0.25 });
        },
      },
    });
    const saved = await saveFixture(runtime, draft);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const identity = exactIdentity(saved);

    for (const takeRef of [
      "item:guid:{WRONG-KIND}",
      undefined,
      ["take:guid:{TAKE-ONE}", "take:guid:{TAKE-TWO}"],
      { kind: "take", ref: "take:guid:{TAKE-ONE}" },
    ]) {
      const failed = await runtime.call_recipe({
        operation: "run",
        ...identity,
        inputs: { take_ref: takeRef },
      });
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(failed.error.code, "PREFLIGHT_FAILED");
      assert.equal(
        failed.error.details.zero_write === true || failed.error.details.mutates_project === false,
        true,
        JSON.stringify(failed),
      );
    }
    assert.deepEqual(dispatches, []);
    assert.deepEqual(undoCalls, []);

    generation = "2";
    const reconnected = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { take_ref: "take:guid:{TAKE-TWO}" },
    });
    assert.equal(reconnected.ok, true, JSON.stringify(reconnected));
    assert.equal(dispatches[0].refs.take_ref, "take:guid:{TAKE-TWO}");
    assert.equal(dispatches.some((entry) => entry.refs?.take_ref === "take:guid:{TAKE-ONE}"), false);
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
  });

  it("reuses a saved exact-project Recipe across fresh generations without relaxing project or owner trust", async () => {
    const draft = makeTwoMacroDraft();
    draft.portability = {
      ...draft.portability,
      bridge_generation: "generation:runtime_bound",
    };
    let projectIdentity = draft.portability.project_identity;
    let bridgeOwner = draft.portability.bridge_owner;
    let generation = "1";
    const dispatches = [];
    const { runtime } = makeRuntime({
      facts: (revision) => ({
        ...completeFacts(revision, draft),
        project_identity: projectIdentity,
        bridge_owner: bridgeOwner,
        bridge_generation: generation,
      }),
      dispatchers: {
        macro: async ({ stage }) => {
          dispatches.push({ stage_id: stage.id, generation });
          return macroEnvelope(stage.id === "inventory_checkpoint"
            ? { returned_count: 1 }
            : { project_ref: projectIdentity });
        },
      },
    });
    const saved = await saveFixture(runtime, draft);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const identity = exactIdentity(saved);

    const first = await runtime.call_recipe({ operation: "run", ...identity, inputs: { operation: "inspect" } });
    assert.equal(first.ok, true, JSON.stringify(first));
    generation = "2";
    const reconnected = await runtime.call_recipe({ operation: "run", ...identity, inputs: { operation: "inspect" } });
    assert.equal(reconnected.ok, true, JSON.stringify(reconnected));
    assert.deepEqual(dispatches.map((entry) => entry.generation), ["1", "1", "2", "2"]);

    projectIdentity = "project:tab:fixture-b";
    const projectDrift = await runtime.call_recipe({ operation: "run", ...identity, inputs: { operation: "inspect" } });
    assert.equal(projectDrift.ok, false, JSON.stringify(projectDrift));
    assert.equal(projectDrift.error.code, "TRUST_INVALID");
    projectIdentity = draft.portability.project_identity;
    bridgeOwner = "owner:other";
    const ownerDrift = await runtime.call_recipe({ operation: "run", ...identity, inputs: { operation: "inspect" } });
    assert.equal(ownerDrift.ok, false, JSON.stringify(ownerDrift));
    assert.equal(ownerDrift.error.code, "TRUST_INVALID");
    assert.equal(dispatches.length, 4);
  });

  it("stops after the active stage and closes Whole-Recipe Undo when the caller cancels", async () => {
    const controller = new AbortController();
    const undoCalls = [];
    let macroCalls = 0;
    let templateCalls = 0;
    const { runtime } = makeRuntime({
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: "recipe-undo-cancel", project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
          };
        },
      },
      dispatchers: {
        macro: async ({ signal }) => {
          macroCalls += 1;
          assert.equal(signal, controller.signal);
          controller.abort("fixture timeout");
          return macroEnvelope({ project_summary: { name: "Dialog" } });
        },
        template: async () => {
          templateCalls += 1;
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await saveFixture(runtime);
    const cancelled = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    }, { signal: controller.signal });

    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.status, "failed");
    assert.equal(cancelled.error.details.request_cancelled, true);
    assert.deepEqual(cancelled.stages.failed, ["run_macro"]);
    assert.deepEqual(cancelled.stages.completed, []);
    assert.deepEqual(cancelled.stages.not_started, ["readback"]);
    assert.equal(cancelled.execution_truth.mutation, "not_applied");
    assert.equal(cancelled.undo.status, "closed");
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
    assert.equal(undoCalls[1].mutation_truth, "not_run");
    assert.equal(macroCalls, 1);
    assert.equal(templateCalls, 0);
  });

  it("stops when cancelled during authoritative preflight without opening Whole-Recipe Undo", async () => {
    const controller = new AbortController();
    const undoCalls = [];
    const { runtime } = makeRuntime({
      facts(revision) {
        controller.abort("fixture preflight timeout");
        return completeFacts(revision);
      },
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: "must-not-open" };
        },
        async end(request) {
          undoCalls.push(request);
          return { ok: true, closed: true, verified: true, handle: request.handle };
        },
      },
    });
    const saved = await saveFixture(runtime);
    const cancelled = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    }, { signal: controller.signal });

    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error.code, "STAGE_FAILED");
    assert.equal(cancelled.error.details.request_cancelled, true);
    assert.equal(cancelled.error.details.zero_write, true);
    assert.deepEqual(undoCalls, []);
  });

  it("retains applied mutation truth when cancellation follows a mutating atomic result", async () => {
    const controller = new AbortController();
    const undoCalls = [];
    const { runtime } = makeRuntime({
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: "recipe-undo-mutating-cancel", project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
            rollback_attempted: request.disposition === "rollback",
            rollback_proven: request.disposition === "rollback",
          };
        },
      },
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: { name: "Dialog" } }),
        template: async () => {
          controller.abort("fixture timeout after mutation");
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await saveFixture(runtime);
    const cancelled = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    }, { signal: controller.signal });

    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error.details.request_cancelled, true);
    assert.equal(cancelled.execution_truth.mutation, "applied_verified");
    assert.equal(cancelled.undo.status, "closed");
    assert.equal(cancelled.proven_partial_changes.length, 1);
    assert.equal(undoCalls[1].mutation_truth, "applied");
  });

  it("keeps verified mutation truth separate when cancellation cannot prove Whole-Recipe Undo close", async () => {
    const controller = new AbortController();
    const { runtime } = makeRuntime({
      undoController: {
        async begin(request) {
          return { ok: true, opened: true, handle: "recipe-undo-cancel-close-fail", project_ref: request.project_ref };
        },
        async end() {
          throw new Error("close proof unavailable");
        },
      },
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: { name: "Dialog" } }),
        template: async () => {
          controller.abort("fixture timeout after mutation");
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await saveFixture(runtime);
    const cancelled = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    }, { signal: controller.signal });

    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error.details.request_cancelled, true);
    assert.equal(cancelled.execution_truth.mutation, "applied_verified");
    assert.equal(cancelled.undo.status, "close_unknown");
    assert.equal(cancelled.resume_safe, false);
  });

  it("fails before stage dispatch when Whole-Recipe Undo cannot open", async () => {
    let stageCalls = 0;
    const { runtime } = makeRuntime({
      undoController: {
        async begin() { throw new Error("begin unavailable"); },
        async end() { throw new Error("must not close"); },
      },
      dispatchers: {
        macro: async () => { stageCalls += 1; return macroEnvelope({ project_summary: {} }); },
        template: async () => { stageCalls += 1; return templateEnvelope({ track_ref: "track:index:0" }); },
      },
    });
    const saved = await saveFixture(runtime);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.status, "blocked");
    assert.equal(failed.error.details.zero_write, true);
    assert.equal(failed.execution_truth.mutation, "not_applied");
    assert.equal(failed.undo.status, "open_failed");
    assert.equal(stageCalls, 0);
  });

  it("keeps verified mutation truth separate when Whole-Recipe Undo close proof fails", async () => {
    let endCalls = 0;
    const { runtime } = makeRuntime({
      undoController: {
        async begin(request) {
          return { ok: true, opened: true, handle: "recipe-undo-close-fail", project_ref: request.project_ref };
        },
        async end() {
          endCalls += 1;
          throw new Error("active project changed before close proof");
        },
      },
    });
    const saved = await saveFixture(runtime);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.status, "partial");
    assert.equal(failed.error.details.undo_close_unknown, true);
    assert.equal(failed.execution_truth.mutation, "applied_verified");
    assert.equal(failed.undo.status, "close_unknown");
    assert.equal(failed.recovery.strategy, "inspect_and_repair");
    assert.equal(failed.resume_safe, false);
    assert.equal(endCalls, 1);
  });

  it("emergency-closes Whole-Recipe Undo once when a dispatcher result throws during normalization", async () => {
    const undoCalls = [];
    const { runtime } = makeRuntime({
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: "recipe-undo-throwing-result", project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
            rollback_attempted: true,
            rollback_proven: true,
          };
        },
      },
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: { name: "Dialog" } }),
        template: async () => Object.defineProperty({}, "contract", {
          get() { throw new Error("fixture result getter failed"); },
        }),
      },
    });
    const saved = await saveFixture(runtime);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });

    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.equal(failed.error.details.recipe_undo_emergency_close, true);
    assert.equal(failed.error.details.recipe_undo_status, "closed");
    assert.equal(failed.execution_truth.mutation, "unknown");
    assert.equal(failed.undo.status, "closed");
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
    assert.equal(undoCalls[1].mutation_truth, "unknown");
  });

  it("bounds a never-resolving stage by deadline, closes Undo, and permits the next run", async () => {
    const undoCalls = [];
    let blockTemplate = true;
    const { runtime } = makeRuntime({
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return { ok: true, opened: true, handle: `recipe-undo-deadline-${undoCalls.length}`, project_ref: request.project_ref };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
            rollback_attempted: request.disposition === "rollback",
            rollback_proven: request.disposition === "rollback",
          };
        },
      },
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: { name: "Dialog" } }),
        template: async () => blockTemplate
          ? new Promise(() => {})
          : templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const saved = await saveFixture(runtime);
    const request = {
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    };
    const startedAt = Date.now();
    const timedOut = await runtime.call_recipe({ ...request, deadline_ms: 20 });

    assert.equal(timedOut.ok, false, JSON.stringify(timedOut));
    assert.equal(timedOut.error.details.deadline_exceeded, true);
    assert.equal(timedOut.execution_truth.mutation, "applied_unverified");
    assert.equal(timedOut.undo.status, "closed");
    assert.ok(Date.now() - startedAt < 500);
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
    assert.equal(undoCalls[1].mutation_truth, "unknown");

    blockTemplate = false;
    const next = await runtime.call_recipe(request);
    assert.equal(next.ok, true, JSON.stringify(next));
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end", "begin", "end"]);
  });

  it("fails the declaring stage when verified readback omits a declared output", async () => {
    let templateCalls = 0;
    const { runtime } = makeRuntime({
      dispatchers: {
        macro: async () => macroEnvelope({}),
        template: async () => {
          templateCalls += 1;
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await saveFixture(runtime);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "READBACK_UNVERIFIED");
    assert.deepEqual(failed.error.details.missing_output_ports, ["project_summary"]);
    assert.deepEqual(failed.stages.failed, ["run_macro"]);
    assert.deepEqual(failed.stages.not_started, ["readback"]);
    assert.equal(templateCalls, 0);
  });

  it("does not satisfy declared outputs from Macro or Template envelope metadata", async () => {
    for (const kind of ["macro", "template"]) {
      const draft = makeMetadataShadowDraft(kind);
      let dispatcherCalls = 0;
      const { runtime } = makeRuntime({
        facts: (saved) => completeFacts(saved, draft),
        dispatchers: {
          [kind]: async () => {
            dispatcherCalls += 1;
            return kind === "macro"
              ? macroEnvelope({})
              : templateEnvelope({});
          },
        },
      });
      const saved = await runtime.call_recipe({
        operation: "save",
        draft,
        version: "1.0.0",
        revision_number: 1,
        saved_at: "1970-01-01T00:00:00.000Z",
      });
      assert.equal(saved.ok, true, `${kind}: ${JSON.stringify(saved)}`);

      const failed = await runtime.call_recipe({
        operation: "run",
        ...exactIdentity(saved),
        inputs: { track_name: "Dialog" },
      });
      assert.equal(failed.ok, false, kind);
      assert.equal(failed.error.code, "READBACK_UNVERIFIED", kind);
      assert.deepEqual(failed.error.details.missing_output_ports, ["status"], kind);
      assert.equal(failed.latest_checkpoint, null, kind);
      assert.equal(dispatcherCalls, 1, kind);
    }
  });

  it("composes object runtimes with raw Macro, Template, get_state, and checkpoint envelopes", async () => {
    const events = [];
    const draft = makeComposedDraft();
    const productRuntime = {
      async call_template(request, execution) {
        const { id, input } = request;
        events.push([
          id.startsWith("macro.") ? "macro" : "template",
          id,
          input,
          execution,
          request[CALL_TEMPLATE_INTERNAL_RECIPE_UNDO],
        ]);
        return id.startsWith("macro.")
          ? macroEnvelope({ project_summary: { name: input.track_name } })
          : templateEnvelope({ track_ref: "track:index:4" });
      },
    };
    const getStateRuntime = {
      async get_state(input) {
        events.push(["get_state", input]);
        return {
          contract: "get_state.runtime.v1",
          ok: true,
          result: { project_summary: { track_count: 5 } },
        };
      },
    };
    const { runtime } = makeRuntime({
      facts: (saved) => completeFacts(saved, draft),
      undoController: {
        async begin(request) {
          return { ok: true, opened: true, handle: "object-runtime-undo", project_ref: request.project_ref };
        },
        async end(request) {
          return { ok: true, closed: true, verified: true, handle: request.handle, project_ref: request.project_ref };
        },
      },
      dispatchers: {
        macro: productRuntime,
        template: productRuntime,
        get_state: getStateRuntime,
        checkpoint: async ({ stage, revision }) => {
          events.push(["checkpoint", stage.id]);
          const declaration = revision.draft.checkpoints.find((item) => item.id === stage.checkpoint);
          return {
            contract: "call_recipe.checkpoint_proof.v1",
            ok: true,
            verified: true,
            checkpoint_id: declaration.id,
            evidence_id: declaration.evidence_id,
            resume_identity: declaration.resume_identity,
            recipe_id: revision.recipe_id,
            version: revision.version,
            revision: revision.revision,
            content_hash: revision.content_hash,
            summary: "Runtime-owned checkpoint proof accepted.",
            outputs: {},
          };
        },
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    const ran = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });
    assert.equal(ran.ok, true);
    assert.equal(ran.counts.processed, 4);
    assert.equal(ran.counts.applied, 4);
    assert.deepEqual(events.map((entry) => entry[0]), ["macro", "template", "get_state", "checkpoint"]);
    assert.equal(events[0][3].signal?.aborted, false);
    assert.equal(typeof events[0][3].deadline?.isExpired, "function");
    assert.equal(typeof events[0][3].performance?.counters, "object");
    assert.equal(events[0][4]?.suppress_child_undo, true);
    assert.equal(ran.latest_checkpoint.stage_id, "checkpoint_proof");
    assert.equal(ran.latest_checkpoint.proof.explicit_checkpoint_proof, true);
  });

  it("retains verified Macro partial changes and does not claim a safe replay", async () => {
    let templateCalls = 0;
    const { runtime } = makeRuntime({
      dispatchers: {
        macro: async () => macroPartialFailureEnvelope(),
        template: async () => {
          templateCalls += 1;
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await saveFixture(runtime);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "MACRO_PARTIAL_FAILURE");
    assert.equal(failed.resume_safe, false);
    assert.equal(failed.proven_partial_changes.length, 1);
    assert.equal(failed.proven_partial_changes[0].change.status, "applied");
    assert.equal(failed.proven_partial_changes[0].change.live_readback.status, "passed");
    assert.equal(templateCalls, 0);
  });

  it("retains compact ok/pass Macro changes as proven mutation truth", async () => {
    const { runtime } = makeRuntime({
      dispatchers: {
        macro: async () => {
          const envelope = macroPartialFailureEnvelope();
          envelope.result.changes = [{
            kind: "item.variation",
            id: "variation-1",
            status: "ok",
            mutation: "done",
            readback: "pass",
          }];
          for (let i = 0; i < 4; i += 1) {
            envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
          }
          return envelope;
        },
        template: async () => templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const saved = await saveFixture(runtime);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.proven_partial_changes.length, 1, JSON.stringify(failed));
    assert.equal(failed.proven_partial_changes[0].change.status, "ok");
    assert.equal(failed.proven_partial_changes[0].change.readback, "pass");
    assert.equal(failed.execution_truth.native_mutation_count, 0, "the fixture Macro stage is read-only; proven rows still remain explicit");

    const skipped = macroPartialFailureEnvelope();
    skipped.result.changes = [{
      kind: "item.variation",
      id: "variation-skipped",
      status: "ok",
      mutation: "skip",
      readback: "pass",
    }];
    for (let i = 0; i < 4; i += 1) {
      skipped.budget.actual_bytes = Buffer.byteLength(JSON.stringify(skipped), "utf8");
    }
    const second = makeRuntime({ dispatchers: { macro: async () => skipped } });
    const secondSaved = await saveFixture(second.runtime);
    const skippedFailure = await second.runtime.call_recipe({
      operation: "run",
      ...exactIdentity(secondSaved),
      inputs: { track_name: "Dialog" },
    });
    assert.deepEqual(skippedFailure.proven_partial_changes, []);
    assert.equal(skippedFailure.execution_truth.native_mutation_count, 0);
  });

  it("rejects full-row readback claims when mutation truth is not completed", async () => {
    for (const status of ["failed", "unknown_or_partial", "pending", "not_run"]) {
      const envelope = macroPartialFailureEnvelope();
      envelope.result.changes = [{
        kind: "project.index.refresh",
        status: "applied",
        mutation: { status },
        live_readback: { status: "passed" },
      }];
      for (let i = 0; i < 4; i += 1) {
        envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
      }
      const { runtime } = makeRuntime({ dispatchers: { macro: async () => envelope } });
      const saved = await saveFixture(runtime);
      const failed = await runtime.call_recipe({
        operation: "run",
        ...exactIdentity(saved),
        inputs: { track_name: "Dialog" },
      });
      assert.deepEqual(failed.proven_partial_changes, [], status);
      assert.equal(failed.execution_truth.native_mutation_count, 0, status);
    }
  });

  it("fails closed on trust drift and zero-write preflight failures", async () => {
    const { runtime } = makeRuntime({
      facts: (saved) => ({ ...completeFacts(saved), project_identity: "project:other" }),
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: {} }),
        template: async () => templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const identity = {
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
    };

    const trustFail = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(trustFail.ok, false);
    assert.equal(trustFail.status, "blocked");
    assert.equal(trustFail.error.code, "TRUST_INVALID");
    assert.equal(trustFail.resume_safe, false);
    assert.equal(trustFail.next_call.tool, "call_recipe");

    const { runtime: trustedRuntime } = makeRuntime({
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: {} }),
        template: async () => templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const trustedSaved = await saveFixture(trustedRuntime);
    const missingInput = await trustedRuntime.call_recipe({
      operation: "run",
      ...exactIdentity(trustedSaved),
      inputs: {},
    });
    assert.equal(missingInput.ok, false);
    assert.equal(missingInput.error.code, "PREFLIGHT_FAILED");
    assert.equal(missingInput.details?.mutates_project ?? missingInput.error?.details?.mutates_project, false);
  });

  it("preserves partial progress and supports safe resume while rejecting unsafe resume", async () => {
    let templateCalls = 0;
    let factsCalls = 0;
    const { runtime } = makeRuntime({
      facts: (revision) => {
        factsCalls += 1;
        return completeFacts(revision);
      },
      dispatchers: {
        macro: async ({ inputs }) => macroEnvelope({ project_summary: { name: inputs.track_name } }),
        template: async () => {
          templateCalls += 1;
          if (templateCalls <= 2) {
            return templateFailureEnvelope({ zeroWrite: true });
          }
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const identity = {
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
    };

    const partial = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(partial.ok, false);
    assert.equal(partial.status, "partial");
    assert.equal(partial.error.code, "TEMPLATE_BLOCKED");
    assert.equal(partial.resume_safe, true);
    assert.deepEqual(partial.counts, { processed: 2, applied: 1, skipped: 0 });
    assert.deepEqual(partial.stages.completed, ["run_macro"]);
    assert.deepEqual(partial.stages.failed, ["readback"]);
    assert.deepEqual(partial.stages.not_started, []);
    assert.equal(partial.next_call.arguments.operation, "resume");
    assert.equal(partial.undo.claimed, false);

    const unsafe = await runtime.call_recipe({
      operation: "resume",
      run_id: partial.run_id,
      checkpoint_id: "wrong_checkpoint",
      ...identity,
    });
    assert.equal(unsafe.ok, false);
    assert.ok(["CHECKPOINT_MISMATCH", "RESUME_UNSAFE", "RESUME_IDENTITY_INVALID"].includes(unsafe.error.code));

    const override = await runtime.call_recipe({
      operation: "resume",
      run_id: partial.run_id,
      checkpoint_id: partial.latest_checkpoint.checkpoint_id,
      ...identity,
      inputs: { track_name: "Override forbidden" },
    });
    assert.equal(override.ok, false);
    assert.equal(override.error.code, "RESUME_IDENTITY_INVALID");

    const drift = await runtime.call_recipe({
      operation: "resume",
      run_id: partial.run_id,
      checkpoint_id: partial.latest_checkpoint.checkpoint_id,
      ...identity,
      content_hash: "f".repeat(64),
    });
    assert.equal(drift.ok, false);
    assert.equal(drift.error.code, "RESUME_IDENTITY_INVALID");
    assert.equal(templateCalls, 1);

    const resumedPartial = await runtime.call_recipe({
      operation: "resume",
      run_id: partial.run_id,
      checkpoint_id: partial.latest_checkpoint.checkpoint_id,
      ...identity,
    });
    assert.equal(resumedPartial.ok, false);
    assert.equal(resumedPartial.operation, "resume");
    assert.equal(resumedPartial.status, "partial");
    assert.equal(resumedPartial.run_id, partial.run_id);
    assert.deepEqual(resumedPartial.counts, { processed: 4, applied: 1, skipped: 1 });
    assert.deepEqual(resumedPartial.stages.completed, ["run_macro"]);
    assert.deepEqual(resumedPartial.stages.failed, ["readback"]);
    assert.deepEqual(resumedPartial.stages.not_started, []);

    const resumed = await runtime.call_recipe({
      operation: "resume",
      run_id: partial.run_id,
      checkpoint_id: resumedPartial.latest_checkpoint.checkpoint_id,
      ...identity,
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.operation, "resume");
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.run_id, partial.run_id);
    assert.deepEqual(resumed.counts, { processed: 6, applied: 2, skipped: 2 });
    assert.equal(
      resumed.counts.processed - resumed.counts.applied - resumed.counts.skipped,
      2,
    );
    assert.equal(resumed.evidence_ref, partial.evidence_ref);
    const evidence = await runtime.call_recipe({
      operation: "get",
      evidence_ref: resumed.evidence_ref,
      limit: 8,
    });
    assert.deepEqual(
      evidence.items.map((item) => [item.stage_id, item.status]),
      [
        ["run_macro", "applied"],
        ["readback", "failed"],
        ["readback", "failed"],
        ["readback", "applied"],
      ],
    );
    assert.equal(templateCalls, 3);
    assert.equal(factsCalls, 3);
  });

  it("treats verified idempotent Macro readback as zero-write and resume-safe", async () => {
    let macroCalls = 0;
    const draft = makeTwoMacroDraft();
    const { runtime } = makeRuntime({
      facts: (revision) => completeFacts(revision, draft),
      dispatchers: {
        macro: async ({ stage }) => {
          macroCalls += 1;
          if (stage.id === "resume_activate" && macroCalls === 2) {
            return macroZeroWriteFailureWithIdempotentReadback();
          }
          return macroEnvelope(stage.id === "inventory_checkpoint"
            ? { returned_count: 2 }
            : { project_ref: "project:path:/tmp/active.RPP" });
        },
      },
    });
    const saved = await saveFixture(runtime, draft);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const identity = exactIdentity(saved);
    const partial = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { operation: "activate_project_tab" },
    });

    assert.equal(partial.ok, false);
    assert.equal(partial.status, "partial", JSON.stringify(partial));
    assert.equal(partial.resume_safe, true);
    assert.equal(partial.error.details.zero_write, true);
    assert.deepEqual(partial.counts, { processed: 2, applied: 1, skipped: 0 });
    assert.deepEqual(partial.proven_partial_changes, []);

    const resumed = await runtime.call_recipe({
      operation: "resume",
      ...identity,
      run_id: partial.run_id,
      checkpoint_id: partial.latest_checkpoint.checkpoint_id,
    });
    assert.equal(resumed.ok, true);
    assert.deepEqual(resumed.counts, { processed: 4, applied: 2, skipped: 1 });
  });

  it("preserves retained progress when a runtime-bound resume drifts before dispatch", async () => {
    let factsCalls = 0;
    let macroCalls = 0;
    let templateCalls = 0;
    const undoCalls = [];
    const draft = structuredClone(makeDraft());
    draft.portability = {
      ...draft.portability,
      bridge_generation: "generation:runtime_bound",
    };
    const { runtime } = makeRuntime({
      facts: (revision) => {
        factsCalls += 1;
        const facts = completeFacts(revision, draft);
        return factsCalls === 1
          ? {
              ...facts,
              bridge_generation: "1",
            }
          : {
              ...facts,
              bridge_generation: "2",
            };
      },
      undoController: {
        async begin(request) {
          undoCalls.push(request);
          return {
            ok: true,
            opened: true,
            handle: "recipe-undo-runtime-binding",
            project_ref: request.project_ref,
          };
        },
        async end(request) {
          undoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
          };
        },
      },
      dispatchers: {
        macro: async ({ inputs }) => {
          macroCalls += 1;
          return macroEnvelopeWithChange({
            project_summary: { name: inputs.track_name },
          });
        },
        template: async () => {
          templateCalls += 1;
          return templateFailureEnvelope({ zeroWrite: true });
        },
      },
    });
    const saved = await saveFixture(runtime, draft);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const identity = exactIdentity(saved);
    const partial = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(partial.resume_safe, true, JSON.stringify(partial));
    assert.equal(partial.proven_partial_changes.length, 1);

    const blocked = await runtime.call_recipe({
      operation: "resume",
      run_id: partial.run_id,
      checkpoint_id: partial.latest_checkpoint.checkpoint_id,
      ...identity,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.operation, "resume");
    assert.equal(blocked.error.code, "TRUST_INVALID");
    assert.equal(blocked.error.details.invalidation_reasons.includes("runtime_binding_mismatch"), true);
    assert.deepEqual(blocked.stages.completed, ["run_macro"]);
    assert.deepEqual(blocked.stages.not_started, ["readback"]);
    assert.equal(blocked.proven_partial_changes.length, 1);
    assert.deepEqual(blocked.latest_checkpoint, partial.latest_checkpoint);
    assert.equal(blocked.evidence_ref, partial.evidence_ref);
    assert.equal(macroCalls, 1);
    assert.equal(templateCalls, 1);
    assert.deepEqual(undoCalls.map((call) => call.operation), ["begin", "end"]);
  });

  it("never replays an unverified mutation and rejects resume input or identity drift", async () => {
    let templateCalls = 0;
    const { runtime } = makeRuntime({
      dispatchers: {
        macro: async ({ inputs }) => macroEnvelope({ project_summary: { name: inputs.track_name } }),
        template: async () => {
          templateCalls += 1;
          return {
            ...templateEnvelope({ track_ref: "track:index:0" }),
            result: {
              ...templateEnvelope({ track_ref: "track:index:0" }).result,
              readback: null,
            },
          };
        },
      },
    });
    const saved = await saveFixture(runtime);
    const identity = exactIdentity(saved);
    const failed = await runtime.call_recipe({
      operation: "run",
      ...identity,
      inputs: { track_name: "Dialog" },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "READBACK_UNVERIFIED");
    assert.equal(failed.resume_safe, false);
    assert.equal(failed.proven_partial_changes.length, 0);

    const resume = await runtime.call_recipe({
      operation: "resume",
      ...identity,
      run_id: failed.run_id,
      checkpoint_id: failed.latest_checkpoint.checkpoint_id,
    });
    assert.equal(resume.ok, false);
    assert.equal(resume.error.code, "RESUME_UNSAFE");
    assert.equal(templateCalls, 1);
  });

  it("fails closed without fresh authoritative facts and before insufficient-budget mutations", async () => {
    const catalog = makeCatalog();
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-no-facts-"));
    const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: {} }),
        template: async () => templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const tooSmall = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 1,
      budget: { max_response_bytes: 4095 },
    });
    assert.equal(tooSmall.ok, false);
    assert.equal(tooSmall.error.code, "RESPONSE_BUDGET_INSUFFICIENT");
    assert.equal((await runtime.call_recipe({ operation: "list" })).count, 0);

    const saved = await saveFixture(runtime);
    const noFacts = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });
    assert.equal(noFacts.ok, false);
    assert.equal(noFacts.error.code, "RUNTIME_FACTS_UNAVAILABLE");
  });

  it("reloads native project and Bridge identity for every run and rejects later drift before dispatch", async () => {
    const catalog = makeCatalog();
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-fresh-facts-"));
    const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
    const draft = makeDraft();
    draft.portability.bridge_generation = "1";
    let projectRef = draft.portability.project_identity;
    let bridgeGeneration = 1;
    let inventoryReads = 0;
    let heartbeatReads = 0;
    let dispatchCalls = 0;
    const runtimeFactsProvider = createAuthoritativeRuntimeFactsProvider({
      catalog,
      projectInventoryProvider: async () => {
        inventoryReads += 1;
        return {
          projects: [{ project_ref: projectRef, active: true }],
          total_count: 1,
          returned_count: 1,
          coverage_status: "complete",
        };
      },
      bridgeLivenessProvider: async () => {
        heartbeatReads += 1;
        return {
          ready: true,
          heartbeat: {
            observed: {
              active_owner: draft.portability.bridge_owner,
              active_generation: bridgeGeneration,
            },
          },
        };
      },
      riskGrantProvider: async () => [...draft.risk_grants],
      checkpointEvidenceProvider: async ({ identity, recomputed_content_hash }) => (
        draft.checkpoints.map((checkpoint) => ({
          checkpoint_id: checkpoint.id,
          evidence_id: checkpoint.evidence_id,
          resume_identity: checkpoint.resume_identity,
          recipe_id: identity.recipe_id,
          version: identity.version,
          revision: identity.revision,
          content_hash: recomputed_content_hash,
        }))
      ),
    });
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      runtimeFactsProvider,
      dispatchers: {
        macro: async () => {
          dispatchCalls += 1;
          return macroEnvelope({ project_summary: {} });
        },
        template: async () => {
          dispatchCalls += 1;
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const first = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(dispatchCalls, 2);

    projectRef = "project:path:/tmp/other.RPP";
    bridgeGeneration = 2;
    const drifted = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.error.code, "TRUST_INVALID");
    assert.deepEqual([...drifted.error.details.invalidation_reasons].sort(), [
      "bridge_generation_mismatch",
      "project_identity_mismatch",
    ]);
    assert.equal(dispatchCalls, 2);
    assert.equal(inventoryReads, 2);
    assert.equal(heartbeatReads, 2);
  });

  it("requires independent risk/checkpoint providers and recomputes stored content truth", async () => {
    const catalog = makeCatalog();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const baseOptions = {
      catalog,
      projectInventoryProvider: async () => ({
        projects: [{ project_ref: sealed.draft.portability.project_identity, active: true }],
        total_count: 1,
        returned_count: 1,
        coverage_status: "complete",
      }),
      bridgeLivenessProvider: async () => ({
        ready: true,
        heartbeat: {
          observed: {
            active_owner: sealed.draft.portability.bridge_owner,
            active_generation: 1,
          },
        },
      }),
    };
    assert.throws(
      () => createAuthoritativeRuntimeFactsProvider(baseOptions),
      (error) => error?.code === "RUNTIME_FACTS_UNAVAILABLE",
    );

    const provider = createAuthoritativeRuntimeFactsProvider({
      ...baseOptions,
      riskGrantProvider: async () => [...sealed.draft.risk_grants],
      checkpointEvidenceProvider: async ({ identity, recomputed_content_hash }) => (
        sealed.draft.checkpoints.map((checkpoint) => ({
          checkpoint_id: checkpoint.id,
          evidence_id: checkpoint.evidence_id,
          resume_identity: checkpoint.resume_identity,
          recipe_id: identity.recipe_id,
          version: identity.version,
          revision: identity.revision,
          content_hash: recomputed_content_hash,
        }))
      ),
    });
    const drifted = structuredClone(sealed);
    drifted.draft.title = "Changed after sealing";
    const facts = await provider({ revision: drifted, operation: "run" });
    assert.notEqual(facts.content_hash, sealed.content_hash);
    assert.equal(facts.checkpoint_evidence.every((item) => item.content_hash === facts.content_hash), true);
  });

  it("blocks server-owned risk-grant drift before any stage dispatch", async () => {
    const catalog = makeCatalog();
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-risk-drift-"));
    const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
    let dispatchCalls = 0;
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      dispatchers: {
        macro: async () => { dispatchCalls += 1; return macroEnvelope({ project_summary: {} }); },
        template: async () => { dispatchCalls += 1; return templateEnvelope({ track_ref: "track:index:0" }); },
      },
      runtimeFactsProvider: createAuthoritativeRuntimeFactsProvider({
        catalog,
        projectInventoryProvider: async () => ({
          projects: [{ project_ref: "project:tab:fixture-a", active: true }],
          total_count: 1,
          returned_count: 1,
          coverage_status: "complete",
        }),
        bridgeLivenessProvider: async () => ({
          ready: true,
          heartbeat: { observed: { active_owner: "owner:fixture", active_generation: 1 } },
        }),
        riskGrantProvider: async () => ["read"],
        checkpointEvidenceProvider: async ({ identity, recomputed_content_hash }) => (
          makeDraft().checkpoints.map((checkpoint) => ({
            checkpoint_id: checkpoint.id,
            evidence_id: checkpoint.evidence_id,
            resume_identity: checkpoint.resume_identity,
            recipe_id: identity.recipe_id,
            version: identity.version,
            revision: identity.revision,
            content_hash: recomputed_content_hash,
          }))
        ),
      }),
    });
    const saved = await saveFixture(runtime);
    const blocked = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "TRUST_INVALID");
    assert.deepEqual(blocked.error.details.invalidation_reasons, ["risk_grant_mismatch"]);
    assert.equal(dispatchCalls, 0);
  });

  it("provides the revision's exact declared risk grants to server-owned policy", async () => {
    const catalog = makeCatalog();
    const draft = makeDraft();
    let providerContext = null;
    const factsProvider = createAuthoritativeRuntimeFactsProvider({
      catalog,
      projectInventoryProvider: async () => ({
        projects: [{ project_ref: "project:tab:fixture-a", active: true }],
        total_count: 1,
        returned_count: 1,
        coverage_status: "complete",
      }),
      bridgeLivenessProvider: async () => ({
        ready: true,
        heartbeat: { observed: { active_owner: "owner:fixture", active_generation: 1 } },
      }),
      riskGrantProvider: async (context) => {
        providerContext = context;
        return [...context.declared_risk_grants];
      },
      checkpointEvidenceProvider: async () => [],
    });
    const sealed = sealExecutableRecipeRevision(draft, {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const facts = await factsProvider({ revision: sealed, operation: "run" });
    assert.deepEqual(providerContext.declared_risk_grants, ["read", "write"]);
    assert.deepEqual(facts.risk_grants, ["read", "write"]);
  });

  it("pages saved revisions and keeps mutation success and failure within the calculated floor", async () => {
    const { runtime } = makeRuntime();
    const first = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
      budget: { max_response_bytes: 4096 },
    });
    const second = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 2,
      saved_at: "1970-01-01T00:00:01.000Z",
      budget: { max_response_bytes: 4096 },
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(Buffer.byteLength(JSON.stringify(second), "utf8") <= 4096, true);

    const page1 = await runtime.call_recipe({ operation: "list", limit: 1, budget: { max_response_bytes: 2048 } });
    assert.equal(page1.count, 1);
    assert.equal(page1.total, 2);
    assert.equal(page1.page.has_more, true);
    const page2 = await runtime.call_recipe({
      operation: "list",
      limit: 1,
      cursor: page1.page.next_cursor,
      budget: { max_response_bytes: 2048 },
    });
    assert.equal(page2.count, 1);
    assert.equal(page2.page.has_more, false);

    const tooTightList = await runtime.call_recipe({
      operation: "list",
      limit: 1,
      budget: { max_response_bytes: 512 },
    });
    assert.equal(tooTightList.ok, false);
    assert.equal(tooTightList.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(Object.hasOwn(tooTightList, "response_compacted"), false);

    const tooTightMutation = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(second),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: 4096 },
    });
    assert.equal(tooTightMutation.ok, false);
    assert.equal(tooTightMutation.error.code, "RESPONSE_BUDGET_INSUFFICIENT");
    assert.equal(tooTightMutation.error.details.zero_write, true);
    const mutationBudget = tooTightMutation.error.details.required;

    const success = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(second),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: mutationBudget },
    });
    assert.equal(success.ok, true);
    assert.equal(Buffer.byteLength(JSON.stringify(success), "utf8") <= mutationBudget, true);

    const { runtime: failingRuntime } = makeRuntime({
      dispatchers: {
        macro: async () => macroPartialFailureEnvelope("x".repeat(6000)),
        template: async () => templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const failingSaved = await saveFixture(failingRuntime);
    const failure = await failingRuntime.call_recipe({
      operation: "run",
      ...exactIdentity(failingSaved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: mutationBudget },
    });
    assert.equal(failure.ok, false);
    assert.equal(Buffer.byteLength(JSON.stringify(failure), "utf8") <= mutationBudget, true);
    assert.equal(failure.error.code, "MACRO_PARTIAL_FAILURE");
    assert.equal(failure.proven_partial_changes.length, 1);
  });

  it("shrinks the final default-budget Recipe list envelope after performance evidence without losing cursor coverage", async () => {
    const { runtime } = makeRuntime();
    for (let revision = 1; revision <= 32; revision += 1) {
      const saved = await runtime.call_recipe({
        operation: "save",
        draft: makeDraft(),
        version: "1.0.0",
        revision_number: revision,
        saved_at: new Date(revision * 1000).toISOString(),
      });
      assert.equal(saved.ok, true);
    }

    const seen = [];
    let cursor;
    for (let pageIndex = 0; pageIndex < 32; pageIndex += 1) {
      const page = await runtime.call_recipe({
        operation: "list",
        limit: 32,
        ...(cursor ? { cursor } : {}),
      });
      assert.equal(page.ok, true);
      assert.equal(page.count > 0, true);
      assert.equal(Buffer.byteLength(JSON.stringify(page), "utf8") <= 16_384, true);
      assert.equal(page.page.cursor, cursor ?? "0");
      seen.push(...page.items.map((item) => item.revision));
      if (!page.page.has_more) {
        assert.equal(page.page.next_cursor, null);
        break;
      }
      assert.equal(page.page.next_cursor, String(seen.length));
      cursor = page.page.next_cursor;
    }
    assert.deepEqual(seen, Array.from({ length: 32 }, (_, index) => index + 1));
  });

  it("sizes the mutation floor from a valid 48-stage revision before any dispatcher write", async () => {
    const catalog = makeCatalog();
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-max-graph-budget-"));
    const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
    const draft = makeMaxStageDraft();
    let dispatcherCalls = 0;
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      runtimeFactsProvider: ({ revision }) => completeFacts(revision, draft),
      dispatchers: {
        macro: async () => {
          dispatcherCalls += 1;
          return macroPartialFailureEnvelope("x".repeat(6000));
        },
        template: async () => {
          dispatcherCalls += 1;
          return templateEnvelope({ track_ref: "track:index:0" });
        },
        get_state: async () => {
          dispatcherCalls += 1;
          return { contract: "get_state.runtime.v1", ok: true, result: {} };
        },
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const blocked = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: 4096 },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "RESPONSE_BUDGET_INSUFFICIENT");
    assert.equal(blocked.error.details.zero_write, true);
    assert.equal(blocked.error.details.stage_count, 48);
    assert.ok(blocked.error.details.required > 4096);
    assert.ok(blocked.error.details.required <= 65_536);
    assert.equal(dispatcherCalls, 0);

    const failure = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: blocked.error.details.required },
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "MACRO_PARTIAL_FAILURE");
    assert.equal(failure.stages.failed.length, 1);
    assert.equal(failure.stages.not_started.length, 47);
    assert.equal(failure.proven_partial_changes.length, 1);
    assert.ok(failure.recovery);
    assert.ok(failure.undo);
    assert.equal(typeof failure.resume_safe, "boolean");
    assert.ok(failure.next_call);
    assert.ok(Buffer.byteLength(JSON.stringify(failure), "utf8") <= blocked.error.details.required);
    assert.equal(dispatcherCalls, 1);
  });

  it("compacts more than four partial changes at the exact floor without losing cumulative counts", async () => {
    let dispatcherCalls = 0;
    const { runtime } = makeRuntime({
      dispatchers: {
        macro: async () => {
          dispatcherCalls += 1;
          return macroLargePartialFailureEnvelope();
        },
        template: async () => templateEnvelope({ track_ref: "track:index:0" }),
      },
    });
    const saved = await saveFixture(runtime);
    const blocked = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: 4096 },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "RESPONSE_BUDGET_INSUFFICIENT");
    assert.equal(blocked.error.details.zero_write, true);
    assert.ok(blocked.error.details.required > 4096);
    assert.equal(dispatcherCalls, 0);

    const failure = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: blocked.error.details.required },
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "MACRO_PARTIAL_FAILURE");
    assert.equal(failure.response_compacted, true, JSON.stringify({
      required: blocked.error.details.required,
      bytes: Buffer.byteLength(JSON.stringify(failure), "utf8"),
      partial_changes: failure.proven_partial_changes.length,
    }));
    assert.deepEqual(failure.counts, { processed: 1, applied: 0, skipped: 0 });
    assert.equal(failure.proven_partial_changes.length, 4);
    assert.equal(failure.stages.failed.length, 1);
    assert.ok(failure.recovery);
    assert.ok(failure.undo);
    assert.ok(Buffer.byteLength(JSON.stringify(failure), "utf8") <= blocked.error.details.required);
    assert.equal(dispatcherCalls, 1);
  });

  it("budgets all 32 bounded verified outputs before dispatch and preserves the full success envelope", async () => {
    const draft = makeManyOutputDraft(32);
    const outputValues = Object.fromEntries(
      draft.outputs.map((output, index) => [output.id, `${index}:${"x".repeat(900)}`]),
    );
    let dispatcherCalls = 0;
    const { runtime } = makeRuntime({
      facts: (revision) => completeFacts(revision, draft),
      dispatchers: {
        template: async () => {
          dispatcherCalls += 1;
          return templateEnvelope(outputValues);
        },
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));

    const blocked = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: 4096 },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "RESPONSE_BUDGET_INSUFFICIENT");
    assert.equal(blocked.error.details.zero_write, true);
    assert.ok(blocked.error.details.required > 4096);
    assert.ok(blocked.error.details.required <= 65_536);
    assert.equal(dispatcherCalls, 0);

    const success = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: blocked.error.details.required },
    });
    assert.equal(success.ok, true, JSON.stringify(success));
    assert.equal(success.verified_outputs.length, 32);
    assert.equal(Object.hasOwn(success, "response_compacted"), false);
    assert.ok(success.timing);
    assert.ok(success.latest_checkpoint);
    assert.ok(Buffer.byteLength(JSON.stringify(success), "utf8") <= blocked.error.details.required);
    assert.equal(dispatcherCalls, 1);
  });

  it("uses the shared verified-output budget for a few complete Recipe outputs", async () => {
    const draft = makeManyOutputDraft(5);
    const outputValues = Object.fromEntries(
      draft.outputs.map((output, index) => [output.id, `${index}:${"x".repeat(2_000)}`]),
    );
    const { runtime } = makeRuntime({
      facts: (revision) => completeFacts(revision, draft),
      dispatchers: {
        template: async () => templateEnvelope(outputValues),
      },
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const success = await runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      budget: { max_response_bytes: 65_536 },
    });
    assert.equal(success.ok, true, JSON.stringify(success));
    assert.equal(success.verified_outputs.length, 5);
    assert.equal(success.verified_outputs.every((output) => typeof output.value === "string"), true);
    assert.equal(success.verified_outputs.every((output) => output.value.length > 2_000), true);
    assert.ok(Buffer.byteLength(JSON.stringify(success), "utf8") <= 65_536);
  });

  it("accepts only exact native D30 project inventory truth", async () => {
    const activeRow = { project_ref: "project:path:/tmp/active.RPP", active: true };
    const success = await readFreshOpenProjectInventory({
      callTemplateRuntime: {
        call_template: async () => nativeProjectInventoryExecution({ projects: [activeRow] }),
      },
      callContext: { allocate: () => ({ request_sequence: 1 }) },
    });
    assert.equal(success.projects[0].project_ref, activeRow.project_ref);

    const summary = nativeProjectInventorySummary({ projects: [activeRow] });
    const failures = [
      { name: "data-only", execution: { ...nativeProjectInventoryExecution(summary), result: { data: summary } } },
      { name: "generic-readback", execution: { ...nativeProjectInventoryExecution(summary), result: { readback: summary } } },
      {
        name: "missing-native-marker",
        execution: nativeProjectInventoryExecution({ ...summary, live_materialization: "generic_readback" }),
      },
      {
        name: "verification-failed",
        execution: { ...nativeProjectInventoryExecution(summary), verification: { status: "failed" } },
      },
      {
        name: "duplicate-ref",
        execution: nativeProjectInventoryExecution({
          projects: [activeRow, { ...activeRow, active: false }],
        }),
      },
      {
        name: "invalid-ref",
        execution: nativeProjectInventoryExecution({ projects: [{ project_ref: "project:fixture", active: true }] }),
      },
      {
        name: "multiple-active",
        execution: nativeProjectInventoryExecution({
          projects: [activeRow, { project_ref: "project:tab:unsaved-2", active: true }],
        }),
      },
    ];
    for (const failure of failures) {
      await assert.rejects(
        () => readFreshOpenProjectInventory({
          callTemplateRuntime: { call_template: async () => failure.execution },
          callContext: { allocate: () => ({ request_sequence: 1 }) },
        }),
        undefined,
        failure.name,
      );
    }
  });

  it("uses fresh server-owned context and a fixed budget for every stdio Recipe stage", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-stdio-stage-"));
    const allocationHints = [];
    const stageCalls = [];
    let sequence = 0;
    const callContext = {
      allocate(hint) {
        allocationHints.push(hint);
        sequence += 1;
        return {
          client_id: "openreaper-mcp",
          session_id: "server-session",
          expected_owner: "owner:fixture",
          expected_generation: 1,
          created_at: `2026-07-21T00:00:0${sequence}.000Z`,
          request_sequence: sequence,
        };
      },
    };
    const callTemplateRuntime = {
      async call_template(request) {
        if (request.id === "template.project.list_open_projects") {
          return nativeProjectInventoryExecution({
            projects: [{ project_ref: "project:tab:fixture-a", active: true }],
          });
        }
        stageCalls.push(request);
        if (request.id === "macro.project.inspect") {
          return macroEnvelope({ project_summary: { name: request.input.track_name } });
        }
        if (request.id === "template.tracks.create_track") {
          return templateEnvelope({ track_ref: "track:index:0" });
        }
        throw new Error(`Unexpected stage ${request.id}`);
      },
    };
    const undoBridge = makeRecipeUndoBridge();
    const binding = createStdioCallRecipeRuntime({
      env: {
        OPENREAPER_EXECUTABLE_RECIPE_ROOT: root,
        OPENREAPER_EXECUTABLE_RECIPE_SOURCE: "user",
        OPENREAPER_EXECUTABLE_RECIPE_CATALOG_JSON: JSON.stringify({ macros: [], templates: [], capabilities: [] }),
        OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON: JSON.stringify(["read", "write"]),
      },
      callTemplateRuntime,
      artifactRuntime: null,
      callContext,
      liveBridge: {
        executor: undoBridge,
      },
    });
    assert.ok(binding);
    const saved = await saveFixture(binding.runtime, makeProductDraft());
    const run = await binding.runtime.call_recipe({
      operation: "run",
      ...exactIdentity(saved),
      inputs: { track_name: "Dialog" },
      context: { client_id: "caller-controlled" },
      budget: { max_response_bytes: 8_192 },
    });
    assert.equal(run.ok, true, JSON.stringify(run));
    assert.equal(stageCalls.length, 2);
    assert.deepEqual(undoBridge.seen.map((request) => request.params.action), ["begin", "end"]);
    assert.equal(stageCalls.every((call) => call[CALL_TEMPLATE_INTERNAL_RECIPE_UNDO]?.suppress_child_undo === true), true);
    assert.equal(stageCalls.every((call) => typeof call[CALL_TEMPLATE_INTERNAL_RECIPE_UNDO]?.handle === "string"), true);
    assert.equal(new Set(stageCalls.map((call) => call.context.request_sequence)).size, 2);
    assert.equal(stageCalls.every((call) => call.context.client_id === "openreaper-mcp"), true);
    assert.deepEqual(stageCalls.map((call) => call.budget), [
      CALL_RECIPE_STAGE_BUDGET,
      CALL_RECIPE_STAGE_BUDGET,
    ]);
    assert.equal(allocationHints.every((hint) => hint === undefined), true);

    stageCalls.length = 0;
    const readSaved = await saveFixture(binding.runtime, makeReadOnlyProductDraft());
    const readRun = await binding.runtime.call_recipe({
      operation: "run",
      ...exactIdentity(readSaved),
      inputs: { track_name: "Read only" },
      budget: { max_response_bytes: 8_192 },
    });
    assert.equal(readRun.ok, true, JSON.stringify(readRun));
    assert.deepEqual(stageCalls.map((call) => call.id), ["macro.project.inspect"]);
  });

  it("builds fixed internal Bridge begin/end requests with matching identity", async () => {
    const bridge = makeRecipeUndoBridge();
    let sequence = 0;
    const controller = createStdioRecipeUndoController({
      liveBridge: { executor: bridge },
      callContext: {
        allocate() {
          sequence += 1;
          return {
            client_id: "openreaper-mcp",
            session_id: "server-session",
            expected_owner: "owner:fixture",
            expected_generation: 1,
            created_at: `2026-07-21T00:00:0${sequence}.000Z`,
            request_sequence: sequence,
          };
        },
      },
    });
    const opened = await controller.begin({
      run_id: "run-fixture",
      attempt: 1,
      project_ref: "project:tab:fixture-a",
      label: "OpenReaper Recipe: recipe.fixture",
    });
    const closed = await controller.end({
      handle: opened.handle,
      project_ref: "project:tab:fixture-a",
      label: "OpenReaper Recipe: recipe.fixture",
      mutation_truth: "applied",
    });

    assert.equal(opened.ok, true);
    assert.equal(closed.ok, true);
    assert.equal(opened.handle, "run-fixture:attempt:1");
    assert.deepEqual(bridge.seen.map((request) => request.operation), [
      { family: "run_command", name: "recipe.undo.transaction" },
      { family: "run_command", name: "recipe.undo.transaction" },
    ]);
    assert.deepEqual(bridge.seen.map((request) => request.pack), [
      { id: "core", capability: "recipe.undo.transaction", risk: "write" },
      { id: "core", capability: "recipe.undo.transaction", risk: "write" },
    ]);
    assert.deepEqual(bridge.seen.map((request) => request.params.transaction_id), [opened.handle, opened.handle]);
    assert.deepEqual(bridge.seen.map((request) => request.undo.flags), [
      ["recipe_transaction_control"],
      ["recipe_transaction_control"],
    ]);
  });

  it("exposes saved exact revisions through the actual six-tool stdio MCP surface", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-stdio-"));
    const client = new Client({ name: "alpha3-4-e2-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: path.resolve("."),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        OPENREAPER_EXECUTABLE_RECIPE_ROOT: root,
        OPENREAPER_EXECUTABLE_RECIPE_SOURCE: "user",
        OPENREAPER_EXECUTABLE_RECIPE_CATALOG_JSON: JSON.stringify({ macros: [], templates: [], capabilities: [] }),
        OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON: JSON.stringify(["read", "write"]),
      },
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual((tools.tools ?? []).map((tool) => tool.name).sort(), [...TOOL_ABI_V1_TOOL_NAMES].sort());
      const schema = tools.tools.find((tool) => tool.name === "call_recipe")?.inputSchema;
      assert.deepEqual(schema.properties.operation.enum, [...CALL_RECIPE_OPERATIONS]);
      assert.equal(Object.hasOwn(schema.properties, "runtime_facts"), false);
      assert.equal(Object.hasOwn(schema.properties, "evidence_page"), false);

      const saved = parseToolJson(await client.callTool({
        name: "call_recipe",
        arguments: {
          operation: "save",
          draft: makeProductDraft(),
          version: "1.0.0",
          revision_number: 1,
          saved_at: "1970-01-01T00:00:00.000Z",
          budget: { max_response_bytes: 4096 },
        },
      }));
      assert.equal(saved.ok, true);

      const listed = parseToolJson(await client.callTool({
        name: "call_recipe",
        arguments: { operation: "list", limit: 1 },
      }));
      assert.equal(listed.count, 1);
      assert.equal(listed.total, 3);
      assert.equal(listed.items[0].source, "official");

      const userListed = parseToolJson(await client.callTool({
        name: "call_recipe",
        arguments: {
          operation: "list",
          filter: { recipe_id: saved.recipe_id },
          limit: 1,
        },
      }));
      assert.equal(userListed.count, 1);
      assert.equal(userListed.items[0].revision, 1);
      assert.equal(userListed.items[0].source, "user");

      const loaded = parseToolJson(await client.callTool({
        name: "call_recipe",
        arguments: {
          operation: "get",
          recipe_id: saved.recipe_id,
          version: saved.version,
          revision: saved.revision,
          content_hash: saved.content_hash,
        },
      }));
      assert.equal(loaded.ok, true);
      assert.equal(loaded.revision, 1);
      assert.equal(loaded.source, "user");
      assert.equal(loaded.draft.id, saved.recipe_id);

      const discovery = parseToolJson(await client.callTool({
        name: "list_recipes",
        arguments: {
          ids: [saved.recipe_id],
          fields: ["capability_truth"],
        },
      }));
      assert.equal(discovery.items.length, 1);
      assert.deepEqual(discovery.items[0].capability_truth.example_call_shape.request, {
        operation: "run",
        ...exactIdentity(saved),
        inputs: {},
      });
      assert.equal(Object.values(exactIdentity(saved)).every((value) => value !== null), true);
    } finally {
      await client.close().catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps public Recipe discovery available beside one preserved stale revision", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-stdio-stale-"));
    const currentCatalog = createExecutableRecipeProductCatalog();
    const oldDefinition = {
      macros: currentCatalog.macros.map((entry) => ({ ...entry, capabilities: [...entry.capabilities] })),
      templates: currentCatalog.templates.map((entry) => ({ ...entry, capabilities: [...entry.capabilities] })),
      capabilities: [...currentCatalog.capabilities],
    };
    const oldMacro = oldDefinition.macros.find((entry) => entry.id === "macro.project.inspect");
    oldMacro.version = "1.6.0";
    oldMacro.descriptor_hash = "d".repeat(64);
    const oldCatalog = createExecutableDependencyCatalog(oldDefinition);
    const staleDraft = makeProductDraft();
    staleDraft.id = "recipe.user.preserved_stale_fixture";
    staleDraft.title = "Preserved stale fixture";
    staleDraft.summary = "A self-consistent user revision sealed against an older dependency catalog.";
    staleDraft.dependencies[0].version = oldMacro.version;
    staleDraft.dependencies[0].descriptor_hash = oldMacro.descriptor_hash;
    staleDraft.stages[0].dependency.version = oldMacro.version;
    const stale = sealExecutableRecipeRevision(staleDraft, {
      catalog: oldCatalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const staleStore = createExecutableRecipeRevisionStore({ root, catalog: oldCatalog, source: "user" });
    const staleSaved = staleStore.save(stale);
    const bytesBefore = readFileSync(staleSaved.path);
    const currentStore = createExecutableRecipeRevisionStore({ root, catalog: currentCatalog, source: "user" });
    const currentDraft = { ...makeProductDraft(), id: "recipe.user.current_fixture" };
    let validDispatches = 0;
    const validUndoCalls = [];
    const currentRuntime = createCallRecipeRuntime({
      store: currentStore,
      catalog: currentCatalog,
      dispatchers: {
        macro: async ({ inputs }) => {
          validDispatches += 1;
          return macroEnvelope({ project_summary: { name: inputs.track_name } });
        },
        template: async () => {
          validDispatches += 1;
          return templateEnvelope({ track_ref: "track:index:0" });
        },
      },
      undoController: {
        async begin(request) {
          validUndoCalls.push(request);
          return {
            ok: true,
            opened: true,
            handle: "recipe-undo-current-valid",
            project_ref: request.project_ref,
          };
        },
        async end(request) {
          validUndoCalls.push(request);
          return {
            ok: true,
            closed: true,
            verified: true,
            handle: request.handle,
            project_ref: request.project_ref,
          };
        },
      },
      runtimeFactsProvider: async ({ revision }) => completeFacts(revision, currentDraft, currentCatalog),
    });
    const client = new Client({ name: "alpha3-4-e2-stale-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: path.resolve("."),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        OPENREAPER_EXECUTABLE_RECIPE_ROOT: root,
        OPENREAPER_EXECUTABLE_RECIPE_SOURCE: "user",
        OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON: JSON.stringify(["read", "write"]),
      },
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const valid = parseToolJson(await client.callTool({
        name: "call_recipe",
        arguments: {
          operation: "save",
          draft: currentDraft,
          version: "1.0.0",
          revision_number: 1,
          saved_at: "1970-01-01T00:00:00.000Z",
        },
      }));
      assert.equal(valid.ok, true, JSON.stringify(valid));

      const validRun = await currentRuntime.call_recipe({
        operation: "run",
        recipe_id: valid.recipe_id,
        version: valid.version,
        revision: valid.revision,
        content_hash: valid.content_hash,
        validation_result_id: valid.validation_result_id,
        inputs: { track_name: "Current recipe remains executable" },
      });
      assert.equal(validRun.ok, true, JSON.stringify(validRun));
      assert.equal(validRun.execution_truth.stage_dispatch_count, 2);
      assert.equal(validRun.undo.opened, true);
      assert.equal(validRun.undo.closed, true);
      assert.equal(validDispatches, 2);
      assert.deepEqual(validUndoCalls.map((call) => call.operation), ["begin", "end"]);

      const discovery = parseToolJson(await client.callTool({ name: "list_recipes", arguments: {} }));
      assert.equal(discovery.items.some((item) => item.id === "recipe.mix.create_bus_processing"), true);
      assert.equal(discovery.items.some((item) => item.id === "recipe.midi.create_instrument_part"), true);
      assert.equal(discovery.items.some((item) => item.id === valid.recipe_id), true);
      assert.equal(discovery.items.some((item) => item.id === stale.recipe_id), false);
      assert.equal(discovery.unavailable_revision_count, 1);
      assert.equal(discovery.unavailable_revisions_truncated, false);
      const unavailable = discovery.unavailable_revisions.find((item) => item.recipe_id === stale.recipe_id);
      assert.equal(unavailable.error.code, "REVISION_STALE");
      assert.equal(unavailable.error.zero_write, true);
      assert.equal(unavailable.executable, false);

      const blocked = parseToolJson(await client.callTool({
        name: "call_recipe",
        arguments: { operation: "run", ...exactIdentity(stale), inputs: { track_name: "Never dispatched" } },
      }));
      assert.equal(blocked.ok, false);
      assert.equal(blocked.error.code, "REVISION_STALE");
      assert.equal(blocked.error.details.zero_write, true);
      assert.equal(blocked.resume_safe, false);
      assert.equal(blocked.execution_truth.mutation, "not_applied");
      assert.equal(blocked.execution_truth.stage_dispatch_count, 0);
      assert.equal(blocked.execution_truth.transport_call_count, 0);
      assert.equal(blocked.execution_truth.native_mutation_count, 0);
      assert.equal(blocked.undo.opened, false);
      assert.deepEqual(readFileSync(staleSaved.path), bytesBefore);
    } finally {
      await client.close().catch(() => {});
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}.official`, { recursive: true, force: true });
    }
  });

  it("keeps E1 store non-executing and bound ownership non-overridable", async () => {
    const catalog = makeCatalog();
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-store-"));
    const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
    assert.equal(typeof store.run, "undefined");
    assert.equal(typeof store.resume, "undefined");
    assert.equal(typeof store.call_recipe, "undefined");

    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      dispatchers: {
        macro: async () => macroEnvelope({ project_summary: {} }),
        template: async () => templateEnvelope({ track_ref: "track:index:1" }),
      },
      runtimeFactsProvider: ({ revision }) => completeFacts(revision),
    });
    const saved = await runtime.call_recipe({
      operation: "save",
      draft: makeDraft(),
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(saved.ok, true);
    // Caller cannot override store root through request fields.
    const listed = await runtime.call_recipe({
      operation: "list",
      root: "/tmp/should-not-override",
      source: "official",
    });
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 1);
  });

  it("catalogs hardware output mutations but rejects their validate/save path before dispatch", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e3-hardware-catalog-"));
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "user", catalog });
    let dispatcherCalls = 0;
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      dispatchers: {
        macro: async () => { dispatcherCalls += 1; return macroEnvelope({}); },
        template: async () => { dispatcherCalls += 1; return templateEnvelope({}); },
      },
    });
    try {
      for (const id of ["template.routing.set_track_hardware_output", "template.routing.remove_track_hardware_output"]) {
        const draft = makeProductDraft();
        const entry = catalog.getTemplate(id);
        draft.stages[1].dependency = { kind: "template", id, version: entry.version, fallback_reason: "official_template_atom_required" };
        draft.dependencies[1] = { kind: "template", id, version: entry.version, risk: entry.risk, fallback_reason: "official_template_atom_required", descriptor_hash: entry.descriptor_hash };
        const validated = await runtime.call_recipe({ operation: "validate", draft });
        const saved = await runtime.call_recipe({ operation: "save", draft, version: "1.0.0", revision_number: 1 });
        assert.equal(validated.ok, false);
        assert.equal(saved.ok, false);
        assert.equal((await runtime.call_recipe({ operation: "list" })).count, 0);
      }
      assert.equal(dispatcherCalls, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function makeRuntime(overrides = {}) {
  const catalog = makeCatalog();
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-e2-runtime-"));
  const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
  const runtime = createCallRecipeRuntime({
    store,
    catalog,
    dispatchers: overrides.dispatchers ?? {
      macro: async ({ inputs }) => macroEnvelope({ project_summary: { name: inputs.track_name } }),
      template: async () => templateEnvelope({ track_ref: "track:index:0" }),
    },
    undoController: overrides.undoController,
    runtimeFactsProvider: async ({ revision }) => overrides.facts
      ? overrides.facts(revision)
      : completeFacts(revision),
  });
  return { runtime, root, catalog, store };
}

function makeRecipeUndoBridge() {
  const bridge = new FakeFoundationBridge({
    owner: "owner:fixture",
    generation: 1,
    now: () => new Date("2026-07-21T00:00:10.000Z"),
  });
  bridge.probeLiveness = async () => ({
    ready: true,
    heartbeat: { observed: { active_owner: "owner:fixture", active_generation: 1 } },
  });
  bridge.execute = function executeRecipeUndo(request, startedAt) {
    const begin = request.params.action === "begin";
    return this.okEnvelope(request, startedAt, {
      summary: {
        contract: "openreaper.recipe_undo_transaction.v1",
        action: request.params.action,
        transaction_id: request.params.transaction_id,
        project_ref: request.params.project_ref,
        opened: true,
        closed: !begin,
        verified: true,
        readback_status: "passed",
      },
      refs: [],
      artifacts: [],
      jobs: [],
      readback: null,
    });
  };
  return bridge;
}

function makeCatalog() {
  return createExecutableDependencyCatalog(makeCatalogDefinition());
}

function makeCatalogDefinition() {
  return {
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
  };
}

function makeDraft() {
  return {
    contract: "recipe.executable.draft.v1",
    id: "recipe.tracks.prepare_dialog_track_executable",
    title: "Executable prepare dialog track",
    summary: "Macro-first executable draft with typed template fallback.",
    pack: "tracks",
    risk: "write",
    inputs: [{ id: "track_name", type: "string", required: true }],
    outputs: [{ id: "track_ref", type: "ref.track", required: true }],
    stages: [
      {
        id: "run_macro",
        kind: "macro",
        dependency: {
          kind: "macro",
          id: "macro.project.inspect",
          version: "1.0.0",
          fallback_reason: null,
        },
        inputs: ["track_name"],
        outputs: ["project_summary"],
        risk: "read",
        checkpoint: "checkpoint_run_macro",
      },
      {
        id: "readback",
        kind: "template",
        dependency: {
          kind: "template",
          id: "template.tracks.create_track",
          version: "1.0.0",
          fallback_reason: "official_template_atom_required",
        },
        inputs: ["project_summary", "track_name"],
        outputs: ["track_ref"],
        risk: "write",
        checkpoint: "checkpoint_readback",
      },
    ],
    bindings: [
      {
        from: { scope: "recipe_input", id: null, port: "track_name" },
        to: { scope: "stage", id: "run_macro", port: "track_name" },
      },
      {
        from: { scope: "stage", id: "run_macro", port: "project_summary" },
        to: { scope: "stage", id: "readback", port: "project_summary" },
      },
      {
        from: { scope: "recipe_input", id: null, port: "track_name" },
        to: { scope: "stage", id: "readback", port: "track_name" },
      },
      {
        from: { scope: "stage", id: "readback", port: "track_ref" },
        to: { scope: "recipe_output", id: null, port: "track_ref" },
      },
    ],
    dependencies: [
      {
        kind: "macro",
        id: "macro.project.inspect",
        version: "1.0.0",
        risk: "read",
        fallback_reason: null,
        descriptor_hash: "a".repeat(64),
      },
      {
        kind: "template",
        id: "template.tracks.create_track",
        version: "1.0.0",
        risk: "write",
        fallback_reason: "official_template_atom_required",
        descriptor_hash: "b".repeat(64),
      },
    ],
    required_capabilities: ["project.index", "tracks.write"],
    risk_grants: ["read", "write"],
    checkpoints: [
      {
        id: "checkpoint_run_macro",
        after_stage: "run_macro",
        evidence_id: "evidence_run_macro",
        resume_identity: "resume.run_macro",
        summary: "Macro stage complete.",
      },
      {
        id: "checkpoint_readback",
        after_stage: "readback",
        evidence_id: "evidence_readback",
        resume_identity: "resume.readback",
        summary: "Template fallback stage complete.",
      },
    ],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 2,
      dependency_count: 2,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: {
      project_identity: "project:tab:fixture-a",
      bridge_owner: "owner:fixture",
      bridge_generation: "1",
      platform: "darwin",
    },
  };
}

function makeProductDraft() {
  const catalog = createExecutableRecipeProductCatalog();
  const draft = structuredClone(makeDraft());
  draft.dependencies = draft.dependencies.map((dependency) => {
    const entry = dependency.kind === "macro"
      ? catalog.getMacro(dependency.id)
      : catalog.getTemplate(dependency.id);
    return { ...dependency, version: entry.version, risk: entry.risk, descriptor_hash: entry.descriptor_hash };
  });
  for (const stage of draft.stages) {
    const entry = stage.dependency.kind === "macro"
      ? catalog.getMacro(stage.dependency.id)
      : catalog.getTemplate(stage.dependency.id);
    stage.dependency.version = entry.version;
  }
  draft.required_capabilities = [...new Set(draft.dependencies.flatMap((dependency) => (
    dependency.kind === "macro"
      ? catalog.getMacro(dependency.id).capabilities
      : catalog.getTemplate(dependency.id).capabilities
  )))].sort();
  return draft;
}

function makeReadOnlyProductDraft() {
  const draft = makeProductDraft();
  draft.id = "recipe.project.read_only_server_policy";
  draft.title = "Read-only server policy";
  draft.summary = "Runs one read-only Macro under a broader server-owned policy.";
  draft.risk = "read";
  draft.outputs = [{ id: "project_summary", type: "json", required: true }];
  draft.stages = [draft.stages[0]];
  draft.bindings = [
    draft.bindings[0],
    {
      from: { scope: "stage", id: "run_macro", port: "project_summary" },
      to: { scope: "recipe_output", id: null, port: "project_summary" },
    },
  ];
  draft.dependencies = [draft.dependencies[0]];
  draft.required_capabilities = createExecutableRecipeProductCatalog().getMacro("macro.project.inspect").capabilities;
  draft.risk_grants = ["read"];
  draft.checkpoints = [draft.checkpoints[0]];
  draft.preflight.stage_count = 1;
  draft.preflight.dependency_count = 1;
  return draft;
}

function makeTwoMacroDraft() {
  const draft = structuredClone(makeDraft());
  draft.id = "recipe.project.idempotent_resume_truth";
  draft.title = "Idempotent project activation resume truth";
  draft.summary = "Proves a zero-write idempotent Macro failure can resume from a prior checkpoint.";
  draft.risk = "read";
  draft.inputs = [{ id: "operation", type: "string", required: true }];
  draft.outputs = [{ id: "project_ref", type: "string", required: true }];
  draft.stages = [
    {
      ...draft.stages[0],
      id: "inventory_checkpoint",
      inputs: ["operation"],
      outputs: ["returned_count"],
      checkpoint: "checkpoint_inventory",
    },
    {
      ...draft.stages[0],
      id: "resume_activate",
      inputs: ["operation"],
      outputs: ["project_ref"],
      checkpoint: "checkpoint_activate",
    },
  ];
  draft.bindings = [
    {
      from: { scope: "recipe_input", id: null, port: "operation" },
      to: { scope: "stage", id: "inventory_checkpoint", port: "operation" },
    },
    {
      from: { scope: "recipe_input", id: null, port: "operation" },
      to: { scope: "stage", id: "resume_activate", port: "operation" },
    },
    {
      from: { scope: "stage", id: "resume_activate", port: "project_ref" },
      to: { scope: "recipe_output", id: null, port: "project_ref" },
    },
  ];
  draft.dependencies = [draft.dependencies[0]];
  draft.required_capabilities = ["project.index"];
  draft.risk_grants = ["read"];
  draft.checkpoints = [
    {
      id: "checkpoint_inventory",
      after_stage: "inventory_checkpoint",
      evidence_id: "evidence_inventory",
      resume_identity: "resume.inventory",
      summary: "Inventory checkpoint accepted.",
    },
    {
      id: "checkpoint_activate",
      after_stage: "resume_activate",
      evidence_id: "evidence_activate",
      resume_identity: "resume.activate",
      summary: "Activation checkpoint accepted.",
    },
  ];
  draft.preflight.stage_count = 2;
  draft.preflight.dependency_count = 1;
  return draft;
}

function makeRecipeRefDraft() {
  const draft = makeTwoMacroDraft();
  draft.id = "recipe.fx.bind_take_and_control_fx";
  draft.title = "Bind one Take and control its created FX";
  draft.summary = "Binds an exact Take ref, then passes the verified created FX ref to a later stage.";
  draft.inputs = [{ id: "take_ref", type: "ref.take", required: true }];
  draft.outputs = [{ id: "parameter_value", type: "number", required: true }];
  draft.portability = {
    ...draft.portability,
    project_identity: "project:runtime_bound",
    bridge_owner: "bridge:runtime_bound",
    bridge_generation: "generation:runtime_bound",
  };
  draft.stages[0] = {
    ...draft.stages[0],
    id: "add_take_fx",
    inputs: [],
    outputs: ["fx_ref"],
    checkpoint: "checkpoint_add_take_fx",
  };
  draft.stages[1] = {
    ...draft.stages[1],
    id: "control_fx",
    inputs: [],
    outputs: ["parameter_value"],
    checkpoint: "checkpoint_control_fx",
  };
  draft.bindings = [
    {
      from: { scope: "recipe_input", id: null, port: "take_ref" },
      to: { scope: "refs", id: "add_take_fx", port: "take_ref" },
    },
    {
      from: { scope: "stage", id: "add_take_fx", port: "fx_ref" },
      to: { scope: "refs", id: "control_fx", port: "fx_ref" },
    },
    {
      from: { scope: "stage", id: "control_fx", port: "parameter_value" },
      to: { scope: "recipe_output", id: null, port: "parameter_value" },
    },
  ];
  draft.checkpoints = [
    {
      id: "checkpoint_add_take_fx",
      after_stage: "add_take_fx",
      evidence_id: "evidence_add_take_fx",
      resume_identity: "resume.add_take_fx",
      summary: "Take FX created and read back.",
    },
    {
      id: "checkpoint_control_fx",
      after_stage: "control_fx",
      evidence_id: "evidence_control_fx",
      resume_identity: "resume.control_fx",
      summary: "FX parameter controlled and read back.",
    },
  ];
  return draft;
}

function makeMaxStageDraft() {
  const draft = structuredClone(makeDraft());
  for (let index = 2; index < 48; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const stageId = `read_state_${suffix}_${"x".repeat(40)}`;
    const checkpointId = `checkpoint_state_${suffix}_${"x".repeat(32)}`;
    draft.stages.push({
      id: stageId,
      kind: "get_state",
      dependency: null,
      inputs: [],
      outputs: [],
      risk: "read",
      checkpoint: checkpointId,
    });
    draft.checkpoints.push({
      id: checkpointId,
      after_stage: stageId,
      evidence_id: `evidence_state_${suffix}_${"x".repeat(34)}`,
      resume_identity: `resume.state_${suffix}_${"x".repeat(34)}`,
      summary: `Verified read-only state checkpoint ${suffix}.`,
    });
  }
  draft.preflight.stage_count = draft.stages.length;
  return draft;
}

function makeManyOutputDraft(count) {
  const draft = structuredClone(makeDraft());
  const outputIds = Array.from({ length: count }, (_, index) => `output_${String(index).padStart(2, "0")}`);
  draft.id = "recipe.project.inspect_many_outputs_executable";
  draft.title = "Executable inspect with many outputs";
  draft.summary = "Exercises the bounded verified output response budget.";
  draft.risk = "write";
  draft.outputs = outputIds.map((id) => ({ id, type: "json", required: true }));
  draft.stages = [{
    ...draft.stages[1],
    inputs: ["track_name"],
    outputs: outputIds,
  }];
  draft.bindings = [
    {
      from: { scope: "recipe_input", id: null, port: "track_name" },
      to: { scope: "stage", id: "readback", port: "track_name" },
    },
    ...outputIds.map((id) => ({
      from: { scope: "stage", id: "readback", port: id },
      to: { scope: "recipe_output", id: null, port: id },
    })),
  ];
  draft.dependencies = [draft.dependencies[1]];
  draft.required_capabilities = ["tracks.write"];
  draft.risk_grants = ["write"];
  draft.checkpoints = [draft.checkpoints[1]];
  draft.preflight.stage_count = 1;
  draft.preflight.dependency_count = 1;
  return draft;
}

function makeMetadataShadowDraft(kind) {
  const draft = structuredClone(makeDraft());
  const stageIndex = kind === "macro" ? 0 : 1;
  const stage = draft.stages[stageIndex];
  const dependency = draft.dependencies[stageIndex];
  const checkpoint = draft.checkpoints[stageIndex];
  draft.id = `recipe.tracks.reject_${kind}_metadata_shadow`;
  draft.title = `Reject ${kind} metadata shadow`;
  draft.summary = "Requires declared outputs to come from authoritative stage readback.";
  draft.risk = stage.risk;
  draft.outputs = [{ id: "status", type: "json", required: true }];
  draft.stages = [{
    ...stage,
    inputs: ["track_name"],
    outputs: ["status"],
  }];
  draft.bindings = [
    {
      from: { scope: "recipe_input", id: null, port: "track_name" },
      to: { scope: "stage", id: stage.id, port: "track_name" },
    },
    {
      from: { scope: "stage", id: stage.id, port: "status" },
      to: { scope: "recipe_output", id: null, port: "status" },
    },
  ];
  draft.dependencies = [dependency];
  draft.required_capabilities = kind === "macro" ? ["project.index"] : ["tracks.write"];
  draft.risk_grants = [stage.risk];
  draft.checkpoints = [checkpoint];
  draft.preflight.stage_count = 1;
  draft.preflight.dependency_count = 1;
  return draft;
}

function makeComposedDraft() {
  const draft = structuredClone(makeDraft());
  draft.stages.push(
    {
      id: "read_state",
      kind: "get_state",
      dependency: null,
      inputs: [],
      outputs: [],
      risk: "read",
      checkpoint: "checkpoint_read_state",
    },
    {
      id: "checkpoint_proof",
      kind: "checkpoint",
      dependency: null,
      inputs: [],
      outputs: [],
      risk: "read",
      checkpoint: "checkpoint_explicit",
    },
  );
  draft.checkpoints.push(
    {
      id: "checkpoint_read_state",
      after_stage: "read_state",
      evidence_id: "evidence_read_state",
      resume_identity: "resume.read_state",
      summary: "Bounded get_state stage complete.",
    },
    {
      id: "checkpoint_explicit",
      after_stage: "checkpoint_proof",
      evidence_id: "evidence_explicit",
      resume_identity: "resume.explicit",
      summary: "Explicit runtime checkpoint proof complete.",
    },
  );
  draft.preflight.stage_count = draft.stages.length;
  return draft;
}

function completeFacts(saved, draft = makeDraft(), catalog = makeCatalog()) {
  const sealed = sealExecutableRecipeRevision(draft, {
    catalog,
    version: saved.version,
    revision: saved.revision,
    saved_at: "1970-01-01T00:00:00.000Z",
  });
  return {
    content_hash: saved.content_hash,
    risk_grants: sealed.draft.risk_grants,
    project_identity: sealed.draft.portability.project_identity,
    bridge_owner: sealed.draft.portability.bridge_owner,
    bridge_generation: sealed.draft.portability.bridge_generation,
    available_capabilities: sealed.draft.required_capabilities,
    checkpoint_evidence: sealed.draft.checkpoints.map((item) => ({
      checkpoint_id: item.id,
      evidence_id: item.evidence_id,
      resume_identity: item.resume_identity,
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    })),
    dependency_versions: sealed.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
    })),
    dependency_descriptors: sealed.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      descriptor_hash: entry.descriptor_hash,
    })),
  };
}

function exactIdentity(saved) {
  return {
    recipe_id: saved.recipe_id,
    version: saved.version,
    revision: saved.revision,
    content_hash: saved.content_hash,
    validation_result_id: saved.validation_result_id,
  };
}

async function saveFixture(runtime, draft = makeDraft()) {
  return runtime.call_recipe({
    operation: "save",
    draft,
    version: "1.0.0",
    revision_number: 1,
    saved_at: "1970-01-01T00:00:00.000Z",
  });
}

function macroEnvelope(data = {}) {
  const envelope = {
    contract: "macro.execution.v1",
    ok: true,
    macro: {
      id: "macro.project.inspect",
      program_id: "openreaper.macro.project.inspect",
      program_version: "1.0.0",
      risk: "read",
    },
    request: { request_id: "request-recipe-stage", dry_run: false },
    execution: {
      status: "completed",
      started_at: "2026-07-21T00:00:00.000Z",
      completed_at: "2026-07-21T00:00:01.000Z",
      stage_count: 1,
      stages: [{
        id: "inspect",
        kind: "verify",
        status: "completed",
        evidence_refs: ["evidence:macro:inspect"],
      }],
    },
    sqlite: {
      used: false,
      source: "not_used",
      freshness: "not_applicable",
      snapshot_ref: null,
      revision: null,
      refreshed: false,
    },
    result: {
      summary: "Macro completed with native verification.",
      canonical_refs: [],
      changes: [],
      verification: { status: "passed", evidence_refs: ["evidence:macro:inspect"] },
      artifact_refs: [],
      data,
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: {
      max_bytes: 65_536,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  };
  for (let i = 0; i < 4; i += 1) {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}

function macroPartialFailureEnvelope(message = "Macro retained one verified partial change.") {
  const envelope = macroEnvelope({});
  envelope.ok = false;
  envelope.execution.status = "partial_failure";
  envelope.result.summary = "Macro failed after one native-verified change.";
  envelope.result.changes = [{
    kind: "project.index.refresh",
    status: "applied",
    live_readback: { status: "passed" },
  }];
  envelope.result.verification = {
    status: "failed",
    evidence_refs: ["evidence:macro:partial"],
  };
  envelope.blockers = [{ code: "MACRO_PARTIAL_FAILURE", message: "Inspect bounded state.", recoverable: false }];
  envelope.error = { code: "MACRO_PARTIAL_FAILURE", message, recoverable: false };
  envelope.recovery = {
    partial_changes_possible: true,
    undo_policy: "single_undo",
    action: "Inspect bounded state before deciding recovery.",
  };
  for (let i = 0; i < 4; i += 1) {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}

function macroEnvelopeWithChange(data = {}) {
  const envelope = macroEnvelope(data);
  envelope.result.changes = [{
    kind: "project.index.refresh",
    status: "applied",
    live_readback: { status: "passed" },
  }];
  for (let i = 0; i < 4; i += 1) {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}

function macroZeroWriteFailureWithIdempotentReadback() {
  const envelope = macroEnvelope({ zero_write: true });
  envelope.ok = false;
  envelope.execution.status = "failed";
  envelope.result.summary = "Project Index rebind failed before any project mutation.";
  envelope.result.changes = [{
    kind: "project_switch",
    status: "applied",
    mutation: { status: "not_run" },
    live_readback: { status: "passed" },
  }];
  envelope.result.verification = { status: "not_required", evidence_refs: [] };
  envelope.blockers = [{
    code: "PROJECT_IDENTITY_REBIND_FAILED",
    message: "Repair Project Index state and retry.",
    recoverable: true,
    details: { zero_write: true },
  }];
  envelope.error = {
    code: "PROJECT_IDENTITY_REBIND_FAILED",
    message: "Repair Project Index state and retry.",
    recoverable: true,
    details: { zero_write: true },
  };
  envelope.recovery = { action: "Repair blocker and retry.", sqlite_rows_authorize_writes: false };
  for (let i = 0; i < 4; i += 1) {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}

function macroLargePartialFailureEnvelope() {
  const envelope = macroPartialFailureEnvelope();
  envelope.result.changes = Array.from({ length: 8 }, (_, index) => ({
    kind: "project.index.refresh",
    status: "applied",
    live_readback: { status: "passed" },
    details: `${index}:${"x".repeat(700)}`,
  }));
  for (let i = 0; i < 4; i += 1) {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}

function parseToolJson(response) {
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

function nativeProjectInventorySummary(options = {}) {
  const projects = options.projects ?? [];
  return {
    readback_status: "passed",
    live_materialization: "native_enum_projects_verified",
    projects,
    total_count: options.total_count ?? projects.length,
    returned_count: options.returned_count ?? projects.length,
    cursor: options.cursor ?? 0,
    next_cursor: options.next_cursor ?? null,
    coverage_status: options.coverage_status ?? "complete",
  };
}

function nativeProjectInventoryExecution(options = {}) {
  const summary = options.readback_status === "passed" && Array.isArray(options.projects)
    ? options
    : nativeProjectInventorySummary(options);
  return {
    contract: "template.execution.v1",
    ok: true,
    template: { id: "template.project.list_open_projects", pack: "project", risk: "read" },
    verification: { status: "passed" },
    result: { summary },
  };
}

function templateEnvelope(readback = {}) {
  return {
    contract: "template.execution.v1",
    ok: true,
    template: { id: "template.tracks.create_track", pack: "tracks", risk: "write" },
    request: { id: "request-template-stage" },
    completed_at: "2026-07-21T00:00:01.000Z",
    verification: { status: "passed", evidence_refs: ["evidence:template:readback"] },
    result: {
      summary: { status: "applied" },
      refs: [{ ref: readback.track_ref ?? "track:index:0" }],
      artifacts: [],
      jobs: [],
      readback,
      session_ledger: null,
      last_result: { updated: true, refs: [], truncated: false },
    },
    error: null,
  };
}

function templateFailureEnvelope({ zeroWrite }) {
  return {
    contract: "template.execution.v1",
    ok: false,
    template: { id: "template.tracks.create_track", pack: "tracks", risk: "write" },
    request: { id: "request-template-stage" },
    completed_at: "2026-07-21T00:00:01.000Z",
    error: {
      code: "TEMPLATE_BLOCKED",
      message: "Template preflight blocked before dispatch.",
      recoverable: true,
      details: { zero_write: zeroWrite === true },
    },
  };
}

function listTree(root) {
  // Lightweight existence probe for zero-write checks.
  try {
    return readFileSync(root, "utf8");
  } catch {
    return `dir:${root}`;
  }
}
