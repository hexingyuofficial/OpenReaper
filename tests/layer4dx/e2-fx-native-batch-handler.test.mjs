import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  ALPHA3_4_D2_FX_NATIVE_BATCH_CAPABILITY,
  ALPHA3_4_D2_FX_NATIVE_BATCH_TEMPLATE_ID,
  executeExactAssignmentsBatch,
} from "../../packages/mcp-server/src/alpha3-4-d2-fx-batch-v1.mjs";
import { createWave2AFxTemplates } from "../../packages/core/src/template-packs/wave2a-fx-templates-v1.mjs";

const FX_REF = "fx:track:guid:{TRACK-01}:0";
const ENTRY = {
  macro_id: "macro.fx.set_controls",
  program_id: "openreaper.macro.fx.set_controls",
  program_version: "1.0.0",
  risk: "write",
};

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

function state() {
  return {
    batchMode: false,
    calls: {},
    timings: {},
    changes: [],
    canonicalRefs: [],
    evidenceRefs: [],
    objectRefs: new Map(),
    sqlite: undefined,
  };
}

function request(dryRun = false) {
  return {
    id: "macro.fx.set_controls",
    input: {
      mode: "exact_assignments",
      dry_run: dryRun,
      assignments: [
        { id: "gain", fx_ref: FX_REF, param_index: 0, normalized_value: 0.5 },
        { id: "mix", fx_ref: FX_REF, param_ident: "mix", normalized_value: 0.25 },
      ],
    },
    context: { request_id: "native-batch-test", created_at: "2026-07-28T00:00:00.000Z" },
    budget: { max_response_bytes: 65_536 },
  };
}

function nativeRows(input) {
  return input.assignments.map((row) => ({
    ...row,
    param_index: row.param_index ?? (row.id === "mix" ? 1 : 0),
    param_ident: row.param_ident ?? (row.id === "gain" ? "gain" : "mix"),
    name: row.id,
    normalized_value: row.normalized_value,
    formatted_value: String(row.normalized_value),
    requested_formatted_value: String(row.normalized_value),
    tolerance: 0.001,
    verification_mode: "numeric_tolerance",
    updated: true,
  }));
}

function indexRuntime() {
  return {
    calls: 0,
    invalidateScopes({ scopes }) {
      this.calls += 1;
      return { ok: true, scopes };
    },
  };
}

async function run({ dryRun = false, nativeResult } = {}) {
  const calls = [];
  const index = indexRuntime();
  const nativeBatchExecutor = async (child) => {
    calls.push(child);
    return nativeResult ?? {
      ok: true,
      result: { readback: { rows: nativeRows({ assignments: child.input.batch }), mutation_attempted: !dryRun } },
    };
  };
  const response = await executeExactAssignmentsBatch({
    request: request(dryRun),
    executeAtomic: async () => ({ ok: false, error: { code: "FALLBACK_UNEXPECTED", message: "native path expected" } }),
    nativeBatchExecutor,
    projectIndexRuntime: index,
    entry: ENTRY,
    startedAt: "2026-07-28T00:00:00.000Z",
    stages: [],
    state: state(),
    listBudget: {},
    readBudget: {},
    now: () => new Date("2026-07-28T00:00:00.000Z"),
    monoNow: (() => {
      let tick = 0;
      return () => ++tick;
    })(),
  });
  return { response, calls, index };
}

