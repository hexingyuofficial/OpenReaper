import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeFoundationBridge } from "../../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_INTERNAL_DISPATCH_TIMEOUT,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const CONTEXT = Object.freeze({
  request_id: "request:alpha4:child-timeout",
  session_id: "session:alpha4:child-timeout",
  expected_owner: "owner-test",
  expected_generation: 1,
  created_at: "2026-07-27T00:00:00.000Z",
  request_sequence: 1,
});

describe("Alpha4 Shard B Recipe/batch child timeout propagation", () => {
  it("keeps public Template descriptor timeout while allowing only the internal child path to extend it", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
      },
    });

    const ordinary = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      refs: [],
      context: CONTEXT,
    });
    assert.equal(ordinary.ok, true, JSON.stringify(ordinary));
    assert.equal(ordinary.request.timeout_ms, 5_000);

    const internalRequest = {
      id: "template.project.read_summary",
      input: {},
      refs: [],
      context: CONTEXT,
      [CALL_TEMPLATE_INTERNAL_DISPATCH_TIMEOUT]: 300_000,
    };
    const internal = await runtime.call_template(internalRequest);
    assert.equal(internal.ok, true, JSON.stringify(internal));
    assert.equal(internal.request.timeout_ms, 300_000);
    assert.equal(bridge.seen.at(-1).timeout_ms, 300_000);
  });
});
