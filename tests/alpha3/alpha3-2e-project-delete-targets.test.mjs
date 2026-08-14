import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT,
  ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
  createAlpha3_2EProjectDeleteTargetsMacroDiscoveryItems,
  createAlpha3_2EProjectDeleteTargetsMacroRuntimeEnvelope,
  planAlpha3_2EProjectDeleteTargetsMacro,
} from "../../packages/mcp-server/src/alpha3-2e-project-delete-targets-v1.mjs";

describe("Alpha3.2-E project delete_targets planner", () => {
  it("publishes an executable confirmation-gated delete Macro", () => {
    const [item] = createAlpha3_2EProjectDeleteTargetsMacroDiscoveryItems();
    assert.equal(item.id, ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID);
    assert.equal(item.support_status, "executable_runtime_bound_confirmation_gated");
    assert.equal(item.support_state, "supported_with_confirmation");
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.implementation_status, "executable");
    assert.equal(item.expectedDelta.kind, "destructive");
  });

  it("returns dry-run preview and confirmation token before destructive requests", () => {
    const plan = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: {
        tracks: ["track:guid:{TRACK-A}"],
        items: ["item:guid:{ITEM-A}", "item:guid:{ITEM-B}"],
        markers: ["marker:project:12"],
      },
      dry_run: true,
      delete_policy: "project_objects_only",
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "dry_run_preview");
    assert.equal(plan.mutation_requests.length, 0);
    assert.deepEqual(plan.preview.target_counts_by_kind, { tracks: 1, items: 2, markers: 1, regions: 0, fx: 0 });
    assert.equal(plan.preview.total_count, 4);
    assert.match(plan.required_confirm_scope.token, /^delete:4:/);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "CONFIRM_SCOPE_REQUIRED"), true);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.filesystem_delete, false);
  });

  it("emits destructive child requests only when confirmation matches the preview exactly", () => {
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: {
        tracks: ["track:guid:{TRACK-A}"],
        items: ["item:guid:{ITEM-A}"],
        markers: ["marker:project:12"],
        regions: ["region:project:3"],
      },
      dry_run: true,
      delete_policy: "project_objects_only",
    });
    const plan = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: preview.preview.refs_by_kind,
      dry_run: false,
      confirm_scope: preview.required_confirm_scope,
      delete_policy: "project_objects_only",
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.dry_run, false);
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), [
      "template.tracks.delete_tracks",
      "template.items.delete_items",
      "template.project.delete_marker",
      "template.project.delete_region",
    ]);
    assert.deepEqual(plan.mutation_requests[0].refs, { track_ref: ["track:guid:{TRACK-A}"] });
    assert.deepEqual(plan.mutation_requests[1].refs, { item_ref: ["item:guid:{ITEM-A}"] });
    assert.deepEqual(plan.readback_requests.map((request) => request.id), ["macro.project.query", "macro.project.query", "macro.project.query"]);
    assert.deepEqual(plan.readback_requests.map((request) => request.input.entity), ["tracks", "items", "markers_regions"]);
    assert.equal(plan.child_requests.length, 7);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.public_call_recipe, false);
    assert.equal(plan.safety.raw_action_lua_shell_ui, false);
  });

  it("canonicalizes omitted zero counts and key order without weakening exact target confirmation", () => {
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: {
        items: ["item:guid:{ITEM-B}", "item:guid:{ITEM-A}"],
        tracks: ["track:guid:{TRACK-A}"],
      },
      dry_run: true,
    });
    const plan = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: {
        tracks: ["track:guid:{TRACK-A}"],
        items: ["item:guid:{ITEM-B}", "item:guid:{ITEM-A}"],
      },
      dry_run: false,
      confirm_scope: {
        target_hash: preview.required_confirm_scope.target_hash,
        expected_counts: { items: 2, tracks: 1 },
        token: preview.required_confirm_scope.token,
      },
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.preview.total_count, 3);
  });

  it("binds destructive confirmation to the exact project and Bridge generation", () => {
    const binding = {
      project_ref: "project:path:/tmp/confirmed.rpp",
      bridge_owner: "owner:confirmed",
      bridge_generation: 7,
    };
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: { items: ["item:guid:{ITEM-A}"] },
      dry_run: true,
    }, { confirmation_context: binding });
    assert.deepEqual(preview.required_confirm_scope.runtime_binding, {
      bridge_owner: "owner:confirmed",
      bridge_generation: 7,
      project_ref: "project:path:/tmp/confirmed.rpp",
    });

    const changedGeneration = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: preview.preview.refs_by_kind,
      dry_run: false,
      confirm_scope: preview.required_confirm_scope,
    }, { confirmation_context: { ...binding, bridge_generation: 8 } });
    assert.equal(changedGeneration.ok, false);
    assert.equal(changedGeneration.blockers.some((entry) => entry.code === "CONFIRM_SCOPE_RUNTIME_MISMATCH"), true);
    assert.deepEqual(changedGeneration.child_requests, []);

    const changedProject = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: preview.preview.refs_by_kind,
      dry_run: false,
      confirm_scope: preview.required_confirm_scope,
    }, { confirmation_context: { ...binding, project_ref: "project:path:/tmp/other.rpp" } });
    assert.equal(changedProject.ok, false);
    assert.equal(changedProject.blockers.some((entry) => entry.code === "CONFIRM_SCOPE_RUNTIME_MISMATCH"), true);
    assert.deepEqual(changedProject.child_requests, []);
  });

  it("collapses Track/Track-FX overlap and emits remaining FX deletes in descending owner-slot order", () => {
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: {
        tracks: ["track:guid:{TRACK-A}"],
        fx: [
          "fx:track:guid:{TRACK-A}:2",
          "fx:track:guid:{TRACK-B}:1",
          "fx:track:guid:{TRACK-B}:4",
        ],
      },
      dry_run: true,
    });
    assert.equal(preview.preview.requested_total_count, 4);
    assert.equal(preview.preview.total_count, 3);
    assert.deepEqual(preview.preview.collapsed_targets, [{
      ref: "fx:track:guid:{TRACK-A}:2",
      parent_ref: "track:guid:{TRACK-A}",
      reason: "owning_track_delete_cascades_fx",
    }]);

    const plan = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: preview.preview.refs_by_kind,
      dry_run: false,
      confirm_scope: preview.required_confirm_scope,
    });
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), [
      "template.fx.delete_fx",
      "template.fx.delete_fx",
      "template.tracks.delete_tracks",
    ]);
    assert.deepEqual(plan.mutation_requests.slice(0, 2).map((request) => request.refs.fx_ref.ref), [
      "fx:track:guid:{TRACK-B}:4",
      "fx:track:guid:{TRACK-B}:1",
    ]);
    assert.deepEqual(plan.mutation_requests[0].refs.fx_ref.identity, {
      scheme: "track_fx",
      value: "track:guid:{TRACK-B}:4",
    });
  });

  it("fails closed on missing or mismatched confirmation", () => {
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({ refs: { items: ["item:guid:{ITEM-A}"] }, dry_run: true });
    const missing = planAlpha3_2EProjectDeleteTargetsMacro({ refs: preview.preview.refs_by_kind, dry_run: false });
    assert.equal(missing.ok, false);
    assert.equal(missing.blockers.some((blocker) => blocker.code === "CONFIRM_SCOPE_REQUIRED"), true);
    assert.deepEqual(missing.mutation_requests, []);

    const mismatch = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: preview.preview.refs_by_kind,
      dry_run: false,
      confirm_scope: { ...preview.required_confirm_scope, expected_counts: { items: 2 } },
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.blockers.some((blocker) => blocker.code === "CONFIRM_SCOPE_COUNTS_MISMATCH"), true);
    assert.deepEqual(mismatch.child_requests, []);

    for (const expected_counts of [
      { items: 1, unknown: 0 },
      { items: -1 },
      { items: 1.5 },
    ]) {
      const invalid = planAlpha3_2EProjectDeleteTargetsMacro({
        refs: preview.preview.refs_by_kind,
        dry_run: false,
        confirm_scope: { ...preview.required_confirm_scope, expected_counts },
      });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.blockers.some((entry) => entry.code === "CONFIRM_SCOPE_COUNTS_MISMATCH"), true);
      assert.deepEqual(invalid.child_requests, []);
    }
  });

  it("rejects unsupported target kinds, filesystem deletion, selectors, duplicates, and malformed refs", () => {
    const plan = planAlpha3_2EProjectDeleteTargetsMacro({
      refs: {
        takes: ["take:guid:{TAKE}"],
        media_files: ["/tmp/source.wav"],
        items: ["item:guid:{A}", "item:guid:{A}", "track:guid:{WRONG}"],
      },
      selectors: [{ kind: "track_name", value: "Drums" }],
      delete_policy: "delete_source_media",
    }, { idempotency_key_present: true });
    const codes = plan.blockers.map((blocker) => blocker.code);
    assert.equal(plan.ok, false);
    assert.equal(codes.includes("TARGET_KIND_UNSUPPORTED"), true);
    assert.equal(codes.includes("FILESYSTEM_DELETE_FORBIDDEN"), true);
    assert.equal(codes.includes("DELETE_SELECTOR_INVALID"), true);
    assert.equal(codes.includes("DELETE_POLICY_UNSUPPORTED"), true);
    assert.equal(codes.includes("DELETE_TARGET_REF_DUPLICATE"), true);
    assert.equal(codes.includes("DELETE_TARGET_REF_INVALID"), true);
    assert.equal(codes.includes("DELETE_TARGETS_IDEMPOTENCY_KEY_UNSUPPORTED"), true);
    assert.deepEqual(plan.child_requests, []);
  });

  it("wraps blocked and preview plans in runtime envelopes without executing children", () => {
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({ refs: { regions: ["region:project:7"] }, dry_run: true });
    const envelope = createAlpha3_2EProjectDeleteTargetsMacroRuntimeEnvelope({ request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { refs: { regions: ["region:project:7"] } } }, plan: preview, now: () => new Date("2026-07-11T00:00:00Z") });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.contract, ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT);
    assert.equal(envelope.result.executed, false);
    assert.equal(envelope.result.execution.executor_call_count, 0);
    assert.equal(envelope.result.preview.total_count, 1);
    assert.equal(envelope.result.typed_blockers[0].code, "CONFIRM_SCOPE_REQUIRED");
  });
});
