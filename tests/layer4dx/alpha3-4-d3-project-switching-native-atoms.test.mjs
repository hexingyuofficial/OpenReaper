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
function is_json_array(value) return type(value) == "table" end
function is_non_negative_integer(value)
  return type(value) == "number" and value == math.floor(value) and value >= 0 and value ~= math.huge
end
function json_array(value) return value or {} end
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
    local is_array = #value > 0 or next(value) == nil
    if is_array then
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
    refs = refs or {},
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
  }

  function file_exists(path) return files[path] == true end

  reaper = {}
  reaper.EnumProjects = function(index)
    if config.enum_fail then error("enum failed") end
    if index == -1 then
      if config.current_fail then error("current enum failed") end
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
  reaper.SelectProjectInstance = function(project)
    calls.select_project = calls.select_project + 1
    if not config.select_project_noop then
      current_project = project
    end
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
  reaper.SetProjExtState = function()
    error("ledger writes must not replace native tab materialization")
  end
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
  it("registers exactly three new project templates on the D30 module and keeps 235/91", () => {
    const catalog = createAcceptedOfficialTemplateCatalogTemplates();
    assert.equal(catalog.length, 235);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 235);
    assert.equal(REGISTRY.entries.length, 235);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
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

install_project_tab_fake({ only_parent = true })
projects[#projects + 1] = { path = saved_a.path, dirty = 0, tracks = {}, items = {} }
local _, dup = list_open_projects(project_request("project.list_open_projects", {}, {}, "read"))
assert(dup ~= nil and dup.details.blocker == "project_path_duplicate")
assert(dup.details.zero_write == true and calls.actions[41929] == nil)
`);
  });

  it("creates a real blank tab with exact identity and fails closed on zero/two added tabs", () => {
    runLua(String.raw`
install_project_tab_fake({ only_parent = true, dirty_a = 2 })
local created, failure = create_project_tab(project_request("project.create_project_tab", { name = "sound design", activate = true }, {}))
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker) .. ":" .. tostring(failure.message)))
assert(created.created == true, "created flag")
assert(created.live_materialization == "native_project_tab_verified", tostring(created.live_materialization))
assert(created.project_ref:match("^project:tab:") ~= nil, tostring(created.project_ref))
assert(created.prior_dirty_unchanged == true and created.prior_raw_dirty_state == 2)
assert(calls.actions[41929] == 1 and #projects == 2 and current_project ~= saved_a)
assert(saved_a.dirty == 2)

install_project_tab_fake({ only_parent = true, ambiguous_new_tabs = true })
local _, amb = create_project_tab(project_request("project.create_project_tab", { name = "x" }, {}))
assert(amb ~= nil, "ambiguous failure missing")
assert(amb.details.blocker == "new_project_tab_identity_ambiguous", tostring(amb.details and amb.details.blocker))
assert(amb.details.added_project_count == 2, tostring(amb.details.added_project_count))
assert(amb.details.partial_state ~= nil)

install_project_tab_fake({ only_parent = true, zero_new_tabs = true })
local _, zero = create_project_tab(project_request("project.create_project_tab", { name = "x" }, {}))
assert(zero ~= nil, "zero failure missing")
assert(zero.details.blocker == "new_project_tab_identity_ambiguous", tostring(zero.details and zero.details.blocker))
assert(zero.details.added_project_count == 0, tostring(zero.details and zero.details.added_project_count))

install_project_tab_fake({ only_parent = true, replace_old_tab = true })
local _, replaced = create_project_tab(project_request("project.create_project_tab", { name = "x" }, {}))
assert(replaced ~= nil and replaced.details.blocker == "project_tab_prior_instance_missing", tostring(replaced and replaced.details and replaced.details.blocker))

install_project_tab_fake({ only_parent = true, open_target_path = "/session/Child.RPP", replace_old_tab = true })
files["/session/Child.RPP"] = true
local _, open_replaced = open_project_in_tab(project_request("project.open_project_in_tab", { path = "/session/Child.RPP" }, {}))
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
local labeled, label_err = create_project_tab(project_request("project.create_project_tab", { name = long_cn, activate = true }, {}))
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
local opened, failure = open_project_in_tab(project_request("project.open_project_in_tab", { path = target }, {}))
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
local _, open_fail = open_project_in_tab(project_request("project.open_project_in_tab", { path = target }, {}))
assert(open_fail ~= nil and open_fail.details.blocker == "main_open_project_failed")
assert(open_fail.details.partial_state == "blank_tab_may_remain")
assert(open_fail.details.rollback_claimed == false)
assert(open_fail.details.prior_project_restored == true)
assert(current_project == saved_a and saved_a.dirty == 7)
`);
  });

  it("activates exact saved and unsaved refs, supports already-active and next-tab fallback", () => {
    runLua(String.raw`
install_project_tab_fake({ two_saved_one_unsaved = true, dirty_a = 1, dirty_b = 2 })
local listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
local saved_ref = listed.projects[2].project_ref
local unsaved_ref = listed.projects[3].project_ref
assert(saved_ref == "project:path:/session/Other.RPP")
assert(unsaved_ref:match("^project:tab:") ~= nil)

local activated, failure = activate_project_tab(project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe"))
assert(failure == nil, failure and (failure.code .. ":" .. tostring(failure.details and failure.details.blocker)))
assert(activated.activated == true and activated.already_active == false)
assert(current_project == saved_b and activated.prior_dirty_unchanged == true)
assert(saved_a.dirty == 1)

local again, again_failure = activate_project_tab(project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe"))
assert(again_failure == nil and again.already_active == true and again.selection_mode == "already_active")
assert(calls.select_project >= 1)

local tab_act, tab_failure = activate_project_tab(project_request("project.activate_project_tab", { project_ref = unsaved_ref }, {}, "safe"))
assert(tab_failure == nil, tab_failure and (tab_failure.code .. ":" .. tostring(tab_failure.details and tab_failure.details.blocker)))
assert(tab_act.activated == true and current_project == unsaved)

install_project_tab_fake({ two_saved_one_unsaved = true, select_project_noop = true })
listed = list_open_projects(project_request("project.list_open_projects", { limit = 10 }, {}, "read"))
saved_ref = listed.projects[2].project_ref
local fallback, fallback_failure = activate_project_tab(project_request("project.activate_project_tab", {}, {
  { kind = "project", ref = saved_ref, identity = { scheme = "path", value = "/session/Other.RPP" } },
}, "safe"))
assert(fallback_failure == nil, fallback_failure and (fallback_failure.code .. ":" .. tostring(fallback_failure.details and fallback_failure.details.blocker)))
assert(fallback.selection_mode == "next_project_tab_action")
assert(calls.actions[40861] ~= nil and calls.actions[40861] >= 1)
assert(current_project == saved_b)
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
});
