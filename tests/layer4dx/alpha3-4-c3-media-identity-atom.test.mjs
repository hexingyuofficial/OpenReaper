import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  WAVE2A_MEDIA_TEMPLATE_IDS,
  createWave2AMediaTemplates,
} from "../../packages/core/src/template-packs/wave2a-media-templates-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const PROBE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/media/probe_file.lua", import.meta.url),
  "utf8",
);
const TAKE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/media/read_take_source.lua", import.meta.url),
  "utf8",
);
const PROJECT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/media/read_project_media_files.lua", import.meta.url),
  "utf8",
);
const E3_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/media/e3_media_route.lua", import.meta.url),
  "utf8",
);
const BRIDGE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url),
  "utf8",
);
const REGISTRY = JSON.parse(
  readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url), "utf8"),
);

const LONG_SEGMENT = "path segment with spaces and 中文音频素材_abcdefghijklmnopqrstuvwxyz_0123456789_padding_segment_for_identity_roundtrip_extra_bytes";
const LONG_PATH = [
  "/Users/Shared/OpenReaper",
  "library session 演示资料",
  "nested folder 层级",
  "deep",
  "more nested 路径段",
  LONG_SEGMENT,
  LONG_SEGMENT,
  "clip 源文件 final.wav",
].join("/");
const SHORT_PATH = "/tmp/openreaper-short.wav";
const WIN_PATH = "C:\\Users\\Shared\\OpenReaper\\session 演示\\clip.wav";
const UNC_PATH = "\\\\server\\share\\session 演示\\clip.wav";
const RELATIVE_PATH = "relative/session 演示/clip.wav";
const FILE_REF_PREFIX = "file:path:";

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" and value:match("%S") ~= nil end
function is_object(value) return type(value) == "table" and value ~= JSON_NULL end
local JSON_ARRAY_MT = { __openreaper_json_array = true }
function is_json_array(value) return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT end
function is_non_negative_integer(value) return type(value) == "number" and value >= 0 and value == math.floor(value) end
function json_array(value) return setmetatable(value or {}, JSON_ARRAY_MT) end
function bounded_string(value, max_bytes)
  local text = type(value) == "string" and value or tostring(value or "")
  return #text <= max_bytes and text or text:sub(1, max_bytes - 3) .. "..."
end
function first_number(value) return type(value) == "number" and value or nil end
function first_string(value) return type(value) == "string" and value or nil end
function safe_budget(request)
  local budget = is_object(request and request.budget) and request.budget or {}
  return {
    max_response_bytes = is_non_negative_integer(budget.max_response_bytes) and budget.max_response_bytes > 0 and budget.max_response_bytes or 65536,
    max_items = is_non_negative_integer(budget.max_items) and budget.max_items > 0 and budget.max_items or 50,
    max_inline_value_bytes = is_non_negative_integer(budget.max_inline_value_bytes) and budget.max_inline_value_bytes > 0 and budget.max_inline_value_bytes or 2048,
  }
end
existing_files = {}
mutations = 0
folder_files = {}
function file_exists(path_value) return existing_files[path_value] == true end
function call_reaper(name, ...) return false end
reaper = {
  EnumerateFiles = function(folder, index)
    local files = folder_files[folder]
    if not files then return nil end
    return files[index + 1]
  end,
}
`;

function runLua(body) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const source = [
    PRELUDE,
    PROBE_SOURCE,
    TAKE_SOURCE,
    PROJECT_SOURCE,
    E3_SOURCE,
    body,
  ].join("\n");
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    throw new Error(message);
  }
}

function longPathExampleFromDescriptor() {
  const templates = createWave2AMediaTemplates();
  const probe = templates.find((entry) => entry.id === "template.media.probe_file");
  const example = probe.examples.find((entry) => entry.name === "probe_long_unicode_path");
  return example.input.path;
}

describe("Alpha3.4-C3 media canonical identity atom", () => {
  it("keeps public counts and embeds full-path identity helpers in generated bridge", () => {
    assert.equal(WAVE2A_MEDIA_TEMPLATE_IDS.length, 7);
    assert.equal(createWave2AMediaTemplates().length, 7);
    assert.equal(REGISTRY.entries.length, 241);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.equal(registry.entries.length, 241);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.match(BRIDGE_SOURCE, /function READ_B_MEDIA\.is_absolute_path/);
    assert.match(BRIDGE_SOURCE, /function READ_B_MEDIA\.file_ref_bytes/);
    assert.match(BRIDGE_SOURCE, /exact_file_ref_exceeds_inline_budget/);
    assert.match(BRIDGE_SOURCE, /MEDIA_FILE_REF_PREFIX_BYTES/);
    assert.ok(Buffer.byteLength(LONG_PATH, "utf8") > 240);
    assert.ok(Buffer.byteLength(longPathExampleFromDescriptor(), "utf8") > 240);
  });

  it("descriptor long-path example is proven >240 UTF-8 bytes", () => {
    const path = longPathExampleFromDescriptor();
    assert.equal(Buffer.byteLength(path, "utf8") > 240, true, `bytes=${Buffer.byteLength(path, "utf8")}`);
  });

  it("round-trips long multi-segment absolute paths with spaces and Chinese as complete file:path identities", () => {
    runLua(`
