import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
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
  new URL("../../reaper/bridge/src/handlers/items/d15_items_source_phase_route.lua", import.meta.url),
  "utf8",
);
const MEDIA_HELPER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/media/probe_file.lua", import.meta.url),
  "utf8",
);
const ENVELOPE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/20-bridge-envelope-kernel.lua", import.meta.url), "utf8");
const POLICY_FULL_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");

const WRITE_CAPABILITIES = Object.freeze([
  "items.set_no_autofades",
  "items.set_invert_phase",
  "items.choose_new_source_file",
]);

describe("D15 items source/phase live handler expansion", () => {
  it("registers exactly the bounded D15 items source/phase batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.equal(registry.entries.length, 235);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.match(BRIDGE_SOURCE, /template_count = 235/);
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d15-items-source-phase-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the three D15 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS, [
      "template.items.set_no_autofades",
      "template.items.set_invert_phase",
      "template.items.choose_new_source_file",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d15Input(id),
        refs: d15Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(WRITE_CAPABILITIES.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), WRITE_CAPABILITIES);

    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.some((ref) => ref.kind === "item" && ref.ref === ITEM_REF.ref), true);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(bridge.seen[2].refs.some((ref) => ref.kind === "file" && ref.ref === FILE_REF.ref), true);
  });

  it("binds source/phase handlers through extracted Lua without raw execution surfaces", () => {
    for (const [capability, handler] of [
      ["items.set_no_autofades", "d15_items_set_no_autofades"],
      ["items.set_invert_phase", "d15_items_set_invert_phase"],
      ["items.choose_new_source_file", "d15_items_choose_new_source_file"],
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "D_FADEINLEN_AUTO",
      "D_FADEOUTLEN_AUTO",
      "D_VOL",
      "PCM_Source_CreateFromFile",
      "SetMediaItemTake_Source",
      "GetMediaItemTake_Source",
      "GetMediaSourceFileName",
      "PCM_Source_Destroy",
      "VERIFICATION_FAILED",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });

  it("uses the frozen canonical media identity and complete-envelope preflight before Undo", () => {
    assert.match(HANDLER_SOURCE, /d15_items_file_object_ref\(filename\)/);
    assert.match(HANDLER_SOURCE, /return READ_B_MEDIA\.file_object_ref\(path_value\)/);
    assert.doesNotMatch(HANDLER_SOURCE, /item:unknown/);
    assert.doesNotMatch(HANDLER_SOURCE, /bounded_string\(path_value, 220\)/);
    assert.match(ROUTE_SOURCE, /local d15_source_relink = capability == "items\.choose_new_source_file"/);
    assert.match(ROUTE_SOURCE, /READ_B_MEDIA\.file_path_from_request_refs_strict\(request\)/);
    assert.match(ROUTE_SOURCE, /READ_B_MEDIA\.ensure_identity_inline_budget\(request, path_value\)/);
    assert.match(ROUTE_SOURCE, /READ_B_MEDIA\.complete_success_envelope_fits\(request, summary, refs/);
    assert.match(ROUTE_SOURCE, /request\.__openreaper_d15_source_path = path/);
    assert.match(ROUTE_SOURCE, /blocker = "malformed_file_ref"/);
    assert.match(ROUTE_SOURCE, /request\.__openreaper_d15_item_object_ref = refs\[1\]/);
    assert.match(HANDLER_SOURCE, /blocker = "timing_restore_failed"/);
    assert.match(HANDLER_SOURCE, /blocker = "timing_readback_mismatch"/);
    assert.ok(ROUTE_SOURCE.indexOf("local d15_source_relink") < ROUTE_SOURCE.indexOf("open_required_undo_block(request, key)"));
  });

  it("executes the D15 product handler in Fengari with complete Unicode identity and truthful fallback", () => {
    const longPath = "/tmp/OpenReaper 中文 空格/" + "分段素材 " .repeat(45) + "final.wav";
    assert.ok(Buffer.byteLength(longPath) > 240);
    runD15Lua(`
local path = ${JSON.stringify(longPath)}
existing_files[path] = true
local item = { guid = "{D15}" }
local take = { source = { path = "/tmp/old.wav" } }
items = { item }
active_take = take
local req = request_for(path)
local summary, failure, _, _, refs = d15_items_choose_new_source_file(req)
assert(failure == nil, "failure " .. (failure and failure.message or "ok"))
assert(summary.file_ref == "file:path:" .. path, "file")
assert(refs[2].ref == "file:path:" .. path and refs[2].identity.value == path, "refs")
assert(calls.create == 1 and calls.set_source == 1 and calls.update == 1, "counts " .. calls.create .. ":" .. calls.set_source .. ":" .. calls.update)
assert(summary.item_ref == "item:guid:{D15}", "guid " .. tostring(summary.item_ref))

item.guid = string.rep("G", 241)
calls = { create = 0, set_source = 0, update = 0 }
local indexed_summary, indexed_failure = d15_items_choose_new_source_file(request_for(path))
assert(indexed_failure == nil, indexed_failure and indexed_failure.message or "ok")
assert(indexed_summary.item_ref == "item:index:0")
items = {}
calls = { create = 0, set_source = 0, update = 0 }
local missing_summary, missing_failure = d15_items_choose_new_source_file(request_for(path))
assert(missing_summary == nil and missing_failure.code == "ITEM_NOT_FOUND")
assert(calls.create == 0 and calls.set_source == 0 and calls.update == 0)
`);
  });

  it("runs real D15 dispatch/Undo composition with complete path and budget truth", () => {
    runD15DispatchLua(`
local posix = "/tmp/d15 中文 source.wav"
local windows = "C:" .. string.char(92) .. "source.wav"
local unc = string.char(92) .. string.char(92) .. "server" .. string.char(92) .. "share" .. string.char(92) .. "source.wav"
local long_path = "/tmp/" .. string.rep("中文 空格/", 32) .. "final.wav"
assert(#long_path > 240)

for _, bad in ipairs({
  { value = "relative.wav", blocker = "relative_path" },
  { value = "", blocker = "empty_path" },
  { value = "bad\\0path", blocker = "nul_char" },
}) do
  reset_state()
  local terminal = dispatch_request(request_for(bad.value), "cmd_d15_bad", nil, { started_at = now_iso() })
  assert_error(terminal, "bad_path", "PARAMS_INVALID", bad.blocker, true)
  assert_zero_write("bad_path")
end

local contradictory = request_for(posix)
contradictory.refs[2].identity.value = "/tmp/other.wav"
reset_state()
assert_error(dispatch_request(contradictory, contradictory.id, nil, { started_at = now_iso() }), "contradictory", "PARAMS_INVALID", "contradictory_file_ref", true)
assert_zero_write("contradictory")

local duplicate = request_for(posix)
duplicate.refs[3] = { kind = "file", ref = "file:path:/tmp/other.wav", identity = { scheme = "path", value = "/tmp/other.wav" } }
reset_state()
assert_error(dispatch_request(duplicate, duplicate.id, nil, { started_at = now_iso() }), "duplicate", "PARAMS_INVALID", "contradictory_file_ref", true)
assert_zero_write("duplicate")

for _, malformed in ipairs({
  function(request) request.refs[2].ref = "garbage" end,
  function(request) request.refs[2].identity = nil end,
  function(request) request.refs[2].identity.scheme = "guid" end,
}) do
  local request = request_for(posix)
  malformed(request)
  reset_state()
  assert_error(dispatch_request(request, request.id, nil, { started_at = now_iso() }), "malformed", "PARAMS_INVALID", "malformed_file_ref", true)
  assert_zero_write("malformed")
end

for _, accepted in ipairs({ posix, windows, unc, long_path }) do
  reset_state(accepted)
  assert_success(dispatch_request(request_for(accepted), "cmd_d15_ok", nil, { started_at = now_iso() }), "accepted", accepted, "item:guid:{D15}")
  assert_success_writes("accepted")
end

local inline_exact = request_for(posix)
inline_exact.budget.max_inline_value_bytes = #( "file:path:" .. posix )
reset_state(posix)
assert_success(dispatch_request(inline_exact, inline_exact.id, nil, { started_at = now_iso() }), "inline_exact", posix, "item:guid:{D15}")
assert_success_writes("inline_exact")

local inline_short = request_for(posix)
inline_short.budget.max_inline_value_bytes = #( "file:path:" .. posix ) - 1
reset_state(posix)
assert_error(dispatch_request(inline_short, inline_short.id, nil, { started_at = now_iso() }), "inline_short", "RESPONSE_TOO_LARGE", "exact_file_ref_exceeds_inline_budget", true)
assert_zero_write("inline_short")

local response_exact = request_for(long_path)
response_exact.budget.max_response_bytes = minimum_success_budget(response_exact, long_path)
reset_state(long_path)
assert_success(dispatch_request(response_exact, response_exact.id, nil, { started_at = now_iso() }), "response_exact", long_path, "item:guid:{D15}")
assert_success_writes("response_exact")

local response_short = request_for(long_path)
response_short.budget.max_response_bytes = response_exact.budget.max_response_bytes - 1
reset_state(long_path)
assert_error(dispatch_request(response_short, response_short.id, nil, { started_at = now_iso() }), "response_short", "RESPONSE_TOO_LARGE", "success_envelope_budget_insufficient", true)
assert_zero_write("response_short")

item.guid = string.rep("G", READ_B_MEDIA.mutation_guid_max_bytes() + 1)
prove_item_index = false
reset_state(posix, true)
local identity_request = request_for(posix)
identity_request.refs[1] = { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } }
local identity_missing = dispatch_request(identity_request, "cmd_d15_identity", nil, { started_at = now_iso() })
assert_error(identity_missing, "identity_missing", "ITEM_NOT_FOUND", "item_identity_unavailable", true)
assert_zero_write("identity_missing")

prove_item_index = true
reset_state(posix, true)
local index_success = dispatch_request(request_for(posix), "cmd_d15_index", nil, { started_at = now_iso() })
assert_success(index_success, "index_success", posix, "item:index:0")
assert_success_writes("index_success")
prove_item_index = true
item.guid = "{D15}"

identity_reads_fail_after_source_set = true
reset_state(posix, true)
local cached_identity = dispatch_request(request_for(posix), "cmd_d15_cached", nil, { started_at = now_iso() })
assert_success(cached_identity, "cached_identity", posix, "item:guid:{D15}")
assert_success_writes("cached_identity")
identity_reads_fail_after_source_set = false

fail_source_set = true
reset_state(posix, true)
assert_error(dispatch_request(request_for(posix), "cmd_d15_source_set", nil, { started_at = now_iso() }), "source_set_failed", "COMMAND_FAILED", "source_relink_rejected", false)
assert(undo_begins == 1 and undo_ends == 1 and calls.create == 1 and calls.set_source == 1 and calls.destroy == 1)
assert((calls.set_take_info or 0) == 0 and (calls.set_item_info or 0) == 0 and (calls.update or 0) == 0)
fail_source_set = false

fail_timing_read = true
reset_state(posix, true)
local timing_read_failed = dispatch_request(request_for(posix), "cmd_d15_timing_read", nil, { started_at = now_iso() })
assert_error(timing_read_failed, "timing_read_failed", "COMMAND_FAILED", "timing_read_failed_before_mutation")
assert(undo_begins == 1 and undo_ends == 1)
assert_native_zero("timing_read_failed")
fail_timing_read = false

fail_timing_set = true
reset_state(posix, true)
assert_error(dispatch_request(request_for(posix), "cmd_d15_timing_set", nil, { started_at = now_iso() }), "timing_set_failed", "COMMAND_FAILED", "timing_restore_failed", false)
assert(undo_begins == 1 and undo_ends == 1 and calls.create == 1 and calls.set_source == 1)
assert((calls.destroy or 0) == 0 and (calls.update or 0) == 0)
fail_timing_set = false

fail_update = true
reset_state(posix, true)
assert_error(dispatch_request(request_for(posix), "cmd_d15_update", nil, { started_at = now_iso() }), "update_failed", "COMMAND_FAILED", "item_update_failed", false)
assert(undo_begins == 1 and undo_ends == 1 and calls.update == 1)
fail_update = false

timing_readback_mismatch = true
reset_state(posix, true)
assert_error(dispatch_request(request_for(posix), "cmd_d15_timing_verify", nil, { started_at = now_iso() }), "timing_readback", "VERIFICATION_FAILED", "timing_readback_mismatch", false)
assert_success_writes("timing_readback")
timing_readback_mismatch = false

fail_undo = true
reset_state(posix, true)
local undo_failed = dispatch_request(request_for(posix), "cmd_d15_undo", nil, { started_at = now_iso() })
assert_error(undo_failed, "undo_failed", "COMMAND_FAILED", "required_undo_begin_failed", true)
assert(undo_begin_attempts == 2 and undo_ends == 0, "undo attempts")
assert_native_zero("undo_failed")
fail_undo = false
`);
  });
});

function runD15Lua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = String.raw`
JSON_NULL = {}
JSON_ARRAY_MT = { __openreaper_json_array = true }
function json_array(v) return setmetatable(v or {}, JSON_ARRAY_MT) end
function is_json_array(v) return type(v) == "table" and getmetatable(v) == JSON_ARRAY_MT end
function is_object(v) return type(v) == "table" and v ~= JSON_NULL end
function is_string(v) return type(v) == "string" and v:match("%S") ~= nil end
function is_non_negative_integer(v) return type(v) == "number" and v >= 0 and v == math.floor(v) end
function first_number(v) return type(v) == "number" and v or nil end
function first_string(v) return type(v) == "string" and v or nil end
function bounded_string(v, n) local s=tostring(v or ""); return #s<=n and s or s:sub(1,n-3).."..." end
function safe_budget(r) local b=r.budget or {}; return { max_response_bytes=b.max_response_bytes or 65536, max_items=b.max_items or 50, max_inline_value_bytes=b.max_inline_value_bytes or 4096 } end
json = { encode = function(v) if type(v) == "string" then return '"' .. v .. '"' end return "{}" end }
function file_exists(path) return existing_files[path] == true end
existing_files = {}; items = {}; active_take = nil; calls = { create=0,set_source=0,update=0 }
function call_reaper(name, ...)
  local a={...}
  if name == "BR_GetMediaItemGUID" then return true, a[1].guid end
  if name == "GetSetMediaItemInfo_String" then return true, true, a[1].guid end
  if name == "CountMediaItems" then return true, #items end
  if name == "GetMediaItem" then return true, items[a[2]+1] end
  if name == "GetActiveTake" then return true, active_take end
  if name == "PCM_Source_CreateFromFile" then calls.create=calls.create+1; return true, { path=a[1] } end
  if name == "GetMediaItemTake_Source" then return true, a[1].source end
  if name == "SetMediaItemTake_Source" then calls.set_source=calls.set_source+1; a[1].source=a[2]; return true, true end
  if name == "GetMediaSourceFileName" then return true, a[1].path end
  if name == "GetMediaItemTakeInfo_Value" or name == "GetMediaItemInfo_Value" then return true, 0 end
  if name == "UpdateItemInProject" then calls.update=calls.update+1; return true end
  if name == "SetMediaItemTakeInfo_Value" or name == "SetMediaItemInfo_Value" then return true, true end
  if name == "PCM_Source_Destroy" then return true end
  return false
end
${MEDIA_HELPER_SOURCE}
${HANDLER_SOURCE}
function request_for(path)
 return { pack={id="items",capability="items.choose_new_source_file",risk="write"}, params={preserve_timing=true}, budget={max_response_bytes=65536,max_items=50,max_inline_value_bytes=4096}, refs=json_array({ {kind="item",ref="item:index:0",identity={scheme="index",value="0"}}, {kind="file",ref="file:path:"..path,identity={scheme="path",value=path}} }) }
end
${body}
return true`;
  const loaded = lauxlib.luaL_loadstring(state, to_luastring(source));
  if (loaded !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
  const called = lua.lua_pcall(state, 0, 1, 0);
  if (called !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from) : source.length;
  if (from < 0 || to < 0) throw new Error(`missing product source slice ${start}`);
  return source.slice(from, to);
}

function runD15DispatchLua(body) {
  const d15Table = extract(ROUTE_SOURCE, "local D15_ITEMS_SOURCE_PHASE_HANDLERS = {", "\nlocal D16_");
  const dispatch = extract(ROUTE_SOURCE, "local function dispatch_template_execute", null);
  const handlerNames = [...ROUTE_SOURCE.matchAll(/handler = ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const stubs = [...new Set(handlerNames.filter((name) => !name.startsWith("d15_items_")))].map((name) => `function ${name}() return nil end`).join("\n");
  const handlerTableNames = [...dispatch.matchAll(/handler = ([A-Z][A-Z0-9_]+_HANDLERS)\[/g)].map((match) => match[1]);
  const handlerTableStubs = [...new Set(handlerTableNames.filter((name) => name !== "D15_ITEMS_SOURCE_PHASE_HANDLERS"))]
    .map((name) => `${name} = {}`)
    .join("\n");
  const source = String.raw`
ACTIVE_OWNER="owner"; ACTIVE_GENERATION=1; CONTRACT="foundation.bridge.v1"; DEFAULT_BUDGET={max_response_bytes=65536,max_items=50,max_inline_value_bytes=4096}; JSON_NULL={}
JSON_ARRAY_MT={__openreaper_json_array=true}; function json_array(v)return setmetatable(v or {},JSON_ARRAY_MT) end; function is_json_array(v)return type(v)=="table" and getmetatable(v)==JSON_ARRAY_MT end
function is_object(v)return type(v)=="table" and v~=JSON_NULL end; function is_string(v)return type(v)=="string" and v:match("%S")~=nil end; function is_non_negative_integer(v)return type(v)=="number" and v>=0 and v==math.floor(v) end; function is_request_id(v)return type(v)=="string" and v:match("^cmd_")~=nil end
function bounded_string(v,n)local s=tostring(v or "");return #s<=n and s or s:sub(1,n-3).."..." end; function first_number(v)return type(v)=="number" and v or nil end; function first_string(v)return type(v)=="string" and v or nil end; function now_iso() return "2026-07-21T00:00:00.000Z" end
json={}
local function encode_string(value)
  return '"' .. value:gsub('[%c\\"]', function(char)
    local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
    return escapes[char] or string.format("\\u%04x", string.byte(char))
  end) .. '"'
end
local encode_json
local function encode_array(value)
  local parts = {}
  for index = 1, #value do parts[#parts + 1] = encode_json(value[index]) end
  return "[" .. table.concat(parts, ",") .. "]"
end
local function encode_object(value)
  local keys = {}
  for key, nested in pairs(value) do
    if type(key) == "string" and nested ~= nil then keys[#keys + 1] = key end
  end
  table.sort(keys)
  local parts = {}
  for _, key in ipairs(keys) do parts[#parts + 1] = encode_string(key) .. ":" .. encode_json(value[key]) end
  return "{" .. table.concat(parts, ",") .. "}"
end
function encode_json(value)
  local kind = type(value)
  if value == JSON_NULL or kind == "nil" then return "null" end
  if kind == "string" then return encode_string(value) end
  if kind == "number" then return tostring(value) end
  if kind == "boolean" then return value and "true" or "false" end
  if kind == "table" then return is_json_array(value) and encode_array(value) or encode_object(value) end
  return "null"
end
function json.encode(value) return encode_json(value) end
function file_exists(p)return existing_files[p]==true end
existing_files={}; calls={}; undo_begin_attempts=0; undo_begins=0; undo_ends=0; fail_undo=false; prove_item_index=true
source_was_set=false; identity_reads_fail_after_source_set=false; fail_timing_read=false; fail_timing_set=false; fail_update=false; timing_readback_mismatch=false
fail_source_set=false
active_project={}; item={guid="{D15}",takes={}}; take={source={path="/tmp/old.wav"}}; item.takes={take}
ARTIFACT_PRODUCING_OPERATIONS = {}
function call_reaper(n,...)
 local a={...}
 if n=="EnumProjects" then return true,active_project,"/tmp/project.rpp" end
 if n=="Undo_BeginBlock" or n=="Undo_BeginBlock2" then
   undo_begin_attempts=undo_begin_attempts+1
   if fail_undo then return false end
   undo_begins=undo_begins+1
   return true
 end
 if n=="Undo_EndBlock" or n=="Undo_EndBlock2" then undo_ends=undo_ends+1; return true end
 if n=="CountMediaItems" then return true,(prove_item_index and not (identity_reads_fail_after_source_set and source_was_set)) and 1 or 0
 elseif n=="GetMediaItem" then return true,(prove_item_index and not (identity_reads_fail_after_source_set and source_was_set)) and item or nil
 elseif n=="GetSelectedMediaItem" then return true,item
 elseif n=="GetActiveTake" then return true,take
 elseif n=="BR_GetMediaItemGUID" then if identity_reads_fail_after_source_set and source_was_set then return false end; return true,item.guid
 elseif n=="GetSetMediaItemInfo_String" then if identity_reads_fail_after_source_set and source_was_set then return false end; return true,true,item.guid
 elseif n=="PCM_Source_CreateFromFile" then calls.create=(calls.create or 0)+1; return true,{path=a[1]}
 elseif n=="SetMediaItemTake_Source" then
   calls.set_source=(calls.set_source or 0)+1
   if fail_source_set then return true,false end
   a[1].source=a[2]; source_was_set=true; return true,true
 elseif n=="GetMediaItemTake_Source" then return true,a[1].source
 elseif n=="GetMediaSourceFileName" then return true,a[1].path
 elseif n=="SetMediaItemTakeInfo_Value" then calls.set_take_info=(calls.set_take_info or 0)+1; return true,not fail_timing_set
 elseif n=="SetMediaItemInfo_Value" then calls.set_item_info=(calls.set_item_info or 0)+1; return true,not fail_timing_set
 elseif n=="PCM_Source_Destroy" then calls.destroy=(calls.destroy or 0)+1; return true
 elseif n=="UpdateItemInProject" then calls.update=(calls.update or 0)+1; return not fail_update
 elseif n=="GetMediaItemTakeInfo_Value" or n=="GetMediaItemInfo_Value" then
   if fail_timing_read and not source_was_set then return false end
   if timing_readback_mismatch and source_was_set then return true,999 end
   return true,0
 end
 return false
end
${ENVELOPE_SOURCE}
${MEDIA_HELPER_SOURCE}
${HANDLER_SOURCE}
${POLICY_FULL_SOURCE}
${stubs}
${handlerTableStubs}
${d15Table}
${dispatch.replaceAll("local function dispatch_request", "function dispatch_request").replaceAll("local function dispatch_template_execute", "function dispatch_template_execute").replace("local ALLOWED_OPERATIONS = {", "ALLOWED_OPERATIONS = {")}
function request_for(path) return {contract=CONTRACT,id="cmd_d15_ok",created_at=now_iso(),timeout_ms=5000,client={id="test",session_id="s"},bridge={expected_owner=ACTIVE_OWNER,expected_generation=ACTIVE_GENERATION},operation={family="run_command",name="template.execute"},pack={id="items",capability="items.choose_new_source_file",risk="write"},params={preserve_timing=true},refs=json_array({{kind="item",ref="item:index:0",identity={scheme="index",value="0"}},{kind="file",ref="file:path:"..path,identity={scheme="path",value=path}}}),undo={mode="required",label="D15"},verification={mode="required",checks=json_array({})},artifacts={allow=false},budget={max_response_bytes=65536,max_items=50,max_inline_value_bytes=4096}} end
function reset_state(path, keep_flags)
  calls={}; undo_begin_attempts=0; undo_begins=0; undo_ends=0; source_was_set=false; take.source={path="/tmp/old.wav"}; existing_files={}
  if path then existing_files[path]=true end
  if not keep_flags then
    item.guid="{D15}"; prove_item_index=true; fail_undo=false; identity_reads_fail_after_source_set=false
    fail_source_set=false; fail_timing_read=false; fail_timing_set=false; fail_update=false; timing_readback_mismatch=false
  end
end
function assert_native_zero(label)
  for _, key in ipairs({"create","set_source","set_take_info","set_item_info","destroy","update"}) do
    assert((calls[key] or 0)==0,label..":"..key..":"..tostring(calls[key]))
  end
end
function assert_zero_write(label)
  assert(undo_begin_attempts==0 and undo_begins==0 and undo_ends==0,label..":undo")
  assert_native_zero(label)
end
function assert_success_writes(label)
  assert(undo_begin_attempts==1 and undo_begins==1 and undo_ends==1,label..":undo")
  for _, key in ipairs({"create","set_source","set_take_info","set_item_info","destroy","update"}) do
    assert(calls[key]==1,label..":"..key..":"..tostring(calls[key]))
  end
end
function assert_success(terminal,label,path,item_ref)
  assert(type(terminal)=="string" and terminal:find('"ok":true',1,true),label..":"..tostring(terminal))
  if path then
    assert(terminal:find(encode_string("file:path:"..path),1,true),label..":file_ref")
    assert(terminal:find(encode_string(path),1,true),label..":identity")
  end
  if item_ref then assert(terminal:find(encode_string(item_ref),1,true),label..":item_ref") end
end
function assert_error(terminal,label,code,blocker,zero_write)
  assert(type(terminal)=="string" and terminal:find('"ok":false',1,true),label..":"..tostring(terminal))
  if code then assert(terminal:find('"code":'..encode_string(code),1,true),label..":code:"..terminal) end
  if blocker then assert(terminal:find('"blocker":'..encode_string(blocker),1,true),label..":blocker:"..terminal) end
  if zero_write ~= nil then assert(terminal:find('"zero_write":'..tostring(zero_write),1,true),label..":zero_write:"..terminal) end
end
function minimum_success_budget(request,path)
  local item_ref="item:guid:"..item.guid
  local summary={item_ref=item_ref,file_ref="file:path:"..path,preserve_timing=true,capability=request.pack.capability,pack=request.pack.id,risk=request.pack.risk,readback_status="passed",undo_evidence="required",artifacts_allowed=false,truncated=false}
  local refs=json_array({{kind="item",ref=item_ref,identity={scheme="guid",value=item.guid}},{kind="file",ref="file:path:"..path,identity={scheme="path",value=path}}})
  for limit=1,65536 do
    request.budget.max_response_bytes=limit
    local required=READ_B_MEDIA.success_envelope_bytes(request,summary,refs,{undo_opened=true,undo_closed=true,verification_status="passed"})
    if required<=limit then return limit end
  end
  error("no success budget")
end
${body}
return true`;
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const loaded = lauxlib.luaL_loadstring(L, to_luastring(source));
  if (loaded !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  const called = lua.lua_pcall(L, 0, 1, 0);
  if (called !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  lua.lua_close(L);
}

const ITEM_REF = createObjectRef("item", { scheme: "guid", value: "{D15-ITEM}" }, {
  ref: "item:guid:{D15-ITEM}",
});
const FILE_REF = createObjectRef("file", { scheme: "path", value: "/tmp/openreaper-d15.wav" }, {
  ref: "file:path:/tmp/openreaper-d15.wav",
});

function d15Input(id) {
  if (id === "template.items.set_no_autofades") {
    return { no_autofades: true };
  }
  if (id === "template.items.set_invert_phase") {
    return { invert_phase: true };
  }
  if (id === "template.items.choose_new_source_file") {
    return { preserve_timing: true };
  }
  return {};
}

function d15Refs(id) {
  if (id === "template.items.choose_new_source_file") {
    return { item_ref: ITEM_REF, file_ref: FILE_REF };
  }
  return { item_ref: ITEM_REF };
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
