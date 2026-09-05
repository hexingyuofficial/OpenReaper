import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/save_project_file.lua", import.meta.url),
  "utf8",
);

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
function json_array(value) return value or {} end
function bounded_string(value, max_bytes)
  local text = type(value) == "string" and value or tostring(value or "")
  if #text <= max_bytes then return text end
  return text:sub(1, max_bytes)
end
function has_control_byte(value)
  for index = 1, #value do
    local byte = string.byte(value, index)
    if byte < 0x20 or byte == 0x7F then return true end
  end
  return false
end
function safe_budget(request)
  return request.budget or { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 2048 }
end
function make_request(capability, params, budget)
  return {
    refs = json_array({}),
    params = params or {},
    pack = { id = "project", capability = capability, risk = "write" },
    budget = budget or { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 2048 },
  }
end
function install_fake(config)
  calls = { api_exists = 0, enum = 0, dirty = 0, save_current = 0, save_as = 0 }
  local enum_index = 0
  local current_state = config.states[1]
  reaper = {}
  reaper.APIExists = function(name)
    calls.api_exists = calls.api_exists + 1
    if config.api_exists_throw == name then error("APIExists throw: " .. name) end
    if config.api_exists_false == name then return false end
    return true
  end
  reaper.EnumProjects = function(index, buffer)
    calls.enum = calls.enum + 1
    enum_index = math.min(enum_index + 1, #config.states)
    current_state = config.states[enum_index]
    return config.project or {}, current_state.path
  end
  reaper.IsProjectDirty = function(project)
    calls.dirty = calls.dirty + 1
    return current_state.dirty
  end
  reaper.Main_SaveProject = function(project, force_save_as)
    calls.save_current = calls.save_current + 1
    if config.save_current_behavior == "throw" then error("save current failed") end
    if config.save_current_behavior == "false" then return false end
    return nil
  end
  reaper.Main_SaveProjectEx = function(project, target, options)
    calls.save_as = calls.save_as + 1
    calls.save_as_target = target
    calls.save_as_options = options
    if config.save_as_behavior == "throw" then error("save as failed") end
    if config.save_as_behavior == "false" then return false end
    return nil
  end
  if config.binding_missing then reaper[config.binding_missing] = nil end
end
`;

function runLua(body) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const source = `${PRELUDE}\n${HANDLER_SOURCE}\n${body}\nreturn true`;
  const loadStatus = lauxlib.luaL_loadstring(L, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  const callStatus = lua.lua_pcall(L, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  assert.equal(lua.lua_toboolean(L, -1), true);
  lua.lua_close(L);
}

function currentBody({ setup = "", assertions }) {
  return `
install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 }, { path = "/source/Current.RPP", dirty = 0 } }, save_current_behavior = "nil" })
${setup}
local summary, failure = save_current_project(make_request("project.save_current_project", {}))
${assertions}
`;
}

function resolveSaveAsLua(requestExpression) {
  return `
local summary, failure = save_project_as(${requestExpression})
local continuation_count = 0
while failure == nil and summary ~= nil and summary.contract == "openreaper.bridge.internal_continuation.v1" do
  continuation_count = continuation_count + 1
  assert(continuation_count < 12)
  summary, failure = save_project_as(${requestExpression}, summary)
end
`;
}

function saveAsBody({ setup = "", assertions }) {
  return `
local target = "/target/Saved.RPP"
install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 }, { path = target, dirty = 0 } }, save_as_behavior = "nil" })
${setup}
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
${assertions}
`;
}

describe("Alpha3.2-C3BC executable fake-REAPER Lua save handler behavior", () => {
  it("blocks an unsaved current project without calling Main_SaveProject", () => {
    runLua(`
install_fake({ states = { { path = "", dirty = 1 } }, save_current_behavior = "nil" })
local summary, failure = save_current_project(make_request("project.save_current_project", {}))
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.details.blocker == "unsaved_project")
assert(calls.save_current == 0)
`);
  });

  it("fails closed for APIExists false/throw and missing direct API binding", () => {
    for (const setup of [
      'install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } }, api_exists_false = "Main_SaveProject" })',
      'install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } }, api_exists_throw = "Main_SaveProject" })',
      'install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } }, binding_missing = "Main_SaveProject" })',
    ]) {
      runLua(`
