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
    const layout = Array.from({ length: 14 }, (_, index) => ({
      id: `track_${index + 1}`,
      kind: "track",
      name: `Highway ${String(index + 1).padStart(2, "0")}`,
      index,
    }));
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
    assert.equal(result.result.changes.length, 28);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(calls.every((call) => call.budget.max_inline_value_bytes === 24_576), true);
    assert.equal(calls.every((call) => call.budget.max_items === 256), true);
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
});

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
        ? `track:guid:{CREATED-${Number(input.index) + 1}}`
        : "track:guid:{CREATED}";
    }
    else if (id === "template.tracks.list_tracks" || id === "template.tracks.read_folder_structure") {
      summary.tracks = options.multiTrackRefs
        ? calls
            .filter((call) => call.id === "template.tracks.create_track" || call.id === "template.tracks.create_folder_track")
            .map((call) => ({ track_ref: `track:guid:{CREATED-${Number(call.input.index) + 1}}`, name: call.input.name }))
        : [{ track_ref: "track:guid:{CREATED}", name: "FX" }];
    }
    else if (id.startsWith("template.media.import_file")) summary.imported_item_refs = ["item:guid:{IMPORTED}"];
    return {
      ok: true,
      request: { id },
      ...(!options.omitWriteVerification || !isWrite(id) ? { verification: { status: "passed" } } : {}),
      result: { summary, readback: summary, refs: Object.values(summary).flatMap((value) => Array.isArray(value) ? value.map(objectRef) : typeof value === "string" ? [objectRef(value)] : []) },
    };
  };
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
