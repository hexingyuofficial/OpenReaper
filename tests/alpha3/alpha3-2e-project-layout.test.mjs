import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT,
  ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
  createAlpha3_2EProjectLayoutMacroDiscoveryItems,
  createAlpha3_2EProjectLayoutMacroRuntimeEnvelope,
  planAlpha3_2EProjectLayoutMacro,
} from "../../packages/mcp-server/src/alpha3-2e-project-layout-v1.mjs";

describe("Alpha3.2-E project apply_layout planner", () => {
  it("publishes an executable layout Macro with readback", () => {
    const [item] = createAlpha3_2EProjectLayoutMacroDiscoveryItems();
    assert.equal(item.id, ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID);
    assert.equal(item.support_status, "executable_runtime_bound");
    assert.equal(item.support_state, "supported_with_readback");
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.implementation_status, "executable");
    assert.equal(item.expectedDelta.kind, "write");
  });

  it("returns a dry-run preview with read-only preflight requests", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      layout: [
        { id: "drums", kind: "folder", name: "Drums", color: "#C00000", index: 0 },
        { id: "kick", kind: "track", name: "Kick", parent_id: "drums", index: 1 },
      ],
      dry_run: true,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "dry_run_preview");
    assert.equal(plan.mutation_requests.length, 0);
    assert.deepEqual(plan.child_requests.map((request) => request.id), ["template.tracks.list_tracks", "template.tracks.read_folder_structure"]);
    assert.deepEqual(plan.preview.target_counts, { rows: 2, folders: 1, tracks: 1, create: 2, update: 0, color: 1, nesting: 1 });
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.deletes_existing_tracks, false);
  });

  it("emits stable create update move color and nesting requests when dry_run is false", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      layout: [
        { id: "bus", kind: "folder", name: "Music Bus", track_ref: "track:guid:{BUS}", color: "#00AAFF", index: 0, folder_depth: 1 },
        { id: "lead", kind: "track", name: "Lead", parent_id: "bus", color: "#FFAA00", index: 1 },
      ],
      dry_run: false,
      match_policy: "by_ref",
      conflict_policy: "update_declared_fields",
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "plan_only_agent_executed_child_requests");
    assert.deepEqual(plan.preflight_requests.map((request) => request.id), ["template.tracks.list_tracks", "template.tracks.read_folder_structure"]);
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), [
      "template.tracks.rename_track",
      "template.tracks.set_color",
      "template.tracks.move_track",
      "template.tracks.set_folder_depth",
      "template.tracks.create_track",
      "template.tracks.set_color",
      "template.tracks.move_track",
      "template.tracks.nest_tracks_in_folder",
    ]);
    assert.deepEqual(plan.mutation_requests[0].refs, { track_ref: "track:guid:{BUS}" });
    assert.equal(plan.mutation_requests[4].input.name, "Lead");
    assert.deepEqual(plan.readback_requests.map((request) => request.id), ["template.tracks.list_tracks", "template.tracks.read_folder_structure"]);
    assert.equal(plan.child_requests.length, 12);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.raw_action_lua_shell_ui, false);
  });

  it("fails closed for invalid layout rows and cycles", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      layout: [
        { id: "a", kind: "folder", name: "A", parent_id: "b" },
        { id: "b", kind: "track", name: "B", parent_id: "a", color: "red" },
        { id: "b", kind: "bus", name: "Dup" },
      ],
      match_policy: "guess",
      conflict_policy: "overwrite",
    }, { idempotency_key_present: true });
    const codes = plan.blockers.map((blocker) => blocker.code);
    assert.equal(plan.ok, false);
    assert.equal(codes.includes("LAYOUT_ROW_ID_DUPLICATE"), true);
    assert.equal(codes.includes("LAYOUT_ROW_KIND_INVALID"), true);
    assert.equal(codes.includes("LAYOUT_COLOR_INVALID"), true);
    assert.equal(codes.includes("LAYOUT_CYCLE"), true);
    assert.equal(codes.includes("LAYOUT_MATCH_POLICY_INVALID"), true);
    assert.equal(codes.includes("LAYOUT_CONFLICT_POLICY_INVALID"), true);
    assert.equal(codes.includes("LAYOUT_IDEMPOTENCY_KEY_UNSUPPORTED"), true);
    assert.deepEqual(plan.child_requests, []);
  });

  it("wraps layout plans in runtime envelopes without executing children", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({ layout: [{ id: "fx", kind: "track", name: "FX", index: 0 }], dry_run: false });
    const envelope = createAlpha3_2EProjectLayoutMacroRuntimeEnvelope({ request: { id: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID, input: { layout: [{ id: "fx", kind: "track", name: "FX" }] } }, plan, now: () => new Date("2026-07-11T00:00:00Z") });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.contract, ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT);
    assert.equal(envelope.result.executed, false);
    assert.equal(envelope.result.execution.executor_call_count, 0);
    assert.equal(envelope.result.plan.preview.target_counts.rows, 1);
  });
});