${setup}
local summary, failure = save_current_project(make_request("project.save_current_project", {}))
assert(summary == nil)
assert(failure.code == "INTERNAL_ERROR")
assert(calls.save_current == 0)
`);
    }
    for (const setup of [
      'install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } }, api_exists_false = "Main_SaveProjectEx" })',
      'install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } }, api_exists_throw = "Main_SaveProjectEx" })',
      'install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } }, binding_missing = "Main_SaveProjectEx" })',
    ]) {
      runLua(`
local target = "/target/Saved.RPP"
${setup}
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
assert(summary == nil)
assert(failure.code == "INTERNAL_ERROR")
assert(calls.save_as == 0)
`);
    }
  });

  it("handles save API pcall failure, nil void success, and false-return failure", () => {
    runLua(currentBody({
      setup: 'reaper.Main_SaveProject = function() calls.save_current = calls.save_current + 1; error("boom") end',
      assertions: 'assert(summary == nil); assert(failure.code == "COMMAND_FAILED"); assert(failure.details.reason == "pcall_failed"); assert(calls.save_current == 1)',
    }));
    runLua(currentBody({
      assertions: 'assert(failure == nil); assert(summary.path_unchanged == true); assert(summary.after_raw_dirty_state == 0); assert(calls.save_current == 1)',
    }));
    runLua(currentBody({
      setup: 'reaper.Main_SaveProject = function() calls.save_current = calls.save_current + 1; return false end',
      assertions: 'assert(summary == nil); assert(failure.code == "COMMAND_FAILED"); assert(failure.details.reason == "failure_return"); assert(calls.save_current == 1)',
    }));
    runLua(saveAsBody({
      setup: 'reaper.Main_SaveProjectEx = function() calls.save_as = calls.save_as + 1; error("boom") end',
      assertions: 'assert(summary == nil); assert(failure.code == "COMMAND_FAILED"); assert(failure.details.reason == "pcall_failed"); assert(calls.save_as == 1)',
    }));
    runLua(saveAsBody({
      setup: 'reaper.Main_SaveProjectEx = function() calls.save_as = calls.save_as + 1; return false end',
      assertions: 'assert(summary == nil); assert(failure.code == "COMMAND_FAILED"); assert(failure.details.reason == "failure_return"); assert(calls.save_as == 1)',
    }));
  });

  it("fails save-current exact-path and dirty verification mismatches", () => {
    runLua(`
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = "/source/B.RPP", dirty = 0 } } })
local summary, failure = save_current_project(make_request("project.save_current_project", {}))
assert(summary == nil); assert(failure.code == "VERIFY_FAILED"); assert(failure.details.blocker == "project_path_mismatch"); assert(calls.save_current == 1)
`);
    runLua(`
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = "/source/A.RPP", dirty = 2 } } })
local summary, failure = save_current_project(make_request("project.save_current_project", {}))
assert(summary == nil); assert(failure.code == "VERIFY_FAILED"); assert(failure.details.blocker == "project_dirty_after_save"); assert(calls.save_current == 1)
`);
  });

  it("fails save-as exact-path and dirty verification mismatches", () => {
    runLua(`
local target = "/target/Saved.RPP"
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = "/target/Other.RPP", dirty = 0 } } })
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
assert(summary == nil); assert(failure.code == "VERIFY_FAILED"); assert(failure.details.blocker == "project_path_target_mismatch"); assert(calls.save_as == 1)
`);
    runLua(`
local target = "/target/Saved.RPP"
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = target, dirty = 1 } } })
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
    assert(summary == nil); assert(failure.code == "VERIFY_FAILED"); assert(failure.details.blocker == "project_dirty_after_save_as"); assert(calls.save_as == 1)
  `);
  });

  it("stabilizes a dirty Save-As readback with one stock current-project save", () => {
    runLua(`
