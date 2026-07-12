import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
  FOUNDATION_BRIDGE_ERROR_CODES,
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
  FOUNDATION_BRIDGE_REF_KINDS,
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
  foundationBridgeRequestFingerprint,
  normalizeFoundationBridgeRequest,
  validateFoundationBridgeResult,
} from "../../packages/core/src/foundation-bridge-v1.mjs";

describe("Layer 2 foundation/bridge ABI contract", () => {
  it("freezes the fixed bridge kernel surface", () => {
    assert.deepEqual(FOUNDATION_BRIDGE_OPERATION_FAMILIES, [
      "query_state",
      "run_command",
      "run_action",
      "run_job",
      "artifact_metadata",
    ]);
    assert.deepEqual(FOUNDATION_BRIDGE_REF_KINDS, [
      "project",
      "track",
      "item",
      "take",
      "fx",
      "send",
      "envelope",
      "marker",
      "region",
      "file",
      "job",
      "artifact",
    ]);
    assert.equal(FOUNDATION_BRIDGE_PACK_IDS.length, 16);
    assert.ok(FOUNDATION_BRIDGE_ERROR_CODES.includes("VERIFY_FAILED"));
    assert.ok(FOUNDATION_BRIDGE_ERROR_CODES.includes("BRIDGE_OWNER_MISMATCH"));
    assert.ok(FOUNDATION_BRIDGE_ERROR_CODES.includes("BRIDGE_GENERATION_MISMATCH"));
  });

  it("normalizes request envelopes without turning packs into bridge APIs", () => {
    const request = normalizeFoundationBridgeRequest(
      makeRequest({
        operation: { family: "run_command", name: "template.execute" },
        pack: { id: "tracks", capability: "track.create", risk: "write" },
      }),
    );

    assert.equal(request.contract, FOUNDATION_BRIDGE_CONTRACT);
    assert.equal(request.operation.family, "run_command");
    assert.equal(request.operation.name, "template.execute");
    assert.equal(request.pack.id, "tracks");
    assert.equal(request.pack.capability, "track.create");
    assert.deepEqual(Object.keys(request.operation).sort(), ["family", "name"]);
  });

  it("requires params to be explicit even when empty", () => {
    const { params, ...requestWithoutParams } = makeRequest();
    assert.equal(params && typeof params, "object");

    const bridge = new FakeFoundationBridge();
    const result = bridge.dispatch(requestWithoutParams);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "REQUEST_INVALID");
    assert.match(result.error.message, /params must be present/);
  });

  it("rejects invalid undo and idempotency combinations before dispatch", () => {
    const bridge = new FakeFoundationBridge();

    const missingUndo = bridge.dispatch(
      makeRequest({
        undo: { mode: "none" },
      }),
    );
    assert.equal(missingUndo.ok, false);
    assert.equal(missingUndo.error.code, "REQUEST_INVALID");
    assert.match(missingUndo.error.message, /undo\.mode required/);

    const readIdempotency = bridge.dispatch(
      makeRequest({
        operation: { family: "query_state", name: "project.summary" },
        pack: { id: "project", capability: "project.summary", risk: "read" },
        undo: { mode: "none" },
        verification: { mode: "none", checks: [] },
        idempotency_key: "read-should-not-dedupe",
      }),
    );
    assert.equal(readIdempotency.ok, false);
    assert.equal(readIdempotency.error.code, "REQUEST_INVALID");
    assert.match(readIdempotency.error.message, /idempotency_key/);
  });

  it("uses typed object refs for every frozen object kind", () => {
    const refs = {
      project: createObjectRef("project", { scheme: "current", value: "current" }, { ref: "project:current" }),
      track: createObjectRef("track", { scheme: "guid", value: "{TRACK}" }),
      item: createObjectRef("item", { scheme: "guid", value: "{ITEM}" }),
      take: createObjectRef("take", { scheme: "guid", value: "{TAKE}" }),
      fx: createObjectRef("fx", { scheme: "index", value: "track:{TRACK}:0" }),
      send: createObjectRef("send", { scheme: "index", value: "track:{TRACK}:0" }),
      envelope: createObjectRef("envelope", { scheme: "name", value: "Volume" }),
      marker: createObjectRef("marker", { scheme: "index", value: "1" }),
      region: createObjectRef("region", { scheme: "name", value: "Verse" }),
      file: createObjectRef("file", { scheme: "path", value: "/tmp/a.wav" }),
      job: createObjectRef("job", { scheme: "job_id", value: "render.1" }),
      artifact: createArtifactRef({
        owner_pack: "analysis",
        scope: "loudness",
        id: "art_20260702000000000_001_abcdef",
        schema: "analysis.loudness.v1",
      }),
    };

    assert.deepEqual(Object.keys(refs), [...FOUNDATION_BRIDGE_REF_KINDS]);
    for (const [kind, ref] of Object.entries(refs)) {
      assert.equal(ref.kind, kind);
      assert.equal(typeof ref.ref, "string");
      assert.equal(typeof ref.identity.scheme, "string");
      assert.equal(typeof ref.identity.value, "string");
    }
  });

  it("requires each ref to agree exactly with its kind and identity before bridge dispatch", () => {
    const validComposite = createObjectRef(
      "fx",
      { scheme: "track_fx", value: "track:guid:{TRACK}:0" },
      { ref: "fx:track:guid:{TRACK}:0" },
    );
    const validProject = createObjectRef(
      "project",
      { scheme: "current", value: "current" },
      { ref: "project:current" },
    );
    const validArtifact = createArtifactRef({
      owner_pack: "analysis",
      scope: "loudness",
      id: "art_20260702000000000_001_abcdef",
      schema: "analysis.loudness.v1",
    });
    const normalized = normalizeFoundationBridgeRequest(makeRequest({
      refs: [validComposite, validProject, validArtifact],
    }));
    assert.deepEqual(normalized.refs, [validComposite, validProject, validArtifact]);

    const cases = [
      [
        "wrong kind prefix",
        { kind: "take", ref: "item:guid:{ITEM}", identity: { scheme: "guid", value: "{ITEM}" } },
        /refs\[0\]\.ref must start with take:/,
      ],
      [
        "scheme mismatch",
        { kind: "take", ref: "take:index:0", identity: { scheme: "guid", value: "0" } },
        /refs\[0\]\.ref scheme must match refs\[0\]\.identity\.scheme/,
      ],
      [
        "value mismatch",
        { kind: "take", ref: "take:guid:{ITEM}", identity: { scheme: "guid", value: "{TAKE}" } },
        /refs\[0\]\.ref value must match refs\[0\]\.identity\.value/,
      ],
    ];
    for (const [, ref, expected] of cases) {
      assert.throws(() => normalizeFoundationBridgeRequest(makeRequest({ refs: [ref] })), expected);
    }
  });

  it("enforces owner and generation mismatch before fake dispatch", () => {
    const bridge = new FakeFoundationBridge({ owner: "owner-a", generation: 7 });

    const ownerMismatch = bridge.dispatch(
      makeRequest({
        bridge: { expected_owner: "owner-b", expected_generation: 7 },
      }),
    );
    assert.equal(ownerMismatch.ok, false);
    assert.equal(ownerMismatch.error.code, "BRIDGE_OWNER_MISMATCH");
    assert.equal(bridge.seen.length, 0);

    const generationMismatch = bridge.dispatch(
      makeRequest({
        bridge: { expected_owner: "owner-a", expected_generation: 6 },
      }),
    );
    assert.equal(generationMismatch.ok, false);
    assert.equal(generationMismatch.error.code, "BRIDGE_GENERATION_MISMATCH");
    assert.equal(bridge.seen.length, 0);
  });

  it("reports undo closure and verification failure in the fixed result envelope", () => {
    const bridge = new FakeFoundationBridge();
    const result = bridge.dispatch(
      makeRequest({
        params: { verification_passes: false },
        undo: {
          mode: "required",
          label: "OpenReaper: fake mutation",
          flags: ["items"],
        },
        verification: {
          mode: "required",
          checks: [{ kind: "count_delta", entity: "item" }],
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "VERIFY_FAILED");
    assert.equal(result.error.recoverable, false);
    assert.equal(result.undo.opened, true);
    assert.equal(result.undo.closed, true);
    assert.equal(result.verification.status, "failed");
    validateFoundationBridgeResult(result);
  });

  it("keeps large content out of ordinary results and uses artifact refs instead", () => {
    const bridge = new FakeFoundationBridge();
    const artifact = createArtifactRef({
      owner_pack: "analysis",
      scope: "peaks",
      id: "art_20260702000000000_001_abcdef",
      schema: "analysis.peaks.v1",
      summary: { samples: 48_000 },
    });

    const inline = bridge.dispatch(
      makeRequest({
        params: {
          emits: {
            inline_payload: "x".repeat(FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_inline_value_bytes + 1),
          },
        },
      }),
    );
    assert.equal(inline.ok, false);
    assert.equal(inline.error.code, "RESPONSE_TOO_LARGE");

    const compact = bridge.dispatch(
      makeRequest({
        params: {
          emits: {
            artifacts: [artifact],
          },
        },
      }),
    );
    assert.equal(compact.ok, true);
    assert.deepEqual(compact.result.artifacts, [artifact]);
    assert.doesNotMatch(JSON.stringify(compact), /"x{100,}"/);

    const metadata = bridge.dispatch(
      makeRequest({
        operation: { family: "artifact_metadata", name: "artifact.metadata" },
        pack: { id: "analysis", capability: "artifact.metadata", risk: "read" },
        refs: [artifact],
        undo: { mode: "none" },
        verification: { mode: "none", checks: [] },
      }),
    );
    assert.equal(metadata.ok, true);
    assert.equal(metadata.result.artifacts[0].ref, artifact.ref);
  });

  it("replays same-key idempotent requests and rejects same-key different fingerprints", () => {
    const bridge = new FakeFoundationBridge();
    const request = makeRequest({
      id: "cmd_20260702000000000_001_aaa111",
      idempotency_key: "same-logical-mutation",
      params: {
        emits: {
          refs: [createObjectRef("track", { scheme: "guid", value: "{TRACK-A}" })],
        },
      },
    });
    const retry = {
      ...request,
      id: "cmd_20260702000000000_002_bbb222",
      created_at: "2026-07-02T00:00:01.000Z",
    };

    const first = bridge.dispatch(request);
    const second = bridge.dispatch(retry);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.id, retry.id);
    assert.equal(second.queue.state, "replayed");
    assert.equal(second.idempotency.replayed, true);
    assert.equal(bridge.seen.length, 1);

    const conflict = bridge.dispatch({
      ...retry,
      id: "cmd_20260702000000000_003_ccc333",
      params: {
        emits: {
          refs: [createObjectRef("track", { scheme: "guid", value: "{TRACK-B}" })],
        },
      },
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
  });

  it("enforces queue and timeout semantics without requiring REAPER", () => {
    const bridge = new FakeFoundationBridge();
    bridge.setRunning(true);
    const conflict = bridge.dispatch(makeRequest());
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, "QUEUE_CONFLICT");

    bridge.setRunning(false);
    const timeout = bridge.dispatch(
      makeRequest({
        timeout_ms: 10,
        params: { simulate_delay_ms: 11 },
      }),
    );
    assert.equal(timeout.ok, false);
    assert.equal(timeout.error.code, "BRIDGE_TIMEOUT");
    assert.equal(timeout.queue.state, "timeout");
  });

  it("exposes a bounded last_result read contract", () => {
    const bridge = new FakeFoundationBridge();
    const refs = Array.from({ length: 5 }, (_, index) =>
      createObjectRef("item", { scheme: "guid", value: `{ITEM-${index}}` }),
    );

    const mutation = bridge.dispatch(
      makeRequest({
        budget: { max_response_bytes: 65_536, max_items: 3, max_inline_value_bytes: 2_048 },
        params: { emits: { refs } },
      }),
    );
    assert.equal(mutation.ok, true);
    assert.equal(mutation.result.last_result.refs.length, 3);
    assert.equal(mutation.result.last_result.truncated, true);

    const read = bridge.dispatch(
      makeRequest({
        operation: { family: "query_state", name: "last_result.read" },
        pack: { id: "core", capability: "last_result.read", risk: "read" },
        budget: { max_response_bytes: 65_536, max_items: 2, max_inline_value_bytes: 2_048 },
        undo: { mode: "none" },
        verification: { mode: "none", checks: [] },
      }),
    );
    assert.equal(read.ok, true);
    assert.equal(read.result.last_result.refs.length, 2);
    assert.equal(read.result.last_result.truncated, true);
  });

  it("keeps request fingerprints stable across command ids and timestamps", () => {
    const a = makeRequest({
      id: "cmd_20260702000000000_001_aaa111",
      created_at: "2026-07-02T00:00:00.000Z",
    });
    const b = makeRequest({
      id: "cmd_20260702000000000_002_bbb222",
      created_at: "2026-07-02T00:01:00.000Z",
    });

    assert.equal(foundationBridgeRequestFingerprint(a), foundationBridgeRequestFingerprint(b));
  });

  it("pressures the same ABI with representative scenarios for all 16 packs", () => {
    const bridge = new FakeFoundationBridge();
    const scenarios = packPressureScenarios();

    assert.deepEqual(
      scenarios.map((scenario) => scenario.pack.id),
      [...FOUNDATION_BRIDGE_PACK_IDS],
    );

    for (const scenario of scenarios) {
      const result = bridge.dispatch(makeRequest(scenario));
      assert.equal(result.contract, FOUNDATION_BRIDGE_CONTRACT);
      assert.equal(result.ok, true, `${scenario.pack.id} scenario failed`);
      validateFoundationBridgeResult(result);
      assert.ok(FOUNDATION_BRIDGE_OPERATION_FAMILIES.includes(scenario.operation.family));
    }
  });
});

function makeRequest(overrides = {}) {
  return {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: "cmd_20260702000000000_001_abcdef",
    created_at: "2026-07-02T00:00:00.000Z",
    client: {
      id: "openreaper-mcp",
      session_id: "session-test",
    },
    bridge: {
      expected_owner: "owner-test",
      expected_generation: 1,
    },
    operation: {
      family: "run_command",
      name: "template.execute",
    },
    pack: {
      id: "tracks",
      capability: "track.create",
      risk: "write",
    },
    params: {},
    refs: [],
    undo: {
      mode: "required",
      label: "OpenReaper: fake mutation",
      flags: ["track_config"],
    },
    verification: {
      mode: "required",
      checks: [],
    },
    artifacts: {
      allow: true,
    },
    budget: { ...FOUNDATION_BRIDGE_DEFAULT_BUDGET },
    timeout_ms: 5000,
    ...overrides,
  };
}

function packPressureScenarios() {
  const project = createObjectRef("project", { scheme: "current", value: "current" }, { ref: "project:current" });
  const track = createObjectRef("track", { scheme: "guid", value: "{TRACK}" });
  const item = createObjectRef("item", { scheme: "guid", value: "{ITEM}" });
  const take = createObjectRef("take", { scheme: "guid", value: "{TAKE}" });
  const fx = createObjectRef("fx", { scheme: "index", value: "track:{TRACK}:0" });
  const send = createObjectRef("send", { scheme: "index", value: "track:{TRACK}:0" });
  const envelope = createObjectRef("envelope", { scheme: "name", value: "Volume" });
  const marker = createObjectRef("marker", { scheme: "index", value: "1" });
  const region = createObjectRef("region", { scheme: "name", value: "Chorus" });
  const file = createObjectRef("file", { scheme: "path", value: "/tmp/source.wav" });
  const job = createObjectRef("job", { scheme: "job_id", value: "render-region-1" });
  const artifact = createArtifactRef({
    owner_pack: "analysis",
    scope: "loudness",
    id: "art_20260702000000000_001_abcdef",
    schema: "analysis.loudness.v1",
  });

  return [
    readScenario("core", "health.read", []),
    readScenario("project", "project.summary", [project]),
    commandScenario("transport", "transport.play", []),
    commandScenario("tracks", "track.create", [], [track]),
    commandScenario("items", "item.move", [item], [item]),
    commandScenario("media", "media.import", [file], [file]),
    jobScenario("analysis", "analysis.loudness", [item], [artifact]),
    commandScenario("midi", "midi.note.write", [take], [take]),
    commandScenario("fx", "fx.param.set", [fx], [fx]),
    commandScenario("routing", "send.create", [track], [send]),
    commandScenario("automation", "envelope.point.write", [envelope], [envelope]),
    jobScenario("render", "render.region", [region], [job]),
    {
      operation: { family: "run_action", name: "action.run" },
      pack: { id: "actions", capability: "action.run", risk: "write" },
      refs: [marker],
      params: { emits: { refs: [marker] } },
    },
    commandScenario("ui", "ui.dialog.open", [project], []),
    readScenario("system", "system.paths", []),
    commandScenario("hardware_control", "surface.command", [track], [track]),
  ];
}

function readScenario(packId, capability, refs) {
  return {
    operation: { family: "query_state", name: capability },
    pack: { id: packId, capability, risk: "read" },
    refs,
    undo: { mode: "none" },
    verification: { mode: "none", checks: [] },
  };
}

function commandScenario(packId, capability, refs, emittedRefs = refs) {
  return {
    operation: { family: "run_command", name: "template.execute" },
    pack: { id: packId, capability, risk: "write" },
    refs,
    params: { emits: { refs: emittedRefs } },
  };
}

function jobScenario(packId, capability, refs, emittedRefs) {
  return {
    operation: { family: "run_job", name: capability },
    pack: { id: packId, capability, risk: "write" },
    refs,
    params: {
      emits: {
        jobs: emittedRefs.filter((ref) => ref.kind === "job"),
        artifacts: emittedRefs.filter((ref) => ref.kind === "artifact"),
      },
    },
  };
}
