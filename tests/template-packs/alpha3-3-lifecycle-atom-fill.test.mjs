import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  createTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  TEMPLATE_CATALOG_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS,
  createTemplateCatalogAlpha3_3LifecycleAtomTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS,
  createAlpha3_3LifecycleAtomTemplates,
} from "../../packages/core/src/template-packs/alpha3-3-lifecycle-atom-fill-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const IDS = Object.freeze([
  "template.fx.delete_fx",
  "template.routing.remove_send",
  "template.items.move_item_to_track",
  "template.items.glue_item",
  "template.tracks.freeze_track",
  "template.tracks.unfreeze_track",
  "template.automation.ensure_take_pitch_envelope",
  "template.items.split_item_by_silence",
]);

const FX_REF = createObjectRef("fx", {
  scheme: "track_fx",
  value: "track:guid:{TRACK}:0",
}, { ref: "fx:track:guid:{TRACK}:0" });
const SEND_REF = createObjectRef("send", {
  scheme: "track_send",
  value: "track:guid:{SOURCE}:0",
}, { ref: "send:track:guid:{SOURCE}:0" });
const ITEM_REF = createObjectRef("item", { scheme: "guid", value: "{ITEM}" }, {
  ref: "item:guid:{ITEM}",
});
const TRACK_REF = createObjectRef("track", { scheme: "guid", value: "{TARGET}" }, {
  ref: "track:guid:{TARGET}",
});
const TAKE_REF = createObjectRef("take", { scheme: "guid", value: "{TAKE}" }, {
  ref: "take:guid:{TAKE}",
});

