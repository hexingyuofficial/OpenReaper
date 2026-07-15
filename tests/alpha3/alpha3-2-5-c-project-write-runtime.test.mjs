import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY,
  executeAlpha3_2_5CProjectWriteMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-c-project-write-runtime-v1.mjs";
import { planAlpha3_2ERoutingApplyMacro } from "../../packages/mcp-server/src/alpha3-2e-routing-apply-v1.mjs";
import { planAlpha3_2EProjectDeleteTargetsMacro } from "../../packages/mcp-server/src/alpha3-2e-project-delete-targets-v1.mjs";

const NOW = "2026-07-12T00:00:00.000Z";

describe("Alpha3.2.5-C executable project-write Macros", () => {
  it("registers the three remaining shared project-write programs after media gets a dedicated executor", () => {
    assert.deepEqual([...ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY.ids].sort(), [
      "macro.project.apply_layout",
      "macro.project.delete_targets",
      "macro.routing.apply",
    ]);
  });

  it("runs dry-run validation and selection without dispatching a write", async () => {
    const calls = [];
    for (const request of [
      { id: "macro.project.apply_layout", input: { layout: [{ id: "fx", kind: "track", name: "FX" }], dry_run: true } },
      { id: "macro.routing.apply", input: { routes: [{ id: "a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }], dry_run: true } },
    ]) {
      const result = await executeAlpha3_2_5CProjectWriteMacro({ request, executeAtomic: fakeAtomic(calls), now: () => new Date(NOW) });
      assert.equal(result.contract, "macro.execution.v1");
      assert.equal(result.ok, true);
      assert.equal(result.execution.status, "dry_run_completed");
      assert.equal(result.result.verification.status, "passed");
    }
    assert.equal(calls.some((call) => isWrite(call.id)), false);
  });

  it("executes fixed routing dependencies, live-resolves refs, and verifies readback", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5 }],
        }),
        context: { session_id: "c2", request_sequence: 1 },
      },
      executeAtomic: fakeAtomic(calls),
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true);
    assert.equal(result.execution.status, "completed");
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.changes.length > 0, true);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(calls.some((call) => call.id === "template.routing.create_track_send"), true);
    assert.equal(calls.some((call) => call.id === "template.routing.resolve_send_ref"), true);
    assert.equal(calls.some((call) => call.id === "template.routing.read_track_routing"), true);
    assert.equal(calls.filter((call) => isWrite(call.id)).every((call) => !JSON.stringify(call.refs).includes("planned:")), true);
  });

  it("rejects a stable write GUID when a live resolver returns a different object", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
        }),
      },
      executeAtomic: fakeAtomic(calls, { wrongTrackRef: "track:guid:{WRONG}" }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "LIVE_REF_RESOLUTION_FAILED");
    assert.equal(calls.some((call) => call.id === "template.routing.create_track_send"), false);
  });

  it("reports partial failure when an executed write lacks passed Template verification", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
        }),
      },
      executeAtomic: fakeAtomic(calls, { omitWriteVerification: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "PROJECT_WRITE_CHILD_VERIFICATION_FAILED");
    assert.equal(result.result.changes.every((change) => change.status !== "applied"), true);
    assert.equal(calls.some((call) => call.id === "template.routing.create_track_send"), true);
    assert.equal(calls.some((call) => call.id === "template.routing.set_send_volume"), false);
  });

  it("reports verified mutation truth separately from failed index maintenance", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5 }],
        }),
      },
      executeAtomic: fakeAtomic(calls),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:failed-index", revision: 1 }),
        invalidateScopes: ({ scopes }) => ({
          ok: false,
          scopes,
          blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }],
        }),
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "INDEX_WRITE_FAILED");
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "failed"), true);
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.data.outcome.live_readback.status, "passed");
    assert.equal(result.result.data.outcome.index_maintenance.status, "failed");
  });

  it("fails closed before the first routing write when graph truth is incomplete or malformed", async () => {
    const cases = [
      [{ routingGraphTruncated: true }, "ROUTING_GRAPH_TRUNCATED"],
      [{ routingGraphCoverageStatus: "incomplete" }, "ROUTING_GRAPH_COVERAGE_INCOMPLETE"],
      [{ routingGraphMissingTracks: true }, "ROUTING_GRAPH_SHAPE_INVALID"],
      [{ routingGraphMissingEdges: true }, "ROUTING_GRAPH_SHAPE_INVALID"],
      [{ routingGraphTrackCount: 3 }, "ROUTING_GRAPH_TRACK_COVERAGE_INCOMPLETE"],
      [{ routingGraphReturnedTrackCount: 1 }, "ROUTING_GRAPH_TRACK_COUNT_MISMATCH"],
      [{ routingGraphEdgeCount: 1 }, "ROUTING_GRAPH_EDGE_COUNT_MISMATCH"],
    ];
    for (const [options, expectedCode] of cases) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: {
          id: "macro.routing.apply",
          input: confirmedRoutingInput({
            routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
          }),
        },
        executeAtomic: fakeAtomic(calls, options),
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false, expectedCode);
      assert.equal(result.execution.status, "failed", expectedCode);
      assert.equal(result.error.code, expectedCode);
      assert.equal(calls.some((call) => isWrite(call.id)), false);
      assert.equal(result.recovery.replay_policy, "correct_and_retry");
      assert.match(result.recovery.action, /same operations/);
      assert.match(result.recovery.action, /only dry_run changed to false/);
      assert.doesNotMatch(result.recovery.action, /confirm/i);
    }
  });

  it("does not report a write attempt when ref materialization fails before executor dispatch", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
        }),
      },
      executeAtomic: fakeAtomic(calls, { omitResolverObjectRefs: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "failed");
    assert.equal(result.error.code, "PROJECT_WRITE_OBJECT_REF_REQUIRED");
    assert.equal(calls.some((call) => isWrite(call.id)), false);
    assert.equal(result.recovery.replay_policy, "correct_and_retry");
  });

  it("treats an executor throw at the mutation boundary as dispatch-uncertain", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
        }),
      },
      executeAtomic: fakeAtomic(calls, { throwOnWrite: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(calls.some((call) => isWrite(call.id)), true);
    assert.equal(result.recovery.replay_policy, "do_not_replay");
  });

  it("blocks live duplicate edges and live-plus-request cycles before the first write", async () => {
    const cases = [
      [
        { duplicate_policy: "reject_existing" },
        [{ send_ref: "send:track:guid:{SRC}:0", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
        "ROUTING_LIVE_DUPLICATE_EDGE",
      ],
      [
        {},
        [{ send_ref: "send:track:guid:{DST}:0", source_track_ref: "track:guid:{DST}", destination_track_ref: "track:guid:{SRC}" }],
        "ROUTING_LIVE_CYCLE",
      ],
    ];
    for (const [routeExtras, graphEdges, expectedCode] of cases) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: {
          id: "macro.routing.apply",
          input: confirmedRoutingInput({
            routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", ...routeExtras }],
          }),
        },
        executeAtomic: fakeAtomic(calls, { routingGraphEdges: graphEdges }),
        now: () => new Date(NOW),
      });

      assert.equal(result.error.code, expectedCode);
      assert.equal(calls.some((call) => isWrite(call.id)), false);
      assert.equal(result.result.changes.every((change) => change.mutation.status === "pending"), true);
    }
  });

  it("allows an intentional live duplicate and binds the newly created Send", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", duplicate_policy: "allow_duplicate" }],
        }),
      },
      executeAtomic: fakeAtomic(calls, {
        routingGraphEdges: [{ send_ref: "send:track:guid:{SRC}:0", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
      }),
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.find((call) => call.id === "template.routing.create_track_send").input.duplicate_policy, "allow_duplicate");
    assert.equal(result.result.changes[0].target_ref, "send:guid:{CREATED}");
  });

  it("reports one logical routing change with separate mutation, live readback, and index truth", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5, pan: 0, muted: false }],
        }),
      },
      executeAtomic: fakeAtomic(calls),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.length, 1);
    assert.deepEqual(result.result.changes[0].template_ids, [
      "template.routing.create_track_send",
      "template.routing.set_send_volume",
      "template.routing.set_send_pan",
      "template.routing.set_send_mute",
    ]);
    assert.deepEqual(result.result.changes[0].mutation, { status: "completed", completed_count: 4, total_count: 4 });
    assert.equal(result.result.changes[0].live_readback.status, "passed");
    assert.equal(result.result.changes[0].index_maintenance.status, "skipped");
  });

  it("never marks a routing row applied when exact live readback is missing, multiple, mismatched, or truncated", async () => {
    const cases = [
      [{ routingReadbackOmitSend: true }, "ROUTING_SEND_READBACK_MISSING"],
      [{ routingReadbackDuplicateSend: true }, "ROUTING_SEND_READBACK_MULTIPLE"],
      [{ routingReadbackVolume: 0.75 }, "ROUTING_SEND_READBACK_MISMATCH"],
      [{ routingReadbackTruncated: true }, "ROUTING_TRACK_READBACK_INCOMPLETE"],
      [{ routingReadbackCoverageStatus: "incomplete" }, "ROUTING_TRACK_READBACK_INCOMPLETE"],
    ];
    for (const [options, expectedCode] of cases) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: {
          id: "macro.routing.apply",
          input: confirmedRoutingInput({
            routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5 }],
          }),
        },
        executeAtomic: fakeAtomic(calls, options),
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false, expectedCode);
      assert.equal(result.execution.status, "partial_failure");
      assert.equal(result.error.code, expectedCode);
      assert.notEqual(result.result.changes[0].status, "applied");
      assert.equal(result.result.changes[0].live_readback.status, "failed");
      assert.equal(result.recovery.replay_policy, "do_not_replay");
    }
  });

  it("never verifies delete absence when send enumeration coverage is unknown", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "delete_a", action: "delete", send_ref: "send:track:guid:{SRC}:0" }],
        }),
      },
      executeAtomic: fakeAtomic(calls, { routingReadbackCoverageStatus: "incomplete" }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "ROUTING_TRACK_READBACK_INCOMPLETE");
    assert.notEqual(result.result.changes[0].status, "applied");
    assert.equal(result.recovery.replay_policy, "do_not_replay");
  });

  it("verifies master-parent and channel-count operations from their exact live track rows", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          master_parent: [{ id: "master", track_ref: "track:guid:{SRC}", enabled: false }],
          channel_counts: [{ id: "channels", track_ref: "track:guid:{DST}", channel_count: 4 }],
        }),
      },
      executeAtomic: fakeAtomic(calls),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.result.changes.map((change) => [change.operation_id, change.status]), [["master", "applied"], ["channels", "applied"]]);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
  });

  it("executes layout through create/live-resolve/readback stages", async () => {
    const request = { id: "macro.project.apply_layout", input: { layout: [{ id: "fx", kind: "track", name: "FX", color: "#224466", index: 0 }], dry_run: false } };
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({ request, executeAtomic: fakeAtomic(calls), now: () => new Date(NOW) });
    assert.equal(result.ok, true);
    assert.equal(result.execution.status, "completed");
    assert.equal(result.result.verification.status, "passed");
    assert.equal(calls.some((call) => call.id === "template.tracks.resolve_track_ref"), true);
    assert.equal(calls.filter((call) => isWrite(call.id)).every((call) => !JSON.stringify(call.refs).includes("planned:")), true);
  });

  it("uses the accepted folder_ref ABI when executing nested layout rows", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: {
          layout: [
            { id: "folder", kind: "folder", name: "Folder", index: 0 },
            { id: "child", kind: "track", name: "Child", parent_id: "folder", index: 1 },
          ],
          dry_run: false,
        },
      },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, folderStructureReadback: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const nesting = calls.find((call) => call.id === "template.tracks.nest_tracks_in_folder");
    assert.deepEqual(nesting.refs, {
      folder_ref: { kind: "track", ref: "track:guid:{CREATED-1}" },
      track_ref: [{ kind: "track", ref: "track:guid:{CREATED-2}" }],
    });
    assert.equal(Object.hasOwn(nesting.refs, "folder_track_ref"), false);
  });

  it("nests sibling rows atomically and requires their final live parent refs", async () => {
    const layout = [
      { id: "folder", kind: "folder", name: "Folder", index: 0 },
      { id: "child_a", kind: "track", name: "Child A", parent_id: "folder", index: 1 },
      { id: "child_b", kind: "track", name: "Child B", parent_id: "folder", index: 2 },
    ];
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: "macro.project.apply_layout", input: { layout, dry_run: false } },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, folderStructureReadback: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const nesting = calls.filter((call) => call.id === "template.tracks.nest_tracks_in_folder");
    assert.equal(nesting.length, 1);
    assert.deepEqual(nesting[0].refs, {
      folder_ref: { kind: "track", ref: "track:guid:{CREATED-1}" },
      track_ref: [
        { kind: "track", ref: "track:guid:{CREATED-2}" },
        { kind: "track", ref: "track:guid:{CREATED-3}" },
      ],
    });
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);

    const mismatched = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: "macro.project.apply_layout", input: { layout, dry_run: false } },
      executeAtomic: fakeAtomic([], {
        multiTrackRefs: true,
        folderStructureReadback: true,
        wrongFolderParentTrackIndex: 1,
      }),
      now: () => new Date(NOW),
    });
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.execution.status, "partial_failure");
    assert.equal(mismatched.error.code, "PROJECT_WRITE_ROW_READBACK_MISMATCH");
    assert.equal(mismatched.result.changes[1].status, "readback_mismatch");
    assert.deepEqual(mismatched.result.changes[1].live_readback.mismatched_fields, ["parent_ref"]);
  });

  it("nests complete descendant blocks ancestor-first and verifies each final direct parent", async () => {
    const layout = [
      { id: "outer", kind: "folder", name: "Outer", index: 0 },
      { id: "inner", kind: "folder", name: "Inner", parent_id: "outer", index: 1 },
      { id: "inner_a", kind: "track", name: "Inner A", parent_id: "inner", index: 2 },
      { id: "inner_b", kind: "track", name: "Inner B", parent_id: "inner", index: 3 },
      { id: "outer_tail_a", kind: "track", name: "Outer Tail A", parent_id: "outer", index: 4 },
      { id: "outer_tail_b", kind: "track", name: "Outer Tail B", parent_id: "outer", index: 5 },
    ];
    const calls = [];
    const folderParentReadbacks = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: "macro.project.apply_layout", input: { layout, dry_run: false } },
      executeAtomic: fakeAtomic(calls, {
        multiTrackRefs: true,
        folderStructureReadback: true,
        folderParentReadbacks,
      }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const nesting = calls.filter((call) => call.id === "template.tracks.nest_tracks_in_folder");
    assert.deepEqual(nesting.map((call) => ({ folder_ref: firstRef({ folder_ref: call.refs.folder_ref }), track_refs: call.refs.track_ref.map((entry) => firstRef({ track_ref: entry })) })), [
      {
        folder_ref: "track:guid:{CREATED-1}",
        track_refs: [
          "track:guid:{CREATED-2}",
          "track:guid:{CREATED-3}",
          "track:guid:{CREATED-4}",
          "track:guid:{CREATED-5}",
          "track:guid:{CREATED-6}",
        ],
      },
      {
        folder_ref: "track:guid:{CREATED-2}",
        track_refs: ["track:guid:{CREATED-3}", "track:guid:{CREATED-4}"],
      },
    ]);
    assert.deepEqual(folderParentReadbacks.at(-1), [
      ["track:guid:{CREATED-2}", "track:guid:{CREATED-1}"],
      ["track:guid:{CREATED-3}", "track:guid:{CREATED-2}"],
      ["track:guid:{CREATED-4}", "track:guid:{CREATED-2}"],
      ["track:guid:{CREATED-5}", "track:guid:{CREATED-1}"],
      ["track:guid:{CREATED-6}", "track:guid:{CREATED-1}"],
    ]);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
  });

  it("creates Marker and Region annotations and applies rows only after exact field readback", async () => {
    const calls = [];
    const invalidations = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: {
          annotations: [
            { id: "intro", kind: "marker", name: "Intro", position_seconds: 0 },
            { id: "chorus", kind: "region", name: "Chorus", start_seconds: 8, end_seconds: 16 },
          ],
          dry_run: false,
        },
      },
      executeAtomic: fakeAtomic(calls),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:annotations", revision: 1 }),
        invalidateScopes: ({ scopes }) => {
          invalidations.push(scopes);
          return { ok: true, scopes, snapshot_id: "snapshot:annotations", revision: 2 };
        },
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls.map((call) => call.id), [
      "template.project.list_markers_regions",
      "template.project.create_marker",
      "template.project.create_region",
      "template.project.list_markers_regions",
    ]);
    assert.deepEqual(result.result.changes.map((change) => [change.operation_id, change.target_ref, change.status]), [
      ["intro", "marker:index:1", "applied"],
      ["chorus", "region:index:2", "applied"],
    ]);
    assert.equal(result.result.changes.every((change) => change.live_readback.source === "live_marker_region_readback"), true);
    assert.deepEqual(invalidations, [["markers"]]);
  });

  it("blocks annotation mutation when preflight coverage is incomplete or a same-name row exists", async () => {
    for (const options of [{ markerRegionTruncated: true }, { existingMarker: true }]) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: {
          id: "macro.project.apply_layout",
          input: { annotations: [{ id: "intro", kind: "marker", name: "Intro", position_seconds: 0 }], dry_run: false },
        },
        executeAtomic: fakeAtomic(calls, options),
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false);
      assert.equal(result.execution.status, "failed");
      assert.equal(calls.some((call) => call.id === "template.project.create_marker"), false);
    }
  });

  it("does not apply an annotation when its exact ref reads back with different fields", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { annotations: [{ id: "intro", kind: "marker", name: "Intro", position_seconds: 0 }], dry_run: false },
      },
      executeAtomic: fakeAtomic(calls, { markerReadbackPosition: 1 }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "PROJECT_WRITE_ROW_READBACK_MISMATCH");
    assert.equal(result.result.changes[0].status, "readback_mismatch");
    assert.deepEqual(result.result.changes[0].live_readback.mismatched_fields, ["position_seconds"]);
  });

  it("keeps mutation, incomplete live readback, and index maintenance separate", async () => {
    const invalidations = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { annotations: [{ id: "intro", kind: "marker", name: "Intro", position_seconds: 0 }], dry_run: false },
      },
      executeAtomic: fakeAtomic([], { markerRegionReadbackTruncatedAfterWrite: true }),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:annotation-incomplete", revision: 1 }),
        invalidateScopes: ({ scopes }) => {
          invalidations.push(scopes);
          return { ok: true, scopes, snapshot_id: "snapshot:annotation-incomplete", revision: 2 };
        },
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "LAYOUT_ANNOTATION_READBACK_INCOMPLETE");
    assert.equal(result.result.changes[0].mutation.status, "completed");
    assert.equal(result.result.changes[0].status, "readback_missing");
    assert.equal(result.result.changes[0].live_readback.status, "failed");
    assert.equal(result.result.changes[0].index_maintenance.status, "completed");
    assert.deepEqual(invalidations, [["markers"]]);
  });

  it("keeps fourteen-row layout readback complete behind a 2 KiB public budget", async () => {
    const calls = [];
    const layout = layoutRows(14);
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout, dry_run: false },
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 },
      },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.length, 14);
    assert.deepEqual(result.result.changes.map((change) => change.operation_id), layout.map((row) => row.id));
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.mutation.status === "completed"), true);
    assert.equal(result.result.changes.every((change) => change.mutation.completed_count === 2), true);
    assert.equal(result.result.changes.every((change) => change.mutation.total_count === 2), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "skipped"), true);
    assert.equal(result.result.changes.some((change) => JSON.stringify(change).includes("evidence_refs")), false);
    assert.equal(calls.every((call) => call.budget.max_inline_value_bytes === 24_576), true);
    assert.equal(calls.every((call) => call.budget.max_items === 256), true);
  });

  it("returns twenty real-length layout outcomes within the frozen response contract", async () => {
    const calls = [];
    const layout = layoutRows(20);
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout, dry_run: false },
        context: {
          session_id: "client:alpha33:0a25c7be-6464-49e0-8a1b-b8634b8dd52a",
          request_sequence: 2_147_483_647,
        },
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 },
      },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, realLengthTrackRefs: true, realLengthRequestIds: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.length, 20);
    assert.deepEqual(result.result.changes.map((change) => change.operation_id), layout.map((row) => row.id));
    for (const change of result.result.changes) {
      assert.match(change.target_ref, /^track:guid:\{[0-9a-f-]{36}\}$/u);
      assert.equal(change.status, "applied");
      assert.deepEqual(change.mutation, { status: "completed", completed_count: 2, total_count: 2 });
      assert.deepEqual(change.live_readback, { status: "passed" });
      assert.deepEqual(change.index_maintenance, { status: "skipped" });
      assert.equal(Object.hasOwn(change, "evidence_refs"), false);
    }
    assert.equal(result.result.canonical_refs.length, 0);
    assert.equal(result.result.verification.evidence_refs.length, 16);
    assert.equal(result.budget.actual_bytes <= 65_536, true);
    assert.equal(inlineDetailBytes(result) <= 24_576, true);
    assert.equal(calls.filter((call) => isWrite(call.id)).length, 40);
  });

  it("verifies a layout batch whose final rows are beyond track one hundred", async () => {
    const calls = [];
    const layout = layoutRows(13).map((row, offset) => ({
      ...row,
      index: 91 + offset,
    }));
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout, match_policy: "create_only", dry_run: false },
      },
      executeAtomic: fakeAtomic(calls, {
        multiTrackRefs: true,
        realLengthTrackRefs: true,
        respectTrackListLimitByIndex: true,
      }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.length, 13);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    const verificationReads = calls.filter((call) =>
      call.id === "template.tracks.list_tracks" || call.id === "template.tracks.read_folder_structure"
    );
    assert.equal(verificationReads.length >= 2, true);
    assert.equal(verificationReads.every((call) => call.input.limit === 256), true);
  });

  it("uses exact GUID readback for layout targets beyond the bounded bulk scan", async () => {
    const calls = [];
    const layout = layoutRows(13).map((row, offset) => ({
      ...row,
      index: 291 + offset,
    }));
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout, match_policy: "create_only", dry_run: false },
      },
      executeAtomic: fakeAtomic(calls, {
        multiTrackRefs: true,
        realLengthTrackRefs: true,
        respectTrackListLimitByIndex: true,
      }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    const exactReadbacks = postMutationTrackResolverCalls(calls);
    assert.deepEqual(exactReadbacks.map((call) => call.input.track_ref), result.result.changes.map((change) => change.target_ref));
  });

  it("does not apply a deep layout row when exact GUID readback returns another Track", async () => {
    const calls = [];
    const layout = [{ ...layoutRows(1)[0], index: 300 }];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout, match_policy: "create_only", dry_run: false },
      },
      executeAtomic: fakeAtomic(calls, {
        multiTrackRefs: true,
        realLengthTrackRefs: true,
        respectTrackListLimitByIndex: true,
        wrongPostReadbackResolverTrackIndex: 300,
      }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PROJECT_WRITE_ROW_READBACK_MISSING");
    assert.equal(result.result.changes[0].status, "readback_missing");
    assert.equal(result.result.changes[0].live_readback.status, "failed");
  });

  it("executes eighty-four-row layouts with compact per-row truth", async () => {
    const calls = [];
    const layout = Array.from({ length: 7 }, (_, folderIndex) => ({
      id: `bus_${folderIndex + 1}`,
      kind: "folder",
      name: `Bus ${folderIndex + 1}`,
      color: folderIndex % 2 ? "#4D83A8" : "#6B8E58",
      children: Array.from({ length: 11 }, (_, childIndex) => ({
        id: `track_${folderIndex + 1}_${childIndex + 1}`,
        kind: "track",
        name: `Track ${folderIndex + 1} ${childIndex + 1}`,
      })),
    }));
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout, dry_run: false },
        context: { session_id: "client:alpha33:budget-boundary", request_sequence: 1 },
      },
      executeAtomic: fakeAtomic(calls, {
        multiTrackRefs: true,
        realLengthTrackRefs: true,
        realLengthRequestIds: true,
        folderStructureReadback: true,
      }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "completed");
    assert.equal(result.result.changes.length, 84);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => /^track:guid:\{[0-9a-f-]{36}\}$/u.test(change.target_ref)), true);
    assert.equal(result.result.changes.every((change) => change.mutation.status === "completed"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "skipped"), true);
    assert.equal(result.result.changes.every((change) => !Object.hasOwn(change, "template_ids")), true);
    const layoutMutationIds = new Set([
      "template.tracks.create_track",
      "template.tracks.create_folder_track",
      "template.tracks.set_color",
      "template.tracks.nest_tracks_in_folder",
    ]);
    assert.equal(calls.filter((call) => layoutMutationIds.has(call.id)).length, 98);
    assert.equal(result.budget.actual_bytes <= 65_536, true);
    assert.equal(inlineDetailBytes(result) <= 24_576, true);
  });

  it("honors the caller response budget before the first layout mutation", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout: layoutRows(20), dry_run: false },
        budget: { max_response_bytes: 6_000, max_items: 50, max_inline_value_bytes: 2_048 },
      },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, realLengthTrackRefs: true, realLengthRequestIds: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED");
    assert.match(result.error.message, /6000 envelope bytes available/u);
    assert.equal(result.result.changes.length, 0);
    assert.equal(calls.length, 0, "caller-budget rejection must precede every child call");
  });

  it("marks only the layout row missing from exact live readback as unverified", async () => {
    const calls = [];
    const invalidations = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: "macro.project.apply_layout", input: { layout: layoutRows(3), dry_run: false } },
      executeAtomic: fakeAtomic(calls, {
        multiTrackRefs: true,
        realLengthTrackRefs: true,
        omitReadbackTrackIndex: 1,
        failPostReadbackResolverTrackIndex: 1,
      }),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:readback-missing", revision: 8 }),
        invalidateScopes: ({ scopes }) => {
          invalidations.push(scopes);
          return { ok: true, scopes, snapshot_id: "snapshot:readback-missing", revision: 9 };
        },
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "PROJECT_WRITE_ROW_READBACK_MISSING");
    assert.equal(result.result.changes.length, 3);
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(result.result.changes[1].operation_id, "track_2");
    assert.equal(result.result.changes[1].status, "readback_missing");
    assert.deepEqual(result.result.changes[1].live_readback, { status: "failed" });
    assert.equal(result.result.changes[2].status, "applied");
    assert.deepEqual(invalidations, [["tracks"]]);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "completed"), true);
    assert.equal(result.result.data.applied_change_count, 2);
    assert.equal(result.result.verification.status, "failed");
    assert.equal(result.result.data.outcome.index_maintenance.status, "completed");
  });

  it("preserves verified per-row layout truth when index maintenance fails", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: "macro.project.apply_layout", input: { layout: layoutRows(2), dry_run: false } },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, realLengthTrackRefs: true }),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:failed-layout-index", revision: 9 }),
        invalidateScopes: ({ scopes }) => ({
          ok: false,
          scopes,
          blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }],
        }),
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "INDEX_WRITE_FAILED");
    assert.equal(result.result.changes.length, 2);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "failed"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.blocker_code === "INDEX_WRITE_FAILED"), true);
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.data.outcome.live_readback.status, "passed");
    assert.equal(result.result.data.outcome.index_maintenance.status, "failed");
  });

  it("requires exact destructive confirmation and never dispatches a delete during the preview", async () => {
    const input = { refs: { items: ["item:guid:{ITEM}"] }, dry_run: true, delete_policy: "project_objects_only" };
    const preview = planAlpha3_2EProjectDeleteTargetsMacro(input);
    const previewCalls = [];
    const dryRun = await executeAlpha3_2_5CProjectWriteMacro({ request: { id: "macro.project.delete_targets", input }, executeAtomic: fakeAtomic(previewCalls), now: () => new Date(NOW) });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.execution.status, "dry_run_completed");
    assert.equal(dryRun.result.data.mutation_skipped, true);
    assert.deepEqual(dryRun.result.data.required_confirm_scope, preview.required_confirm_scope);
    assert.equal(dryRun.result.data.executable_retry.id, "macro.project.delete_targets");
    assert.equal(previewCalls.some((call) => call.id === "template.items.delete_items"), false);

    const calls = [];
    const completed = await executeAlpha3_2_5CProjectWriteMacro({
      request: dryRun.result.data.executable_retry,
      executeAtomic: fakeAtomic(calls),
      now: () => new Date(NOW),
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.execution.status, "completed");
    assert.equal(calls.some((call) => call.id === "template.items.delete_items"), true);
    assert.equal(completed.recovery, null);
  });

  it("keeps exact FX deletion applied when live absence readback passes and invalidates only legal index scopes", async () => {
    const fxRef = "fx:track:guid:{TRACK}:1";
    const preview = planAlpha3_2EProjectDeleteTargetsMacro({ refs: { fx: [fxRef] }, dry_run: true });
    const invalidations = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.delete_targets",
        input: { refs: preview.preview.refs_by_kind, dry_run: false, confirm_scope: preview.required_confirm_scope },
      },
      executeAtomic: async ({ id, input = {}, refs = {} }) => {
        if (id === "template.fx.delete_fx") {
          return successfulExecution(id, {
            deleted_fx_ref: fxRef,
            owner_ref: "track:guid:{TRACK}",
            readback_status: "passed",
          }, [refs.fx_ref]);
        }
        if (id === "template.fx.resolve_fx_ref") {
          return successfulExecution(id, { fx_ref: fxRef }, [{
            kind: "fx",
            ref: fxRef,
            identity: { scheme: "track_fx", value: "track:guid:{TRACK}:1" },
          }]);
        }
        throw new Error(`Unexpected atomic call ${id}:${JSON.stringify(input)}`);
      },
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:fx-delete", revision: 3 }),
        invalidateScopes: ({ scopes }) => {
          invalidations.push(scopes);
          return { ok: true, status: "scopes_invalidated", scopes };
        },
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(result.result.changes[0].live_readback.source, "accepted_template_live_absence_readback");
    assert.deepEqual(invalidations, [["fx", "tracks", "takes", "automation"]]);
  });

  it("does not project FX identities or routing fingerprints as canonical refs", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.routing.apply",
        input: confirmedRoutingInput({
          routes: [{ id: "send", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
        }),
      },
      executeAtomic: async (request) => {
        const response = await fakeAtomic(calls)(request);
        if (request.id === "template.routing.create_track_send") {
          response.result.summary.fingerprint = "track:guid:{DST}|1|0|-1|0";
          response.result.summary.internal_identity = "track:guid:{SRC}:0";
        }
        return response;
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.canonical_refs.includes("track:guid:{DST}|1|0|-1|0"), false);
    assert.equal(result.result.canonical_refs.includes("track:guid:{SRC}:0"), false);
  });
});

