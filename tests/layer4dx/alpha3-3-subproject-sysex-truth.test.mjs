import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const SUBPROJECT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/d30_project_container_route.lua", import.meta.url),
  "utf8",
);
const SYSEX_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/insert_text_sysex_events.lua", import.meta.url),
  "utf8",
);

const PRELUDE = String.raw`
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
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
json = { encode = function() return "{}" end }
`;

describe("Alpha3.3 native Subproject and SysEx truth", () => {
  it("creates a real child RPP/proxy, inserts its exact source on the exact Track, and synchronously updates it", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({ copy_import_media = true })
local create_request = project_request("project.create_subproject", { name = "Dialog Edit", activate = true, inherit_time_selection = true }, {})
create_request.id = "req_create"
local created, failure, output_refs, _, refs = create_subproject(create_request)
assert(failure == nil and created.created == true and created.parent_restored == true)
assert(created.child_project_path == "/session/Dialog_Edit__subproject_req_create.RPP")
assert(created.proxy_path == created.child_project_path .. "-PROX")
assert(files[created.child_project_path] == true and files[created.proxy_path] == true)
assert(created.subproject_project_ref == "project:path:" .. created.child_project_path)
assert(created.inherited_time_selection == true and created.inherited_time_selection_start_seconds == 3 and created.inherited_time_selection_end_seconds == 7)
assert(output_refs[1].identity.scheme == "path" and output_refs[1].identity.value == created.child_project_path)
assert(output_refs[2].identity.scheme == "path" and output_refs[2].identity.value == "/session/Parent.RPP")
assert(current_project == parent_project and calls.actions[41929] == 1 and calls.actions[42332] == 1)
assert(child_project.time_start == 3 and child_project.time_end == 7)

local insert_request = project_request("project.insert_subproject_item", { position_seconds = 12.5, name = "Dialog Subproject" }, {
  refs[1],
  { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } },
})
insert_request.id = "req_insert"
local inserted, insert_failure, inserted_refs = insert_subproject_item(insert_request)
assert(insert_failure == nil and inserted.inserted == true, insert_failure and (insert_failure.code .. ":" .. tostring(insert_failure.details.blocker)) or "insert missing")
assert(inserted.position_seconds == 12.5 and inserted.source_path == created.child_project_path)
assert(inserted.source_proxy_path == created.proxy_path and inserted.requested_proxy_path == created.proxy_path)
assert(inserted.source_path_mode == "exact_requested_child_project")
assert(inserted.subproject_item_status == "native_source_verified")
assert(#parent_project.items == 2 and parent_project.items[2].track == target_track)
assert(parent_project.items[2].position == 12.5 and parent_project.items[2].length == 6.25)
assert(parent_project.items[2].take.name == "Dialog Subproject")
assert(parent_project.items[2].take.source.path == created.child_project_path)
assert(parent_project.items[2].take.source.subproject == child_project)
assert(other_track.selected == true and target_track.selected == false)
assert(parent_project.items[1].selected == true and parent_project.items[2].selected == false)
assert(cursor == 9 and inserted_refs[1].ref == "item:guid:{ITEM-NEW}")
assert(inserted_refs[1].identity.scheme == "guid" and inserted_refs[1].identity.value == "{ITEM-NEW}")
assert(calls.insert_media == 0 and calls.create_source == 1 and calls.add_item == 1 and calls.add_take == 1)

local update_request = project_request("project.render_or_update_subproject", { mode = "render_or_update" }, {
  refs[1], inserted_refs[1],
})
update_request.id = "req_update"
local updated, update_failure, _, jobs = render_or_update_subproject(update_request)
assert(update_failure == nil and updated.completed == true and updated.queued == false and updated.synchronous == true)
assert(updated.linked_item_verified == true and updated.parent_restored == true)
assert(jobs[1].summary.state == "completed" and current_project == parent_project)
assert(calls.actions[42332] == 2)
`);
  });

  it("fails before mutation on existing child targets and restores the parent after save/render readback failures", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({ existing_child = true })
local request = project_request("project.create_subproject", { name = "Dialog Edit" }, {})
request.id = "req_create"
local summary, failure = create_subproject(request)
assert(summary == nil and failure.code == "FILE_EXISTS")
assert(calls.actions[41929] == nil and current_project == parent_project)

install_subproject_fake({ no_proxy = true })
request = project_request("project.create_subproject", { name = "Dialog Edit" }, {})
request.id = "req_create"
summary, failure = create_subproject(request)
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.blocker == "subproject_proxy_missing")
assert(current_project == parent_project and calls.select_project >= 1)

install_subproject_fake({ save_failure = true })
request = project_request("project.create_subproject", { name = "Dialog Edit" }, {})
request.id = "req_create"
summary, failure = create_subproject(request)
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.blocker == "subproject_save_failed" and current_project == parent_project)
`);
  });

  it("saves and renders the one newly created inactive tab by native project pointer and fails closed when identity is ambiguous", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({ inactive_new_tab = true })
local request = project_request("project.create_subproject", { name = "Dialog Edit" }, {})
request.id = "req_create"
local summary, failure = create_subproject(request)
assert(failure == nil and summary.created == true and summary.parent_restored == true)
assert(current_project == parent_project and calls.select_project == 0)
assert(files[summary.child_project_path] == true and files[summary.proxy_path] == true)
assert(calls.actions[40861] == nil)

install_subproject_fake({ ambiguous_new_tabs = true })
request = project_request("project.create_subproject", { name = "Dialog Edit" }, {})
request.id = "req_create"
summary, failure = create_subproject(request)
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.blocker == "new_project_tab_identity_ambiguous")
assert(failure.details.added_project_count == 2 and current_project == parent_project)
`);
  });

  it("renders an already-open child by pointer and refuses to replace the parent for a closed child", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({})
files["/session/ClosedChild.RPP"] = true
local child_ref = { kind = "project", ref = "project:path:/session/ClosedChild.RPP", identity = { scheme = "path", value = "/session/ClosedChild.RPP" } }
local request = project_request("project.render_or_update_subproject", { mode = "render" }, { child_ref })
request.id = "closed_child"
local summary, failure = render_or_update_subproject(request)
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.blocker == "subproject_must_be_open_for_native_update")
assert(current_project == parent_project and calls.actions[41929] == nil and calls.actions[42332] == nil)

install_subproject_fake({ open_child_path = "/session/ClosedChild.RPP" })
request = project_request("project.render_or_update_subproject", { mode = "render" }, { child_ref })
request.id = "open_child"
summary, failure = render_or_update_subproject(request)
assert(failure == nil and summary.completed == true and summary.queued == false)
assert(summary.proxy_path == "/session/ClosedChild.RPP-PROX" and files[summary.proxy_path] == true)
assert(current_project == parent_project and calls.actions[42332] == 1 and calls.select_project == 0)

install_subproject_fake({ open_child_path = "/session/ClosedChild.RPP", render_failure = true })
files["/session/ClosedChild.RPP"] = true
request = project_request("project.render_or_update_subproject", { mode = "render" }, { child_ref })
request.id = "closed_child_failure"
summary, failure = render_or_update_subproject(request)
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.blocker == "subproject_render_action_failed" and current_project == parent_project)
`);
  });

  it("fails before mutation when the exact open child cannot produce a valid native project source", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
local child_path = "/session/Child.RPP"
local child_ref = { kind = "project", ref = "project:path:" .. child_path, identity = { scheme = "path", value = child_path } }
local function insert_with(config)
  install_subproject_fake(config)
  files[child_path] = true
  files[child_path .. "-PROX"] = true
  local request = project_request("project.insert_subproject_item", { position_seconds = 4 }, {
    child_ref,
    { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } },
  })
  return insert_subproject_item(request)
