import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const POLICY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/d17_midi_edit_route.lua", import.meta.url),
  "utf8",
);
const LIST_NOTES_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_notes.lua", import.meta.url),
  "utf8",
);
const LIST_CC_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_cc_events.lua", import.meta.url),
  "utf8",
);
const LIST_TEXT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_text_sysex_events.lua", import.meta.url),
  "utf8",
);

const MIDI_READ_PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" end
function is_non_negative_integer(value) return type(value) == "number" and value >= 0 and value == math.floor(value) end
function json_array(value) return value or {} end
function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then return value end
  end
  return nil
end
function bounded_string(value, max_length)
  if value == nil then return "" end
  local text = tostring(value)
  if #text <= (max_length or 160) then return text end
  return string.sub(text, 1, (max_length or 160) - 3) .. "..."
end
function safe_budget(request)
  return request.budget or { max_items = 100, max_response_bytes = 65536, max_inline_value_bytes = 2048 }
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end

READ_B_MIDI = {}
function READ_B_MIDI.handler_error(code, message, details, recoverable)
  return nil, { code = code, message = message, details = details or {}, recoverable = recoverable ~= false }
end
function READ_B_MIDI.bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then limit = requested end
  return math.max(1, math.min(limit, budget.max_items, hard_limit or budget.max_items))
end
function READ_B_MIDI.integer_value(value)
  if type(value) == "number" and value == math.floor(value) then return value end
  return nil
end
function READ_B_MIDI.resolve_midi_take_for_request() return take, nil end
function READ_B_MIDI.take_ref_string() return "take:guid:{D17-READ}" end

function make_request(params)
  return { params = params or {}, budget = { max_items = 100, max_response_bytes = 65536, max_inline_value_bytes = 2048 } }
end

take = { id = "take" }
notes = {
  { false, false, 0, 120, 0, 60, 90 },
  { false, false, 120, 240, 0, 61, 91 },
  { false, false, 240, 360, 0, 62, 92 },
  { false, false, 360, 480, 0, 63, 93 },
  { false, false, 480, 600, 0, 64, 94 },
}
cc_events = {
  { false, false, 0, 176, 0, 7, 10 },
  { false, false, 120, 176, 0, 10, 20 },
  { false, false, 240, 176, 0, 7, 30 },
  { false, false, 360, 176, 0, 7, 40 },
  { false, false, 480, 176, 0, 10, 50 },
}
text_events = {
  { false, false, 0, 1, "one" },
  { false, false, 120, 5, "lyric" },
  { false, false, 240, 1, "two" },
  { false, false, 360, -1, "sysex" },
  { false, false, 480, 1, "three" },
}
reaper = {}
reaper.MIDI_CountEvts = function(candidate)
  assert(candidate == take)
  return true, #notes, #cc_events, #text_events
end
reaper.MIDI_GetNote = function(candidate, index)
  assert(candidate == take)
  local row = notes[index + 1]
  if not row then return false end
  return true, row[1], row[2], row[3], row[4], row[5], row[6], row[7]
end
reaper.MIDI_GetCC = function(candidate, index)
  assert(candidate == take)
  local row = cc_events[index + 1]
  if not row then return false end
  return true, row[1], row[2], row[3], row[4], row[5], row[6], row[7]
end
reaper.MIDI_GetTextSysexEvt = function(candidate, index)
  assert(candidate == take)
  local row = text_events[index + 1]
  if not row then return false end
  return true, row[1], row[2], row[3], row[4], row[5]
end
`;

const CAPABILITIES = Object.freeze([
  "midi.set_notes_batch",
  "midi.quantize_notes",
  "midi.quantize_selected_notes",
  "midi.set_cc_events_batch",
]);

describe("D17 MIDI edit live handler expansion", () => {
  it("registers exactly the bounded D17 MIDI edit batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d17-midi-edit-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the four D17 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS, [
      "template.midi.set_notes_batch",
      "template.midi.quantize_notes",
      "template.midi.quantize_selected_notes",
      "template.midi.set_cc_events_batch",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d17Input(id),
        refs: { take_ref: TAKE_REF },
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(CAPABILITIES.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "midi");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.some((ref) => ref.kind === "take" && ref.ref === TAKE_REF.ref), true);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
  });

  it("binds MIDI edit handlers through extracted Lua without raw execution surfaces", () => {
    for (const [capability, handler] of [
      ["midi.set_notes_batch", "d17_midi_set_notes_batch"],
      ["midi.quantize_notes", "d17_midi_quantize_notes"],
      ["midi.quantize_selected_notes", "d17_midi_quantize_selected_notes"],
      ["midi.set_cc_events_batch", "d17_midi_set_cc_events_batch"],
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "MIDI_GetNote",
      "MIDI_SetNote",
      "MIDI_GetCC",
      "MIDI_SetCC",
      "MIDI_Sort",
      "MIDI_GetGrid",
      "STALE_TAKE_HASH",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });

  it("paginates note, filtered CC, and filtered text reads without overlap", () => {
    runMidiReadLua(`
