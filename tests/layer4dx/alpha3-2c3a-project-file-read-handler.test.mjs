import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/read_file_state.lua", import.meta.url),
  "utf8",
);
const ROUTE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url),
  "utf8",
);
const BRIDGE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url),
  "utf8",
);
const REGISTRY = JSON.parse(readFileSync(
  new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url),
  "utf8",
));

const IDS = [
  "template.project.read_current_project_path",
  "template.project.read_dirty_state",
];

function rows() {
  return REGISTRY.entries.filter((entry) => IDS.includes(entry.template_id));
}

describe("Alpha3.2-C3A project file read handlers", () => {
  it("keeps an exact two-id read-only route group", () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS, IDS);
    assert.deepEqual(rows().map((entry) => entry.template_id), IDS);
    for (const entry of rows()) {
      assert.equal(entry.operation.family, "query_state");
      assert.equal(entry.pack, "project");
      assert.equal(entry.risk, "read");
      assert.equal(entry.route, "alpha3-2c3a-project-file-read");
      assert.equal(entry.handler_file, "project/read_file_state.lua");
      assert.equal(entry.artifact_policy, "none");
      assert.deepEqual(entry.tests, ["tests/layer4dx/alpha3-2c3a-project-file-read-handler.test.mjs"]);
    }
  });

  it("binds both operations to the generated extracted handler exports", () => {
    assert.match(ROUTE_SOURCE, /\["query_state:project\.read_current_project_path"\]\s*=\s*\{[\s\S]*?handler\s*=\s*read_current_project_path/);
    assert.match(ROUTE_SOURCE, /\["query_state:project\.read_dirty_state"\]\s*=\s*\{[\s\S]*?handler\s*=\s*read_dirty_state/);
    assert.match(BRIDGE_SOURCE, /handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_current_project_path/);
    assert.match(BRIDGE_SOURCE, /handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_dirty_state/);
    assert.equal((BRIDGE_SOURCE.match(/\["query_state:project\.read_current_project_path"\]/g) ?? []).length, 1);
    assert.equal((BRIDGE_SOURCE.match(/\["query_state:project\.read_dirty_state"\]/g) ?? []).length, 1);
  });

  it("implements truthful bounded path and strict IsProjectDirty semantics", () => {
    assert.match(HANDLER_SOURCE, /pcall\(reaper\.EnumProjects, -1, ""\)/);
    assert.match(HANDLER_SOURCE, /path_state = has_project_path and "saved_project" or "unsaved_project"/);
    assert.match(HANDLER_SOURCE, /path_truncated = path_truncated/);
    assert.match(HANDLER_SOURCE, /pcall\(reaper\.IsProjectDirty, project\)/);
    assert.match(HANDLER_SOURCE, /raw_dirty_state ~= raw_dirty_state/);
    assert.match(HANDLER_SOURCE, /raw_dirty_state == math\.huge/);
    assert.match(HANDLER_SOURCE, /raw_dirty_state == -math\.huge/);
    assert.match(HANDLER_SOURCE, /raw_dirty_state < 0/);
    assert.match(HANDLER_SOURCE, /raw_dirty_state ~= math\.floor\(raw_dirty_state\)/);
    assert.match(HANDLER_SOURCE, /code = code/);
    assert.match(HANDLER_SOURCE, /"INTERNAL_ERROR"/);
    for (const reason of ["api_unavailable", "pcall_failed", "invalid_result"]) {
      assert.match(HANDLER_SOURCE, new RegExp(`reason = "${reason}"`));
    }
  });

  it("contains no project-file mutation or bypass surface", () => {
    for (const forbidden of [
      "Main_SaveProject",
      "Main_SaveProjectEx",
      "Main_OnCommand",
      "RenderProject",
      "RecursiveCreateDirectory",
      "os.execute",
      "io.open",
      "ShowMessageBox",
      "GetUserInputs",
    ]) {
      assert.doesNotMatch(HANDLER_SOURCE, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), forbidden);
    }
  });
});