end

local summary, failure = insert_with({})
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.blocker == "subproject_must_be_open_for_native_source")
assert(#parent_project.items == 1 and calls.create_source == 0 and calls.insert_media == 0)

summary, failure = insert_with({ open_child_path = child_path, source_create_failure = true })
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.blocker == "subproject_source_create_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 0)

summary, failure = insert_with({ open_child_path = child_path, source_type = "WAVE" })
assert(summary == nil and failure.details.blocker == "subproject_source_type_mismatch")
assert(#parent_project.items == 1 and calls.destroy_source == 1)

summary, failure = insert_with({ open_child_path = child_path, source_path = "/session/Wrong.RPP" })
assert(summary == nil and failure.details.blocker == "subproject_source_path_mismatch")
assert(#parent_project.items == 1 and calls.destroy_source == 1)

summary, failure = insert_with({ open_child_path = child_path, source_length = 0 })
assert(summary == nil and failure.details.blocker == "subproject_source_length_invalid")
assert(#parent_project.items == 1 and calls.destroy_source == 1)

summary, failure = insert_with({ open_child_path = child_path, source_length_is_qn = true })
assert(summary == nil and failure.details.blocker == "subproject_source_length_invalid")
assert(#parent_project.items == 1 and calls.destroy_source == 1)

`);
  });

  it("rolls back partial native Item creation on every post-mutation failure", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
local child_path = "/session/Child.RPP"
local child_ref = { kind = "project", ref = "project:path:" .. child_path, identity = { scheme = "path", value = child_path } }
local function insert_with(config)
  config.open_child_path = child_path
  install_subproject_fake(config)
  files[child_path .. "-PROX"] = true
  local request = project_request("project.insert_subproject_item", { position_seconds = 4, name = "Child" }, {
    child_ref,
    { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } },
  })
  return insert_subproject_item(request)
end

local summary, failure = insert_with({ add_item_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_item_create_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 1 and calls.delete_item == 0)

summary, failure = insert_with({ add_take_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_take_create_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 1 and calls.delete_item == 1)

summary, failure = insert_with({ position_write_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_item_bounds_write_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 1 and calls.delete_item == 1)

summary, failure = insert_with({ length_write_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_item_bounds_write_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 1 and calls.delete_item == 1)

summary, failure = insert_with({ set_source_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_take_source_write_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 1 and calls.delete_item == 1)

summary, failure = insert_with({ update_item_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_item_update_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 0 and calls.delete_item == 1)

summary, failure = insert_with({ wrong_source_readback = true })
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.blocker == "subproject_source_readback_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 0 and calls.delete_item == 1)

summary, failure = insert_with({ missing_child_pointer = true })
assert(summary == nil and failure.details.blocker == "subproject_source_readback_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 0 and calls.delete_item == 1)

summary, failure = insert_with({ wrong_child_pointer = true })
assert(summary == nil and failure.details.blocker == "subproject_source_readback_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 0 and calls.delete_item == 1)

summary, failure = insert_with({ name_readback_failure = true })
assert(summary == nil and failure.details.blocker == "subproject_item_name_readback_failed")
assert(#parent_project.items == 1 and calls.destroy_source == 0 and calls.delete_item == 1)
assert(other_track.selected == true and target_track.selected == false and cursor == 9)
assert(calls.insert_media == 0)
`);
  });

  it("reports rollback failure instead of hiding a partially created Item", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({
  open_child_path = "/session/Child.RPP",
  update_item_failure = true,
  delete_item_failure = true,
})
files["/session/Child.RPP"] = true
files["/session/Child.RPP-PROX"] = true
local child_ref = { kind = "project", ref = "project:path:/session/Child.RPP", identity = { scheme = "path", value = "/session/Child.RPP" } }
local request = project_request("project.insert_subproject_item", { position_seconds = 4 }, {
  child_ref,
  { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } },
})
local summary, failure = insert_subproject_item(request)
assert(summary == nil and failure.code == "RESTORE_FAILED")
assert(failure.details.original_blocker == "subproject_item_update_failed")
assert(failure.details.item_deleted == false and #parent_project.items == 2)
`);
  });

  it("verifies native subproject truth across bounded wrapper-source chains", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({ open_child_path = "/session/Child.RPP" })
local expected = "/session/Child.RPP-PROX"
local associated_project = child_project
local function truth_for(source)
  return d30_item_source_truth(
    { track = target_track, take = { source = source } },
    expected,
    "/session/Child.RPP"
  )
end

local direct = { path = expected, subproject = associated_project }
local truth = truth_for(direct)
assert(truth ~= nil and truth.source == direct and truth.subproject_source == direct)

local associated_parent = { path = "", subproject = associated_project }
local path_wrapper = { path = expected, parent = associated_parent }
truth = truth_for(path_wrapper)
assert(truth ~= nil and truth.source == path_wrapper and truth.subproject_source == associated_parent)

local path_parent = { path = expected }
local associated_wrapper = { path = "", subproject = associated_project, parent = path_parent }
truth = truth_for(associated_wrapper)
assert(truth ~= nil and truth.source == path_parent and truth.subproject_source == associated_wrapper)

assert(truth_for({ path = expected, parent = { path = "" } }) == nil)
assert(truth_for({ path = "/wrong/source.RPP-PROX", subproject = associated_project }) == nil)
assert(truth_for({ raise_path = true, parent = { path = expected, subproject = associated_project } }) == nil)
assert(truth_for({ raise_subproject = true, parent = { path = expected, subproject = associated_project } }) == nil)
assert(truth_for({ path = expected, subproject = associated_project, raise_parent = true }) == nil)

local cyclic = { path = expected, subproject = associated_project }
cyclic.parent = cyclic
assert(truth_for(cyclic) == nil)

local max_depth = { path = expected, subproject = associated_project }
local max_cursor = max_depth
for _ = 1, 15 do
  max_cursor.parent = { path = "" }
  max_cursor = max_cursor.parent
end
assert(truth_for(max_depth) ~= nil)

local over_deep = { path = expected, subproject = associated_project }
local cursor_source = over_deep
for _ = 1, 16 do
  cursor_source.parent = { path = "" }
  cursor_source = cursor_source.parent
end
assert(truth_for(over_deep) == nil)
`);
  });

  it("uses wrapper-source truth for both insertion and later linked-item update", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
install_subproject_fake({ open_child_path = "/session/Child.RPP", wrapper_source = true })
files["/session/Child.RPP-PROX"] = true
local child_ref = { kind = "project", ref = "project:path:/session/Child.RPP", identity = { scheme = "path", value = "/session/Child.RPP" } }
local insert_request = project_request("project.insert_subproject_item", { position_seconds = 4 }, {
  child_ref,
  { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } },
})
local inserted, insert_failure, inserted_refs = insert_subproject_item(insert_request)
assert(insert_failure == nil and inserted.inserted == true)
local inserted_source = parent_project.items[2].take.source
assert(inserted_source.path == "/session/Child.RPP")
assert(inserted_source.subproject == nil and inserted_source.parent.subproject == child_project)
assert(inserted.source_path == "/session/Child.RPP")
assert(inserted.source_proxy_path == "/session/Child.RPP-PROX")
assert(inserted.source_path_mode == "exact_requested_child_project")