local first_notes, failure = list_take_notes(make_request({ limit = 2 }))
assert(failure == nil and first_notes.returned_count == 2 and first_notes.next_cursor == "2" and first_notes.truncated == true)
assert(first_notes.notes[1].index == 0 and first_notes.notes[2].index == 1)
local second_notes = list_take_notes(make_request({ limit = 2, cursor = first_notes.next_cursor }))
assert(second_notes.notes[1].index == 2 and second_notes.notes[2].index == 3 and second_notes.next_cursor == "4")
local third_notes = list_take_notes(make_request({ limit = 2, cursor = second_notes.next_cursor }))
assert(third_notes.returned_count == 1 and third_notes.notes[1].index == 4 and third_notes.truncated == false and third_notes.next_cursor == nil)
local null_cursor_notes = list_take_notes(make_request({ limit = 1, cursor = JSON_NULL }))
assert(null_cursor_notes.notes[1].index == 0)
local empty_cursor_notes = list_take_notes(make_request({ limit = 1, cursor = "" }))
assert(empty_cursor_notes.notes[1].index == 0)

local first_cc = list_take_cc_events(make_request({ limit = 2, controller = 7 }))
assert(first_cc.returned_count == 2 and first_cc.next_cursor == "2" and first_cc.truncated == true)
assert(first_cc.cc_events[1].index == 0 and first_cc.cc_events[2].index == 2)
local second_cc = list_take_cc_events(make_request({ limit = 2, controller = 7, cursor = first_cc.next_cursor }))
assert(second_cc.returned_count == 1 and second_cc.cc_events[1].index == 3 and second_cc.truncated == false and second_cc.next_cursor == nil)

local first_text = list_take_text_sysex_events(make_request({ limit = 2, event_kind = "text" }))
assert(first_text.returned_count == 2 and first_text.next_cursor == "2" and first_text.truncated == true)
assert(first_text.events[1].index == 0 and first_text.events[2].index == 2)
local second_text = list_take_text_sysex_events(make_request({ limit = 2, event_kind = "text", cursor = first_text.next_cursor }))
assert(second_text.returned_count == 1 and second_text.events[1].index == 4 and second_text.truncated == false and second_text.next_cursor == nil)
`);
  });

  it("returns PARAMS_INVALID for non-decimal MIDI read cursors", () => {
    runMidiReadLua(`
for _, cursor in ipairs({ "-1", "1.5", "abc", 1 }) do
  local summary, failure = list_take_notes(make_request({ cursor = cursor }))
  assert(summary == nil and failure.code == "PARAMS_INVALID" and failure.details.reason_code == "CURSOR_INVALID")
  summary, failure = list_take_cc_events(make_request({ cursor = cursor, controller = 7 }))
  assert(summary == nil and failure.code == "PARAMS_INVALID" and failure.details.reason_code == "CURSOR_INVALID")
  summary, failure = list_take_text_sysex_events(make_request({ cursor = cursor, event_kind = "text" }))
  assert(summary == nil and failure.code == "PARAMS_INVALID" and failure.details.reason_code == "CURSOR_INVALID")
end
`);
  });
});

function runMidiReadLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = [
    MIDI_READ_PRELUDE,
    LIST_NOTES_SOURCE,
    LIST_CC_SOURCE,
    LIST_TEXT_SOURCE,
    body,
    "return true",
  ].join("\n");
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

const TAKE_REF = createObjectRef("take", { scheme: "guid", value: "{D17-TAKE}" }, {
  ref: "take:guid:{D17-TAKE}",
});

function d17Input(id) {
  if (id === "template.midi.set_notes_batch") {
    return { expected_take_hash: "take:guid:{D17-TAKE}:1:1:0", notes: [{ index: 0, velocity: 100 }] };
  }
  if (id === "template.midi.quantize_notes") {
    return { grid_unit: "ppq", grid_ppq: 120, strength: 1, preserve_duration: true, expected_take_hash: "take:guid:{D17-TAKE}:1:1:0" };
  }
  if (id === "template.midi.quantize_selected_notes") {
    return { grid_unit: "ppq", grid_ppq: 120, strength: 1, preserve_duration: true, require_selected_notes: true, expected_take_hash: "take:guid:{D17-TAKE}:1:1:0" };
  }
  return { expected_take_hash: "take:guid:{D17-TAKE}:1:1:0", events: [{ index: 0, value: 96 }] };
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
