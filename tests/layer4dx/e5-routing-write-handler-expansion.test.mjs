import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  E5_ROUTING_WRITE_TEMPLATE_IDS,
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/routing/e5_r1_routing_read_route.lua", import.meta.url),
  "utf8",
);

describe("E5 routing write live handler expansion", () => {
  it("registers exactly the bounded routing write batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "e5-routing-write-handlers")
        .map((entry) => entry.template_id),
      E5_ROUTING_WRITE_TEMPLATE_IDS,
    );
  });

  it("binds routing writes through template.execute without raw action surfaces", () => {
    for (const capability of [
      "routing.send.create",
      "routing.send.set_volume",
      "routing.send.set_pan",
      "routing.send.set_mute",
      "routing.send.set_mode",
      "routing.master_parent.set",
      "routing.track_channels.set",
      "routing.track_hardware_output.set",
      "routing.track_hardware_output.remove",
      "routing.send.audio_channels.set",
      "routing.send.set_phase",
      "routing.send.set_mono",
      "routing.send.midi_channels.set",
    ]) {
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${capability.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\]`));
    }
    assert.match(HANDLER_SOURCE, /CreateTrackSend/);
    assert.match(HANDLER_SOURCE, /RemoveTrackSend/);
    assert.match(HANDLER_SOURCE, /GetOutputChannelName/);
    assert.match(HANDLER_SOURCE, /SetTrackSendInfo_Value/);
    assert.match(HANDLER_SOURCE, /SetMediaTrackInfo_Value/);
    assert.match(HANDLER_SOURCE, /Main_OnCommandEx\", ALPHA3_3_B1D_DELETE_AUTOMATION_ITEM_ACTION_ID, 0, 0/);
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand(?!Ex)|NamedCommandLookup|os\.execute|io\.popen|loadstring)\b/);
    assert.doesNotMatch(HANDLER_SOURCE, /Main_OnCommandEx\",(?! ALPHA3_3_B1D_DELETE_AUTOMATION_ITEM_ACTION_ID)/);
  });
});
