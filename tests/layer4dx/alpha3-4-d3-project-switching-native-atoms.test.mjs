import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalogTemplates,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/d30_project_container_route.lua", import.meta.url),
  "utf8",
);
const REGISTRY = JSON.parse(
  readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url), "utf8"),
);

const PRELUDE = String.raw`
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
local JSON_ARRAY_MT = { __openreaper_json_array = true }
function is_json_array(value) return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT end
function is_non_negative_integer(value)
  return type(value) == "number" and value == math.floor(value) and value >= 0 and value ~= math.huge
end
function json_array(value) return setmetatable(value or {}, JSON_ARRAY_MT) end
function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then return value end
  end
  return nil
end
function first_string(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "string" then return value end
  end
  return nil
end
function bounded_string(value, max_length)
  local text = value == nil and "" or tostring(value)
  if #text <= (max_length or 160) then return text end
  return text:sub(1, max_length or 160)
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function artifact_id_from_request(request) return request.id end
function safe_budget(request)
  local budget = request and request.budget or {}
  return {
    max_items = budget.max_items or 100,
    max_inline_value_bytes = budget.max_inline_value_bytes or 4096,
    max_response_bytes = budget.max_response_bytes or 65536,
  }
end
ACTIVE_OWNER = "openreaper-live-smoke"
ACTIVE_GENERATION = 1
json = {}
function json.encode(value)
  local value_type = type(value)
  if value == nil then
    return "null"
  elseif value_type == "string" then
    return '"' .. value:gsub("\\", "\\\\"):gsub('"', '\\"') .. '"'
  elseif value_type == "number" then
    return tostring(value)
  elseif value_type == "boolean" then
    return value and "true" or "false"
  elseif value_type == "table" then
    if is_json_array(value) then
      local parts = {}
      for index = 1, #value do
        parts[#parts + 1] = json.encode(value[index])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for key in pairs(value) do
      if type(key) == "string" then keys[#keys + 1] = key end
    end
    table.sort(keys)
    local parts = {}
    for _, key in ipairs(keys) do
      parts[#parts + 1] = json.encode(key) .. ":" .. json.encode(value[key])
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
`;

const FIXTURES = String.raw`
function project_request(capability, params, refs, risk, budget)
  return {
    id = "request",
    params = params or {},
    refs = json_array(refs or {}),
    pack = { id = "project", capability = capability, risk = risk or "write" },
    budget = budget or { max_items = 100, max_inline_value_bytes = 4096, max_response_bytes = 65536 },
  }
end

function install_project_tab_fake(config)
  config = config or {}
  ACTIVE_OWNER = config.owner or "openreaper-live-smoke"
  ACTIVE_GENERATION = config.generation or 1
  d30_project_tab_tokens = {}
  d30_project_tab_owner = nil
  d30_project_tab_generation = nil
  d30_project_tab_seq = 0

  local function make_project(path, dirty)
    return {
      path = path or "",
      dirty = dirty or 0,
      tracks = {},
      items = {},
      name = config.names and config.names[path] or nil,
    }
  end

  saved_a = make_project(config.path_a or "/session/Parent.RPP", config.dirty_a or 0)
  saved_b = make_project(config.path_b or "/session/Other.RPP", config.dirty_b or 0)
  unsaved = make_project("", config.dirty_unsaved or 0)
  unsaved.name = config.unsaved_name or "unsaved"

  if config.non_ascii_path then
    saved_b.path = config.non_ascii_path
  end

  projects = {}
  if config.only_parent then
    projects = { saved_a }
  elseif config.two_saved_one_unsaved then
    projects = { saved_a, saved_b, unsaved }
  else
    projects = config.projects or { saved_a, saved_b, unsaved }
  end
  current_project = config.current or projects[1]
  files = {}
  for _, project in ipairs(projects) do
    if project.path ~= "" then files[project.path] = true end
  end
  if config.existing_open_path then
    files[config.existing_open_path] = true
  end
  if config.open_target_path then
    files[config.open_target_path] = true
  end
  calls = {
    actions = {},
    select_project = 0,
    open_project = 0,
    open_args = {},
    sws = 0,
    save = 0,
    ledger = 0,
  }

  function file_exists(path) return files[path] == true end

  reaper = {}
  reaper.EnumProjects = function(index)
    if config.enum_fail then error("enum failed") end
    if index == -1 then
      if config.current_fail then error("current enum failed") end
      if config.current_false_handle then
        return false, ""
      end
      if config.current_nonstring_path then
        return current_project or saved_a, config.current_nonstring_path_value
      end
      if config.current_missing then
        return { path = "/missing/current.RPP", dirty = 0 }, "/missing/current.RPP"
      end
      if not current_project then return nil, "" end
      return current_project, current_project.path or ""
    end
    local project = projects[index + 1]
    if not project then return nil, "" end
    return project, project.path or ""
  end
  reaper.IsProjectDirty = function(project)
    if config.dirty_fail then error("dirty failed") end
    if config.dirty_invalid then return -1 end
    return project.dirty or 0
  end
  reaper.Undo_BeginBlock2 = function(project)
    calls.undo_begins = (calls.undo_begins or 0) + 1
    calls.last_undo_begin = project
    if config.undo_end_increments_dirty then
      -- pairing state only; dirty bump happens on End
      calls.open_undo = project
    end
  end
  reaper.Undo_EndBlock2 = function(project, label, flags)
    calls.undo_ends = (calls.undo_ends or 0) + 1
    calls.last_undo_end = project
    -- Real REAPER fixture: empty Undo_EndBlock2 can increment project state count.
    if config.undo_end_increments_dirty and type(project) == "table" then
      project.dirty = (project.dirty or 0) + 1
    end
    calls.open_undo = nil
  end
  reaper.GetProjectName = function(project)
    if project.name then return true, project.name end
    if project.path and project.path ~= "" then
      return true, project.path:match("([^/\\]+)$")
    end
    return true, "unsaved"
  end
  reaper.Main_OnCommandEx = function(action, flag, project)
    calls.actions[action] = (calls.actions[action] or 0) + 1
    if action == 41929 then
      assert(flag == 0 and project == 0)
      if config.replace_old_tab then
        table.remove(projects, 1)
      end
      local blank = make_project("", 0)
      projects[#projects + 1] = blank
      if config.ambiguous_new_tabs then
        projects[#projects + 1] = make_project("", 0)
      end
      if config.zero_new_tabs then
        table.remove(projects, #projects)
        if config.ambiguous_new_tabs then table.remove(projects, #projects) end
      end
      if not config.inactive_new_tab and not config.ambiguous_new_tabs and not config.zero_new_tabs then
        current_project = blank
      end
      return nil
    end
    if action == 40861 then
      assert(flag == 0 and project == 0)
      local current_index = nil
      for index, candidate in ipairs(projects) do
        if candidate == current_project then current_index = index break end
      end
      assert(current_index ~= nil)
      current_project = projects[(current_index % #projects) + 1]
      return nil
    end
    error("unexpected action " .. tostring(action))
  end
  pending_select = nil
  reaper.SelectProjectInstance = function(project)
    calls.select_project = calls.select_project + 1
    if config.select_project_noop then
      return
    end
    if config.select_project_deferred then
      pending_select = project
      return
    end
    current_project = project
  end
  reaper.Main_openProject = function(arg)
    calls.open_project = calls.open_project + 1
    calls.open_args[#calls.open_args + 1] = arg
    if config.open_failure then return false end
    assert(type(arg) == "string")
    local path = arg:match("^noprompt:(.+)$") or arg
    assert(files[path] == true)
    current_project.path = path
    current_project.dirty = 0
    return nil
  end
  reaper.BR_GetMediaItemGUID = function()
    calls.sws = calls.sws + 1
    error("SWS must not be used")
  end
  reaper.Main_SaveProjectEx = function()
    calls.save = calls.save + 1
    error("unexpected Main_SaveProjectEx write")
  end
  reaper.SetProjExtState = function()
    calls.ledger = calls.ledger + 1
    error("ledger writes must not replace native tab materialization")
  end
end

function apply_pending_select()
  if pending_select then
    current_project = pending_select
    pending_select = nil
  end
end

function run_with_continuation(handler, request)
  local cont = nil
  for _ = 1, 12 do
    if cont then
      apply_pending_select()
    end
    local summary, failure, artifacts, jobs, refs = handler(request, cont)
    if type(summary) == "table" and summary.contract == "openreaper.bridge.internal_continuation.v1" then
      cont = summary
    else
      return summary, failure, artifacts, jobs, refs
    end
  end
  error("handler continuation did not reach a terminal result")
end
`;

function runLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const script = `${PRELUDE}\n${FIXTURES}\n${HANDLER_SOURCE}\n${body}`;
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(script));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 0, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  lua.lua_close(state);
}

describe("Alpha3.4-D3 native project-switching atoms", () => {
  it("registers exactly three new project templates on the D30 module and keeps 242/91", () => {
    const catalog = createAcceptedOfficialTemplateCatalogTemplates();
    assert.equal(catalog.length, 242);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 242);
    assert.equal(REGISTRY.entries.length, 242);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
    assert.match(HANDLER_SOURCE, /D30_WRITE_SUCCESS_ENVELOPE_MIN_BYTES\s*=\s*65536/);
    assert.match(HANDLER_SOURCE, /d30_project_write_budget_gate/);
    assert.doesNotMatch(HANDLER_SOURCE, /artifacts_allowed\s*=/);
    const emptyArtifactSites = [
      ...(HANDLER_SOURCE.match(/nil, json_array\(\{\}\), json_array\(\{\}\), json_array\(\{/g) ?? []),
      ...(HANDLER_SOURCE.match(/nil, json_array\(\{\}\), json_array\(\{ job_ref \}\), json_array\(\{/g) ?? []),
    ];
    assert.ok(emptyArtifactSites.length >= 7, `expected >=7 empty-artifact success returns, got ${emptyArtifactSites.length}`);
    for (const id of [
      "template.project.list_open_projects",
      "template.project.open_project_in_tab",
      "template.project.activate_project_tab",
      "template.project.create_project_tab",
    ]) {
      const row = REGISTRY.entries.find((entry) => entry.template_id === id);
      assert.ok(row, id);
      assert.equal(row.handler_file, "project/d30_project_container_route.lua");
    }
    assert.match(HANDLER_SOURCE, /function list_open_projects/);
    assert.match(HANDLER_SOURCE, /function open_project_in_tab/);
    assert.match(HANDLER_SOURCE, /function activate_project_tab/);
    assert.match(HANDLER_SOURCE, /Main_openProject/);
    assert.match(HANDLER_SOURCE, /D30_NEW_PROJECT_TAB_ACTION = 41929/);
    assert.match(HANDLER_SOURCE, /live_materialization = "native_project_tab_verified"/);
    assert.match(HANDLER_SOURCE, /openreaper\.bridge\.internal_continuation\.v1/);
    assert.match(HANDLER_SOURCE, /d30_project_continue/);
    assert.match(HANDLER_SOURCE, /create_project_tab\.mutate_create/);
    assert.match(HANDLER_SOURCE, /create_project_tab\.verify_created/);
    assert.match(HANDLER_SOURCE, /create_project_tab\.verify_selection/);
    assert.match(HANDLER_SOURCE, /open_project_in_tab\.mutate_create/);
    assert.match(HANDLER_SOURCE, /open_project_in_tab\.verify_created/);
    assert.match(HANDLER_SOURCE, /open_project_in_tab\.verify_blank_selection/);
    assert.match(HANDLER_SOURCE, /open_project_in_tab\.open_into_active/);
    assert.match(HANDLER_SOURCE, /activate_project_tab\.mutate_select/);
    assert.match(HANDLER_SOURCE, /activate_project_tab\.verify_selection/);
    assert.match(HANDLER_SOURCE, /next_phase_may_mutate/);
    assert.doesNotMatch(HANDLER_SOURCE, /D30_NEXT_PROJECT_TAB_ACTION\s*=\s*40861/);
    assert.doesNotMatch(HANDLER_SOURCE, /Main_OnCommandEx\",\s*D30_NEXT_PROJECT_TAB_ACTION/);
    assert.doesNotMatch(HANDLER_SOURCE, /Main_OnCommandEx\",\s*40861/);
    assert.doesNotMatch(HANDLER_SOURCE, /materialization = "ledger_only_waiting_fixture"/);
    assert.doesNotMatch(HANDLER_SOURCE, /\bSWS\b/);
  });

  it("lists two saved tabs plus one unsaved tab with stable paging and complete coverage", () => {
    runLua(String.raw`
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 3 })
local page1, failure = list_open_projects(project_request("project.list_open_projects", { cursor = 0, limit = 2 }, {}, "read"))
assert(failure == nil, failure and failure.code)
assert(page1.total_count == 3 and page1.returned_count == 2 and page1.coverage_status == "paged")
assert(page1.next_cursor == "2")
assert(page1.projects[1].project_ref == "project:path:/session/Parent.RPP")
assert(page1.projects[1].dirty == true and page1.projects[1].raw_dirty_state == 3)
assert(page1.projects[2].project_ref == "project:path:/session/Other.RPP")
local page2, failure2 = list_open_projects(project_request("project.list_open_projects", { cursor = page1.next_cursor, limit = 2 }, {}, "read"))
assert(failure2 == nil, failure2 and failure2.code)
assert(page2.coverage_status == "complete" and page2.returned_count == 1 and page2.next_cursor == nil)
assert(page2.projects[1].path_state == "unsaved_project")
assert(page2.projects[1].project_ref:match("^project:tab:") ~= nil)
assert(json.encode(page2):match('"projects":%[%{') ~= nil, json.encode(page2))
local exhausted = assert(list_open_projects(project_request("project.list_open_projects", { cursor = "3", limit = 2 }, {}, "read")))
assert(exhausted.returned_count == 0 and exhausted.coverage_status == "complete")
assert(json.encode(exhausted):match('"projects":%[%]') ~= nil, json.encode(exhausted))
assert(calls.actions[41929] == nil and calls.select_project == 0 and calls.sws == 0)
`);
  });

  it("round-trips string next_cursor, rejects invalid cursors, and budget-pages under 2KiB inline", () => {
    runLua(String.raw`
install_project_tab_fake({ two_saved_one_unsaved = true })
local page1 = assert(list_open_projects(project_request("project.list_open_projects", { cursor = "0", limit = 1 }, {}, "read")))
assert(page1.next_cursor == "1" and page1.coverage_status == "paged")
local page2 = assert(list_open_projects(project_request("project.list_open_projects", { cursor = page1.next_cursor, limit = 1 }, {}, "read")))
assert(page2.cursor == 1 and page2.projects[1].project_ref == "project:path:/session/Other.RPP")

for _, bad in ipairs({ -1, 1.5, "", "01x", " 2", "2.0", true }) do
  local _, err = list_open_projects(project_request("project.list_open_projects", { cursor = bad }, {}, "read"))
  assert(err ~= nil and err.code == "PARAMS_INVALID", tostring(bad))
end

install_project_tab_fake({ only_parent = true })
for i = 1, 40 do
  projects[#projects + 1] = {
    path = string.format("/session/long-path-project-%02d-%s.RPP", i, string.rep("x", 120)),
    dirty = 0,
    tracks = {},
    items = {},
  }
  files[projects[#projects].path] = true
end
local tight = project_request("project.list_open_projects", { limit = 100 }, {}, "read", {
  max_items = 100,
  max_inline_value_bytes = 2048,
  max_response_bytes = 2800,
})
local paged, paged_err = list_open_projects(tight)
assert(paged_err == nil, paged_err and (paged_err.code .. ":" .. tostring(paged_err.details and paged_err.details.blocker)))
assert(paged.total_count == 41)
assert(paged.returned_count >= 1 and paged.returned_count < paged.total_count, tostring(paged.returned_count))
assert(paged.coverage_status == "paged" and paged.next_cursor ~= nil)
assert(paged.returned_count > 0)

install_project_tab_fake({ only_parent = true })
projects[1].path = "/session/" .. string.rep("很长路径", 120) .. "/demo.RPP"
files[projects[1].path] = true
local too_big, big_err = list_open_projects(project_request("project.list_open_projects", { limit = 1 }, {}, "read", {
  max_items = 10,
  max_inline_value_bytes = 128,
  max_response_bytes = 1700,
}))
assert(too_big == nil and big_err ~= nil, big_err and big_err.code)
assert(big_err.code == "RESPONSE_TOO_LARGE")
assert(big_err.details.blocker == "single_project_row_exceeds_budget")
assert(type(big_err.details.project_ref) == "string")
`);
  });

  it("fails closed on active-project truth gaps and duplicate inventory identity", () => {
    runLua(String.raw`
install_project_tab_fake({ only_parent = true, current_fail = true })
local _, current_fail = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(current_fail ~= nil and current_fail.details.blocker == "active_project_unreadable")

install_project_tab_fake({ only_parent = true, current_missing = true })
local _, missing = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(missing ~= nil and missing.details.blocker == "active_project_not_in_inventory")

install_project_tab_fake({ only_parent = true })
local listed = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(listed ~= nil)
local active_rows = 0
for _, row in ipairs(listed.projects) do if row.active then active_rows = active_rows + 1 end end
assert(active_rows == 1)

-- Unsaved active: EnumProjects(-1) returns exact handle + empty path string.
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_unsaved = 1 })
current_project = unsaved
local unsaved_list = list_open_projects(project_request("project.list_open_projects", { cursor = 0, limit = 100 }, {}, "read"))
assert(unsaved_list ~= nil)
local active_unsaved = nil
local active_count = 0
for _, row in ipairs(unsaved_list.projects) do
  if row.active then
    active_count = active_count + 1
    active_unsaved = row
  end
end
assert(active_count == 1)
assert(active_unsaved ~= nil)
assert(active_unsaved.active == true)
assert(active_unsaved.saved == false)
assert(active_unsaved.path_state == "unsaved_project")
assert(active_unsaved.project_ref:match("^project:tab:") ~= nil)
local current_state = d30_project_current_state()
assert(current_state ~= nil and current_state.project == unsaved and current_state.path == "")

install_project_tab_fake({ only_parent = true })
projects[#projects + 1] = { path = saved_a.path, dirty = 0, tracks = {}, items = {} }
local _, dup = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(dup ~= nil and dup.details.blocker == "project_path_duplicate")
assert(dup.details.zero_write == true and calls.actions[41929] == nil)

-- Negative: false project handle from EnumProjects(-1) fails closed with zero writes.
install_project_tab_fake({ only_parent = true, current_false_handle = true })
local _, false_handle = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(false_handle ~= nil and false_handle.details.blocker == "active_project_unreadable")
assert(calls.actions[41929] == nil and calls.select_project == 0 and calls.open_project == 0)
local _, create_false = create_project_tab(project_request("project.create_project_tab", { name = "x", activate = true }, {}))
assert(create_false ~= nil and create_false.details.blocker == "active_project_unreadable")
assert(calls.actions[41929] == nil and calls.select_project == 0 and calls.open_project == 0)

-- Negative: real handle + non-string path fails closed with zero writes.
install_project_tab_fake({ only_parent = true, current_nonstring_path = true, current_nonstring_path_value = 123 })
local _, nonstring = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(nonstring ~= nil and nonstring.details.blocker == "active_project_unreadable")
assert(calls.actions[41929] == nil and calls.select_project == 0 and calls.open_project == 0)
local _, create_nonstring = create_project_tab(project_request("project.create_project_tab", { name = "x" }, {}))
assert(create_nonstring ~= nil and create_nonstring.details.blocker == "active_project_unreadable")
assert(calls.actions[41929] == nil and calls.select_project == 0 and calls.open_project == 0)

-- Negative: EnumProjects(-1) API exception fails closed with zero writes (preflight).
install_project_tab_fake({ only_parent = true, current_fail = true })
local _, api_exc = create_project_tab(project_request("project.create_project_tab", { name = "x" }, {}))
assert(api_exc ~= nil and api_exc.details.blocker == "active_project_unreadable")
assert(calls.actions[41929] == nil and calls.select_project == 0 and calls.open_project == 0)
`);
  });

  it("create_subproject rejects unsaved active parent before any mutation", () => {
    runLua(String.raw`
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_unsaved = 0 })
current_project = unsaved
assert(d30_project_current_state() ~= nil)
assert(d30_project_current_state().project == unsaved)
assert(d30_project_current_state().path == "")
local _, failure = create_subproject(project_request("project.create_subproject", { name = "Dialog Edit", activate = true }, {}))
assert(failure ~= nil, "expected unsaved-parent failure")
assert(failure.details.blocker == "parent_project_unsaved_or_unreadable", tostring(failure.details and failure.details.blocker))
assert(calls.actions[41929] == nil)
assert(calls.select_project == 0)
assert(calls.open_project == 0)
assert((calls.actions[42332] or 0) == 0)
assert(calls.save == 0)
assert(calls.ledger == 0)
`);
  });

  it("D30 write paths zero-write on 2048 and 4096 budgets; handler artifacts empty", () => {
    runLua(String.raw`
local function assert_zero_write(budget_bytes)
  install_project_tab_fake({ only_parent = true, dirty_a = 0 })
  local tight = { max_items = 100, max_inline_value_bytes = 4096, max_response_bytes = budget_bytes }
  local _, create_fail = create_project_tab(project_request("project.create_project_tab", { name = "n", activate = true }, {}, "write", tight))
  assert(create_fail ~= nil and create_fail.code == "RESPONSE_TOO_LARGE", "budget " .. tostring(budget_bytes))
  assert(create_fail.details.zero_write == true)
  assert(create_fail.details.required_response_bytes == 65536)
  assert(calls.actions[41929] == nil and calls.select_project == 0 and (calls.undo_begins or 0) == 0)

  local target = "/session/Other.RPP"
  files[target] = true
  local _, open_fail = open_project_in_tab(project_request("project.open_project_in_tab", { path = target }, {}, "write", tight))
  assert(open_fail ~= nil and open_fail.code == "RESPONSE_TOO_LARGE" and open_fail.details.zero_write == true)
  assert(calls.open_project == 0 and calls.actions[41929] == nil)

  install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 0 })
  local listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
  local saved_ref = listed.projects[2].project_ref
  local _, act_fail = activate_project_tab(project_request("project.activate_project_tab", {}, {
    { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
  }, "safe", tight))
  assert(act_fail ~= nil and act_fail.code == "RESPONSE_TOO_LARGE" and act_fail.details.zero_write == true)
  assert(calls.select_project == 0)
end
assert_zero_write(2048)
assert_zero_write(4096)

-- Room budget: handler returns empty artifacts and unique canonical refs.
install_project_tab_fake({ only_parent = true, dirty_a = 2 })
local roomy = { max_items = 100, max_inline_value_bytes = 4096, max_response_bytes = 65536 }
local created, cfail, cart, cjobs, crefs = run_with_continuation(create_project_tab, project_request("project.create_project_tab", { name = "ok", activate = true }, {}, "write", roomy))
assert(cfail == nil, cfail and cfail.code)
assert(created.created == true)
assert(created.artifacts_allowed == nil)
assert(is_json_array(cart) and #cart == 0)
assert(is_json_array(crefs) and #crefs == 1)
assert(type(crefs[1].ref) == "string" and crefs[1].ref:match("^project:") ~= nil)
`);
  });

  it("creates a real blank tab with exact identity and fails closed on zero/two added tabs", () => {
    runLua(String.raw`
      install_project_tab_fake({ only_parent = true, dirty_a = 2 })
local created, failure = run_with_continuation(create_project_tab, project_request("project.create_project_tab", { name = "sound design", activate = true }, {}))
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker) .. ":" .. tostring(failure.message)))
assert(created.created == true, "created flag")
assert(created.live_materialization == "native_project_tab_verified", tostring(created.live_materialization))
assert(created.project_ref:match("^project:tab:") ~= nil, tostring(created.project_ref))
assert(created.prior_dirty_unchanged == true and created.prior_raw_dirty_state == 2)
assert(calls.actions[41929] == 1 and #projects == 2 and current_project ~= saved_a)
assert(saved_a.dirty == 2)

install_project_tab_fake({ only_parent = true, ambiguous_new_tabs = true })
local _, amb = run_with_continuation(create_project_tab, project_request("project.create_project_tab", { name = "x" }, {}))
assert(amb ~= nil, "ambiguous failure missing")
assert(amb.details.blocker == "new_project_tab_identity_ambiguous", tostring(amb.details and amb.details.blocker))
assert(amb.details.added_project_count == 2, tostring(amb.details.added_project_count))
assert(amb.details.partial_state ~= nil)

install_project_tab_fake({ only_parent = true, zero_new_tabs = true })
local _, zero = run_with_continuation(create_project_tab, project_request("project.create_project_tab", { name = "x" }, {}))
assert(zero ~= nil, "zero failure missing")
assert(zero.details.blocker == "new_project_tab_identity_ambiguous", tostring(zero.details and zero.details.blocker))
assert(zero.details.added_project_count == 0, tostring(zero.details and zero.details.added_project_count))

install_project_tab_fake({ only_parent = true, replace_old_tab = true })
local _, replaced = run_with_continuation(create_project_tab, project_request("project.create_project_tab", { name = "x" }, {}))
assert(replaced ~= nil and replaced.details.blocker == "project_tab_prior_instance_missing", tostring(replaced and replaced.details and replaced.details.blocker))

install_project_tab_fake({ only_parent = true, open_target_path = "/session/Child.RPP", replace_old_tab = true })
files["/session/Child.RPP"] = true
local _, open_replaced = run_with_continuation(open_project_in_tab, project_request("project.open_project_in_tab", { path = "/session/Child.RPP" }, {}))
assert(open_replaced ~= nil and open_replaced.details.blocker == "project_tab_prior_instance_missing")

install_project_tab_fake({ only_parent = true })
local _, copy = create_project_tab(project_request("project.create_project_tab", {
  name = "x",
  copy_active_project_settings = true,
}, {}))
assert(copy ~= nil and copy.details.blocker == "copy_active_project_settings_unproven")
assert(calls.actions[41929] == nil)

install_project_tab_fake({ only_parent = true })
local long_cn = string.rep("工程标签名称", 40)
local labeled, label_err = run_with_continuation(create_project_tab, project_request("project.create_project_tab", { name = long_cn, activate = true }, {}))
assert(label_err == nil, label_err and label_err.code)
assert(labeled.openreaper_label ~= nil and #labeled.openreaper_label <= 160)
assert(labeled.title_claim == "openreaper_label_only")
local encoded = json.encode(labeled)
assert(type(encoded) == "string" and #encoded > 0)
`);
  });

  it("opens exact non-ASCII path in a new tab, preserves dirty prior, and reports partial open failure", () => {
    runLua(String.raw`
local target = "/session/项目/demo 声音.RPP"
install_project_tab_fake({ only_parent = true, dirty_a = 4, open_target_path = target })
local opened, failure = run_with_continuation(open_project_in_tab, project_request("project.open_project_in_tab", { path = target }, {}))
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker)))
assert(opened.opened == true and opened.project_ref == "project:path:" .. target)
assert(opened.prior_project_remains_open == true and opened.prior_dirty_unchanged == true)
assert(opened.prior_raw_dirty_state == 4 and saved_a.dirty == 4)
assert(current_project.path == target)
assert(calls.open_project == 1 and calls.open_args[1] == "noprompt:" .. target)
assert(calls.actions[41929] == 1)
local still_parent = false
for _, project in ipairs(projects) do if project == saved_a then still_parent = true end end
assert(still_parent == true)

install_project_tab_fake({ only_parent = true, dirty_a = 5, open_target_path = target })
local _, already = open_project_in_tab(project_request("project.open_project_in_tab", { path = saved_a.path }, {}))
assert(already ~= nil and already.details.blocker == "PROJECT_ALREADY_OPEN")
assert(already.details.zero_write == true and calls.actions[41929] == nil and calls.open_project == 0)

install_project_tab_fake({ only_parent = true, dirty_a = 7, open_target_path = target, open_failure = true })
local _, open_fail = run_with_continuation(open_project_in_tab, project_request("project.open_project_in_tab", { path = target }, {}))
assert(open_fail ~= nil and open_fail.details.blocker == "main_open_project_failed")
assert(open_fail.details.partial_state == "blank_tab_may_remain")
assert(open_fail.details.rollback_claimed == false)
assert(open_fail.details.prior_project_restored == true)
assert(current_project == saved_a and saved_a.dirty == 7)
`);
  });

  it("activates exact saved and unsaved refs, supports already-active and deferred post-yield select", () => {
    runLua(String.raw`
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 1, dirty_b = 2 })
local listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
local saved_ref = listed.projects[2].project_ref
local unsaved_ref = listed.projects[3].project_ref
assert(saved_ref == "project:path:/session/Other.RPP")
assert(unsaved_ref:match("^project:tab:") ~= nil)

local activated, failure = run_with_continuation(activate_project_tab, project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe"))
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker)))
assert(activated.activated == true and activated.already_active == false)
assert(current_project == saved_b and activated.prior_dirty_unchanged == true)
assert(saved_a.dirty == 1)
assert(activated.prior_raw_dirty_state == 1)

local again, again_failure = activate_project_tab(project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe"))
assert(again_failure == nil and again.already_active == true and again.selection_mode == "already_active")
assert(calls.select_project >= 1)

local tab_act, tab_failure = run_with_continuation(activate_project_tab, project_request("project.activate_project_tab", { project_ref = unsaved_ref }, {}, "safe"))
assert(tab_failure == nil, tab_failure and (tab_failure.code .. ":" .. tostring(tab_failure.details and tab_failure.details.blocker)))
assert(tab_act.activated == true and current_project == unsaved)

install_project_tab_fake({ two_saved_one_unsaved = true, select_project_deferred = true, dirty_a = 1, dirty_b = 2 })
listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
saved_ref = listed.projects[2].project_ref
local req = project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe")
local pre = activate_project_tab(req)
assert(pre.phase == "activate_project_tab.mutate_select" and pre.next_phase_may_mutate == true)
assert(calls.select_project == 0)
local first = activate_project_tab(req, pre)
assert(type(first) == "table" and first.contract == "openreaper.bridge.internal_continuation.v1")
assert(first.phase == "activate_project_tab.verify_selection")
assert(first.next_phase_may_mutate == false)
assert(calls.select_project == 1)
assert(current_project == saved_a)
apply_pending_select()
local deferred, deferred_failure = activate_project_tab(req, first)
assert(deferred_failure == nil, deferred_failure and deferred_failure.code)
assert(deferred.activated == true and deferred.selection_mode == "select_scheduled")
assert(current_project == saved_b)
assert(calls.select_project == 1)
assert(calls.actions[40861] == nil)

-- Immediate SelectProjectInstance application still requires a later verify tick.
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 1, dirty_b = 2 })
listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
saved_ref = listed.projects[2].project_ref
req = project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe")
local pre2 = activate_project_tab(req)
local immediate = activate_project_tab(req, pre2)
assert(type(immediate) == "table" and immediate.contract == "openreaper.bridge.internal_continuation.v1")
assert(immediate.phase == "activate_project_tab.verify_selection")
assert(current_project == saved_b)
assert(calls.select_project == 1)
local finished, finished_failure = activate_project_tab(req, immediate)
assert(finished_failure == nil and finished.activated == true)
assert(calls.select_project == 1)

-- create: preflight zero-write, mutate create once, verify on later tick.
install_project_tab_fake({ only_parent = true, dirty_a = 2 })
local create_req = project_request("project.create_project_tab", { name = "phase", activate = true }, {})
local c0 = create_project_tab(create_req)
assert(c0.phase == "create_project_tab.mutate_create" and c0.next_phase_may_mutate == true)
assert(calls.actions[41929] == nil)
local c1 = create_project_tab(create_req, c0)
assert(c1.phase == "create_project_tab.verify_created" and c1.next_phase_may_mutate == false)
assert(calls.actions[41929] == 1 and calls.select_project == 0)
local c2, c2_fail = create_project_tab(create_req, c1)
assert(c2_fail == nil and c2.created == true)
assert(calls.actions[41929] == 1 and calls.select_project == 0)

-- create with inactive new tab: select once after create verify, then post-yield verify.
install_project_tab_fake({ only_parent = true, dirty_a = 2, inactive_new_tab = true, select_project_deferred = true })
create_req = project_request("project.create_project_tab", { name = "phase2", activate = true }, {})
c0 = create_project_tab(create_req)
c1 = create_project_tab(create_req, c0)
assert(c1.phase == "create_project_tab.verify_created")
local c1b = create_project_tab(create_req, c1)
assert(c1b.phase == "create_project_tab.mutate_select" and c1b.next_phase_may_mutate == true)
local c2b = create_project_tab(create_req, c1b)
assert(c2b.phase == "create_project_tab.verify_selection" and c2b.next_phase_may_mutate == false)
assert(calls.select_project == 1)
apply_pending_select()
local c3, c3_fail = create_project_tab(create_req, c2b)
assert(c3_fail == nil and c3.created == true and calls.select_project == 1)
`);
  });

  it("regression: prior dirty must stay exact after activate when Undo_EndBlock2 would +1 state count", () => {
    runLua(String.raw`
-- Without product dispatch skip_undo, a content Undo_EndBlock2 on prior would
-- bump dirty and VERIFY_FAILED prior_project_dirty_or_missing. Handler finish
-- still requires exact prior dirty equality (no verifier looseness).
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 0, dirty_b = 0, undo_end_increments_dirty = true })
local listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
local saved_ref = listed.projects[2].project_ref
assert(saved_a.dirty == 0)
local activated, failure = run_with_continuation(activate_project_tab, project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe"))
-- Native handler path does not open Undo itself; product dispatch owns that.
-- Prove finish verifier still demands exact prior dirty equality.
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker)))
assert(activated.prior_dirty_unchanged == true)
assert(activated.prior_raw_dirty_state == 0)
assert(saved_a.dirty == 0, "prior dirty must remain 0, got " .. tostring(saved_a.dirty))
assert(current_project == saved_b)

-- Simulate the pre-fix failure mode: if prior dirty was bumped, finish fails closed.
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 0, dirty_b = 0 })
listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
saved_ref = listed.projects[2].project_ref
local req = project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe")
local pre = activate_project_tab(req)
assert(pre.phase == "activate_project_tab.mutate_select")
assert(pre.state.prior_raw_dirty_state == 0)
assert(pre.state.selection_only_no_content_undo == true)
local mid = activate_project_tab(req, pre)
assert(mid.phase == "activate_project_tab.verify_selection")
-- Inject the live REAPER Undo_EndBlock2 dirty bump between select and verify.
saved_a.dirty = 1
local _, bumped = activate_project_tab(req, mid)
assert(bumped ~= nil)
assert(bumped.code == "VERIFY_FAILED")
assert(bumped.details.blocker == "prior_project_dirty_or_missing")
assert(bumped.details.prior_raw_dirty_before == 0)
assert(bumped.details.prior_raw_dirty_after == 1)
`);
  });

  it("fails closed on stale token, closed tab, duplicate path, and API failures without SWS", () => {
    runLua(String.raw`
install_project_tab_fake({ two_saved_one_unsaved = true })
local listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
local token_ref = listed.projects[3].project_ref
local token = token_ref:match("^project:tab:(.+)$")
d30_project_tab_tokens[token] = nil
local _, stale = activate_project_tab(project_request("project.activate_project_tab", { project_ref = token_ref }, {}, "safe"))
assert(stale ~= nil and stale.details.blocker == "stale_project_tab_token")

install_project_tab_fake({ two_saved_one_unsaved = true })
listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
token_ref = listed.projects[3].project_ref
table.remove(projects, 3)
local _, closed = activate_project_tab(project_request("project.activate_project_tab", {
  project_ref = token_ref,
}, {}, "safe"))
assert(closed ~= nil)
assert(closed.details.blocker == "project_ref_not_open" or closed.details.blocker == "stale_project_tab_token")

install_project_tab_fake({ only_parent = true })
local dup = { path = saved_a.path, dirty = 0, tracks = {}, items = {} }
projects[#projects + 1] = dup
local _, dup_fail = activate_project_tab(project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = "project:path:" .. saved_a.path, identity = { scheme = "path", value = saved_a.path } },
}, "safe"))
assert(dup_fail ~= nil)
assert(dup_fail.details.blocker == "project_path_duplicate" or dup_fail.details.blocker == "project_ref_duplicate" or dup_fail.details.blocker == "project_identity_duplicate")

install_project_tab_fake({ only_parent = true, enum_fail = true })
local _, enum_fail = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(enum_fail ~= nil)

install_project_tab_fake({ only_parent = true, dirty_fail = true })
local _, dirty_fail = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(dirty_fail ~= nil)

assert(calls.sws == 0)
`);
  });

  it("open failure after mutation restores prior only after a verified later tick", () => {
    runLua(String.raw`
local target = "/session/项目/demo 声音.RPP"
install_project_tab_fake({ only_parent = true, dirty_a = 7, open_target_path = target, open_failure = true, select_project_deferred = true })
local req = project_request("project.open_project_in_tab", { path = target }, {})
local p0 = open_project_in_tab(req)
assert(p0.phase == "open_project_in_tab.mutate_create" and p0.next_phase_may_mutate == true)
assert(calls.actions[41929] == nil)
local p1 = open_project_in_tab(req, p0)
assert(p1.phase == "open_project_in_tab.verify_created" and p1.next_phase_may_mutate == false)
assert(calls.actions[41929] == 1 and calls.open_project == 0)
local p2 = open_project_in_tab(req, p1)
assert(p2.phase == "open_project_in_tab.mutate_select" or p2.phase == "open_project_in_tab.open_into_active" or p2.phase == "open_project_in_tab.verify_blank_selection")
if p2.phase == "open_project_in_tab.mutate_select" then
  p2 = open_project_in_tab(req, p2)
end
if p2.phase == "open_project_in_tab.verify_blank_selection" then
  apply_pending_select()
  p2 = open_project_in_tab(req, p2)
end
assert(p2.phase == "open_project_in_tab.open_into_active" and p2.next_phase_may_mutate == true)
local p3 = open_project_in_tab(req, p2)
assert(p3.phase == "open_project_in_tab.schedule_restore_after_fail" and p3.next_phase_may_mutate == false)
assert(calls.open_project == 1)
local p4 = open_project_in_tab(req, p3)
assert(p4.phase == "open_project_in_tab.mutate_restore_after_fail" and p4.next_phase_may_mutate == true)
local p5 = open_project_in_tab(req, p4)
assert(p5.phase == "open_project_in_tab.verify_restore_after_fail" and p5.next_phase_may_mutate == false)
apply_pending_select()
local _, fail = open_project_in_tab(req, p5)
assert(fail ~= nil and fail.details.blocker == "main_open_project_failed")
assert(fail.details.prior_project_restored == true)
assert(current_project == saved_a and saved_a.dirty == 7)
`);
  });

  it("keeps create/open mutation at-most-once and never identifies new tabs on the 41929 tick", () => {
    runLua(String.raw`
install_project_tab_fake({ only_parent = true, dirty_a = 2 })
local req = project_request("project.create_project_tab", { name = "once", activate = true }, {})
local p0 = create_project_tab(req)
assert(p0.phase == "create_project_tab.mutate_create")
assert(p0.next_phase_may_mutate == true)
assert(calls.actions[41929] == nil)
local p1 = create_project_tab(req, p0)
assert(p1.phase == "create_project_tab.verify_created")
assert(calls.actions[41929] == 1)
assert(p1.state.projects_before ~= nil)
assert(p1.state.added_project == nil)
local p2 = create_project_tab(req, p1)
assert(p2.created == true)
assert(calls.actions[41929] == 1)

install_project_tab_fake({ only_parent = true, dirty_a = 3, open_target_path = "/session/Child.RPP" })
files["/session/Child.RPP"] = true
local oreq = project_request("project.open_project_in_tab", { path = "/session/Child.RPP" }, {})
local o0 = open_project_in_tab(oreq)
assert(o0.phase == "open_project_in_tab.mutate_create" and calls.actions[41929] == nil)
local o1 = open_project_in_tab(oreq, o0)
assert(o1.phase == "open_project_in_tab.verify_created" and calls.actions[41929] == 1)
assert(o1.state.blank_project == nil and o1.state.projects_before ~= nil)
local cont = o1
local opened = nil
for _ = 1, 12 do
  apply_pending_select()
  local summary, failure = open_project_in_tab(oreq, cont)
  if type(summary) == "table" and summary.contract == "openreaper.bridge.internal_continuation.v1" then
    cont = summary
  else
    opened = summary
    assert(failure == nil, failure and failure.code)
    break
  end
end
assert(opened ~= nil and opened.opened == true)
assert(calls.actions[41929] == 1 and calls.open_project == 1)
`);
  });

  it("create_project_tab activate=true keeps already-active blank tab without SelectProjectInstance", () => {
    runLua(String.raw`
install_project_tab_fake({ only_parent = true, dirty_a = 1 })
local req = project_request("project.create_project_tab", { name = "sound design", activate = true }, {})
local created, failure = run_with_continuation(create_project_tab, req)
assert(failure == nil, failure and failure.code)
assert(created.created == true and created.activate == true and created.active == true)
assert(created.path_state == "unsaved_project")
assert(calls.actions[41929] == 1)
assert(calls.select_project == 0)
assert(created.selection_mode == "already_active")
local active = d30_project_current_state()
assert(active ~= nil and active.project == current_project and active.path == "")
assert(current_project ~= saved_a)
`);
  });

  it("open_project_in_tab recognizes active unsaved blank then opens path once without extra select", () => {
    runLua(String.raw`
local target = "/session/Child.RPP"
install_project_tab_fake({ only_parent = true, dirty_a = 2, open_target_path = target })
files[target] = true
local req = project_request("project.open_project_in_tab", { path = target }, {})
local opened, failure = run_with_continuation(open_project_in_tab, req)
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker)))
assert(opened.opened == true and opened.path == target)
assert(opened.project_ref == "project:path:" .. target)
assert(calls.actions[41929] == 1)
assert(calls.open_project == 1)
assert(calls.select_project == 0)
assert(opened.selection_mode == "already_active")
assert(current_project.path == target)
local active = d30_project_current_state()
assert(active ~= nil and active.project == current_project and active.path == target)
assert(saved_a.dirty == 2)
`);
  });
});