describe("Alpha3.3 exact lifecycle atom descriptors", () => {
  it("exports exactly the eight accepted lifecycle atom ids", () => {
    assert.deepEqual(ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS, IDS);
    assert.deepEqual(TEMPLATE_CATALOG_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS, IDS);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS, IDS);
    assert.deepEqual(createAlpha3_3LifecycleAtomTemplates().map(({ id }) => id), IDS);
    assert.deepEqual(createTemplateCatalogAlpha3_3LifecycleAtomTemplates().map(({ id }) => id), IDS);
  });

  it("validates exact destructive/write metadata, refs, undo posture, and readback declarations", async () => {
    const templates = createAlpha3_3LifecycleAtomTemplates();
    const catalog = createTemplateCatalog({ templates });
    const [deleteFx, removeSend, moveItem, glueItem, freezeTrack, unfreezeTrack, ensurePitch, splitSilence] = IDS.map((id) => catalog.require(id));

    for (const descriptor of templates) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.inputSchema.additionalProperties, false, descriptor.id);
      assert.deepEqual(descriptor.inputSchema.required, descriptor.id === "template.tracks.freeze_track" ? ["mode"] : [], descriptor.id);
      assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
      assert.equal(descriptor.bridge.operation_name, "template.execute", descriptor.id);
      assert.equal(descriptor.verification.mode, "required", descriptor.id);
      assert.equal(descriptor.artifacts.mode, "none", descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
    }

    assert.equal(deleteFx.risk, "destructive");
    assert.equal(deleteFx.bridge.idempotency, "none");
    assert.equal(deleteFx.expectedDelta.idempotent, false);
    assert.deepEqual(deleteFx.refs.input.map(({ name, kind }) => [name, kind]), [["fx_ref", "fx"]]);
    assert.deepEqual(deleteFx.verification.checks.map(({ name }) => name), ["fx_guid_absent", "fx_count_decremented"]);
    assert.equal(Object.hasOwn(deleteFx.outputSchema.properties, "fx_guid"), true);

    assert.equal(removeSend.risk, "destructive");
    assert.equal(removeSend.bridge.idempotency, "none");
    assert.equal(removeSend.expectedDelta.idempotent, false);
    assert.deepEqual(removeSend.refs.input.map(({ name, kind }) => [name, kind]), [["send_ref", "send"]]);
    assert.equal(removeSend.outputSchema.properties.category.const, 0);
    assert.equal(Object.hasOwn(removeSend.outputSchema.properties, "fingerprint"), true);

    assert.equal(moveItem.risk, "write");
    assert.equal(moveItem.bridge.idempotency, "supported");
    assert.equal(moveItem.expectedDelta.idempotent, true);
    assert.deepEqual(moveItem.refs.input.map(({ name, kind }) => [name, kind]), [
      ["item_ref", "item"],
      ["target_track_ref", "track"],
    ]);
    assert.deepEqual(moveItem.verification.checks.map(({ name }) => name), [
      "item_target_track_matches",
      "item_identity_preserved",
      "item_takes_preserved",
      "track_count_unchanged",
    ]);

    assert.equal(glueItem.risk, "destructive");
    assert.equal(glueItem.bridge.timeout_ms, 300_000);
    assert.equal(glueItem.bridge.idempotency, "none");
    assert.deepEqual(glueItem.refs.input.map(({ name, kind }) => [name, kind]), [["item_ref", "item"]]);
    assert.deepEqual(glueItem.refs.output.map(({ name, kind }) => [name, kind]), [
      ["glued_item_ref", "item"],
      ["glued_take_ref", "take"],
    ]);
    assert.equal(Object.hasOwn(glueItem.outputSchema.properties, "owner_track_ref"), true);
    assert.equal(Object.hasOwn(glueItem.outputSchema.properties, "item_count_unchanged"), true);

    assert.equal(freezeTrack.risk, "write");
    assert.equal(freezeTrack.bridge.timeout_ms, 300_000);
    assert.deepEqual(freezeTrack.inputSchema.properties.mode.enum, ["mono", "stereo", "multichannel"]);
    assert.deepEqual(freezeTrack.inputSchema.required, ["mode"]);
    assert.equal(Object.hasOwn(freezeTrack.outputSchema.properties, "action_id"), false);
    assert.deepEqual(freezeTrack.verification.checks.map(({ name }) => name), ["freeze_count_increased", "selection_restored"]);

    assert.equal(unfreezeTrack.risk, "destructive");
    assert.equal(unfreezeTrack.bridge.timeout_ms, 60_000);
    assert.equal(Object.hasOwn(unfreezeTrack.outputSchema.properties, "action_id"), false);
    assert.deepEqual(unfreezeTrack.verification.checks.map(({ name }) => name), ["freeze_count_decreased", "selection_restored"]);

    assert.equal(ensurePitch.risk, "write");
    assert.equal(ensurePitch.bridge.timeout_ms, 10_000);
    assert.equal(ensurePitch.bridge.idempotency, "supported");
    assert.equal(ensurePitch.expectedDelta.idempotent, true);
    assert.deepEqual(ensurePitch.refs.input.map(({ name, kind }) => [name, kind]), [["take_ref", "take"]]);
    assert.deepEqual(ensurePitch.refs.output.map(({ name, kind }) => [name, kind]), [["envelope_ref", "envelope"]]);

    assert.equal(splitSilence.risk, "destructive");
    assert.equal(splitSilence.bridge.timeout_ms, 300_000);
    assert.equal(splitSilence.bridge.idempotency, "none");
    assert.deepEqual(splitSilence.refs.input.map(({ name, kind }) => [name, kind]), [["item_ref", "item"]]);
    assert.deepEqual(splitSilence.refs.output.map(({ name, kind }) => [name, kind]), [
      ["kept_item_refs", "item"],
      ["deleted_item_refs", "item"],
    ]);
    assert.deepEqual(splitSilence.verification.checks.map(({ name }) => name), [
      "analysis_coverage_complete",
      "kept_guids_present",
      "deleted_guids_absent",
      "duration_conserved",
      "track_item_count_matches",
    ]);

    const adjacentBridge = new FakeFoundationBridge();
    const adjacentResult = await executeTemplate({
      descriptor: splitSilence,
      input: {
        batch: true,
        operation: "remove_silence",
        target: "exact",
        target_refs: [ITEM_REF.ref],
        adjacent_audio: "both",
        dry_run: true,
      },
      refs: { item_ref: ITEM_REF },
      context: context({ request_sequence: 9 }),
      executor: adjacentBridge,
    });
    assert.equal(adjacentResult.ok, true, JSON.stringify(adjacentResult));
    assert.equal(adjacentBridge.seen.length, 1);
    assert.equal(adjacentBridge.seen[0].params.adjacent_audio, "both");

    const bridge = new FakeFoundationBridge();
    for (const [index, id] of IDS.entries()) {
      const result = await executeTemplate({
        descriptor: catalog.require(id),
        input: inputFor(id),
        refs: refsFor(id),
        context: context({ request_sequence: index + 1 }),
        executor: bridge,
      });
      assert.equal(result.ok, true, id);
    }
    assert.deepEqual(bridge.seen.map(({ pack }) => [pack.id, pack.capability, pack.risk]), [
      ["fx", "fx.delete_fx", "destructive"],
      ["routing", "routing.remove_send", "destructive"],
      ["items", "items.move_item_to_track", "write"],
      ["items", "items.glue_item", "destructive"],
      ["tracks", "tracks.freeze_track", "write"],
      ["tracks", "tracks.unfreeze_track", "destructive"],
      ["automation", "automation.ensure_take_pitch_envelope", "write"],
      ["items", "items.split_item_by_silence", "destructive"],
    ]);
    for (const request of bridge.seen) {
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(Object.hasOwn(request, "idempotency_key"), false);
    }
  });

  it("promotes all eight into accepted catalog, Recipe compatibility, and one bounded live allowlist", async () => {
    const official = createAcceptedOfficialTemplateCatalog();
    for (const id of IDS) {
      assert.equal(official.get(id) !== null, true, id);
      assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.includes(id), true, id);
      assert.equal(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS.includes(id), true, id);
    }

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS,
      },
    });
    for (const [index, id] of IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: inputFor(id),
        refs: refsFor(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }
    assert.deepEqual(runtime.live_gate.allowed_template_ids, IDS);
    const exact = runtime.list_templates({ ids: IDS, fields: ["summary"] });
    assert.equal(exact.items.every((item) => item.capability_truth.live_runnable_now === true), true);
    assert.equal(exact.items.every((item) => item.capability_truth.evidence_level === "live_smoked"), true);
  });

  it("keeps descriptor source data-only and free of raw execution bypasses", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/alpha3-3-lifecycle-atom-fill-v1.mjs", import.meta.url),
      "utf8",
    );
    const serialized = JSON.stringify(createAlpha3_3LifecycleAtomTemplates());
    assert.doesNotMatch(source, /reaper\/bridge|child_process|spawn\(|execFile|os\.execute|io\.popen/);
    assert.doesNotMatch(serialized, /run_action|Main_OnCommand|NamedCommandLookup|raw_lua|shell_command|bridge_request/);
  });
});

function refsFor(id) {
  if (id === "template.fx.delete_fx") return { fx_ref: FX_REF };
  if (id === "template.routing.remove_send") return { send_ref: SEND_REF };
  if (id === "template.items.move_item_to_track") return { item_ref: ITEM_REF, target_track_ref: TRACK_REF };
  if (id === "template.items.glue_item") return { item_ref: ITEM_REF };
  if (id === "template.items.split_item_by_silence") return { item_ref: ITEM_REF };
  if (id === "template.automation.ensure_take_pitch_envelope") return { take_ref: TAKE_REF };
  return { track_ref: TRACK_REF };
}

function inputFor(id) {
  if (id === "template.tracks.freeze_track") return { mode: "stereo" };
  if (id === "template.items.split_item_by_silence") return { silence_threshold_dbfs: -60, min_silence_ms: 50 };
  return {};
}

function context(overrides = {}) {
  return {
    session_id: "session-alpha3-3-lifecycle-atoms",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-14T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
