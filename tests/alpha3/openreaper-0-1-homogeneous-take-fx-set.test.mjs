import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const OWNER = "homogeneous-fx-owner";
const GENERATION = 19;
const PROJECT_REF = "project:path:/tmp/homogeneous-fx.RPP";
const TRACK_REF = "track:guid:{FX-SET-TRACK}";
const PLUGIN_NAME = "VST: ReaEQ (Cockos)";
const PLUGIN_ID = "vst:reaeq-cockos";
const LAYOUT = "fx-layout-v1:reaeq-stable";
const TRACK_OBJECT = createObjectRef(
  "track",
  { scheme: "guid", value: "{FX-SET-TRACK}" },
  { ref: TRACK_REF },
);
const LUA_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url),
  "utf8",
);

describe("OpenReaper 0.1.0 homogeneous active-Take FX sets", () => {
  for (const memberCount of [1, 8, 64]) {
    it(`executes the fixed three public calls for ${memberCount} homogeneous Take FX`, async () => {
      const fixture = createFixture(memberCount);
      const created = await createSet(fixture, 1);
      assert.equal(created.ok, true, JSON.stringify(created));
      assert.equal(created.result.data.member_count, memberCount);
      assert.match(created.result.data.fx_set_ref, /^fx-set:v1:/);

      const inspected = await fixture.runtime.call_template({
        id: "macro.fx.set_controls",
        input: {
          mode: "inspect_set",
          fx_set_ref: created.result.data.fx_set_ref,
          controls: [{ id: "frequency", param_ident: "frequency", natural_value: "3000 Hz" }],
        },
        refs: [],
        context: context(2),
      });
      assert.equal(inspected.ok, true, JSON.stringify(inspected));
      assert.equal(inspected.result.data.member_count, memberCount);
      assert.equal(inspected.result.data.parameters.length, 2);
      assert.match(inspected.result.data.parameter_plan_ref, /^fx-parameter-plan:v1:/);

      const applied = await fixture.runtime.call_template({
        id: "macro.fx.set_controls",
        input: {
          mode: "shared_plan",
          fx_set_ref: created.result.data.fx_set_ref,
          parameter_plan_ref: inspected.result.data.parameter_plan_ref,
          dry_run: false,
        },
        refs: [],
        context: context(3),
      });
      assert.equal(applied.ok, true, JSON.stringify(applied));
      assert.equal(applied.result.data.target_count, memberCount);
      assert.equal(applied.result.data.control_count, 1);
      assert.equal(applied.result.data.mutation_count, memberCount);
      assert.equal(applied.result.data.undo_block_count, 1);
      assert.equal(fixture.bridge.seen.slice(-3).every((request) => request.budget.max_response_bytes === 120_000), true);
      assert.deepEqual(fixture.bridge.seen.map((request) => request.pack.capability), [
        "track.resolve_ref",
        "fx.installed.search",
        "fx.add_take",
        "fx.list_parameters",
        "fx.set_parameter_assignments_batch",
      ]);
    });
  }

  it("accepts inline natural controls after representative inspection", async () => {
    const fixture = createFixture(8);
    const created = await createSet(fixture, 1);
    const readOnly = await fixture.runtime.call_template({
      id: "macro.fx.set_controls",
      input: { mode: "inspect_set", fx_set_ref: created.result.data.fx_set_ref },
      refs: [],
      context: context(2),
    });
    assert.equal(readOnly.ok, true, JSON.stringify(readOnly));
    assert.equal(readOnly.result.data.parameter_plan_ref, null);

    const applied = await fixture.runtime.call_template({
      id: "macro.fx.set_controls",
      input: {
        mode: "shared_plan",
        fx_set_ref: created.result.data.fx_set_ref,
        controls: [
          { id: "frequency", param_name: "Frequency", display_value: "3000 Hz" },
          { id: "gain", param_name: "Gain", natural_value: "-3 dB" },
        ],
        dry_run: false,
      },
      refs: [],
      context: context(3),
    });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.result.data.control_count, 2);
    assert.equal(applied.result.data.mutation_count, 16);
    assert.deepEqual(fixture.bridge.seen.slice(-2).map((request) => request.pack.capability), [
      "fx.list_parameters",
      "fx.set_parameter_assignments_batch",
    ]);
  });

  it("fails stale generation and project authority before another native call", async () => {
    const fixture = createFixture(1);
    const created = await createSet(fixture, 1);
    const seenBefore = fixture.bridge.seen.length;
    fixture.bridge.setGeneration(GENERATION + 1);
    const staleGeneration = await fixture.runtime.call_template({
      id: "macro.fx.set_controls",
      input: { mode: "inspect_set", fx_set_ref: created.result.data.fx_set_ref },
      refs: [],
      context: context(2, { expected_generation: GENERATION + 1 }),
    });
    assert.equal(staleGeneration.ok, false);
    assert.equal(staleGeneration.error.code, "FX_SET_BRIDGE_GENERATION_STALE");
    assert.equal(fixture.bridge.seen.length, seenBefore);

    fixture.projectIndexRuntime.identity.bridge_generation = GENERATION;
    fixture.projectIndexRuntime.identity.project_ref = "project:path:/tmp/other.RPP";
    const staleProject = await fixture.runtime.call_template({
      id: "macro.fx.set_controls",
      input: { mode: "inspect_set", fx_set_ref: created.result.data.fx_set_ref },
      refs: [],
      context: context(3),
    });
    assert.equal(staleProject.ok, false);
    assert.equal(staleProject.error.code, "FX_SET_PROJECT_STALE");
    assert.equal(fixture.bridge.seen.length, seenBefore);
  });

  it("rejects incomplete member readback and never creates a parameter plan", async () => {
    const fixture = createFixture(8, { inspectionMismatch: true });
    const created = await createSet(fixture, 1);
    const inspected = await fixture.runtime.call_template({
      id: "macro.fx.set_controls",
      input: {
        mode: "inspect_set",
        fx_set_ref: created.result.data.fx_set_ref,
        controls: [{ id: "frequency", param_ident: "frequency", natural_value: "3000 Hz" }],
      },
      refs: [],
      context: context(2),
    });
    assert.equal(inspected.ok, false);
    assert.equal(inspected.error.code, "FX_SET_INSPECTION_READBACK_MISMATCH");
    assert.equal(fixture.bridge.seen.at(-1).pack.capability, "fx.list_parameters");
  });

  it("promotes an allowlisted FX-set reason code without widening the Foundation ABI", async () => {
    const fixture = createFixture(65, { cardinalityFailure: true });
    const rejected = await createSet(fixture, 1);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "FX_SET_CARDINALITY_INVALID");
    assert.deepEqual(rejected.error.details, {
      reason_code: "FX_SET_CARDINALITY_INVALID",
      zero_write: true,
      target_count: 65,
      maximum: 64,
    });
    assert.equal(rejected.result.changes.length, 0);
    assert.equal(fixture.bridge.seen.at(-1).pack.capability, "fx.add_take");
  });

  it("compiles equivalent Hz/kHz text and locks the native formatted value", () => {
    const start = LUA_SOURCE.indexOf("function E2_FX_HOMOGENEOUS_SET.formatted_quantity");
    const end = LUA_SOURCE.indexOf("\nfunction E2_FX_HOMOGENEOUS_SET.compile_controls", start);
    assert.ok(start >= 0 && end > start);
    runLua(String.raw`
      local E2_FX_HOMOGENEOUS_SET = {}
      local function is_string(value) return type(value) == "string" end
      function E2_FX_HOMOGENEOUS_SET.finite(value)
        return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
      end
      local formatted_calls = 0
      local formatted_inputs = {}
      local function e2_fx_format_param_value(_, _, _, _, value)
        formatted_calls = formatted_calls + 1
        assert(value >= 0 and value <= 1)
        formatted_inputs[#formatted_inputs + 1] = value
        return string.format("%.2f kHz", value * 6)
      end
      local function e2_fx_format_param_normalized(_, _, _, _, normalized)
        return string.format("%.2f kHz", normalized * 6)
      end
      local function e2_fx_read_param_value() return { value = 0, min_value = 0, max_value = 1 } end
      ${LUA_SOURCE.slice(start, end)}
      local value, native = E2_FX_HOMOGENEOUS_SET.search_formatted(
        { take = {}, slot_index = 0 },
        0,
        "3000 Hz"
      )
      assert(type(value) == "number")
      assert(native == "3.00 kHz")
      local track_value, track_native = E2_FX_HOMOGENEOUS_SET.search_formatted(
        { owner_kind = "track", owner = {}, slot_index = 0 },
        0,
        "3000 Hz"
      )
      assert(type(track_value) == "number")
      assert(track_native == "3.00 kHz")
      assert(formatted_calls > 0 and formatted_calls < 5000)
      assert(formatted_inputs[1] == 0)
      assert(E2_FX_HOMOGENEOUS_SET.formatted_matches("-3.00 dB", "-3 dB"))
      assert(not E2_FX_HOMOGENEOUS_SET.formatted_matches("3.00 kHz", "3.00 dB"))
      assert(E2_FX_HOMOGENEOUS_SET.formatted_readback_matches("3000.0", "3000.0 Hz"))
      assert(E2_FX_HOMOGENEOUS_SET.formatted_readback_matches("-3.0", "-3.0 dB"))
      assert(not E2_FX_HOMOGENEOUS_SET.formatted_readback_matches("2999.0", "3000.0 Hz"))
      assert(not E2_FX_HOMOGENEOUS_SET.formatted_readback_matches("3000.0 ms", "3000.0 Hz"))
      assert(E2_FX_HOMOGENEOUS_SET.format_at_value(
        { owner_kind = "track", owner = {}, slot_index = 0 },
        0,
        0.35546875
      ) == "2.13 kHz")
      assert(formatted_inputs[#formatted_inputs] == 0.35546875)
      assert(E2_FX_HOMOGENEOUS_SET.format_at_normalized(
        { owner_kind = "track", owner = {}, slot_index = 0 },
        0,
        0.35546875
      ) == "2.13 kHz")
      assert(E2_FX_HOMOGENEOUS_SET.format_at_normalized({ take = {}, slot_index = 0 }, 0, 1.01) == nil)
    `);
  });

  it("matches only the exact installed identity or its native numeric VST2 instance suffix", () => {
    const start = LUA_SOURCE.indexOf("local function e2_fx_installed_identity_matches_live");
    const end = LUA_SOURCE.indexOf("\nlocal function e2_fx_current_project_truth", start);
    assert.ok(start >= 0 && end > start);
    runLua(String.raw`
      local function is_string(value) return type(value) == "string" end
      ${LUA_SOURCE.slice(start, end)}
      local installed = "/Applications/REAPER.app/Contents/Plugins/FX/reaeq.vst.dylib"
      assert(e2_fx_installed_identity_matches_live(installed, installed))
      assert(e2_fx_installed_identity_matches_live(installed, installed .. "<1919247729"))
      assert(not e2_fx_installed_identity_matches_live(installed, installed .. "<"))
      assert(not e2_fx_installed_identity_matches_live(installed, installed .. "<1919247729>"))
      assert(not e2_fx_installed_identity_matches_live(installed, installed .. "<reaeq"))
      assert(not e2_fx_installed_identity_matches_live(installed, installed .. "-renamed<1919247729"))
      assert(not e2_fx_installed_identity_matches_live(installed, "/tmp/reaeq.vst.dylib<1919247729"))
      assert(not e2_fx_installed_identity_matches_live(installed .. "<1919247729", installed .. "<1919247729<1"))
    `);
  });

  it("keeps 65, MIDI, missing Take, duplicate FX, and mixed layout at native zero-write", () => {
    const start = LUA_SOURCE.indexOf("local function e2_fx_take_fanout_error");
    const end = LUA_SOURCE.indexOf("\nlocal function add_take_fx", start);
    const errorStart = LUA_SOURCE.indexOf("local E2_FX_SET_FOUNDATION_ERROR_CODES");
    const errorEnd = LUA_SOURCE.indexOf("\nfunction E2_FX_HOMOGENEOUS_SET.only_fields", errorStart);
    assert.ok(start >= 0 && end > start && errorStart >= 0 && errorEnd > errorStart);
    runLua(String.raw`
      local JSON_NULL = {}
      local E2_FX_TAKE_FANOUT_MAX_TARGETS = 64
      local E2_FX_CHAIN_MAX_INSTANCES = 4096
      local E2_FX_HOMOGENEOUS_SET = {}
      local scenario = "too_many"
      local add_calls = 0
      local function is_object(value) return type(value) == "table" end
      local function is_string(value) return type(value) == "string" end
      local function first_number(...)
        for index = 1, select("#", ...) do
          local value = select(index, ...)
          if type(value) == "number" then return value end
        end
      end
      local function bounded_string(value) return value end
      local function e2_fx_read_error(code, message, details, recoverable)
        return nil, { code = code, message = message, details = details or {}, recoverable = recoverable }
      end
      ${LUA_SOURCE.slice(errorStart, errorEnd)}
      local function e2_fx_fanout_binding_valid() return true end
      local function e2_fx_exact_fanout_track() return { guid = "TRACK" }, "track:guid:{TRACK}", nil end
      local function e2_fx_plugin_name() return "VST: ReaEQ (Cockos)" end
      local function e2_fx_exact_installed_plugin() return { ident = "reaeq" }, nil end
      local function e2_fx_installed_identity_matches_live(installed, live) return installed == live end
      local function e2_fx_current_project_truth() return { project_instance_id = "project:1" } end
      local function e2_fx_native_item_guid(item) return item.guid end
      local function e2_fx_read_take_guid(take) return take.guid end
      local function e2_fx_read_plugin_id(_, take)
        if scenario == "duplicate" or scenario == "mixed_layout" then return "reaeq" end
        return "other"
      end
      local function e2_fx_read_guid(_, take, slot) return take.guid .. ":fx:" .. tostring(slot) end
      local function e2_fx_parameter_layout(_, take)
        local fingerprint = scenario == "mixed_layout" and "layout:" .. take.guid or "layout:stable"
        return { parameter_count = 2, layout_fingerprint = fingerprint }, nil
      end
      local function e2_fx_take_add_by_name()
        add_calls = add_calls + 1
        return 0
      end
      local function e2_fx_read_count() return 1 end
      local function e2_fx_read_fx_object_ref() return { ref = "unused" } end
      local function e2_fx_write_summary(_, value) return value end
      local function e2_fx_read_refs() return {} end
      local function json_array(value) return value end
      local function call_reaper(api, object, index)
        if api == "CountTrackMediaItems" then
          if scenario == "too_many" then return true, 65 end
          if scenario == "mixed_layout" then return true, 2 end
          return true, 1
        end
        if api == "GetTrackMediaItem" then return true, { guid = "ITEM-" .. tostring(index) } end
        if api == "GetActiveTake" then
          if scenario == "missing_take" then return true, nil end
          return true, { guid = object.guid:gsub("^ITEM", "TAKE") }
        end
        if api == "TakeIsMIDI" then return true, scenario == "midi" end
        if api == "TakeFX_GetCount" then return true, scenario == "duplicate" and 2 or 1 end
        error("unexpected API: " .. tostring(api))
      end
      ${LUA_SOURCE.slice(start, end)}
      local request = { params = {
        plugin_name = "VST: ReaEQ (Cockos)",
        duplicate_policy = "reuse_exact",
        include_parameter_layout = true,
        dry_run = false,
        target_binding = {},
      } }
      local expected = {
        too_many = "FX_SET_CARDINALITY_INVALID",
        missing_take = "FX_SET_ACTIVE_TAKE_MISSING",
        midi = "FX_SET_MIDI_UNSUPPORTED",
        duplicate = "FX_SET_DUPLICATE_AMBIGUOUS",
        mixed_layout = "FX_SET_LAYOUT_MISMATCH",
      }
      for _, name in ipairs({ "too_many", "missing_take", "midi", "duplicate", "mixed_layout" }) do
        scenario = name
        local _, failure = e2_fx_add_take_fx_fanout(request)
        assert(type(failure) == "table" and failure.code == "PARAMS_INVALID", name .. ":" .. tostring(failure and failure.code))
        assert(failure.details.reason_code == expected[name], name .. ":" .. tostring(failure.details.reason_code))
        assert(failure.details.zero_write == true, name .. ":zero_write")
        assert(add_calls == 0, name .. ":add_calls=" .. tostring(add_calls))
      end
    `);
  });

  it("executes 64 FX x 8 controls without the legacy 64-row ceiling", () => {
    const start = LUA_SOURCE.indexOf("local E2_FX_SET_FOUNDATION_ERROR_CODES");
    const end = LUA_SOURCE.indexOf("\nlocal function e2_fx_take_fanout_error", start);
    assert.ok(start >= 0 && end > start);
    runLua(String.raw`
      local JSON_NULL = {}
      local E2_FX_TAKE_FANOUT_MAX_TARGETS = 64
      local E2_FX_HOMOGENEOUS_SET = {}
      local writes = 0
      local function is_object(value) return type(value) == "table" end
      local function is_string(value) return type(value) == "string" end
      local function is_json_array(value) return type(value) == "table" end
      local function bounded_string(value) return value end
      local function json_array(value) return value end
      local function first_number(value) return value end
      local function e2_fx_read_error(code, message, details, recoverable)
        return nil, { code = code, message = message, details = details or {}, recoverable = recoverable }
      end
      local function e2_fx_current_project_truth() return { project_instance_id = "project:stable" } end
      local function e2_fx_read_fx_owner_from_ref_object(ref)
        local take_guid = ref.ref:match("^fx:take:guid:(.+):0$")
        return "take", ref.take, 0
      end
      local function e2_fx_read_take_guid(take) return take.guid end
      local function e2_fx_read_guid(_, take) return take.fx_guid end
      local function e2_fx_read_plugin_id() return "reaeq" end
      local function e2_fx_parameter_layout()
        return { parameter_count = 8, layout_fingerprint = "layout:stable" }, nil
      end
      local function e2_fx_read_param_ident(_, _, _, index) return "param" .. tostring(index) end
      local function e2_fx_read_param_name(_, _, _, index) return "Param " .. tostring(index) end
      local function e2_fx_format_param_value(_, _, _, index, value)
        local unit = index % 2 == 0 and " Hz" or " dB"
        return string.format("%.1f%s", value * 1000, unit)
      end
      local function e2_fx_set_param_value(_, take, _, index, value)
        writes = writes + 1
        take.values[index] = value
        return true
      end
      local function e2_fx_read_param_normalized(_, take, _, index) return take.values[index] or 0 end
      local function e2_fx_read_param_formatted(_, take, _, index)
        local normalized = take.values[index] or 0
        return string.format("%.1f", normalized * 1000)
      end
      local function e2_fx_write_summary(_, value) return value end
      local function e2_fx_read_summary(_, value) return value end
      local function e2_fx_read_param_value(_, take, _, index)
        return { value = take.values[index] or 0, min_value = 0, max_value = 1 }
      end
      local function e2_fx_read_param_step_sizes() return { is_discrete = false } end
      local function e2_fx_read_refs(...) return { ... } end
      ${LUA_SOURCE.slice(start, end)}
      local members, refs = {}, {}
      for index = 1, 64 do
        local take_ref = "take:guid:{TAKE-" .. tostring(index) .. "}"
        local fx_ref = "fx:" .. take_ref .. ":0"
        local take = { guid = "{TAKE-" .. tostring(index) .. "}", fx_guid = "{FX-" .. tostring(index) .. "}", values = {} }
        members[index] = {
          fx_ref = fx_ref,
          take_ref = take_ref,
          fx_guid = take.fx_guid,
          plugin_id = "reaeq",
          parameter_count = 8,
          layout_fingerprint = "layout:stable",
        }
        refs[index] = {
          kind = "fx",
          ref = fx_ref,
          identity = { scheme = "take_fx", value = take_ref .. ":0" },
          take = take,
        }
      end
      local controls = {}
      for index = 0, 7 do
        local value = (index + 1) / 10
        controls[index + 1] = {
          id = "control" .. tostring(index),
          param_index = index,
          param_ident = "param" .. tostring(index),
          param_name = "Param " .. tostring(index),
          natural_value = "requested:" .. tostring(index),
          value = value,
          requested_formatted_value = e2_fx_format_param_value("take", {}, 0, index, value),
          tolerance = 0.000001,
        }
      end
      local request = {
        refs = refs,
        params = {
          mode = "shared_plan",
          dry_run = false,
          batch = {},
          set_fingerprint = string.rep("a", 64),
          plan_hash = string.rep("b", 64),
          expected_plugin_identity = { name = "VST: ReaEQ (Cockos)", plugin_id = "reaeq" },
          expected_layout_fingerprint = "layout:stable",
          expected_representative_fx_ref = members[1].fx_ref,
          expected_members = members,
          controls = controls,
        },
      }
      local result, failure = E2_FX_HOMOGENEOUS_SET.apply(request)
      assert(failure == nil)
      assert(result.mutation_count == 512 and writes == 512)
      assert(result.target_count == 64 and result.control_count == 8)
      assert(result.undo_block_count == 1)
      assert(#result.member_results == 64)
    `);
  });
});

