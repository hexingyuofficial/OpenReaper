import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
  normalizeFoundationBridgeRequest,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_EXECUTION_HARNESS_CONTRACT,
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";

describe("Layer 4B template execution harness contract", () => {
  it("builds a legal read bridge request with stable envelope shape", async () => {
    const descriptor = makeDescriptor({
      id: "template.project.read_summary",
      title: "Read project summary",
      summary: "Read a compact project summary.",
      pack: "project",
      risk: "read",
      entity_kind: "project",
      tags: ["project", "read"],
      bridge: bridge({
        operation_family: "query_state",
        operation_name: "project.summary",
        capability: "project.summary",
        idempotency: "none",
      }),
      inputSchema: objectSchema({
        include_tracks: { type: "boolean" },
      }, ["include_tracks"]),
      outputSchema: objectSchema({
        project_ref: { type: "string" },
      }),
      refs: refs({
        input: [refDeclaration("project_ref", "project", true)],
      }),
      expectedDelta: expectedDelta({
        kind: "read",
        summary: "Reads compact project state.",
        entities: [{ entity_kind: "project", action: "read", summary: "Project state is read." }],
        idempotent: true,
      }),
      verification: verification({ mode: "none", checks: [] }),
    });
    const project = createObjectRef(
      "project",
      { scheme: "current", value: "current" },
      { ref: "project:current" },
    );

    const first = buildTemplateBridgeRequest({
      descriptor,
      input: { include_tracks: true },
      refs: { project_ref: project },
      context: context({ request_sequence: 7 }),
    });
    const second = buildTemplateBridgeRequest({
      descriptor,
      input: { include_tracks: true },
      refs: { project_ref: project },
      context: context({ request_sequence: 7 }),
    });

    assert.equal(first.contract, FOUNDATION_BRIDGE_CONTRACT);
    assert.equal(first.id, second.id);
    assert.match(first.id, /^cmd_20260702000000000_007_[a-f0-9]{6}$/);
    assert.deepEqual(first.client, { id: "openreaper-mcp", session_id: "session-test" });
    assert.deepEqual(first.bridge, { expected_owner: "owner-test", expected_generation: 1 });
    assert.deepEqual(first.operation, { family: "query_state", name: "project.summary" });
    assert.equal(first.pack.id, "project");
    assert.equal(first.pack.capability, "project.summary");
    assert.equal(first.pack.risk, "read");
    assert.equal(first.undo.mode, "none");
    assert.equal("idempotency_key" in first, false);
    normalizeFoundationBridgeRequest(first);

    const result = await executeTemplate({
      descriptor,
      input: { include_tracks: true },
      refs: { project_ref: project },
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(result.contract, TEMPLATE_EXECUTION_HARNESS_CONTRACT);
    assert.equal(result.ok, true);
    assert.equal(result.template.id, descriptor.id);
    assert.equal(result.undo.mode, "none");
  });

  it("maps write descriptor metadata, undo, verification, and refs into request/result", async () => {
    const track = createObjectRef("track", { scheme: "guid", value: "{TRACK-A}" });
    const descriptor = makeDescriptor({
      id: "template.tracks.create_track",
      title: "Create track",
      summary: "Create one track and return its compact ref.",
      refs: refs({ output: [refDeclaration("track_ref", "track", true)] }),
      inputSchema: objectSchema({
        name: { type: "string" },
        emits: { type: "object" },
      }, ["name", "emits"]),
      outputSchema: objectSchema({
        track_ref: { type: "string" },
      }, ["track_ref"]),
    });

    const request = buildTemplateBridgeRequest({
      descriptor,
      input: { name: "Dialog", emits: { refs: [track] } },
      context: context(),
    });

    assert.deepEqual(request.operation, { family: "run_command", name: "template.execute" });
    assert.equal(request.pack.id, "tracks");
    assert.equal(request.pack.capability, "track.create");
    assert.equal(request.pack.risk, "write");
    assert.equal(request.undo.mode, "required");
    assert.equal(request.undo.label, "OpenReaper: track.create");
    assert.deepEqual(request.undo.flags, ["track"]);
    assert.equal(request.verification.mode, "required");
    assert.equal(request.artifacts.allow, false);
    assert.equal("idempotency_key" in request, false);

    const result = await executeTemplate({
      descriptor,
      input: { name: "Dialog", emits: { refs: [track] } },
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.refs, [track]);
    assert.equal(result.result.last_result.updated, true);
    assert.equal(result.verification.status, "passed");
    assert.equal(result.undo.closed, true);
  });

  it("handles destructive mutations with required undo", async () => {
    const item = createObjectRef("item", { scheme: "guid", value: "{ITEM-A}" });
    const descriptor = makeDescriptor({
      id: "template.items.delete_item",
      title: "Delete item",
      summary: "Delete one item through a verified destructive mutation.",
      pack: "items",
      risk: "destructive",
      entity_kind: "item",
      tags: ["item", "delete"],
      bridge: bridge({ capability: "item.delete", operation_name: "item.delete" }),
      inputSchema: objectSchema({
        emits: { type: "object" },
      }, ["emits"]),
      refs: refs({ input: [refDeclaration("item_ref", "item", true)] }),
      expectedDelta: expectedDelta({
        summary: "One item is removed.",
        entities: [{ entity_kind: "item", action: "delete", summary: "Item disappears." }],
      }),
      verification: verification({
        checks: [{ name: "item_absent", kind: "state_delta", summary: "The item ref is absent." }],
      }),
    });

    const result = await executeTemplate({
      descriptor,
      input: { emits: { refs: [item] } },
      refs: { item_ref: item },
      context: context(),
      executor: new FakeFoundationBridge(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.template.risk, "destructive");
    assert.equal(result.undo.mode, "required");
    assert.equal(result.undo.opened, true);
    assert.equal(result.undo.closed, true);
    assert.deepEqual(result.result.refs, [item]);
  });

  it("keeps jobs and artifacts as refs for job/artifact templates", async () => {
    const region = createObjectRef("region", { scheme: "name", value: "Chorus" });
    const job = createObjectRef("job", { scheme: "job_id", value: "render.region.1" });
    const artifact = createArtifactRef({
      owner_pack: "render",
      scope: "manifest",
      id: "art_20260702000000000_001_abcdef",
      schema: "render.manifest.v1",
      summary: { files: 1 },
    });
    const descriptor = makeDescriptor({
      id: "template.render.render_region_job",
      title: "Render region job",
      summary: "Start a region render job and return refs only.",
      pack: "render",
      risk: "destructive",
      entity_kind: "render_job",
      tags: ["render", "job"],
      bridge: bridge({
        operation_family: "run_job",
        operation_name: "render.region",
        capability: "render.region",
        idempotency: "supported",
      }),
      inputSchema: objectSchema({
        emits: { type: "object" },
      }, ["emits"]),
      outputSchema: objectSchema({
        job_ref: { type: "string" },
        manifest_ref: { type: "string" },
      }),
      refs: refs({
        input: [refDeclaration("region_ref", "region", true)],
        output: [refDeclaration("job_ref", "job", true), refDeclaration("manifest_ref", "artifact", true)],
      }),
      artifacts: artifacts({
        mode: "produces",
        output: [artifactDeclaration("render_manifest", "render.manifest.v1", "render")],
      }),
      expectedDelta: expectedDelta({
        kind: "job",
        summary: "Starts render output work and returns compact refs.",
        entities: [{ entity_kind: "render_job", action: "start_job", summary: "Render job starts." }],
      }),
    });

    const result = await executeTemplate({
      descriptor,
      input: { emits: { jobs: [job], artifacts: [artifact] } },
      refs: { region_ref: region },
      context: context(),
      executor: new FakeFoundationBridge(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.undo.mode, "required");
    assert.equal(result.result.jobs[0].kind, "job");
    assert.equal(result.result.artifacts[0].kind, "artifact");
    assert.doesNotMatch(JSON.stringify(result), /payload/);
  });

  it("fixes idempotency behavior for none, supported, and required descriptors", async () => {
    const track = createObjectRef("track", { scheme: "guid", value: "{TRACK-IDEMPOTENT}" });
    const bridgeExecutor = new FakeFoundationBridge();
    const requiredDescriptor = makeDescriptor({
      id: "template.tracks.ensure_named_track",
      title: "Ensure named track",
      summary: "Create or reuse a track by name with idempotency.",
      tags: ["track", "idempotent"],
      bridge: bridge({ idempotency: "required" }),
      inputSchema: objectSchema({
        name: { type: "string" },
        emits: { type: "object" },
      }, ["name", "emits"]),
      expectedDelta: expectedDelta({
        summary: "A named track exists exactly once.",
        entities: [{ entity_kind: "track", action: "create", summary: "Track is created only when missing." }],
        idempotent: true,
      }),
    });

    const first = await executeTemplate({
      descriptor: requiredDescriptor,
      input: { name: "Dialog", emits: { refs: [track] } },
      context: context({ request_sequence: 1 }),
      executor: bridgeExecutor,
    });
    const replay = await executeTemplate({
      descriptor: requiredDescriptor,
      input: { name: "Dialog", emits: { refs: [track] } },
      context: context({ request_sequence: 2 }),
      executor: bridgeExecutor,
    });

    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    assert.equal(first.request.idempotency_key, replay.request.idempotency_key);
    assert.equal(replay.idempotency.replayed, true);
    assert.equal(bridgeExecutor.seen.length, 1);

    const supported = buildTemplateBridgeRequest({
      descriptor: makeDescriptor({ bridge: bridge({ idempotency: "supported" }) }),
      input: { name: "Music" },
      context: context(),
      idempotencyKey: "caller-key",
    });
    assert.equal(supported.idempotency_key, "caller-key");

    const none = await executeTemplate({
      descriptor: makeReadDescriptor(),
      input: {},
      context: context(),
      idempotencyKey: "not-allowed",
      executor: new FakeFoundationBridge(),
    });
    assert.equal(none.ok, false);
    assert.equal(none.error.source, "harness");
    assert.equal(none.error.code, "TEMPLATE_IDEMPOTENCY_INVALID");
  });

  it("normalizes keyed refs in descriptor declaration order", () => {
    const track = createObjectRef("track", { scheme: "guid", value: "{TRACK-ORDER}" });
    const item = createObjectRef("item", { scheme: "guid", value: "{ITEM-ORDER}" });
    const descriptor = makeDescriptor({
      refs: refs({
        input: [
          refDeclaration("track_ref", "track", true),
          refDeclaration("item_ref", "item", true),
        ],
      }),
    });

    const first = buildTemplateBridgeRequest({
      descriptor,
      input: { name: "Dialog" },
      refs: { track_ref: track, item_ref: item },
      context: context(),
    });
    const second = buildTemplateBridgeRequest({
      descriptor,
      input: { name: "Dialog" },
      refs: { item_ref: item, track_ref: track },
      context: context(),
    });

    assert.equal(first.id, second.id);
    assert.deepEqual(first.refs, [track, item]);
    assert.deepEqual(second.refs, [track, item]);
  });

  it("maps verification failure as a bridge typed error", async () => {
    const descriptor = makeDescriptor({
      inputSchema: objectSchema({
        verification_passes: { type: "boolean" },
      }, ["verification_passes"]),
    });

    const result = await executeTemplate({
      descriptor,
      input: { verification_passes: false },
      context: context(),
      executor: new FakeFoundationBridge(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.source, "bridge");
    assert.equal(result.error.code, "VERIFY_FAILED");
    assert.equal(result.error.recoverable, false);
    assert.equal(result.undo.closed, true);
    assert.equal(result.verification.status, "failed");
  });

  it("maps ordinary bridge typed errors into the template result envelope", async () => {
    const descriptor = makeDescriptor({
      inputSchema: objectSchema({
        force_error: { enum: ["PACK_DISABLED"] },
      }, ["force_error"]),
    });

    const result = await executeTemplate({
      descriptor,
      input: { force_error: "PACK_DISABLED" },
      context: context(),
      executor: new FakeFoundationBridge(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.contract, TEMPLATE_EXECUTION_HARNESS_CONTRACT);
    assert.equal(result.error.source, "bridge");
    assert.equal(result.error.code, "PACK_DISABLED");
    assert.equal(result.error.recoverable, true);
  });

  it("rejects invalid input before dispatch", async () => {
    const bridgeExecutor = new FakeFoundationBridge();
    const result = await executeTemplate({
      descriptor: makeDescriptor(),
      input: { wrong_name: "Dialog" },
      context: context(),
      executor: bridgeExecutor,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.source, "harness");
    assert.equal(result.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(result.error.details.errors.join("\n"), /input.name is required/);
    assert.match(result.error.details.errors.join("\n"), /wrong_name/);
    assert.equal(bridgeExecutor.seen.length, 0);
  });

  it("rejects invalid ref objects before dispatch as typed ref errors", async () => {
    const bridgeExecutor = new FakeFoundationBridge();
    const result = await executeTemplate({
      descriptor: makeDescriptor({
        refs: refs({ input: [refDeclaration("track_ref", "track", true)] }),
      }),
      input: { name: "Dialog" },
      refs: { track_ref: { kind: "track" } },
      context: context(),
      executor: bridgeExecutor,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.source, "harness");
    assert.equal(result.error.code, "TEMPLATE_REFS_INVALID");
    assert.match(result.error.details.errors.join("\n"), /refs\.track_ref\.ref/);
    assert.match(result.error.details.errors.join("\n"), /refs\.track_ref\.identity/);
    assert.equal(bridgeExecutor.seen.length, 0);
  });

  it("rejects kind-prefix, scheme, and value ref mismatches before dispatch", async () => {
    const descriptor = makeDescriptor({
      refs: refs({ input: [refDeclaration("take_ref", "take", true)] }),
    });
    const cases = [
      [
        "wrong kind prefix",
        { kind: "take", ref: "item:guid:{ITEM}", identity: { scheme: "guid", value: "{ITEM}" } },
        "refs.take_ref.ref must start with take:.",
      ],
      [
        "scheme mismatch",
        { kind: "take", ref: "take:index:0", identity: { scheme: "guid", value: "0" } },
        "refs.take_ref.ref scheme must match refs.take_ref.identity.scheme.",
      ],
      [
        "value mismatch",
        { kind: "take", ref: "take:guid:{ITEM}", identity: { scheme: "guid", value: "{TAKE}" } },
        "refs.take_ref.ref value must match refs.take_ref.identity.value.",
      ],
    ];

    for (const [label, takeRef, expectedError] of cases) {
      const bridgeExecutor = new FakeFoundationBridge();
      const result = await executeTemplate({
        descriptor,
        input: { name: label },
        refs: { take_ref: takeRef },
        context: context(),
        executor: bridgeExecutor,
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, "TEMPLATE_REFS_INVALID", label);
      assert.equal(result.error.details.errors.includes(expectedError), true, label);
      assert.equal(bridgeExecutor.seen.length, 0, label);
    }
  });

  it("returns response-too-large as a typed bounded error without inline payload", async () => {
    const descriptor = makeDescriptor({
      inputSchema: objectSchema({
        emits: { type: "object" },
      }, ["emits"]),
    });
    const payload = "x".repeat(FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_inline_value_bytes + 1);

    const result = await executeTemplate({
      descriptor,
      input: { emits: { inline_payload: payload } },
      context: context(),
      executor: new FakeFoundationBridge(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.source, "bridge");
    assert.equal(result.error.code, "RESPONSE_TOO_LARGE");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(`x{${payload.length}}`));
  });

  it("rejects oversized successful bridge result fields beyond summary", async () => {
    const descriptor = makeDescriptor();
    const bridgeExecutor = new FakeFoundationBridge();
    const payload = "x".repeat(FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_inline_value_bytes + 1);

    const result = await executeTemplate({
      descriptor,
      input: { name: "Dialog" },
      context: context(),
      executor: (request) => {
        const bridgeResult = structuredClone(bridgeExecutor.dispatch(request));
        bridgeResult.result.last_result = {
          ...bridgeResult.result.last_result,
          payload,
        };
        bridgeResult.budget.response_bytes = 100;
        return bridgeResult;
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.source, "harness");
    assert.equal(result.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(result.error.details.path, "result.last_result");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(`x{${payload.length}}`));
  });

  it("keeps aggregate batch rows intact without duplicating their canonical refs", async () => {
    const descriptor = makeDescriptor();
    const bridgeExecutor = new FakeFoundationBridge();
    const track = createObjectRef("track", { scheme: "guid", value: "{TRACK-BATCH}" });
    const sourceTrack = createObjectRef("track", { scheme: "guid", value: "{TRACK-BATCH-SOURCE}" });
    const rows = Array.from({ length: 64 }, (_, index) => ({
      row_index: index + 1,
      item_ref: `item:guid:{ITEM-BATCH-${String(index + 1).padStart(2, "0")}}`,
      active_take_ref: `take:guid:{TAKE-BATCH-${String(index + 1).padStart(2, "0")}}`,
      position_seconds: index * 0.25,
      volume_db: -1.5,
      take_volume_db: -0.75,
      take_pan: 0.125,
      take_pitch_semitones: 1,
      take_playrate: 1.01,
      preserve_pitch: true,
      readback_status: "passed",
      readback_proof: "native item/take control identity and requested-field readback ".repeat(7),
    }));

    const result = await executeTemplate({
      descriptor,
      input: { name: "Batch" },
      context: context(),
      executor: (request) => {
        const bridgeResult = structuredClone(bridgeExecutor.dispatch(request));
        bridgeResult.result.summary = {
          rows,
          row_count: rows.length,
          source_track_ref: sourceTrack.ref,
          readback_status: "passed",
          batch_timings: {
            rows: rows.length,
            native_mutation_count: rows.length,
            native_readback_count: rows.length,
            runner: "generic_native_batch",
          },
        };
        bridgeResult.result.refs = [track];
        bridgeResult.result.readback = { status: "passed", row_count: rows.length };
        bridgeResult.budget.response_bytes = Buffer.byteLength(JSON.stringify(bridgeResult), "utf8");
        return bridgeResult;
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.result.summary.rows, rows);
    assert.deepEqual(result.result.readback, { status: "passed", row_count: 64 });
    assert.deepEqual(result.result.refs, [track, sourceTrack]);
    assert.equal(new Set(result.result.refs.map((ref) => ref.ref)).size, result.result.refs.length);
    assert.equal(result.result.summary.batch_timings.native_mutation_count, 64);
    assert.equal(result.result.summary.batch_timings.native_readback_count, 64);
    assert.ok(result.budget.response_bytes <= FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_response_bytes);
  });

  it("keeps aggregate target readback intact without duplicating its canonical refs", async () => {
    const descriptor = makeDescriptor();
    const bridgeExecutor = new FakeFoundationBridge();
    const track = createObjectRef("track", { scheme: "guid", value: "{TRACK-TARGET-BATCH}" });
    const sourceTrack = createObjectRef("track", { scheme: "guid", value: "{TRACK-TARGET-BATCH-SOURCE}" });
    const project = createObjectRef("project", { scheme: "current", value: "current" });
    const targets = Array.from({ length: 64 }, (_, index) => ({
      owner_ref: `take:guid:{TAKE-TARGET-BATCH-${String(index + 1).padStart(2, "0")}}`,
      fx_ref: `fx:take:guid:{TAKE-TARGET-BATCH-${String(index + 1).padStart(2, "0")}}:0`,
      envelope_ref: `envelope:guid:{ENVELOPE-TARGET-BATCH-${String(index + 1).padStart(2, "0")}}`,
      ...(index === 0 ? { track_ref: track.ref } : {}),
      processed_count: 2,
      readback_status: "passed",
    }));
    const changes = [
      { item_ref: "item:guid:{ITEM-GENERIC-BATCH-1}" },
      { item_ref: "item:guid:{ITEM-GENERIC-BATCH-2}" },
    ];
    const summary = {
      aggregate_readback: true,
      execution_shape: "single_bridge_request_native_batch",
      target_count: targets.length,
      targets,
      change_count: changes.length,
      changes,
      source_track_ref: sourceTrack.ref,
      readback_status: "passed",
    };
    const readback = {
      aggregate_readback: true,
      execution_shape: "single_bridge_request_native_batch",
      target_count: targets.length,
      targets,
      project_ref: project.ref,
      status: "passed",
    };

    const result = await executeTemplate({
      descriptor,
      input: { name: "Target Batch" },
      context: context(),
      executor: (request) => {
        const bridgeResult = structuredClone(bridgeExecutor.dispatch(request));
        bridgeResult.result.summary = summary;
        bridgeResult.result.refs = [track];
        bridgeResult.result.readback = readback;
        bridgeResult.budget.response_bytes = Buffer.byteLength(JSON.stringify(bridgeResult), "utf8");
        return bridgeResult;
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.result.summary, summary);
    assert.deepEqual(result.result.readback, readback);
    assert.deepEqual(result.result.refs, [track, sourceTrack, project]);
    assert.equal(new Set(result.result.refs.map((ref) => ref.ref)).size, result.result.refs.length);
    assert.ok(result.budget.response_bytes <= FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_response_bytes);
  });

  it("still projects target refs without exact aggregate count evidence", async () => {
    const descriptor = makeDescriptor();
    const bridgeExecutor = new FakeFoundationBridge();

    for (const [label, summary] of [
      ["unproven", {
        targets: [{ item_ref: "item:guid:{ITEM-TARGET-UNPROVEN-1}" }, { item_ref: "item:guid:{ITEM-TARGET-UNPROVEN-2}" }],
        target_count: 2,
      }],
      ["mismatched", {
        targets: [{ item_ref: "item:guid:{ITEM-TARGET-MISMATCH-1}" }, { item_ref: "item:guid:{ITEM-TARGET-MISMATCH-2}" }],
        target_count: 1,
        aggregate_readback: true,
        execution_shape: "single_bridge_request_native_batch",
      }],
      ["non-integer", {
        targets: [{ item_ref: "item:guid:{ITEM-TARGET-NONINTEGER-1}" }, { item_ref: "item:guid:{ITEM-TARGET-NONINTEGER-2}" }],
        target_count: 2.5,
        aggregate_readback: true,
        execution_shape: "single_bridge_request_native_batch",
      }],
      ["non-batch", {
        targets: [{ item_ref: "item:guid:{ITEM-TARGET-NONBATCH-1}" }, { item_ref: "item:guid:{ITEM-TARGET-NONBATCH-2}" }],
        target_count: 2,
        aggregate_readback: true,
        execution_shape: "registered_macro_program",
      }],
      ["singular", {
        targets: [{ item_ref: "item:guid:{ITEM-TARGET-SINGULAR}" }],
        target_count: 1,
        aggregate_readback: true,
        execution_shape: "single_bridge_request_native_batch",
      }],
    ]) {
      const result = await executeTemplate({
        descriptor,
        input: { name: label },
        context: context(),
        executor: (request) => {
          const bridgeResult = structuredClone(bridgeExecutor.dispatch(request));
          bridgeResult.result.summary = summary;
          bridgeResult.result.refs = [];
          bridgeResult.budget.response_bytes = Buffer.byteLength(JSON.stringify(bridgeResult), "utf8");
          return bridgeResult;
        },
      });

      assert.equal(result.ok, true, label);
      assert.deepEqual(
        result.result.refs.map((ref) => ref.ref),
        summary.targets.map((target) => target.item_ref),
        label,
      );
    }
  });

  it("still projects row refs when batch timing evidence is absent or singular", async () => {
    const descriptor = makeDescriptor();
    const bridgeExecutor = new FakeFoundationBridge();

    for (const [label, summary] of [
      ["unproven", {
        rows: [{ item_ref: "item:guid:{ITEM-UNPROVEN-1}" }, { item_ref: "item:guid:{ITEM-UNPROVEN-2}" }],
      }],
      ["mismatched", {
        rows: [{ item_ref: "item:guid:{ITEM-MISMATCH-1}" }, { item_ref: "item:guid:{ITEM-MISMATCH-2}" }],
        batch_timings: { rows: 1, runner: "generic_native_batch" },
      }],
      ["singular", {
        rows: [{ item_ref: "item:guid:{ITEM-SINGULAR}" }],
        batch_timings: { rows: 1, runner: "generic_native_batch" },
      }],
    ]) {
      const result = await executeTemplate({
        descriptor,
        input: { name: label },
        context: context(),
        executor: (request) => {
          const bridgeResult = structuredClone(bridgeExecutor.dispatch(request));
          bridgeResult.result.summary = summary;
          bridgeResult.result.refs = [];
          bridgeResult.budget.response_bytes = Buffer.byteLength(JSON.stringify(bridgeResult), "utf8");
          return bridgeResult;
        },
      });

      assert.equal(result.ok, true, label);
      assert.deepEqual(
        result.result.refs.map((ref) => ref.ref),
        summary.rows.map((row) => row.item_ref),
        label,
      );
    }
  });
});

function makeDescriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.tracks.create_track",
    title: "Create track",
    summary: "Create one new track and return its compact track ref.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "create"],
    bridge: bridge(),
    inputSchema: objectSchema({
      name: { type: "string" },
    }, ["name"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
    }, ["track_ref"]),
    refs: refs({ output: [refDeclaration("track_ref", "track", true)] }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta(),
    verification: verification(),
    examples: [
      {
        name: "create_named_track",
        summary: "Create a track named Dialog.",
        input: { name: "Dialog" },
      },
    ],
    ...overrides,
  };
}

function makeReadDescriptor() {
  return makeDescriptor({
    id: "template.core.read_health",
    title: "Read bridge health",
    summary: "Read compact bridge health.",
    pack: "core",
    risk: "read",
    entity_kind: "bridge_health",
    tags: ["health", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "bridge.health",
      capability: "bridge.health",
      idempotency: "none",
    }),
    inputSchema: objectSchema(),
    outputSchema: objectSchema(),
    refs: refs(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads compact bridge health.",
      entities: [{ entity_kind: "bridge_health", action: "read", summary: "Bridge health is read." }],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_health",
        summary: "Read bridge health.",
        input: {},
      },
    ],
  });
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "track.create",
    idempotency: "supported",
    timeout_ms: 5_000,
    ...overrides,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function refs(overrides = {}) {
  return {
    input: [],
    output: [],
    ...overrides,
  };
}

function refDeclaration(name, kind, required, summary = `${kind} ref.`) {
  return {
    name,
    kind,
    required,
    summary,
  };
}

function artifacts(overrides = {}) {
  return {
    mode: "none",
    input: [],
    output: [],
    ...overrides,
  };
}

function artifactDeclaration(name, schema, owner_pack, summary = `${schema} artifact.`) {
  return {
    name,
    schema,
    owner_pack,
    summary,
  };
}

function expectedDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Creates one track and returns a compact track ref.",
    entities: [
      {
        entity_kind: "track",
        action: "create",
        summary: "One track is created.",
      },
    ],
    idempotent: false,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    mode: "required",
    checks: [
      {
        name: "track_exists",
        kind: "state_delta",
        summary: "A track ref exists after the mutation.",
      },
    ],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-02T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
