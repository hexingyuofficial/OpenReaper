import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeFoundationBridge } from "../../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_INTERNAL_DISPATCH_TIMEOUT,
  CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  TEMPLATE_EXECUTION_DEFAULT_DISPATCH_TIMEOUT_MS,
} from "../../../packages/core/src/template-execution-harness-v1.mjs";

const CONTEXT = Object.freeze({
  request_id: "request:alpha4:child-timeout",
  session_id: "session:alpha4:child-timeout",
  expected_owner: "owner-test",
  expected_generation: 1,
  created_at: "2026-07-27T00:00:00.000Z",
  request_sequence: 1,
});

describe("Alpha4 Shard B Recipe/batch child timeout propagation", () => {
  it("keeps the public no-deadline safety cap while honoring an explicit internal child cap", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS,
      },
    });

    const ordinary = await runtime.call_template({
      id: "template.project.list_open_projects",
      input: { cursor: "0", limit: 25 },
      refs: [],
      context: CONTEXT,
    });
    assert.equal(ordinary.ok, true, JSON.stringify(ordinary));
    assert.equal(ordinary.request.timeout_ms, TEMPLATE_EXECUTION_DEFAULT_DISPATCH_TIMEOUT_MS);

    const internalRequest = {
      id: "template.project.list_open_projects",
      input: { cursor: "0", limit: 25 },
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
