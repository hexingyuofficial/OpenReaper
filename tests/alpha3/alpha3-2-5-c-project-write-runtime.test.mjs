import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY,
  executeAlpha3_2_5CProjectWriteMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-c-project-write-runtime-v1.mjs";
import { planAlpha3_2EProjectDeleteTargetsMacro } from "../../packages/mcp-server/src/alpha3-2e-project-delete-targets-v1.mjs";

const NOW = "2026-07-12T00:00:00.000Z";

describe("Alpha3.2.5-C executable project-write Macros", () => {
  it("registers exactly the four fixed project-write programs", () => {
    assert.deepEqual([...ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY.ids].sort(), [
      "macro.media.place_assets",
      "macro.project.apply_layout",
      "macro.project.delete_targets",
      "macro.routing.apply",
    ]);
  });

  it("runs dry-run validation and selection without dispatching a write", async () => {
    const calls = [];
    for (const request of [
      { id: "macro.project.apply_layout", input: { layout: [{ id: "fx", kind: "track", name: "FX" }], dry_run: true } },
      { id: "macro.media.place_assets", input: { assets: [{ id: "one", path: "/Users/Shared/OpenReaper/one.wav", track_ref: "track:guid:{ONE}", position_seconds: 0 }], dry_run: true } },
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
        input: {
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5 }],
          dry_run: false,
        },
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
        input: {
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
          dry_run: false,
        },
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
        input: {
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
          dry_run: false,
        },
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
        input: {
          routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5 }],
          dry_run: false,
        },
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

  it("executes layout and media placement through probe/create/live-resolve/readback stages", async () => {
    for (const request of [
      { id: "macro.project.apply_layout", input: { layout: [{ id: "fx", kind: "track", name: "FX", color: "#224466", index: 0 }], dry_run: false } },
      { id: "macro.media.place_assets", input: { assets: [{ id: "one", path: "/Users/Shared/OpenReaper/one.wav", track_ref: "track:guid:{ONE}", position_seconds: 0 }], dry_run: false } },
    ]) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({ request, executeAtomic: fakeAtomic(calls), now: () => new Date(NOW) });
      assert.equal(result.ok, true);
      assert.equal(result.execution.status, "completed");
      assert.equal(result.result.verification.status, "passed");
      assert.equal(calls.some((call) => call.id === "template.tracks.resolve_track_ref"), true);
      assert.equal(calls.filter((call) => isWrite(call.id)).every((call) => !JSON.stringify(call.refs).includes("planned:")), true);
      if (request.id === "macro.media.place_assets") {
        assert.equal(calls.some((call) => call.id === "template.items.resolve_item_ref"), false);
        const readback = calls.find((call) => call.id === "template.items.read_item_summary");
        assert.equal(readback.refs.item_ref.ref, "item:guid:{IMPORTED}");
      }
    }
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

  it("blocks one-hundred-row compact results before the first mutation for short and long ids", async () => {
    for (const longIds of [false, true]) {
      const calls = [];
      const layout = layoutRows(100, { longIds });
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: {
          id: "macro.project.apply_layout",
          input: { layout, dry_run: false },
          context: { session_id: "client:alpha33:budget-boundary", request_sequence: longIds ? 2 : 1 },
        },
        executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, realLengthTrackRefs: true, realLengthRequestIds: true }),
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false);
      assert.equal(result.execution.status, "blocked");
      assert.equal(result.error.code, "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED");
      assert.equal(result.result.changes.length, 0);
      assert.equal(calls.length, 0, "response-budget rejection must precede every child call");
      assert.equal(result.budget.actual_bytes <= 65_536, true);
      assert.equal(inlineDetailBytes(result) <= 24_576, true);
    }
  });

  it("honors the caller response budget before the first layout mutation", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: "macro.project.apply_layout",
        input: { layout: layoutRows(20), dry_run: false },
        budget: { max_response_bytes: 12_000, max_items: 50, max_inline_value_bytes: 2_048 },
      },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, realLengthTrackRefs: true, realLengthRequestIds: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED");
    assert.match(result.error.message, /12000 envelope bytes available/u);
    assert.equal(result.result.changes.length, 0);
    assert.equal(calls.length, 0, "caller-budget rejection must precede every child call");
  });

  it("marks only the layout row missing from exact live readback as unverified", async () => {
    const calls = [];
    const invalidations = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: "macro.project.apply_layout", input: { layout: layoutRows(3), dry_run: false } },
      executeAtomic: fakeAtomic(calls, { multiTrackRefs: true, realLengthTrackRefs: true, omitReadbackTrackIndex: 1 }),
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
        input: {
          routes: [{ id: "send", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }],
          dry_run: false,
        },
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

function fakeAtomic(calls, options = {}) {
  return async ({ id, input = {}, refs = {}, budget }) => {
    calls.push({ id, input, refs, budget });
    if (id === "template.items.resolve_item_ref" && calls.some((call) => call.id === "template.items.delete_items")) {
      return { ok: false, request: { id }, error: { code: "ITEM_NOT_FOUND", message: "Deleted item no longer resolves." }, result: {} };
    }
    const ref = firstRef(refs);
    const summary = {};
    if (id === "template.tracks.resolve_track_ref") summary.track_ref = options.wrongTrackRef ?? input.track_ref;
    else if (id === "template.items.resolve_item_ref") summary.item_ref = input.ref;
    else if (id === "template.items.read_item_summary") summary.item_ref = ref;
    else if (id === "template.routing.resolve_send_ref") summary.send_ref = input.send_ref;
    else if (id === "template.routing.create_track_send") summary.send_ref = "send:guid:{CREATED}";
    else if (id === "template.routing.read_track_routing") {
      summary.tracks = [{ track_ref: "track:guid:{SRC}" }, { track_ref: "track:guid:{DST}" }];
      summary.sends = [{ send_ref: "send:guid:{CREATED}", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }];
    }
    else if (id === "template.media.probe_file") summary.file_ref = "file:guid:{PROBED}";
    else if (id === "template.tracks.create_track" || id === "template.tracks.create_folder_track") {
      summary.track_ref = options.multiTrackRefs
        ? createdTrackRef(Number(input.index), options)
        : "track:guid:{CREATED}";
    }
    else if (id === "template.tracks.list_tracks" || id === "template.tracks.read_folder_structure") {
      summary.tracks = options.multiTrackRefs
        ? calls
            .filter((call) => call.id === "template.tracks.create_track" || call.id === "template.tracks.create_folder_track")
            .filter((call) => Number(call.input.index) !== options.omitReadbackTrackIndex)
            .map((call) => ({ track_ref: createdTrackRef(Number(call.input.index), options), name: call.input.name }))
        : [{ track_ref: "track:guid:{CREATED}", name: "FX" }];
    }
    else if (id.startsWith("template.media.import_file")) summary.imported_item_refs = ["item:guid:{IMPORTED}"];
    return {
      ok: true,
      request: { id: options.realLengthRequestIds ? realLengthRequestId(calls.length, id) : id },
      ...(!options.omitWriteVerification || !isWrite(id) ? { verification: { status: "passed" } } : {}),
      result: { summary, readback: summary, refs: Object.values(summary).flatMap((value) => Array.isArray(value) ? value.map(objectRef) : typeof value === "string" ? [objectRef(value)] : []) },
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
