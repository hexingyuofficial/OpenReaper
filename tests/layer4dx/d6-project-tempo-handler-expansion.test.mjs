import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/tempo_write.lua", import.meta.url),
  "utf8",
);
const READ_HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/read_tempo_map.lua", import.meta.url),
  "utf8",
);

describe("D6 project tempo/grid live handler expansion", () => {
  it("registers the bounded project tempo/BPM/grid handler batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d6-project-tempo-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
    );
  });

  it("binds tempo writes through template.execute without raw action surfaces", () => {
    for (const capability of [
      "project.set_tempo",
      "project.set_bpm",
      "project.set_tempo_marker",
      "project.set_grid",
    ]) {
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${capability.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\]`));
    }

    assert.match(HANDLER_SOURCE, /SetCurrentBPM/);
    assert.match(HANDLER_SOURCE, /AddTempoTimeSigMarker/);
    assert.match(HANDLER_SOURCE, /SetTempoTimeSigMarker/);
    assert.match(HANDLER_SOURCE, /GetTempoTimeSigMarker/);
    assert.match(HANDLER_SOURCE, /readback\.time_sig_num == numerator/);
    assert.match(HANDLER_SOURCE, /readback\.time_sig_denom == denominator/);
    assert.match(HANDLER_SOURCE, /TIME_SIGNATURE_INVALID/);
    assert.match(HANDLER_SOURCE, /Master_GetTempo|TimeMap_GetTimeSigAtTime/);
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|os\.execute|io\.popen|loadstring)\b/);
  });

  it("maps native effective time-signature fields before BPM", () => {
    assert.match(
      READ_HANDLER_SOURCE,
      /local ok_effective, timesig_num, timesig_denom, bpm = call_reaper\("TimeMap_GetTimeSigAtTime"/,
    );
    assert.doesNotMatch(
      READ_HANDLER_SOURCE,
      /local ok_effective, bpm, timesig_num, timesig_denom = call_reaper\("TimeMap_GetTimeSigAtTime"/,
    );
  });

  it("binds grid writes to fixed REAPER primitives without exposing raw action input", () => {
    const gridSource = readFileSync(
      new URL("../../reaper/bridge/src/handlers/project/d20_project_grid_snap.lua", import.meta.url),
      "utf8",
    );
    assert.match(gridSource, /GetSetProjectGrid/);
    assert.match(gridSource, /GetSetProjectGrid", project, false, 0, 0, 0/);
    assert.match(gridSource, /GetSetProjectGrid", project, true, division, swingmode, swing/);
    assert.doesNotMatch(gridSource, /request\.params\.(?:action|command|command_id|lua|script|shell)/);
    assert.doesNotMatch(gridSource, /\b(?:Main_OnCommand|Main_OnCommandEx|os\.execute|io\.popen|loadstring)\b/);
  });

  it("runs the route harness in fake mode without REAPER", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/smoke-template-runtime-live.mjs", "--project-tempo", "--fake"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const report = JSON.parse(output);
    assert.equal(report.ok, true);
    assert.equal(report.reason, "d6_project_tempo_route_fake_static_readback_passed");
    assert.deepEqual(report.expected_template_ids, CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS);
    assert.equal(report.live_support_status, "not_claimed");
    assert.equal(report.spawned_reaper, false);
  });
});