function createFixture(memberCount, bridgeOptions = {}) {
  const members = createMembers(memberCount);
  const bridge = new HomogeneousFxBridge(members, bridgeOptions);
  const invalidations = [];
  const projectIndexRuntime = {
    identity: {
      bridge_owner: OWNER,
      bridge_generation: GENERATION,
      project_ref: PROJECT_REF,
    },
    adapter: {},
    status: () => ({ ok: true, lifecycle: "ready", snapshot_id: "snapshot:fx-set", revision: "revision:fx-set" }),
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      return { ok: true, scopes, snapshot_id: "snapshot:fx-set", revision: "revision:fx-set" };
    },
  };
  const runtime = createCallTemplateRuntime({
    projectIndexRuntime,
    live: {
      opted_in: true,
      executor: bridge,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
    },
  });
  return { runtime, bridge, members, invalidations, projectIndexRuntime };
}

async function createSet(fixture, requestSequence) {
  return fixture.runtime.call_template({
    id: "macro.fx.apply_chain",
    input: {
      owner_kind: "take",
      chain: [{ plugin_name: PLUGIN_NAME, duplicate_policy: "reuse_exact" }],
      target_binding: {
        bind_at: "execution",
        domain: "takes",
        selector: "active_take_of_items",
        owner: { domain: "tracks", selector: "explicit_refs", items: "all" },
        aggregation: "batch",
        cardinality: { minimum: 1, maximum: 64 },
      },
      dry_run: false,
    },
    refs: { track_ref: TRACK_REF },
    context: context(requestSequence),
  });
}

