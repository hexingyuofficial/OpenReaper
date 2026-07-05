import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  E5_ROUTING_AUTOMATION_EXTRA_TEMPLATE_IDS,
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/routing/e5_r1_routing_read_route.lua", import.meta.url),
  "utf8",
);

describe("E5 routing/automation extra live handler expansion", () => {
  it("registers the bounded routing pin and automation handler batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "e5-routing-automation-extra-handlers")
        .map((entry) => entry.template_id),
      E5_ROUTING_AUTOMATION_EXTRA_TEMPLATE_IDS,
    );
  });

  it("binds automation writes through template.execute without raw action surfaces", () => {
    for (const capability of [
      "automation.set_envelope_lane_state",
      "automation.insert_envelope_point",
      "automation.set_track_automation_mode",
      "automation.set_envelope_point",
      "automation.insert_envelope_points_batch",
      "automation.set_send_automation_mode",
      "automation.create_automation_item",
      "automation.set_automation_item_bounds",
    ]) {
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${capability.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\]`));
    }

    for (const operation of [
      "routing.fx_pin_mapping.read",
      "automation.resolve_envelope_ref",
      "automation.read_envelope_summary",
      "automation.read_envelope_points",
      "automation.evaluate_envelope_at_time",
      "automation.read_track_automation_mode",
      "automation.read_automation_items",
      "automation.resolve_send_envelope",
    ]) {
      assert.match(ROUTE_SOURCE, new RegExp(`\\["query_state:${operation.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\]`));
    }

    assert.match(HANDLER_SOURCE, /TrackFX_GetPinMappings/);
    assert.match(HANDLER_SOURCE, /GetTrackEnvelopeByName/);
    assert.match(HANDLER_SOURCE, /InsertEnvelopePoint/);
    assert.match(HANDLER_SOURCE, /SetTrackAutomationMode/);
    assert.match(HANDLER_SOURCE, /InsertAutomationItem/);
    assert.match(HANDLER_SOURCE, /BR_GetMediaTrackSendInfo_Envelope|P_ENV:<VOLENV/);
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|os\.execute|io\.popen|loadstring)\b/);
  });
});