local update_request = project_request("project.render_or_update_subproject", { mode = "render_or_update" }, {
  child_ref, inserted_refs[1],
})
local updated, update_failure = render_or_update_subproject(update_request)
assert(update_failure == nil and updated.completed == true and updated.linked_item_verified == true)

inserted_source.parent.subproject = nil
updated, update_failure = render_or_update_subproject(update_request)
assert(updated == nil and update_failure.code == "VERIFY_FAILED")
assert(update_failure.details.blocker == "linked_item_source_readback_failed")
`);
  });

  it("retains legacy managed-copy readback only with the exact child pointer and existing proxy file", () => {
    runLua(SUBPROJECT_SOURCE, String.raw`
local managed_source_path = "/session/Media/Child.RPP"
install_subproject_fake({ open_child_path = "/session/Child.RPP" })
files["/session/Child.RPP-PROX"] = true
files[managed_source_path .. "-PROX"] = true
local source = { path = managed_source_path, source_type = "RPP_PROJECT", subproject = child_project }
local item = { track = target_track, take = { source = source } }
local truth = d30_item_source_truth(item, "/session/Child.RPP-PROX", "/session/Child.RPP")
assert(truth ~= nil and truth.source_path == managed_source_path)
assert(truth.source_proxy_path == managed_source_path .. "-PROX")
assert(truth.source_path_mode == "reaper_managed_proxy_copy")