class HomogeneousFxBridge extends FakeFoundationBridge {
  constructor(members, options = {}) {
    super({ owner: OWNER, generation: GENERATION });
    this.members = members;
    this.options = options;
  }

  dispatch(input) {
    const request = structuredClone(input);
    request.params = { ...(request.params ?? {}), emits: this.emitted(request) };
    return super.dispatch(request);
  }

  execute(request, startedAt) {
    if (this.options.cardinalityFailure && request.pack?.capability === "fx.add_take") {
      return this.errorEnvelope(request, "PARAMS_INVALID", "Track-owned Take-FX fanout accepts 1-64 active audio Take targets.", {
        recoverable: true,
        startedAt,
        details: {
          reason_code: "FX_SET_CARDINALITY_INVALID",
          zero_write: true,
          target_count: 65,
          maximum: 64,
        },
      });
    }
    return super.execute(request, startedAt);
  }

  emitted(request) {
    const capability = request.pack?.capability;
    if (capability === "track.resolve_ref") {
      return output([TRACK_OBJECT], { track_ref: TRACK_REF, name: "Dialogue" });
    }
    if (capability === "fx.installed.search") {
      return output([], {
        rows: [{ index: 0, name: PLUGIN_NAME, ident: PLUGIN_ID }],
        row_count: 1,
        matched_count: 1,
        scanned_count: 1,
        truncated: false,
      });
    }
    if (capability === "fx.add_take") {
      return output(this.members.map((member) => fxObject(member)), {
        mode: "track_owned_active_take_fx_set",
        track_ref: TRACK_REF,
        member_count: this.members.length,
        members: structuredClone(this.members),
        representative_fx_ref: this.members[0].fx_ref,
        plugin_identity: { name: PLUGIN_NAME, plugin_id: PLUGIN_ID, installed_index: 0 },
        layout_fingerprint: LAYOUT,
        project_instance_id: "native-project:fx-set",
        mutation_count: this.members.length,
        zero_write: false,
      });
    }
    if (capability === "fx.list_parameters") {
      const expected = structuredClone(request.params.expected_members ?? []);
      if (this.options.inspectionMismatch && expected[0]) expected[0].fx_guid = "{REPLACED-FX}";
      const controls = Array.isArray(request.params.controls)
        ? request.params.controls.map((control, index) => compiledControl(control, index))
        : [];
      return output(this.members.map((member) => fxObject(member)), {
        mode: "inspect_set",
        set_fingerprint: request.params.expected_set_fingerprint,
        plugin_identity: structuredClone(request.params.expected_plugin_identity),
        layout_fingerprint: request.params.expected_layout_fingerprint,
        representative_fx_ref: request.params.expected_representative_fx_ref,
        member_count: expected.length,
        member_checks: expected.map((member) => ({ ...member, status: "passed" })),
        parameter_count: 2,
        parameters: parameterInventory(),
        compiled_controls: controls,
        truncated: false,
        inventory_complete: true,
      });
    }
    if (capability === "fx.set_parameter_assignments_batch") {
      const expected = request.params.expected_members;
      return output(this.members.map((member) => fxObject(member)), {
        mode: "shared_plan",
        set_fingerprint: request.params.set_fingerprint,
        plan_hash: request.params.plan_hash,
        layout_fingerprint: request.params.expected_layout_fingerprint,
        target_count: expected.length,
        control_count: request.params.controls.length,
        mutation_count: request.params.dry_run ? 0 : expected.length * request.params.controls.length,
        undo_block_count: request.params.dry_run ? 0 : 1,
        mutation_attempted: request.params.dry_run !== true,
        zero_write: request.params.dry_run === true,
        member_results: expected.map((member) => ({
          ...member,
          control_count: request.params.controls.length,
          status: request.params.dry_run ? "planned" : "passed",
        })),
      });
    }
    return output([], {});
  }
}

