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
  it("executes bounded cold hydration once, then serves warm SQLite rows without a broad reread", async () => {
    const fixture = await makeFixture();
    let executorCalls = 0;
    const operations = [];
    const fake = new FakeFoundationBridge({ owner: OWNER, generation: GENERATION, now: () => new Date(NOW) });
    const executor = {
      dispatch(request) {
        executorCalls += 1;
        operations.push(request.operation.name);
        const response = structuredClone(fake.dispatch(request));
        if (request.operation.name === "project.read_summary") {
          response.result.summary = {
            project_ref: indexRuntime.identity.project_ref,
            change_count: 1,
            track_count: 1,
            item_count: 0,
          };
          response.result.readback = response.result.summary;
        } else if (request.operation.name === "project.create_observation_bundle") {
          response.result.summary = {
            artifact_ref: "artifact:project:observation_bundle:art_20260711111500000_001_abcdef",
            project_ref: indexRuntime.identity.project_ref,
          };
          response.result.readback = response.result.summary;
          response.result.refs = [{
            kind: "artifact",
            ref: response.result.summary.artifact_ref,
            identity: { scheme: "artifact_ref", value: response.result.summary.artifact_ref },
          }];
        }
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
        projectIndexArtifactReader: async () => ({
          payload: {
            project_ref: indexRuntime.identity.project_ref,
            project_map: {
              project_ref: indexRuntime.identity.project_ref,
              track_count: 1,
              item_count: 0,
              truncated: false,
              tracks: [{
                track_ref: "track:guid:{TRACK-1}",
                index: 0,
                name: "Kick",
                selected: true,
                muted: false,
                record_armed: false,
                items: [],
              }],
              selected_items: [],
            },
            markers_regions: { items: [] },
            coverage: {
              project_map: "complete_page",
              markers_regions: "bounded",
            },
          },
        }),
        now: () => new Date(NOW),
      });

      const cold = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(1),
      });
      assert.equal(cold.ok, true, JSON.stringify(cold));
      assert.equal(cold.contract, "macro.execution.v1");
      assert.equal(cold.execution.status, "completed");
      assert.equal(cold.sqlite.source, "cold_hydration");
      assert.equal(cold.result.data.rows.length, 1);
      assert.equal(cold.result.data.rows[0].ref, "track:guid:{TRACK-1}");
      assert.equal(cold.result.data.rows[0].name, "Kick");
      assert.deepEqual(operations, ["project.read_summary", "project.create_observation_bundle"]);
      assert.equal(cold.result.data.refresh.call_count, 1);

      const warm = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(2),
      });
      assert.equal(warm.ok, true, JSON.stringify(warm));
      assert.equal(warm.sqlite.source, "warm_index");
      assert.equal(warm.result.data.rows[0].ref, "track:guid:{TRACK-1}");
      assert.equal(warm.result.data.refresh.call_count, 0);
      assert.equal(executorCalls, 3);
      assert.deepEqual(operations, [
        "project.read_summary",
        "project.create_observation_bundle",
        "project.read_summary",
      ]);
      assert.equal(warm.sqlite.revision, "reaper-change-count:1");
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("publishes only the generic query and returns replacements for all legacy query names", async () => {
    const runtime = createCallTemplateRuntime();
    const exact = runtime.list_templates({
      ids: ["macro.project.query", "macro.selected_context", "macro.index_status", "macro.query_tracks"],
    });
    assert.deepEqual(exact.items.map((item) => item.id), ["macro.project.query"]);
    assert.deepEqual(exact.missing_ids, ["macro.selected_context", "macro.index_status", "macro.query_tracks"]);
    const generic = createAlpha3_2DGenericProjectQueryDiscoveryItems()[0];
    assert.equal(generic.support_status, "executable_runtime_bound");
    assert.equal(generic.known_blocker, "live_executor_not_configured");
    assert.equal(generic.execution_shape, "registered_macro_program");

    for (const id of ["macro.selected_context", "macro.index_status", "macro.query_tracks", "macro.query_items", "macro.changed_since"]) {
      const result = await runtime.call_template({ id, input: {} });
      assert.equal(result.ok, false, id);
      assert.equal(result.error.code, "CALL_TEMPLATE_ID_REPLACED", id);
      assert.equal(result.error.details.replacement, "macro.project.query", id);
      if (id === "macro.selected_context") assert.deepEqual(result.error.details.replacement_input, { entity: "selected_context" });
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