function successfulExecution(id, summary, refs = []) {
  return {
    ok: true,
    request: { id: `evidence:${id}` },
    verification: { status: "passed" },
    result: { summary, readback: summary, refs },
  };
}

function confirmedRoutingInput(input) {
  const preview = planAlpha3_2ERoutingApplyMacro({ ...input, dry_run: true });
  assert.equal(preview.ok, true, JSON.stringify(preview.blockers));
  return { ...input, dry_run: false };
}

function fakeAtomic(calls, options = {}) {
  return async ({ id, input = {}, refs = {}, budget }) => {
    calls.push({ id, input, refs, budget });
    if (options.throwOnWrite && isWrite(id)) throw new Error("Executor transport outcome is unknown.");
    if (id === "template.items.resolve_item_ref" && calls.some((call) => call.id === "template.items.delete_items")) {
      return { ok: false, request: { id }, error: { code: "ITEM_NOT_FOUND", message: "Deleted item no longer resolves." }, result: {} };
    }
    if (id === "template.tracks.resolve_track_ref"
      && Number.isInteger(options.failPostReadbackResolverTrackIndex)
      && input.track_ref === createdTrackRef(options.failPostReadbackResolverTrackIndex, options)
      && postMutationTrackResolverCalls(calls).at(-1) === calls.at(-1)) {
      return { ok: false, request: { id }, error: { code: "TRACK_NOT_FOUND", message: "Track no longer resolves." }, result: {} };
    }
    const ref = firstRef(refs);
    const summary = {};
    if (id === "template.routing.read_project_routing_graph") {
      summary.tracks = options.routingGraphTracks ?? [
        { track_ref: "track:guid:{SRC}", master_parent_enabled: true, channel_count: 2 },
        { track_ref: "track:guid:{DST}", master_parent_enabled: true, channel_count: 2 },
      ];
      summary.edges = options.routingGraphEdges ?? [];
      summary.track_count = options.routingGraphTrackCount ?? summary.tracks.length;
      summary.returned_track_count = options.routingGraphReturnedTrackCount ?? summary.tracks.length;
      summary.edge_count = options.routingGraphEdgeCount ?? summary.edges.length;
      summary.truncated = options.routingGraphTruncated === true;
      summary.coverage_status = options.routingGraphCoverageStatus ?? "complete";
      summary.coverage = { internally_complete: options.routingGraphInternallyComplete !== false };
      if (options.routingGraphMissingTracks) delete summary.tracks;
      if (options.routingGraphMissingEdges) delete summary.edges;
    }
    else if (id === "template.tracks.resolve_track_ref") {
      const wrongPostReadback = Number.isInteger(options.wrongPostReadbackResolverTrackIndex)
        && input.track_ref === createdTrackRef(options.wrongPostReadbackResolverTrackIndex, options)
        && postMutationTrackResolverCalls(calls).at(-1) === calls.at(-1);
      summary.track_ref = wrongPostReadback ? "track:guid:{FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF}" : options.wrongTrackRef ?? input.track_ref;
    }
    else if (id === "template.items.resolve_item_ref") summary.item_ref = input.ref;
    else if (id === "template.items.read_item_summary") summary.item_ref = ref;
    else if (id === "template.routing.resolve_send_ref") summary.send_ref = input.send_ref;
    else if (id === "template.routing.create_track_send") summary.send_ref = "send:guid:{CREATED}";
    else if (id === "template.routing.read_track_routing") {
      summary.track_ref = ref;
      summary.master_parent_enabled = ref === "track:guid:{SRC}" && calls.some((call) => call.id === "template.routing.set_master_parent_send") ? false : true;
      summary.channel_count = ref === "track:guid:{DST}" && calls.some((call) => call.id === "template.routing.set_track_channel_count") ? 4 : 2;
      summary.truncated = options.routingReadbackTruncated === true;
      summary.coverage_status = options.routingReadbackCoverageStatus ?? "complete";
      summary.coverage = { internally_complete: options.routingReadbackCoverageStatus !== "incomplete" };
      const expectedSend = {
            send_ref: "send:guid:{CREATED}",
            source_track_ref: "track:guid:{SRC}",
            destination_track_ref: "track:guid:{DST}",
            volume: options.routingReadbackVolume ?? (calls.some((call) => call.id === "template.routing.set_send_volume") ? 0.5 : 1),
            pan: 0,
            muted: false,
          };
      summary.sends = ref === "track:guid:{SRC}" && !options.routingReadbackOmitSend
        ? options.routingReadbackDuplicateSend ? [expectedSend, { ...expectedSend }] : [expectedSend]
        : [];
    }
    else if (id === "template.media.probe_file") summary.file_ref = "file:guid:{PROBED}";
    else if (id === "template.tracks.create_track" || id === "template.tracks.create_folder_track") {
      summary.track_ref = options.multiTrackRefs
        ? createdTrackRef(Number(input.index), options)
        : "track:guid:{CREATED}";
    }
    else if (id === "template.tracks.list_tracks" || id === "template.tracks.read_folder_structure") {
      const nesting = calls.filter((call) => call.id === "template.tracks.nest_tracks_in_folder");
      const parentRefByChild = new Map();
      for (const call of nesting) {
        const folderRef = firstRef({ folder_ref: call.refs.folder_ref });
        for (const entry of call.refs.track_ref ?? []) parentRefByChild.set(firstRef({ track_ref: entry }), folderRef);
      }
      summary.tracks = options.multiTrackRefs
        ? calls
            .filter((call) => call.id === "template.tracks.create_track" || call.id === "template.tracks.create_folder_track")
            .filter((call) => Number(call.input.index) !== options.omitReadbackTrackIndex)
            .filter((call) => options.respectTrackListLimitByIndex !== true || Number(call.input.index) < input.limit)
            .map((call) => {
              const trackRef = createdTrackRef(Number(call.input.index), options);
              const parentRef = options.folderStructureReadback === true ? parentRefByChild.get(trackRef) : null;
              return {
                track_ref: trackRef,
                name: call.input.name,
                ...(parentRef ? {
                  parent_ref: Number(call.input.index) === options.wrongFolderParentTrackIndex ? null : parentRef,
                } : {}),
              };
            })
        : [{ track_ref: "track:guid:{CREATED}", name: "FX" }];
      if (id === "template.tracks.read_folder_structure" && nesting.length > 0 && Array.isArray(options.folderParentReadbacks)) {
        options.folderParentReadbacks.push(summary.tracks
          .filter((row) => typeof row.parent_ref === "string")
          .map((row) => [row.track_ref, row.parent_ref]));
      }
    }
    else if (id === "template.project.create_marker") {
      summary.marker_ref = "marker:index:1";
      summary.name = input.name;
      summary.position_seconds = input.position_seconds;
    }
    else if (id === "template.project.create_region") {
      summary.region_ref = "region:index:2";
      summary.name = input.name;
      summary.start_seconds = input.start_seconds;
      summary.end_seconds = input.end_seconds;
    }
    else if (id === "template.project.list_markers_regions") {
      const existing = options.existingMarker
        ? [{ kind: "marker", marker_ref: "marker:index:0", name: "Intro", position_seconds: 0 }]
        : [];
      const created = calls.flatMap((call) => {
        if (call.id === "template.project.create_marker") return [{ kind: "marker", marker_ref: "marker:index:1", name: call.input.name, position_seconds: options.markerReadbackPosition ?? call.input.position_seconds }];
        if (call.id === "template.project.create_region") return [{ kind: "region", region_ref: "region:index:2", name: call.input.name, position_seconds: call.input.start_seconds, end_seconds: call.input.end_seconds }];
        return [];
      });
      summary.items = [...existing, ...created];
      summary.marker_count = summary.items.filter((row) => row.kind === "marker").length;
      summary.region_count = summary.items.filter((row) => row.kind === "region").length;
      summary.truncated = options.markerRegionTruncated === true
        || (options.markerRegionReadbackTruncatedAfterWrite === true && created.length > 0);
    }
    else if (id.startsWith("template.media.import_file")) summary.imported_item_refs = ["item:guid:{IMPORTED}"];
    const resultRefs = Object.values(summary).flatMap((value) => Array.isArray(value) ? value.map(objectRef) : typeof value === "string" ? [objectRef(value)] : []);
    return {
      ok: true,
      request: { id: options.realLengthRequestIds ? realLengthRequestId(calls.length, id) : id },
      ...(!options.omitWriteVerification || !isWrite(id) ? { verification: { status: "passed" } } : {}),
      result: { summary, readback: summary, refs: options.omitResolverObjectRefs && id === "template.tracks.resolve_track_ref" ? [] : resultRefs },
    };
  };
}