function createMembers(count) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    const takeRef = `take:guid:{FX-SET-TAKE-${suffix}}`;
    return {
      track_ref: TRACK_REF,
      item_ref: `item:guid:{FX-SET-ITEM-${suffix}}`,
      take_ref: takeRef,
      fx_ref: `fx:${takeRef}:0`,
      fx_guid: `{FX-SET-FX-${suffix}}`,
      plugin_id: PLUGIN_ID,
      parameter_count: 2,
      layout_fingerprint: LAYOUT,
      status: "created",
    };
  });
}

function parameterInventory() {
  return [
    { param_index: 0, param_ident: "frequency", name: "Frequency", normalized_value: 0.5, formatted_value: "3.00 kHz" },
    { param_index: 1, param_ident: "gain", name: "Gain", normalized_value: 0.4, formatted_value: "-3.00 dB" },
  ];
}

function compiledControl(control, index) {
  const gain = control.param_ident === "gain" || control.param_name === "Gain";
  return {
    id: control.id,
    param_index: gain ? 1 : 0,
    param_ident: gain ? "gain" : "frequency",
    param_name: gain ? "Gain" : "Frequency",
    natural_value: control.natural_value,
    value: gain ? 0.4 : 0.5,
    requested_formatted_value: gain ? "-3.00 dB" : "3.00 kHz",
    tolerance: 0.000001 + index * 0,
  };
}

function fxObject(member) {
  return createObjectRef(
    "fx",
    { scheme: "take_fx", value: `${member.take_ref}:0` },
    { ref: member.fx_ref, display: { owner_ref: member.take_ref, slot_index: 0 } },
  );
}

function output(refs, readback) {
  return { refs, readback };
}

function context(requestSequence, overrides = {}) {
  return {
    session_id: "session-homogeneous-fx-set",
    request_id: `homogeneous-fx-${requestSequence}`,
    expected_owner: OWNER,
    expected_generation: GENERATION,
    created_at: "2026-08-20T00:00:00.000Z",
    request_sequence: requestSequence,
    ...overrides,
  };
}

function runLua(source) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 0, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  lua.lua_close(state);
}
