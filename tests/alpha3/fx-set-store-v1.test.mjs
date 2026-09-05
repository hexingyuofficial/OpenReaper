import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FX_PARAMETER_PLAN_REF_PREFIX,
  FX_SET_REF_PREFIX,
  createFxSetStoreV1,
  fxSetAuthorityFromRequest,
} from "../../packages/mcp-server/src/fx-set-store-v1.mjs";

const AUTHORITY = Object.freeze({
  bridge_owner: "bridge-owner-a",
  bridge_generation: 7,
  project_ref: "project:path:/tmp/fixture.RPP",
});

function member(index = 0) {
  return {
    fx_ref: `fx:take:guid:{TAKE-${index}}:0`,
    take_ref: `take:guid:{TAKE-${index}}`,
    item_ref: `item:guid:{ITEM-${index}}`,
    fx_guid: `{FX-${index}}`,
    plugin_id: "reaeq",
    parameter_count: 16,
  };
}

function createStore(options = {}) {
  let sequence = 0;
  return createFxSetStoreV1({
    randomUUID: () => `id-${++sequence}`,
    ...options,
  });
}

function putSet(store, overrides = {}) {
  return store.putSet({
    authority: AUTHORITY,
    track_ref: "track:guid:{TRACK-1}",
    plugin_identity: { plugin_id: "reaeq", fx_name: "VST: ReaEQ (Cockos)" },
    layout_fingerprint: "layout-a",
    representative_fx_ref: member(0).fx_ref,
    members: [member(0)],
    ...overrides,
  });
}

describe("server-owned homogeneous FX set state", () => {
  it("stores immutable 1-64 member sets and fingerprints membership", () => {
    const store = createStore();
    const first = putSet(store);
    const second = putSet(store, { members: [member(0), member(1)] });

    assert.equal(first.ok, true);
    assert.match(first.record.ref, new RegExp(`^${FX_SET_REF_PREFIX}`));
    assert.equal(first.record.members.length, 1);
    assert.notEqual(first.record.set_fingerprint, second.record.set_fingerprint);

    first.record.members[0].fx_ref = "mutated-by-caller";
    assert.equal(store.getSet(first.record.ref, AUTHORITY).record.members[0].fx_ref, member(0).fx_ref);
  });

  it("rejects zero and 65 members before creating state", () => {
    const store = createStore();
    assert.equal(putSet(store, { members: [] }).code, "FX_SET_SIZE_INVALID");
    const tooMany = Array.from({ length: 65 }, (_, index) => member(index));
    const failure = putSet(store, { members: tooMany });
    assert.equal(failure.ok, false);
    assert.equal(failure.code, "FX_SET_SIZE_INVALID");
    assert.equal(failure.zero_write, true);
  });

  it("fails closed for unknown, restarted, stale-generation, and stale-project refs", () => {
    const store = createStore();
    const created = putSet(store);

    assert.equal(store.getSet(`${FX_SET_REF_PREFIX}missing`, AUTHORITY).code, "FX_SET_REF_UNKNOWN_OR_EXPIRED");
    assert.equal(createStore().getSet(created.record.ref, AUTHORITY).code, "FX_SET_REF_UNKNOWN_OR_EXPIRED");
    assert.equal(store.getSet(created.record.ref, { ...AUTHORITY, bridge_generation: 8 }).code, "FX_SET_BRIDGE_GENERATION_STALE");
    assert.equal(store.getSet(created.record.ref, { ...AUTHORITY, project_ref: "project:path:/tmp/other.RPP" }).code, "FX_SET_PROJECT_STALE");
    assert.equal(store.getSet(created.record.ref, { bridge_owner: AUTHORITY.bridge_owner, bridge_generation: 7 }).code, "FX_SET_PROJECT_STALE");
  });

  it("expires sets and all plans that depend on them", () => {
    let now = 1_000;
    const store = createStore({ now: () => now, ttlMs: 50 });
    const set = putSet(store);
    const plan = store.putPlan({
      authority: AUTHORITY,
      fx_set_ref: set.record.ref,
      controls: [{ id: "gain", param_ident: "gain", natural_value: "-3 dB" }],
    });
    assert.equal(plan.ok, true);
    assert.match(plan.record.ref, new RegExp(`^${FX_PARAMETER_PLAN_REF_PREFIX}`));

    now = 1_051;
    assert.equal(store.getSet(set.record.ref, AUTHORITY).code, "FX_SET_REF_UNKNOWN_OR_EXPIRED");
    assert.equal(store.getPlan(plan.record.ref, { authority: AUTHORITY }).code, "FX_PARAMETER_PLAN_REF_UNKNOWN_OR_EXPIRED");
  });

  it("binds plans to one set, authority, fingerprint, and 1-8 controls", () => {
    const store = createStore();
    const setA = putSet(store);
    const setB = putSet(store, { members: [member(1)] });
    const plan = store.putPlan({
      authority: AUTHORITY,
      fx_set_ref: setA.record.ref,
      controls: [{ id: "frequency", param_ident: "freq", natural_value: "3000 Hz" }],
    });

    assert.equal(plan.ok, true);
    assert.equal(store.getPlan(plan.record.ref, { authority: AUTHORITY, fx_set_ref: setA.record.ref }).ok, true);
    assert.equal(store.getPlan(plan.record.ref, { authority: AUTHORITY, fx_set_ref: setB.record.ref }).code, "FX_PARAMETER_PLAN_SET_MISMATCH");
    assert.equal(store.getPlan(plan.record.ref, { authority: { ...AUTHORITY, bridge_owner: "bridge-owner-b" } }).code, "FX_PARAMETER_PLAN_BRIDGE_OWNER_STALE");
    assert.equal(store.putPlan({ authority: AUTHORITY, fx_set_ref: setA.record.ref, controls: [] }).code, "FX_PARAMETER_PLAN_SIZE_INVALID");
    assert.equal(store.putPlan({ authority: AUTHORITY, fx_set_ref: setA.record.ref, controls: Array.from({ length: 9 }, (_, id) => ({ id })) }).code, "FX_PARAMETER_PLAN_SIZE_INVALID");
  });

  it("derives Bridge and Project Index authority from one request", () => {
    assert.deepEqual(fxSetAuthorityFromRequest({
      context: { expected_owner: "owner", expected_generation: 12 },
    }, {
      identity: { project_ref: "project:path:/tmp/current.RPP" },
    }), {
      bridge_owner: "owner",
      bridge_generation: 12,
      project_ref: "project:path:/tmp/current.RPP",
    });
    assert.deepEqual(fxSetAuthorityFromRequest({}, {
      identity: {
        bridge_owner: "runtime-owner",
        bridge_generation: 13,
        project_ref: "project:path:/tmp/runtime.RPP",
      },
    }), {
      bridge_owner: "runtime-owner",
      bridge_generation: 13,
      project_ref: "project:path:/tmp/runtime.RPP",
    });
  });
});