function layoutRows(count, { longIds = false } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: longIds ? `track_${String(index + 1).padStart(3, "0")}_${"x".repeat(80)}` : `track_${index + 1}`,
    kind: "track",
    name: `Highway ${String(index + 1).padStart(3, "0")}`,
    index,
  }));
}

function createdTrackRef(index, options) {
  if (!options.realLengthTrackRefs) return `track:guid:{CREATED-${index + 1}}`;
  return `track:guid:{00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}}`;
}

function postMutationTrackResolverCalls(calls) {
  const finalWriteIndex = calls.findLastIndex((call) => isWrite(call.id));
  const firstBulkReadbackIndex = calls.findIndex((call, index) => index > finalWriteIndex
    && (call.id === "template.tracks.list_tracks" || call.id === "template.tracks.read_folder_structure"));
  if (firstBulkReadbackIndex < 0) return [];
  return calls.slice(firstBulkReadbackIndex + 1).filter((call) => call.id === "template.tracks.resolve_track_ref");
}

function realLengthRequestId(sequence, id) {
  return `request:bridge:${String(sequence).padStart(4, "0")}:f5ea614b-e606-4f86-9c89-1609ee6f311d:${id}`;
}

function inlineDetailBytes(envelope) {
  return Buffer.byteLength(JSON.stringify({
    stages: envelope.execution.stages,
    changes: envelope.result.changes,
    data: envelope.result.data,
    blockers: envelope.blockers,
    error: envelope.error,
    recovery: envelope.recovery,
  }), "utf8");
}

function objectRef(ref) {
  return { kind: String(ref).split(":", 1)[0], ref };
}

function firstRef(refs) {
  for (const value of Object.values(refs)) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof value.ref === "string") return value.ref;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return null;
}

function isWrite(id) {
  return !id.includes(".read_") && !id.includes(".list_") && !id.includes(".resolve_") && !id.includes(".probe_");
}
