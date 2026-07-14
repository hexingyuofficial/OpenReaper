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

describe("Alpha3.3 exact lifecycle atom descriptors", () => {
  it("exports exactly the three accepted lifecycle atom ids", () => {
    assert.deepEqual(ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS, IDS);
    assert.deepEqual(TEMPLATE_CATALOG_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS, IDS);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS, IDS);
    assert.deepEqual(createAlpha3_3LifecycleAtomTemplates().map(({ id }) => id), IDS);
    assert.deepEqual(createTemplateCatalogAlpha3_3LifecycleAtomTemplates().map(({ id }) => id), IDS);
  });

  it("validates exact destructive/write metadata, refs, undo posture, and readback declarations", async () => {
    const templates = createAlpha3_3LifecycleAtomTemplates();
    const catalog = createTemplateCatalog({ templates });
    const [deleteFx, removeSend, moveItem] = IDS.map((id) => catalog.require(id));

    for (const descriptor of templates) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.inputSchema.additionalProperties, false, descriptor.id);
      assert.deepEqual(descriptor.inputSchema.required, [], descriptor.id);
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

    const bridge = new FakeFoundationBridge();
    for (const [index, id] of IDS.entries()) {
      const result = await executeTemplate({
        descriptor: catalog.require(id),
        input: {},
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
    ]);
    for (const request of bridge.seen) {
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(Object.hasOwn(request, "idempotency_key"), false);
    }
  });

  it("promotes all three into accepted catalog, Recipe compatibility, and one bounded live allowlist", async () => {
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
        input: {},
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
  return { item_ref: ITEM_REF, target_track_ref: TRACK_REF };
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