source.subproject = { path = "/session/OtherChild.RPP" }
assert(d30_item_source_truth(item, "/session/Child.RPP-PROX", "/session/Child.RPP") == nil)

source.subproject = child_project
files[managed_source_path .. "-PROX"] = nil
assert(d30_item_source_truth(item, "/session/Child.RPP-PROX", "/session/Child.RPP") == nil)
`);
  });

  it("persists mixed text and duplicate SysEx from integer-array and hex inputs with exact row-delta readback", () => {
    runLua(SYSEX_SOURCE, String.raw`
install_midi_fake({})
local request = midi_request({
  { ppq = 0, event_kind = "lyric", text = "hello" },
  { ppq = 120, event_kind = "sysex", bytes = { 240, 125, 1, 2, 247 } },
  { ppq = 120, event_kind = "sysex", bytes = "F0 7D 01 02 F7" },
})
local summary, failure = safe_write_insert_text_sysex_events(request)
assert(failure == nil and summary.inserted_count == 3 and summary.verified_text_sysex_count == 3)
assert(summary.verified_by_kind.lyric == 1 and summary.verified_by_kind.sysex == 2)
assert(summary.verification_mode == "exact_row_multiset_delta")
assert(#midi_rows == 4 and calls.insert == 3 and calls.sort == 1)
local expected = string.char(125, 1, 2)
assert(midi_rows[3].payload == expected and midi_rows[4].payload == expected)
`);
  });

  it("rejects malformed SysEx before mutation and reports VERIFY_FAILED when dispatch success is not persisted", () => {
    runLua(SYSEX_SOURCE, String.raw`
install_midi_fake({})
local summary, failure = safe_write_insert_text_sysex_events(midi_request({
  { ppq = 0, event_kind = "sysex", bytes = "F0 80 F7" },
}))
assert(summary == nil and failure.code == "PARAMS_INVALID")
assert(failure.details.blocker == "sysex_bytes_invalid" and calls.insert == 0)

install_midi_fake({ drop_sysex = true })
summary, failure = safe_write_insert_text_sysex_events(midi_request({
  { ppq = 0, event_kind = "sysex", bytes = { 240, 125, 247 } },
}))
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.blocker == "aggregate_count_delta_mismatch")
assert(calls.insert == 1)
`);
  });
});

const FIXTURES = String.raw`
function project_request(capability, params, refs)
  return {
    id = "request",
    params = params or {},
    refs = refs or {},
    pack = { id = "project", capability = capability, risk = "write" },
  }