existing_files[${JSON.stringify(LONG_PATH)}] = true
local path = ${JSON.stringify(LONG_PATH)}
assert(#path > 240)
local file_ref = READ_B_MEDIA.file_ref_for_path(path)
assert(file_ref == "file:path:" .. path, tostring(file_ref))
assert(string.find(file_ref, "...", 1, true) == nil)
local object_ref = READ_B_MEDIA.file_object_ref(path)
assert(object_ref.ref == file_ref)
assert(object_ref.identity.scheme == "path")
assert(object_ref.identity.value == path)
call_reaper = function(name, ...)
  if name == "PCM_Source_CreateFromFile" then return true, { path = path } end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 1.5, false end
  if name == "GetMediaSourceNumChannels" then return true, 2 end
  if name == "PCM_Source_Destroy" then return true end
  return false
end
local summary, failure = probe_media_file({
  params = { path = path, include_metadata_keys = false },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(failure == nil, failure and failure.message or "ok")
assert(summary.file_ref == "file:path:" .. path)
assert(summary.decodable == true)
`);
  });

  it("accepts Windows drive and UNC absolute paths and rejects relative paths before any read or write", () => {
    runLua(`
local win = ${JSON.stringify(WIN_PATH)}
local unc = ${JSON.stringify(UNC_PATH)}
local rel = ${JSON.stringify(RELATIVE_PATH)}
assert(READ_B_MEDIA.is_absolute_path(win) == true)
assert(READ_B_MEDIA.is_absolute_path(unc) == true)
assert(READ_B_MEDIA.is_absolute_path(rel) == false)
assert(READ_B_MEDIA.canonical_path(rel) == nil)
existing_files[win] = true
existing_files[unc] = true
call_reaper = function(name, ...)
  if name == "PCM_Source_CreateFromFile" then return true, {} end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 1.0, false end
  if name == "GetMediaSourceNumChannels" then return true, 2 end
  if name == "GetMediaSourceFileName" then return true, path end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetSetMediaItemTakeInfo_String" then
    if select(4, ...) == true then return true, true end
    return true, true, "short.wav"
  end
  if name == "PCM_Source_Destroy" then return true end
  return false
end
local win_probe, win_fail = probe_media_file({
  params = { path = win },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(win_fail == nil, win_fail and win_fail.message or "ok")
assert(win_probe.file_ref == "file:path:" .. win)
local unc_probe, unc_fail = probe_media_file({
  params = { path = unc },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(unc_fail == nil, unc_fail and unc_fail.message or "ok")
assert(unc_probe.file_ref == "file:path:" .. unc)

local rel_probe, rel_fail = probe_media_file({
  params = { path = rel },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(rel_probe == nil)
assert(rel_fail.code == "PARAMS_INVALID")
assert(rel_fail.details.blocker == "relative_path")

mutations = 0
local track = {}
call_reaper = function(name, ...)
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetMediaTrackInfo_Value" then return true, 1 end
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, {} end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, {} end
  if name == "BR_GetMediaItemTakeGUID" then return true, "{TAKE}" end
  if name == "PCM_Source_CreateFromFile"
    or name == "AddMediaItemToTrack"
    or name == "AddTakeToMediaItem"
    or name == "SetMediaItemTake_Source"
    or name == "SetMediaItemInfo_Value"
  then
    mutations = mutations + 1
  end
  return false
end
for _, capability in ipairs({ "media.import_file_to_track", "media.import_file_section_to_track", "media.relink_take_source" }) do
  mutations = 0
  local request = {
    pack = { id = "media", capability = capability, risk = "write" },
    params = capability == "media.import_file_section_to_track" and { position_seconds = 0, start_percent = 0.1, end_percent = 0.9 } or { position_seconds = 0 },
    refs = json_array({
      { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
      { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } },
      { kind = "file", ref = "file:path:" .. rel, identity = { scheme = "path", value = rel } },
    }),
    budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
  }
  local summary, failure
  if capability == "media.import_file_to_track" then
    summary, failure = import_file_to_track(request)
  elseif capability == "media.import_file_section_to_track" then
    summary, failure = import_file_section_to_track(request)
  else
    summary, failure = relink_take_source(request)
  end
  assert(summary == nil, capability)
  assert(failure ~= nil, capability)
  assert(mutations == 0, capability .. " mutations=" .. tostring(mutations))
end
`);
  });

  it("returns full native take source filename and matching file_ref without silent truncation", () => {
    runLua(`
local take = {}
local source = {}
local path = ${JSON.stringify(LONG_PATH)}
existing_files[path] = true
call_reaper = function(name, ...)
  if name == "GetTake" then return true, take end
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, {} end
  if name == "CountTakes" then return true, 1 end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetMediaSourceFileName" then return true, path end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 2.0, false end
  if name == "GetMediaSourceNumChannels" then return true, 1 end
  if name == "BR_GetMediaItemTakeGUID" then return true, "{TAKE-C3}" end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, "{TAKE-C3}" end
  return false
end
local summary, failure = read_take_source({
  params = { include_metadata_keys = false },
  refs = json_array({ { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } } }),
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(failure == nil, failure and (failure.message .. " " .. tostring(failure.code)) or "ok")
assert(summary.filename == path)
assert(summary.file_ref == "file:path:" .. path)
assert(summary.file_ref == "file:path:" .. summary.filename)
assert(summary.take_name == "{TAKE-C3}")
assert(#summary.filename > 240)
`);
  });

  it("keeps short ASCII path compatibility for probe and mutation identities", () => {
    runLua(`
local path = ${JSON.stringify(SHORT_PATH)}
existing_files[path] = true
local track = {}
local item = {}
local take = {}
local source = {}
local writes = 0
call_reaper = function(name, ...)
  if name == "PCM_Source_CreateFromFile" then return true, source end
  if name == "GetMediaSourceFileName" then return true, path end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 1.0, false end
  if name == "GetMediaSourceNumChannels" then return true, 2 end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetSetMediaItemTakeInfo_String" then
    local take, key, value, set_new = ...
    if key == "P_NAME" then
      if set_new then take.name = value; return true, true end
      return true, true, take.name or "short.wav"
    end
    return true, true, "{TAKE-SHORT}"
  end
  if name == "PCM_Source_Destroy" then return true end
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK-SHORT}" end
  if name == "GetMediaTrackInfo_Value" then return true, 1 end
  if name == "AddMediaItemToTrack" then writes = writes + 1; return true, item end
  if name == "AddTakeToMediaItem" then writes = writes + 1; return true, take end
  if name == "SetMediaItemTake_Source" then writes = writes + 1; return true end
  if name == "SetMediaItemInfo_Value" then writes = writes + 1; return true end
  if name == "UpdateItemInProject" then return true end
  if name == "UpdateArrange" then return true end
  if name == "CountMediaItems" then return true, 0 end
  if name == "CountSelectedMediaItems" then return true, 0 end
  if name == "SetMediaItemSelected" then return true end
  if name == "BR_GetMediaItemGUID" then return true, "{ITEM-SHORT}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM-SHORT}" end
  return false
end
local probe, probe_failure = probe_media_file({
  params = { path = path },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 2048 },
})
assert(probe_failure == nil, probe_failure and probe_failure.message or "ok")
assert(probe.file_ref == "file:path:" .. path)
local request = {
  pack = { id = "media", capability = "media.import_file_to_track", risk = "write" },
  params = { position_seconds = 0, preserve_selection = false },
  refs = json_array({
    { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. path, identity = { scheme = "path", value = path } },
  }),
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 2048 },
}
local summary, failure, _, _, refs = import_file_to_track(request)
assert(failure == nil, failure and failure.message or "ok")
assert(summary.source_file_ref == "file:path:" .. path)
assert(refs[2].ref == summary.source_file_ref)
assert(refs[2].identity.value == path)
assert(writes > 0)
`);
  });

  it("uses full file:path: byte length for inline budget exact fit and one-byte shortfall", () => {
    runLua(`
local path = ${JSON.stringify(LONG_PATH)}
existing_files[path] = true
local file_ref_bytes = READ_B_MEDIA.file_ref_bytes(path)
assert(file_ref_bytes == ${FILE_REF_PREFIX.length} + #path)
call_reaper = function(name, ...)
  if name == "PCM_Source_CreateFromFile" then return true, {} end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 1.0, false end
  if name == "GetMediaSourceNumChannels" then return true, 2 end
  if name == "PCM_Source_Destroy" then return true end
  return false
end
local ok_summary, ok_failure = probe_media_file({
  params = { path = path },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = file_ref_bytes },
})
assert(ok_failure == nil, ok_failure and (ok_failure.code .. " " .. tostring(ok_failure.details and ok_failure.details.blocker)) or "ok")
assert(ok_summary.file_ref == "file:path:" .. path)

local bad_summary, bad_failure = probe_media_file({
  params = { path = path },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = file_ref_bytes - 1 },
})
assert(bad_summary == nil)
assert(bad_failure.code == "RESPONSE_TOO_LARGE")
assert(bad_failure.details.blocker == "exact_file_ref_exceeds_inline_budget")
assert(bad_failure.details.file_ref_bytes == file_ref_bytes)
assert(bad_failure.details.max_inline_value_bytes == file_ref_bytes - 1)
assert(bad_failure.details.file_ref_prefix_bytes == ${FILE_REF_PREFIX.length})
`);
  });

  it("fails closed before import/relink mutation when response budget cannot hold full identity", () => {
    runLua(`
local path = ${JSON.stringify(LONG_PATH)}
existing_files[path] = true
mutations = 0
local track = {}
local take = {}
local item = {}
call_reaper = function(name, ...)
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK-BUDGET}" end
  if name == "GetMediaTrackInfo_Value" then return true, 1 end
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, item end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, take end
  if name == "BR_GetMediaItemTakeGUID" then return true, "{TAKE-BUDGET}" end
  if name == "PCM_Source_CreateFromFile"
    or name == "AddMediaItemToTrack"
    or name == "AddTakeToMediaItem"
    or name == "SetMediaItemTake_Source"
    or name == "SetMediaItemInfo_Value"
  then
    mutations = mutations + 1
  end
  return false
end
local request = {
  pack = { id = "media", capability = "media.import_file_to_track", risk = "write" },
  params = { position_seconds = 0 },
  refs = json_array({
    { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. path, identity = { scheme = "path", value = path } },
  }),
  budget = { max_response_bytes = 1000, max_items = 50, max_inline_value_bytes = 4096 },
}
local summary, failure = import_file_to_track(request)
assert(summary == nil)
assert(failure ~= nil)
assert(failure.code == "RESPONSE_TOO_LARGE", failure and failure.code or "nil")
assert(failure.details.blocker == "success_envelope_budget_insufficient")
assert(mutations == 0)
local tiny_inline = {
  pack = { id = "media", capability = "media.relink_take_source", risk = "write" },
  params = {},
  refs = json_array({
    { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. path, identity = { scheme = "path", value = path } },
  }),
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 64 },
}
local relink_summary, relink_failure = relink_take_source(tiny_inline)
assert(relink_summary == nil)
assert(relink_failure.code == "RESPONSE_TOO_LARGE", relink_failure and relink_failure.code or "nil")
assert(relink_failure.details.blocker == "exact_file_ref_exceeds_inline_budget")
assert(mutations == 0)
`);
  });

  it("project and folder lists never count without identity and round-trip long absolute paths", () => {
    runLua(`
local path = ${JSON.stringify(LONG_PATH)}
local folder = "/Users/Shared/OpenReaper/library session 演示资料"
local short_name = "clip 源文件 final.wav"
local long_name = path:match("([^/]+)$")
existing_files[path] = true
folder_files[folder] = { short_name }
-- Make folder entry resolve to long absolute path by joining
folder_files[folder] = { long_name }
-- rebuild long path under folder for list_folder
local folder_file = folder .. "/" .. long_name
existing_files[folder_file] = true
local take = {}
local source = {}
call_reaper = function(name, ...)
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, {} end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, take end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetMediaSourceFileName" then return true, path end
  return false
end
local project, project_fail = read_project_media_files({
  params = { include_offline = true, max_sources = 10 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(project_fail == nil, project_fail and project_fail.message or "ok")
assert(project.source_count == 1)
assert(#project.file_refs == 1)
assert(project.file_refs[1] == "file:path:" .. path)
assert(project.file_refs[1] ~= nil)

local list, list_fail = list_folder_media_files({
  pack = { id = "media", capability = "media.folder_media.list", risk = "read" },
  params = { folder_ref = "folder:path:" .. folder, media_type = "any", limit = 10, offset = 0 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(list_fail == nil, list_fail and list_fail.message or "ok")
assert(list.total_matching_count == 1)
assert(list.row_count == 1)
assert(#list.file_refs == 1)
assert(list.file_refs[1] == "file:path:" .. folder_file)
assert(list.rows[1].file_ref == list.file_refs[1])

-- relative source fails closed without fake count (include_offline true)
call_reaper = function(name, ...)
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, {} end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, take end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetMediaSourceFileName" then return true, ${JSON.stringify(RELATIVE_PATH)} end
  return false
end
local bad_project, bad_project_fail = read_project_media_files({
  params = { include_offline = true, max_sources = 10 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(bad_project == nil)
assert(bad_project_fail.code == "PARAMS_INVALID")
assert(bad_project_fail.details.blocker == "relative_path")

-- relative missing source with include_offline=false still fail-closed before fake offline/source counts
existing_files[${JSON.stringify(RELATIVE_PATH)}] = nil
call_reaper = function(name, ...)
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, {} end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, take end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetMediaSourceFileName" then return true, ${JSON.stringify(RELATIVE_PATH)} end
  return false
end
local offline_rel, offline_rel_fail = read_project_media_files({
  params = { include_offline = false, max_sources = 10 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(offline_rel == nil, "relative offline must not succeed")
assert(offline_rel_fail ~= nil)
assert(offline_rel_fail.code == "PARAMS_INVALID")
assert(offline_rel_fail.details.blocker == "relative_path")
assert(offline_rel_fail.details.source_count == nil)
assert(offline_rel_fail.details.offline_count == nil)
`);
  });

  it("rejects contradictory ref and identity.value and never invents truncated success identity", () => {
    runLua(`
local path = ${JSON.stringify(LONG_PATH)}
local truncated = string.sub(path, 1, 80)
existing_files[path] = true
local track = {}
call_reaper = function(name, ...)
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK-CONFLICT}" end
  if name == "GetMediaTrackInfo_Value" then return true, 1 end
  if name == "PCM_Source_CreateFromFile" or name == "AddMediaItemToTrack" then
    error("mutation_must_not_run")
  end
  return false
end
local request = {
  pack = { id = "media", capability = "media.import_file_to_track", risk = "write" },
  params = { position_seconds = 0 },
  refs = json_array({
    { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. truncated, identity = { scheme = "path", value = path } },
  }),
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
}
local summary, failure = import_file_to_track(request)
assert(summary == nil)
assert(failure ~= nil, "expected failure")
assert(failure.code == "PARAMS_INVALID", "code=" .. tostring(failure.code))
assert(failure.details.blocker == "contradictory_file_ref")
local ok_ref = READ_B_MEDIA.file_ref_for_path(path)
assert(ok_ref == "file:path:" .. path)
assert(string.find(ok_ref, path, 1, true) ~= nil)
assert(string.find(ok_ref, "...", 1, true) == nil)
`)
  });

  it("rejects contradictory bad file ref even when a later valid file ref exists", () => {
    runLua(`
local bad = ${JSON.stringify(RELATIVE_PATH)}
local good = ${JSON.stringify(SHORT_PATH)}
existing_files[good] = true
local track = {}
mutations = 0
call_reaper = function(name, ...)
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK-LATER}" end
  if name == "GetMediaTrackInfo_Value" then return true, 1 end
  if name == "PCM_Source_CreateFromFile" or name == "AddMediaItemToTrack" or name == "Undo_BeginBlock2" or name == "EnumProjects" then
    mutations = mutations + 1
    error("must_not_reach_mutation")
  end
  return false
end
local request = {
  pack = { id = "media", capability = "media.import_file_to_track", risk = "write" },
  params = { position_seconds = 0 },
  refs = json_array({
    { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. bad, identity = { scheme = "path", value = bad } },
    { kind = "file", ref = "file:path:" .. good, identity = { scheme = "path", value = good } },
  }),
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
}
local ok, result = READ_B_MEDIA.preflight_mutation_write(request)
assert(ok == false)
assert(result.code == "PARAMS_INVALID")
assert(result.details.blocker == "relative_path")
assert(result.details.zero_write == true)
local summary, failure = import_file_to_track(request)
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(mutations == 0)
`)
  });

  it("POSIX path join preserves legal backslash characters; Windows drive/UNC still join with backslash", () => {
    runLua(`
local bs = string.char(92)
local posix_folder = "/tmp/openreaper" .. bs .. "legal-backslash-name"
local joined = READ_B_MEDIA.path_join(posix_folder, "clip.wav")
assert(joined == posix_folder .. "/clip.wav", "joined=" .. tostring(joined))
assert(string.sub(joined, #posix_folder + 1, #posix_folder + 1) == "/")
local win = READ_B_MEDIA.path_join("C:" .. bs .. "Users" .. bs .. "Shared", "clip.wav")
assert(win == "C:" .. bs .. "Users" .. bs .. "Shared" .. bs .. "clip.wav", "win=" .. tostring(win))
local unc = READ_B_MEDIA.path_join(bs .. bs .. "server" .. bs .. "share", "clip.wav")
assert(unc == bs .. bs .. "server" .. bs .. "share" .. bs .. "clip.wav", "unc=" .. tostring(unc))
folder_files[posix_folder] = { "clip.wav" }
local list, list_fail = list_folder_media_files({
  pack = { id = "media", capability = "media.folder_media.list", risk = "read" },
  params = { folder_ref = "folder:path:" .. posix_folder, media_type = "any", limit = 10, offset = 0 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(list_fail == nil, list_fail and list_fail.message or "ok")
assert(list.file_refs[1] == "file:path:" .. posix_folder .. "/clip.wav")
assert(list.folder_ref == "folder:path:" .. posix_folder)
`)
  });

  it("canonical identity rejects only NUL; tab and newline remain expressible", () => {
    runLua(`
local with_tab = "/tmp/openreaper\\twith-tab.wav"
-- actual tab character:
with_tab = "/tmp/openreaper" .. string.char(9) .. "with-tab.wav"
local with_nl = "/tmp/openreaper" .. string.char(10) .. "with-nl.wav"
local with_nul = "/tmp/openreaper" .. string.char(0) .. "with-nul.wav"
assert(select(1, READ_B_MEDIA.canonical_path(with_tab)) == with_tab)
assert(select(1, READ_B_MEDIA.canonical_path(with_nl)) == with_nl)
local bad, reason = READ_B_MEDIA.canonical_path(with_nul)
assert(bad == nil)
assert(reason == "nul_char")
`)
  });

  it("empty folder still validates folder_ref inline budget and empty-page response budget", () => {
    runLua(`
local folder = "/Users/Shared/OpenReaper/empty media 文件夹"
folder_files[folder] = {}
local list, list_fail = list_folder_media_files({
  pack = { id = "media", capability = "media.folder_media.list", risk = "read" },
  params = { folder_ref = "folder:path:" .. folder, media_type = "any", limit = 10, offset = 0 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(list_fail == nil, list_fail and list_fail.message or "ok")
assert(list.folder_ref == "folder:path:" .. folder)
assert(list.row_count == 0)
assert(list.total_matching_count == 0)
local tiny, tiny_fail = list_folder_media_files({
  pack = { id = "media", capability = "media.folder_media.list", risk = "read" },
  params = { folder_ref = "folder:path:" .. folder, media_type = "any", limit = 10, offset = 0 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 20 },
})
assert(tiny == nil)
assert(tiny_fail.code == "RESPONSE_TOO_LARGE")
assert(tiny_fail.details.blocker == "exact_folder_ref_exceeds_inline_budget")
local empty_budget, empty_fail = list_folder_media_files({
  pack = { id = "media", capability = "media.folder_media.list", risk = "read" },
  params = { folder_ref = "folder:path:" .. folder, media_type = "any", limit = 10, offset = 0 },
  budget = { max_response_bytes = 32, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(empty_budget == nil)
assert(empty_fail.code == "RESPONSE_TOO_LARGE")
assert(empty_fail.details.blocker == "empty_page_exceeds_budget")
`)
  });

  it("project and folder lists page only at complete item boundaries; single oversized row fails closed", () => {
    runLua(`
local short_a = "/tmp/a.wav"
local short_b = "/tmp/b.wav"
local long_path = ${JSON.stringify(LONG_PATH)}
existing_files[short_a] = true
existing_files[short_b] = true
existing_files[long_path] = true
local take = {}
local source = {}
local filenames = { short_a, short_b, long_path }
local fi = 0
call_reaper = function(name, ...)
  if name == "CountMediaItems" then return true, 3 end
  if name == "GetMediaItem" then return true, {} end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, take end
  if name == "GetMediaItemTake_Source" then return true, source end
  if name == "GetMediaSourceFileName" then
    fi = fi + 1
    return true, filenames[fi]
  end
  return false
end
local project, project_fail = read_project_media_files({
  params = { include_offline = true, max_sources = 10 },
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(project_fail == nil, project_fail and project_fail.message or "ok")
assert(project.source_count == 3)
assert(#project.file_refs >= 1)
assert(#project.file_refs <= 3)
-- Force single long identity to exceed summary budget while inline still allows it.
fi = 0
filenames = { long_path }
local low, low_fail = read_project_media_files({
  params = { include_offline = true, max_sources = 10 },
  budget = { max_response_bytes = 80, max_items = 50, max_inline_value_bytes = 4096 },
})
assert(low == nil)
assert(low_fail.code == "RESPONSE_TOO_LARGE")
assert(low_fail.details.blocker == "single_identity_row_exceeds_budget" or low_fail.details.blocker == "empty_page_exceeds_budget")
`)
  });

  it("pure preflight mutation write fails closed with zero EnumProjects/Undo/mutation APIs", () => {
    runLua(`
local path = ${JSON.stringify(LONG_PATH)}
existing_files[path] = true
local guarded = 0
call_reaper = function(name, ...)
  if name == "EnumProjects" or name == "Undo_BeginBlock2" or name == "Undo_EndBlock2"
    or name == "Undo_BeginBlock" or name == "Undo_EndBlock"
    or name == "PCM_Source_CreateFromFile" or name == "AddMediaItemToTrack"
    or name == "SetMediaItemTake_Source" then
    guarded = guarded + 1
    error("preflight_must_not_call_" .. name)
  end
  return false
end
local request = {
  pack = { id = "media", capability = "media.import_file_to_track", risk = "write" },
  params = { position_seconds = 0 },
  refs = json_array({
    { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. path, identity = { scheme = "path", value = path } },
  }),
  budget = { max_response_bytes = 1000, max_items = 50, max_inline_value_bytes = 4096 },
}
local ok, failure = READ_B_MEDIA.preflight_mutation_write(request)
assert(ok == false)
assert(failure.code == "RESPONSE_TOO_LARGE")
assert(failure.details.zero_write == true)
assert(guarded == 0)
local rel = {
  pack = { id = "media", capability = "media.relink_take_source", risk = "write" },
  params = {},
  refs = json_array({
    { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:relative/x.wav", identity = { scheme = "path", value = "relative/x.wav" } },
  }),
  budget = { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 4096 },
}
local ok2, failure2 = READ_B_MEDIA.preflight_mutation_write(rel)
assert(ok2 == false)
assert(failure2.details.blocker == "relative_path")
assert(guarded == 0)
`)
  });
});
