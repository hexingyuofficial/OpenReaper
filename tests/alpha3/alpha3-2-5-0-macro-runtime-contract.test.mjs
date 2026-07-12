import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_STATUSES,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  MACRO_PUBLIC_IMPLEMENTATION_STATUSES,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
  validateMacroRegistryEntry,
} from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
import {
  ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS,
  ALPHA3_2_5_0_MACRO_INVENTORY,
  ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS,
  summarizeMacroInventory,
  validateMacroInventory,
} from "../../packages/mcp-server/src/alpha3-2-5-0-macro-inventory-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

const ACCEPTED_TEMPLATE_IDS = new Set(["template.tracks.set_volume"]);
const REGISTERED_STAGE_IDS = new Set(["resolve-track", "set-volume", "verify-volume", "project-result"]);

describe("Alpha3.2.5-0 Macro runtime contract", () => {
  it("keeps the public five-tool ABI unchanged", () => {
    assert.deepEqual(TOOL_ABI_V1_TOOL_NAMES, [
      "ping",
      "get_state",
      "list_templates",
      "list_recipes",
      "call_template",
    ]);
  });

  it("keeps plan_only out of public completion and execution vocabularies", () => {
    assert.equal(MACRO_PUBLIC_IMPLEMENTATION_STATUSES.includes("plan_only"), false);
    assert.equal(MACRO_EXECUTION_STATUSES.includes("plan_only"), false);
    assert.deepEqual(MACRO_PUBLIC_IMPLEMENTATION_STATUSES, ["executable", "deprecated_alias"]);
  });

  it("validates a fixed versioned allowlisted Typed Macro Program", () => {
    const entry = executableControlEntry();
    const validation = validateMacroRegistryEntry(entry, {
      acceptedTemplateIds: ACCEPTED_TEMPLATE_IDS,
      registeredStageIds: REGISTERED_STAGE_IDS,
    });
    assert.deepEqual(validation, { valid: true, errors: [] });

    const registry = createMacroProgramRegistry([entry], {
      acceptedTemplateIds: ACCEPTED_TEMPLATE_IDS,
      registeredStageIds: REGISTERED_STAGE_IDS,
    });
    assert.deepEqual(registry.ids, ["macro.controls.set"]);
    assert.equal(registry.get("macro.controls.set").program_version, "1.0.0");
    assert.equal(Object.isFrozen(registry.get("macro.controls.set")), true);
  });

  it("rejects unaccepted dependencies, unregistered stages, and arbitrary graph fields", () => {
    const entry = executableControlEntry();
    assert.equal(validateMacroRegistryEntry({
      ...entry,
      dependencies: { template_ids: ["template.unknown.write"], runtime_capabilities: [] },
    }, {
      acceptedTemplateIds: ACCEPTED_TEMPLATE_IDS,
      registeredStageIds: REGISTERED_STAGE_IDS,
    }).valid, false);
    assert.equal(validateMacroRegistryEntry({
      ...entry,
      stages: [{ ...entry.stages[0], id: "model-provided-stage" }],
    }, {
      acceptedTemplateIds: ACCEPTED_TEMPLATE_IDS,
      registeredStageIds: REGISTERED_STAGE_IDS,
    }).valid, false);

    const registry = createMacroProgramRegistry([entry], {
      acceptedTemplateIds: ACCEPTED_TEMPLATE_IDS,
      registeredStageIds: REGISTERED_STAGE_IDS,
    });
    for (const injected of [
      { child_graph: [] },
      { stages: [] },
      { template_ids: ["template.tracks.set_volume"] },
      { dependencies: {} },
      { handler: "execute-anything" },
    ]) {
      const request = validateMacroProgramRequest({
        macro_id: "macro.controls.set",
        input: { target_kind: "track", fields: { volume: 0.75 } },
        ...injected,
      }, { registry });
      assert.equal(request.valid, false, JSON.stringify(injected));
    }

    assert.equal(validateMacroProgramRequest({
      macro_id: "macro.controls.set",
      input: { target_kind: "track", fields: { volume: 0.75 } },
      selectors: { track_name: "Lead" },
      dry_run: false,
      confirmation: true,
    }, { registry }).valid, true);
  });

  it("inventories exactly 18 current, 11 legacy, and one proposed Macro id", () => {
    assert.deepEqual(validateMacroInventory(), { valid: true, errors: [] });
    assert.deepEqual(ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS, {
      current: 18,
      legacy_query: 11,
      proposed: 1,
      total: 30,
      executable_official: 12,
      consolidated_legacy_mapping: 17,
      internal_withdrawn_draft: 1,
    });
    assert.equal(new Set(ALPHA3_2_5_0_MACRO_INVENTORY.map((row) => row.id)).size, 30);
    assert.equal(summarizeMacroInventory().valid, true);
  });

  it("maps every legacy/consolidated id to an approved executable target", () => {
    const targets = new Set(ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS);
    for (const row of ALPHA3_2_5_0_MACRO_INVENTORY) {
      if (row.target_outcome === "consolidated_legacy_mapping") {
        assert.equal(targets.has(row.replacement.id), true, row.id);
      }
    }
    assert.deepEqual(
      ALPHA3_2_5_0_MACRO_INVENTORY.find((row) => row.id === "macro.set_midi_controls").future_candidates,
      ["macro.midi.edit_notes"],
    );
  });

  it("validates compact executed evidence and fails closed at response boundaries", () => {
    const envelope = successfulEnvelope();
    assert.deepEqual(validateMacroExecutionEnvelope(envelope), { valid: true, errors: [] });

    const oversizedBudget = structuredClone(envelope);
    oversizedBudget.budget.max_bytes = MACRO_CONTRACT_CEILINGS.envelope_max_bytes + 1;
    assert.equal(validateMacroExecutionEnvelope(oversizedBudget).valid, false);

    const oversizedStages = structuredClone(envelope);
    oversizedStages.execution.stages = Array.from(
      { length: MACRO_CONTRACT_CEILINGS.stage_summary_max_count + 1 },
      (_, index) => ({
        id: `stage-${index}`,
        kind: "verify",
        status: "completed",
        evidence_refs: [],
      }),
    );
    oversizedStages.execution.stage_count = oversizedStages.execution.stages.length;
    assert.equal(validateMacroExecutionEnvelope(oversizedStages).valid, false);

    const falseSuccess = structuredClone(envelope);
    falseSuccess.error = { code: "WRITE_FAILED" };
    assert.equal(validateMacroExecutionEnvelope(falseSuccess).valid, false);

    const falseVerification = structuredClone(envelope);
    falseVerification.result.verification.status = "failed";
    assert.equal(validateMacroExecutionEnvelope(falseVerification).valid, false);

    const falseSqliteUse = structuredClone(envelope);
    falseSqliteUse.sqlite = {
      used: true,
      source: "not_used",
      freshness: "not_applicable",
      snapshot_ref: null,
      revision: null,
      refreshed: false,
    };
    assert.equal(validateMacroExecutionEnvelope(falseSqliteUse).valid, false);

    const queryResult = structuredClone(envelope);
    queryResult.result.data = {
      entity: "tracks",
      rows: [{ ref: "track:guid:{TRACK-A}", name: "Lead" }],
      page: { next_cursor: null },
    };
    queryResult.budget.actual_bytes = Buffer.byteLength(JSON.stringify(queryResult));
    assert.deepEqual(validateMacroExecutionEnvelope(queryResult), { valid: true, errors: [] });

    const invalidData = structuredClone(envelope);
    invalidData.result.data = [];
    assert.equal(validateMacroExecutionEnvelope(invalidData).valid, false);
  });

  it("keeps the architecture boundary explicit in the approved ABI documents", async () => {
    const [macroAbi, foundation, layout, ratchet] = await Promise.all([
      readFile(new URL("../../docs/abi/MACRO_RUNTIME_CONTRACT_V1.md", import.meta.url), "utf8"),
      readFile(new URL("../../docs/FOUNDATION_FREEZE_PLAN.md", import.meta.url), "utf8"),
      readFile(new URL("../../docs/REPOSITORY_LAYOUT.md", import.meta.url), "utf8"),
      readFile(new URL("../../docs/RATCHET_MODEL.md", import.meta.url), "utf8"),
    ]);
    assert.match(macroAbi, /Macro\s+= one registered executable bounded task program/);
    assert.match(macroAbi, /plan_only.*forbidden/s);
    assert.match(macroAbi, /model-supplied child-request executor is forbidden/);
    assert.match(macroAbi, /`macro\.midi\.create_clip`[\s\S]*executable official/);
    assert.match(macroAbi, /`macro\.fx\.apply_native_chain`[\s\S]*executable official/);
    assert.match(foundation, /Post-V1 Additive Layer: Macro Runtime Contract v1/);
    assert.match(layout, /registered Macros are the bounded executable task layer/);
    assert.match(ratchet, /## Macro States/);
  });
});

function executableControlEntry() {
  return {
    contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
    macro_id: "macro.controls.set",
    program_id: "openreaper.macro.controls.set",
    program_version: "1.0.0",
    implementation_status: "executable",
    risk: "write",
    input_schema: { type: "object", additionalProperties: false },
    selector_policy: {
      task_shaped: true,
      canonical_refs_optional_at_public_boundary: true,
      live_reresolve_before_write: true,
    },
    sqlite_policy: {
      mode: "invalidate_after_write",
      write_authority: false,
      identity_fields: ["project", "bridge_owner", "bridge_generation", "snapshot", "revision"],
    },
    dependencies: {
      template_ids: ["template.tracks.set_volume"],
      runtime_capabilities: [],
    },
    stages: [
      { id: "resolve-track", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
      { id: "set-volume", kind: "template_execute", dependency_ref: "template.tracks.set_volume", risk: "write", stop_on_error: true },
      { id: "verify-volume", kind: "verify", risk: "read", stop_on_error: true },
      { id: "project-result", kind: "result_project", risk: "read", stop_on_error: true },
    ],
    undo_policy: "single_undo",
    verification_policy: "required",
    dry_run_supported: true,
    result_budget: { max_bytes: 65_536 },
  };
}

function successfulEnvelope() {
  return {
    contract: "macro.execution.v1",
    ok: true,
    macro: {
      id: "macro.controls.set",
      program_id: "openreaper.macro.controls.set",
      program_version: "1.0.0",
      risk: "write",
    },
    request: {
      request_id: "request-1",
      dry_run: false,
    },
    execution: {
      status: "completed",
      started_at: "2026-07-12T00:00:00.000Z",
      completed_at: "2026-07-12T00:00:01.000Z",
      stage_count: 4,
      stages: [
        { id: "resolve-track", kind: "live_ref_resolve", status: "completed", evidence_refs: ["evidence:resolve"] },
        { id: "set-volume", kind: "template_execute", status: "completed", evidence_refs: ["evidence:write"] },
        { id: "verify-volume", kind: "verify", status: "completed", evidence_refs: ["evidence:readback"] },
        { id: "project-result", kind: "result_project", status: "completed", evidence_refs: [] },
      ],
    },
    sqlite: {
      used: true,
      source: "warm_index",
      freshness: "fresh",
      snapshot_ref: "snapshot-1",
      revision: "revision-1",
      refreshed: false,
    },
    result: {
      summary: "Track volume changed and verified.",
      canonical_refs: [{ kind: "track", guid: "{TRACK-A}" }],
      changes: [{ kind: "track.volume", before: 1, after: 0.75 }],
      verification: {
        status: "passed",
        evidence_refs: ["evidence:readback"],
      },
      artifact_refs: [],
      data: {
        target_kind: "track",
      },
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: {
      max_bytes: 65_536,
      actual_bytes: 2_048,
      truncated: false,
      artifact_fallback: false,
    },
  };
}