end

function install_subproject_fake(config)
  config = config or {}
  parent_project = { path = "/session/Parent.RPP", items = {}, time_start = 3, time_end = 7 }
  child_project = nil
  current_project = parent_project
  projects = { parent_project }
  files = { [parent_project.path] = true }
  target_track = { guid = "{TARGET}", name = "Target", selected = false }
  other_track = { guid = "{OTHER}", name = "Other", selected = true }
  parent_project.tracks = { target_track, other_track }
  existing_item = { guid = "{ITEM-OLD}", track = other_track, position = 1, selected = true }
  parent_project.items[1] = existing_item
  cursor = 9
  calls = {
    actions = {},
    select_project = 0,
    insert_media = 0,
    create_source = 0,
    destroy_source = 0,
    add_item = 0,
    add_take = 0,
    set_take_source = 0,
    delete_item = 0,
    update_item = 0,
  }
  local expected_child = "/session/Dialog_Edit__subproject_req_create.RPP"
  if config.existing_child then files[expected_child] = true end
  if config.open_child_path then
    child_project = { path = config.open_child_path, tracks = {}, items = {}, time_start = 0, time_end = 0 }
    projects[#projects + 1] = child_project
    files[config.open_child_path] = true
  end
  function file_exists(path) return files[path] == true end

  reaper = {}
  reaper.EnumProjects = function(index)
    if index == -1 then return current_project, current_project.path or "" end
    local project = projects[index + 1]
    if not project then return nil, "" end
    return project, project.path or ""
  end
  reaper.Main_OnCommandEx = function(action, flag, project)
    calls.actions[action] = (calls.actions[action] or 0) + 1
    if action == 41929 then
      assert(flag == 0 and project == 0)
      child_project = { path = "", tracks = {}, items = {}, time_start = 0, time_end = 0 }
      projects[#projects + 1] = child_project
      if config.ambiguous_new_tabs then
        projects[#projects + 1] = { path = "", tracks = {}, items = {}, time_start = 0, time_end = 0 }
      end
      if not config.inactive_new_tab and not config.ambiguous_new_tabs then current_project = child_project end
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
    assert(action == 42332 and flag == 0 and project == child_project)
    if config.render_failure then return false end
    if not config.no_proxy then files[project.path .. "-PROX"] = true end
    return nil
  end
  reaper.Main_SaveProjectEx = function(project, path, options)
    assert(project == child_project and options == 8)
    if config.save_failure then return false end
    project.path = path
    files[path] = true
    return nil
  end
  reaper.SelectProjectInstance = function(project)
    calls.select_project = calls.select_project + 1
    if not config.select_project_noop then current_project = project end
  end
  reaper.SetProjExtState = function(project) assert(project == parent_project); return 1 end
  reaper.GetSet_LoopTimeRange2 = function(project, is_set, is_loop, start_time, end_time)
    assert(is_loop == false)
    if is_set then
      project.time_start = start_time
      project.time_end = end_time
    end
    return project.time_start, project.time_end
  end
  reaper.CountTracks = function(project) return #(project.tracks or {}) end
  reaper.GetTrack = function(project, index) return (project.tracks or {})[index + 1] end
  reaper.GetTrackGUID = function(track) return track.guid end
  reaper.GetTrackName = function(track) return true, track.name end
  reaper.GetSelectedTrack = function(project, index)
    local selected = {}
    for _, track in ipairs(project.tracks or {}) do if track.selected then selected[#selected + 1] = track end end
    return selected[index + 1]
  end
  reaper.InsertTrackAtIndex = function(index)
    local track = { guid = "{CREATED}", name = "Created", selected = false }
    table.insert(current_project.tracks, index + 1, track)
  end
  reaper.IsTrackSelected = function(track) return track.selected == true end
  reaper.SetTrackSelected = function(track, selected) track.selected = selected == true end
  reaper.CountMediaItems = function(project) return #(project.items or {}) end
  reaper.GetMediaItem = function(project, index) return (project.items or {})[index + 1] end
  reaper.IsMediaItemSelected = function(item) return item.selected == true end
  reaper.SetMediaItemSelected = function(item, selected) item.selected = selected == true end
  reaper.GetCursorPositionEx = function(project) assert(project == parent_project); return cursor end
  reaper.SetEditCurPos2 = function(project, value) assert(project == parent_project); cursor = value end
  reaper.UpdateArrange = function() end
  reaper.InsertMedia = function(path, mode)
    calls.insert_media = calls.insert_media + 1
    error("InsertMedia must not be used for native subproject insertion: " .. tostring(path) .. ":" .. tostring(mode))
  end
  reaper.PCM_Source_CreateFromFile = function(path)
    calls.create_source = calls.create_source + 1
    assert(path:match("%.RPP$") and not path:match("%-PROX$"))
    if config.source_create_failure then return nil end
    local associated_project = config.wrong_child_pointer and { path = "/session/OtherChild.RPP" } or child_project
    if config.missing_child_pointer then associated_project = nil end
    return {
      path = config.source_path or path,
      source_type = config.source_type or "RPP_PROJECT",
      length = config.source_length == nil and 6.25 or config.source_length,
      length_is_qn = config.source_length_is_qn == true,
      subproject = associated_project,
    }
  end
  reaper.PCM_Source_Destroy = function(source)
    calls.destroy_source = calls.destroy_source + 1
    source.destroyed = true
  end
  reaper.GetMediaSourceType = function(source)
    if source.raise_type then error("source type read failed") end
    if source.source_type then return source.source_type end
    return source.path and source.path ~= "" and "RPP_PROJECT" or "SECTION"
  end
  reaper.GetMediaSourceLength = function(source)
    return source.length, source.length_is_qn == true
  end
  reaper.AddMediaItemToTrack = function(track)
    calls.add_item = calls.add_item + 1
    if config.add_item_failure then return nil end
    local item = {
      guid = "{ITEM-NEW}",
      track = track,
      position = 0,
      length = 0,
      selected = true,
      take = nil,
    }
    parent_project.items[#parent_project.items + 1] = item
    return item
  end
  reaper.AddTakeToMediaItem = function(item)
    calls.add_take = calls.add_take + 1
    if config.add_take_failure then return nil end
    local take = { source = nil, name = "" }
    item.take = take
    return take
  end
  reaper.SetMediaItemInfo_Value = function(item, key, value)
    if key == "D_POSITION" then
      if config.position_write_failure then return false end
      item.position = value
      return true
    end
    assert(key == "D_LENGTH")
    if config.length_write_failure then return false end
    item.length = value
    return true
  end
  reaper.SetMediaItemTake_Source = function(take, source)
    calls.set_take_source = calls.set_take_source + 1
    if config.set_source_failure then return false end
    if config.wrapper_source then
      take.source = {
        path = source.path,
        source_type = source.source_type,
        length = source.length,
        length_is_qn = source.length_is_qn,
        parent = { path = "", source_type = "SECTION", subproject = source.subproject },
      }
    else
      take.source = source
    end
  end
  reaper.UpdateItemInProject = function(item)
    calls.update_item = calls.update_item + 1
    if config.update_item_failure then return false end
  end
  reaper.DeleteTrackMediaItem = function(track, item)
    calls.delete_item = calls.delete_item + 1
    assert(track == item.track)
    if config.delete_item_failure then return false end
    for index, candidate in ipairs(parent_project.items) do
      if candidate == item then
        table.remove(parent_project.items, index)
        return true
      end
    end
    return false
  end
  reaper.BR_GetMediaItemGUID = function(item) return item.guid end
  reaper.GetMediaItem_Track = function(item) return item.track end
  reaper.GetActiveTake = function(item) return item.take end
  reaper.GetMediaItemTake_Source = function(take)
    if config.wrong_source_readback then
      return { path = "/wrong/source.RPP", source_type = "RPP_PROJECT", subproject = child_project }
    end
    return take.source
  end
  reaper.GetMediaSourceFileName = function(source)
    if source.raise_path then error("source path read failed") end
    return source.path
  end
  reaper.GetSubProjectFromSource = function(source)
    if source.raise_subproject then error("subproject read failed") end
    return source.subproject
  end
  reaper.GetMediaSourceParent = function(source)
    if source.raise_parent then error("parent source read failed") end
    return source.parent
  end
  reaper.GetMediaItemInfo_Value = function(item, key)
    if key == "D_POSITION" then return item.position end
    assert(key == "D_LENGTH")
    return item.length
  end
  reaper.GetSetMediaItemTakeInfo_String = function(take, key, value, set_new)
    assert(key == "P_NAME")
    if set_new then take.name = value end
    if config.name_readback_failure and not set_new then return true, "wrong" end
    return true, take.name
  end
end

READ_B_MIDI = {}
function READ_B_MIDI.resolve_midi_take_for_request() return midi_take end
function READ_B_MIDI.take_ref_string() return "take:guid:{MIDI-TAKE}" end

function midi_request(events)
  return {
    params = { events = events, position_unit = "ppq", sort_events = true },
    refs = { { kind = "take", ref = "take:guid:{MIDI-TAKE}", identity = { scheme = "guid", value = "{MIDI-TAKE}" } } },
    pack = { id = "midi", capability = "midi.insert_text_sysex_events", risk = "write" },
  }
end

function install_midi_fake(config)
  config = config or {}
  midi_take = {}
  midi_rows = {
    { selected = false, muted = false, ppq = -120, type_value = 1, payload = "existing" },
  }
  calls = { insert = 0, sort = 0 }
  reaper = {}
  reaper.MIDI_CountEvts = function(take)
    assert(take == midi_take)
    return true, 0, 0, #midi_rows
  end
  reaper.MIDI_GetTextSysexEvt = function(take, index)
    assert(take == midi_take)
    local row = midi_rows[index + 1]
    if not row then return false end
    return true, row.selected, row.muted, row.ppq, row.type_value, row.payload
  end
  reaper.MIDI_InsertTextSysexEvt = function(take, selected, muted, ppq, type_value, payload, no_sort)
    assert(take == midi_take and no_sort == true)
    calls.insert = calls.insert + 1
    if config.dispatch_failure then return false end
    if not (config.drop_sysex and type_value == -1) then
      midi_rows[#midi_rows + 1] = {
        selected = selected,
        muted = muted,
        ppq = ppq,
        type_value = type_value,
        payload = payload,
      }
    end
    return true
  end
  reaper.MIDI_Sort = function(take) assert(take == midi_take); calls.sort = calls.sort + 1 end
  reaper.MIDI_GetPPQPosFromProjTime = function(take, seconds) assert(take == midi_take); return seconds * 960 end
end
`;

function runLua(handlerSource, body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const script = `${PRELUDE}\n${FIXTURES}\n${handlerSource}\n${body}`;
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