local target = "/target/Saved.RPP"
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = target, dirty = 0 }, { path = target, dirty = 1 }, { path = target, dirty = 1 }, { path = target, dirty = 0 } } })
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
assert(failure == nil)
assert(summary.path_matches_target == true)
assert(summary.after_raw_dirty_state == 0)
assert(calls.save_as == 1)
assert(calls.save_current == 1)
`);
  });

  it("succeeds through each direct API exactly once with nil void returns and flag 8", () => {
    runLua(currentBody({
      assertions: 'assert(failure == nil); assert(summary.project_ref == "project:current"); assert(calls.save_current == 1)',
    }));
    runLua(saveAsBody({
      assertions: 'assert(failure == nil); assert(summary.path_matches_target == true); assert(summary.overwrite == true); assert(calls.save_as == 1); assert(calls.save_as_target == target); assert(calls.save_as_options == 8)',
    }));
  });

  it("passes a Unicode and spaced absolute target unchanged to the stock save API", () => {
    runLua(`
local target = "/Users/测试 用户/工程/【音频】 白×滑动音阶/探索 🚀.RPP"
install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 }, { path = target, dirty = 0 } }, save_as_behavior = "nil" })
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
assert(failure == nil)
assert(summary.path_matches_target == true)
assert(calls.save_as == 1)
assert(calls.save_as_target == target)
`);
  });

  it("rejects locale-independent raw control bytes before stock save mutation", () => {
    runLua(`
for _, byte in ipairs({ 0, 9, 10, 31, 127 }) do
  local target = "/target/Bad" .. string.char(byte) .. ".RPP"
  install_fake({ states = { { path = "/source/Current.RPP", dirty = 1 } } })
  local summary, failure = save_project_as(make_request("project.save_project_as", { target_path = target, overwrite = true }))
  assert(summary == nil)
  assert(failure.code == "PARAMS_INVALID")
  assert(failure.details.blocker == "target_structure_invalid")
  assert(calls.save_as == 0)
end
`);
  });

  it("proves the complete success-envelope budget before save and defaults pass maximum supported paths", () => {
    runLua(`
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = "/source/A.RPP", dirty = 0 } } })
local budget = { max_response_bytes = 1000, max_items = 50, max_inline_value_bytes = 2048 }
local summary, failure = save_current_project(make_request("project.save_current_project", {}, budget))
assert(summary == nil); assert(failure.code == "RESPONSE_TOO_LARGE"); assert(failure.details.blocker == "success_envelope_budget_insufficient"); assert(calls.save_current == 0)
`);
    runLua(`
local max_path = "/" .. string.rep("a", 2043) .. ".RPP"
assert(#max_path == 2048)
install_fake({ states = { { path = max_path, dirty = 1 }, { path = max_path, dirty = 0 } } })
local summary, failure = save_current_project(make_request("project.save_current_project", {}))
assert(failure == nil); assert(summary.path_unchanged == true); assert(calls.save_current == 1)
`);
    runLua(`
local target = "/" .. string.rep("b", 2043) .. ".RPP"
assert(#target == 2048)
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 }, { path = target, dirty = 0 } } })
${resolveSaveAsLua('make_request("project.save_project_as", { target_path = target, overwrite = true })')}
assert(failure == nil); assert(summary.path_matches_target == true); assert(calls.save_as == 1)
`);
  });

  it("rejects overwrite false at the bridge boundary without calling Main_SaveProjectEx", () => {
    runLua(`
local target = "/target/Saved.RPP"
install_fake({ states = { { path = "/source/A.RPP", dirty = 1 } } })
local summary, failure = save_project_as(make_request("project.save_project_as", { target_path = target, overwrite = false }))
assert(summary == nil); assert(failure.code == "PARAMS_INVALID"); assert(failure.details.blocker == "overwrite_true_required_for_dispatch"); assert(calls.save_as == 0)
`);
  });
});
