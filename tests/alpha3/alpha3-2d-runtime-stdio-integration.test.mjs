import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import { openAlpha3_2DProjectIndexRuntime } from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import { createAlpha3_2DGenericProjectQueryDiscoveryItems } from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const OWNER = "openreaper-alpha32d-integration";
const GENERATION = 1;
const LOGICAL_SESSION = "installed-alpha32d-integration";
const NOW = "2026-07-11T11:15:00.000Z";

describe("Alpha3.2-D call_template Project Index integration", () => {
  it("returns refresh children without hidden execution, observes an explicit atomic read, and serves the indexed row", async () => {
    const fixture = await makeFixture();
    let executorCalls = 0;
    const fake = new FakeFoundationBridge({ owner: OWNER, generation: GENERATION, now: () => new Date(NOW) });
    const executor = {
      dispatch(request) {
        executorCalls += 1;
        const response = structuredClone(fake.dispatch(request));
        response.result.readback = {
          tracks: [{
            track_ref: "track:guid:{TRACK-1}",
            index: 0,
            name: "Kick",
            selected: true,
            muted: false,
            record_armed: false,
          }],
          track_count: 1,
          coverage: "complete",
        };
        return response;
      },
    };

    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createCallTemplateRuntime({
        projectIndexRuntime: indexRuntime,
        live: {
          opted_in: true,
          executor,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
        },
        now: () => new Date(NOW),
      });

      const before = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
      });
      assert.equal(before.ok, false);
      assert.equal(["INDEX_NOT_READY", "INDEX_REFRESH_REQUIRED"].includes(before.error.code), true);
      assert.equal(executorCalls, 0);
      assert.equal(before.result.execution.child_executor, false);
      assert.equal(before.result.execution.executor_call_count, 0);
      assert.equal(before.result.refresh_requests.some((request) => request.id === "template.tracks.list_tracks"), true);

      const child = await runtime.call_template({
        id: "template.tracks.list_tracks",
        input: { limit: 25, include_selection: true },
        context: callContext(1),
      });
      assert.equal(child.ok, true, JSON.stringify(child));
      assert.equal(executorCalls, 1);
      assert.equal(child.result.project_index_observation.ok, true);
      assert.equal(child.result.project_index_observation.status, "observed");
      assert.deepEqual(child.result.project_index_observation.scopes, ["tracks"]);
      assert.equal(child.result.project_index_observation.child_calls_executed, 0);

      const after = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "never", limit: 25 },
      });
      assert.equal(after.ok, true, JSON.stringify(after));
      assert.equal(executorCalls, 1);
      assert.equal(after.result.rows.length, 1);
      assert.equal(after.result.rows[0].ref, "track:guid:{TRACK-1}");
      assert.equal(after.result.rows[0].name, "Kick");
      assert.equal(after.result.execution.child_executor, false);
      assert.equal(after.result.execution.executor_call_count, 0);
      assert.equal(after.result.plan.safety.hidden_executor, false);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("publishes only the generic query plus selected-context compatibility and rejects internal legacy calls", async () => {
    const runtime = createCallTemplateRuntime();
    const exact = runtime.list_templates({
      ids: ["macro.project.query", "macro.selected_context", "macro.index_status", "macro.query_tracks"],
    });
    assert.deepEqual(exact.items.map((item) => item.id).sort(), ["macro.project.query", "macro.selected_context"].sort());
    const generic = createAlpha3_2DGenericProjectQueryDiscoveryItems()[0];
    assert.equal(generic.support_status, "supported_runtime_bound");
    assert.equal(generic.known_blocker, null);
    assert.equal(generic.evidence_level, "runtime_bound_product_store");

    for (const id of ["macro.index_status", "macro.query_tracks", "macro.query_items", "macro.changed_since"]) {
      const result = await runtime.call_template({ id, input: {} });
      assert.equal(result.ok, false, id);
      assert.equal(result.error.code, "CALL_TEMPLATE_ID_REPLACED", id);
      assert.equal(result.error.details.replacement, "macro.project.query", id);
    }
  });
});

async function makeFixture() {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha32d-integration-"));
  const root = await realpath(rawRoot);
  const stateRoot = path.join(root, "state");
  const projectPath = path.join(root, "Trial.RPP");
  await mkdir(stateRoot);
  await writeFile(projectPath, "<REAPER_PROJECT 0.1>\n", "utf8");
  return {
    root,
    stateRoot,
    projectPath,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

function openIndex(fixture) {
  return openAlpha3_2DProjectIndexRuntime({
    stateRoot: fixture.stateRoot,
    projectPath: fixture.projectPath,
    bridgeOwner: OWNER,
    bridgeGeneration: GENERATION,
    logicalSessionKey: LOGICAL_SESSION,
    now: () => new Date(NOW),
  });
}

function callContext(requestSequence) {
  return {
    client_id: "alpha32d-integration-test",
    session_id: "alpha32d-integration-client",
    expected_owner: OWNER,
    expected_generation: GENERATION,
    created_at: NOW,
    request_sequence: requestSequence,
  };
}