describe("E2 FX native assignment batch", () => {
  it("dispatches once and invalidates Project Index once after aggregate truth", async () => {
    const { response, calls, index } = await run();
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, ALPHA3_4_D2_FX_NATIVE_BATCH_TEMPLATE_ID);
    assert.equal(calls[0].input.batch.length, 2);
    assert.equal(Object.hasOwn(calls[0].input.batch[0], "requested_formatted_value"), false);
    assert.equal(Object.hasOwn(calls[0].input.batch[1], "requested_formatted_value"), false);
    assert.equal(response.result.data.calls.native_batch, 1);
    assert.equal(response.result.data.calls.mutation, 0);
    assert.equal(response.result.data.calls.readback, 0);
    assert.equal(index.calls, 1);
  });

  it("keeps dry_run at zero writes and does not stale Project Index", async () => {
    const { response, calls, index } = await run({ dryRun: true });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.dry_run, true);
    assert.equal(response.result.changes.every((row) => row.status === "planned"), true);
    assert.equal(response.result.data.calls.mutation, 0);
    assert.equal(response.result.data.calls.readback, 0);
    assert.equal(index.calls, 0);
  });

  it("fails closed and invalidates once for an unknown native outcome", async () => {
    const { response, index } = await run({
      nativeResult: {
        ok: false,
        error: {
          code: "BRIDGE_TIMEOUT",
          message: "native result unavailable",
          details: { mutation_outcome: "unknown" },
        },
      },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "BRIDGE_TIMEOUT");
    assert.equal(response.result.changes.every((row) => row.status === "unknown_or_partial"), true);
    assert.equal(index.calls, 1);
  });

  it("rejects a partial aggregate readback as untrusted", async () => {
    const { response, index } = await run({
      nativeResult: { ok: true, result: { readback: { rows: [] } } },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "FX_ASSIGNMENTS_NATIVE_BATCH_PARTIAL");
    assert.equal(index.calls, 1);
  });

  it("keeps the typed descriptor and Lua route generic", () => {
    const descriptor = createWave2AFxTemplates().find((entry) => entry.id === ALPHA3_4_D2_FX_NATIVE_BATCH_TEMPLATE_ID);
    assert.equal(descriptor?.bridge.capability, ALPHA3_4_D2_FX_NATIVE_BATCH_CAPABILITY);
    assert.equal(descriptor?.refs.input[0].kind, "fx");
    const lua = readFileSync(new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url), "utf8");
    assert.match(lua, /e2_fx_parameter_assignments_batch/);
    assert.match(lua, /E2_FX_PARAMETER_ASSIGNMENTS_BATCH_CHUNK_SIZE/);
    assert.doesNotMatch(lua, /MCP|transport request|executeAtomic/iu);
  });

  it("parses exact Track/Take refs and preserves typed zero-write failures", () => {
    const source = readFileSync(new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url), "utf8");
    const start = source.indexOf("local function e2_fx_batch_error");
    const end = source.indexOf("\nlocal function e2_fx_batch_validate_rows", start);
    assert.ok(start >= 0 && end > start);
    const extracted = source.slice(start, end);
    runLua(String.raw`
      local function is_object(value) return type(value) == "table" end
      local function is_string(value) return type(value) == "string" end
      local function is_json_array(value) return type(value) == "table" end
      local function e2_fx_read_error(code, message, details)
        return nil, { code = code, message = message, details = details or {} }
      end
      ${extracted}
      local track = {
        kind = "fx",
        ref = "fx:track:guid:{TRACK-01}:0",
        identity = { scheme = "track_fx", value = "track:guid:{TRACK-01}:0" },
      }
      local take = {
        kind = "fx",
        ref = "fx:take:guid:{TAKE-01}:0",
        identity = { scheme = "take_fx", value = "take:guid:{TAKE-01}:0" },
      }
      local owner_kind, owner_ref, slot = e2_fx_batch_exact_ref(track)
      assert(owner_kind == "track" and owner_ref == "track:guid:{TRACK-01}" and slot == 0)
      owner_kind, owner_ref, slot = e2_fx_batch_exact_ref(take)
      assert(owner_kind == "take" and owner_ref == "take:guid:{TAKE-01}" and slot == 0)
      local ref_map, failure = e2_fx_batch_ref_map({ refs = { take } })
      assert(ref_map ~= nil and failure == nil and ref_map[take.ref] == take)
      ref_map, failure = e2_fx_batch_ref_map({ refs = {
        { kind = "fx", ref = take.ref, identity = { scheme = "track_fx", value = "take:guid:{TAKE-01}:0" } },
      } })
      assert(ref_map == nil and type(failure) == "table" and failure.code == "FX_REF_INVALID")
    `);
  });

  it("keeps the ReaEQ profile strict, owner-generic, and named-config bounded", () => {
    const source = readFileSync(new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url), "utf8");
    const start = source.indexOf("local E2_FX_REAEQ_BAND_MAX");
    const end = source.indexOf("\nlocal function reorder_fx", start);
    assert.ok(start >= 0 && end > start);
    const extracted = source.slice(start, end);
    assert.match(source, /TakeFX_SetParam/);
    assert.match(source, /TrackFX_SetParam/);
    assert.match(source, /TakeFX_SetNamedConfigParm/);
    assert.match(source, /TrackFX_SetNamedConfigParm/);
    assert.match(extracted, /BANDTYPE/);
    assert.match(extracted, /BANDENABLED/);
    assert.match(extracted, /type_raw = type_raw or JSON_NULL/);
    assert.match(extracted, /enabled_raw = enabled_raw or JSON_NULL/);
    assert.doesNotMatch(extracted, /Main_OnCommand|SetParamNormalized|reaper\.ini|SWS|ReaPack/u);
    assert.doesNotMatch(extracted, /request\.params\.(?:key|named_config|parmname)/u);
    assert.ok(extracted.indexOf("e2_fx_reaeq_validate_request(request") < extracted.indexOf("local mutation_started"));
  });

  it("maps only approved Cockos ReaEQ identities and the six public topologies", () => {
    const source = readFileSync(new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url), "utf8");
    const start = source.indexOf("local E2_FX_REAEQ_BAND_MAX");
    const end = source.indexOf("\nlocal function e2_fx_reaeq_band_key", start);
    assert.ok(start >= 0 && end > start);
    const extracted = source.slice(start, end);
    runLua(String.raw`
      ${extracted}
      assert(E2_FX_REAEQ_BAND_MAX == 4)
      assert(e2_fx_reaeq_identity_allowed("VST: ReaEQ (Cockos)"))
      assert(e2_fx_reaeq_identity_allowed("VST3:ReaEQ (Cockos)"))
      assert(e2_fx_reaeq_identity_allowed("AU: ReaEQ (Cockos)"))
      assert(e2_fx_reaeq_identity_allowed("/Applications/REAPER.app/Contents/Plugins/FX/reaeq.vst.dylib<1919247729"))
      assert(e2_fx_reaeq_identity_allowed([[C:\Program Files\REAPER (x64)\Plugins\FX\reaeq.vst.dll<1919247729]]))
      assert(e2_fx_reaeq_identity_allowed([[C:\Program Files\REAPER (x64)\Plugins\FX\reaeq.dll<1919247729]]))
      assert(not e2_fx_reaeq_identity_allowed("VST3:OtherEQ (Cockos)"))
      assert(not e2_fx_reaeq_identity_allowed("/tmp/reaeq.vst.dylib<1"))
      assert(not e2_fx_reaeq_identity_allowed("/tmp/not-reaeq.vst.dylib<1919247729"))
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.high_pass == 0)
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.low_shelf == 1)
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.band == 2)
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.notch == 3)
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.high_shelf == 4)
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.low_pass == 5)
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[0] == "low_shelf")
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[1] == "high_shelf")
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[3] == "low_pass")
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[4] == "high_pass")
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[6] == "notch")
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[8] == "band")
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[2] == nil)
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[5] == nil)
      assert(E2_FX_REAEQ_READ_TYPE_NAMES[7] == nil)
      assert(E2_FX_REAEQ_WRITE_TYPE_VALUES.arbitrary == nil)
    `);
  });

  it("accepts only exact ReaEQ semantic idents with an optional matching native index prefix", () => {
    const source = readFileSync(new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url), "utf8");
    const start = source.indexOf("local function e2_fx_reaeq_expected_ident");
    const end = source.indexOf("\nlocal function e2_fx_reaeq_inventory", start);
    assert.ok(start >= 0 && end > start);
    const extracted = source.slice(start, end);
    runLua(String.raw`
      local E2_FX_REAEQ_IDENT_TOKENS = {
        high_pass = "High_Pass",
        low_shelf = "Low_Shelf",
        band = "Band",
        notch = "Notch",
        high_shelf = "High_Shelf",
        low_pass = "Low_Pass",
      }
      ${extracted}
      local expected = e2_fx_reaeq_expected_ident(1, "frequency_hz", "low_shelf")
      assert(expected == "_Freq_Low_Shelf")
      assert(e2_fx_reaeq_ident_matches(0, "_Freq_Low_Shelf", expected))
      assert(e2_fx_reaeq_ident_matches(0, "0:_Freq_Low_Shelf", expected))
      assert(not e2_fx_reaeq_ident_matches(0, "1:_Freq_Low_Shelf", expected))
      assert(not e2_fx_reaeq_ident_matches(0, "0:_Freq_High_Pass", expected))
      assert(not e2_fx_reaeq_ident_matches(0, "prefix:_Freq_Low_Shelf", expected))
    `);
  });
});
