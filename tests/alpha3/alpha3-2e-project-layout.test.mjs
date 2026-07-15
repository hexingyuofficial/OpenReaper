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
    assert.deepEqual(plan.preview.target_counts, { rows: 2, layout_rows: 2, annotations: 0, markers: 0, regions: 0, folders: 1, tracks: 1, create: 2, update: 0, color: 1, nesting: 1 });
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.deletes_existing_tracks, false);
  });

  it("flattens guide-shaped recursive children in deterministic pre-order", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      layout: [{
        id: "drums",
        kind: "folder",
        name: "DRUMS",
        children: [
          { id: "kick", kind: "track", name: "Kick", parent_id: "drums" },
          { id: "snare", kind: "track", name: "Snare" },
        ],
      }],
      dry_run: true,
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.preview.rows.map(({ id, parent_id, index }) => ({ id, parent_id, index })), [
      { id: "drums", parent_id: null, index: 0 },
      { id: "kick", parent_id: "drums", index: 1 },
      { id: "snare", parent_id: "drums", index: 2 },
    ]);
    assert.equal(plan.preview.rows.every((row) => !Object.hasOwn(row, "children")), true);
    assert.deepEqual(plan.child_requests.map((request) => request.id), ["template.tracks.list_tracks", "template.tracks.read_folder_structure"]);
  });

  it("retains the existing flat parent_id ABI", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      layout: [
        { id: "music", kind: "folder", name: "MUSIC" },
        { id: "keys", kind: "track", name: "Keys", parent_id: "music" },
      ],
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.preview.rows.map(({ id, parent_id }) => ({ id, parent_id })), [
      { id: "music", parent_id: null },
      { id: "keys", parent_id: "music" },
    ]);
  });

  it("fails closed for duplicate nested ids, recursive object cycles, and conflicting parent declarations", () => {
    const duplicate = planAlpha3_2EProjectLayoutMacro({
      layout: [
        { id: "drums", kind: "folder", name: "Drums", children: [{ id: "kick", kind: "track", name: "Kick" }] },
        { id: "kick", kind: "track", name: "Duplicate Kick" },
      ],
    });
    assert.equal(duplicate.blockers.some((entry) => entry.code === "LAYOUT_ROW_ID_DUPLICATE"), true);
    assert.deepEqual(duplicate.child_requests, []);

    const recursive = { id: "cycle", kind: "folder", name: "Cycle", children: [] };
    recursive.children.push(recursive);
    const cycle = planAlpha3_2EProjectLayoutMacro({ layout: [recursive] });
    assert.equal(cycle.blockers.some((entry) => entry.code === "LAYOUT_CHILDREN_CYCLE"), true);
    assert.deepEqual(cycle.child_requests, []);

    const conflict = planAlpha3_2EProjectLayoutMacro({
      layout: [
        { id: "other", kind: "folder", name: "Other" },
        { id: "drums", kind: "folder", name: "Drums", children: [{ id: "kick", kind: "track", name: "Kick", parent_id: "other" }] },
      ],
    });
    assert.equal(conflict.blockers.some((entry) => entry.code === "LAYOUT_PARENT_ID_CONFLICT"), true);
    assert.deepEqual(conflict.child_requests, []);
  });

  it("enforces recursive depth and flattened row ceilings", () => {
    const depthEight = planAlpha3_2EProjectLayoutMacro({ layout: nestedLayout(8) });
    assert.equal(depthEight.ok, true);
    assert.equal(depthEight.preview.target_counts.layout_rows, 9);

    const depthNine = planAlpha3_2EProjectLayoutMacro({ layout: nestedLayout(9) });
    assert.equal(depthNine.ok, false);
    assert.equal(depthNine.blockers.some((entry) => entry.code === "LAYOUT_CHILDREN_DEPTH_EXCEEDED"), true);
    assert.deepEqual(depthNine.child_requests, []);

    const hundred = planAlpha3_2EProjectLayoutMacro({ layout: wideLayout(100) });
    assert.equal(hundred.ok, true);
    assert.equal(hundred.preview.target_counts.layout_rows, 100);

    const hundredOne = planAlpha3_2EProjectLayoutMacro({ layout: wideLayout(101) });
    assert.equal(hundredOne.ok, false);
    assert.equal(hundredOne.blockers.some((entry) => entry.code === "LAYOUT_TOO_LARGE"), true);
    assert.deepEqual(hundredOne.child_requests, []);
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
    assert.deepEqual(plan.mutation_requests[7].refs, {
      folder_ref: "track:guid:{BUS}",
      track_ref: ["track:planned:lead"],
    });
    assert.deepEqual(plan.readback_requests.map((request) => request.id), ["template.tracks.list_tracks", "template.tracks.read_folder_structure"]);
    assert.equal(plan.child_requests.length, 12);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.raw_action_lua_shell_ui, false);
  });

  it("plans create-only Marker and Region annotations with complete live reads", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      annotations: [
        { id: "intro", kind: "marker", name: "Intro", position_seconds: 0 },
        { id: "chorus", kind: "region", name: "Chorus", start_seconds: 8, end_seconds: 16 },
      ],
      dry_run: false,
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.preview.target_counts, { rows: 2, layout_rows: 0, annotations: 2, markers: 1, regions: 1, folders: 0, tracks: 0, create: 0, update: 0, color: 0, nesting: 0 });
    assert.deepEqual(plan.preflight_requests.map((request) => request.id), ["template.project.list_markers_regions"]);
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), ["template.project.create_marker", "template.project.create_region"]);
    assert.deepEqual(plan.mutation_requests[0].input, { name: "Intro", position_seconds: 0 });
    assert.deepEqual(plan.mutation_requests[1].input, { name: "Chorus", start_seconds: 8, end_seconds: 16 });
    assert.deepEqual(plan.readback_requests.map((request) => request.id), ["template.project.list_markers_regions"]);
  });

  it("blocks update-shaped, colored, and invalid annotation rows before child calls", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      annotations: [
        { id: "move", kind: "marker", name: "Move", marker_ref: "marker:index:1", position_seconds: 2 },
        { id: "color", kind: "marker", name: "Color", position_seconds: 3, color: "#112233" },
        { id: "bounds", kind: "region", name: "Bounds", start_seconds: 8, end_seconds: 8 },
      ],
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((entry) => entry.code === "LAYOUT_ANNOTATION_UPDATE_UNSUPPORTED"), true);
    assert.equal(plan.blockers.some((entry) => entry.code === "LAYOUT_ANNOTATION_COLOR_READBACK_UNSUPPORTED"), true);
    assert.equal(plan.blockers.some((entry) => entry.code === "LAYOUT_REGION_END_INVALID"), true);
    assert.deepEqual(plan.child_requests, []);
  });

  it("blocks duplicate annotation identities within one request", () => {
    const plan = planAlpha3_2EProjectLayoutMacro({
      annotations: [
        { id: "intro_a", kind: "marker", name: "Intro", position_seconds: 0 },
        { id: "intro_b", kind: "marker", name: "Intro", position_seconds: 4 },
      ],
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((entry) => entry.code === "LAYOUT_ANNOTATION_REQUEST_CONFLICT"), true);
    assert.deepEqual(plan.child_requests, []);
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

function nestedLayout(maxDepth) {
  let row = { id: `depth_${maxDepth}`, kind: "track", name: `Depth ${maxDepth}` };
  for (let depth = maxDepth - 1; depth >= 0; depth -= 1) {
    row = { id: `depth_${depth}`, kind: "folder", name: `Depth ${depth}`, children: [row] };
  }
  return [row];
}

function wideLayout(count) {
  return [{
    id: "root",
    kind: "folder",
    name: "Root",
    children: Array.from({ length: count - 1 }, (_, index) => ({
      id: `child_${index + 1}`,
      kind: "track",
      name: `Child ${index + 1}`,
    })),
  }];
}
