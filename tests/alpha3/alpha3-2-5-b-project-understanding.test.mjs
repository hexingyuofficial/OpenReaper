import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY,
  projectAlpha3_2_5BProjectQueryDoctorTask,
} from "../../packages/mcp-server/src/alpha3-2-5-b-project-understanding-v1.mjs";
import {
  openAlpha3_2DProjectIndexRuntime,
} from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import {
  createAlpha3_2DGenericProjectQueryDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";
import {
  createAlpha3_2EProjectInspectMacroDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-2e-small-macro-spine-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  validateMacroExecutionEnvelope,
} from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const OWNER = "openreaper-alpha325-b";
const GENERATION = 1;
const NOW = "2026-07-12T06:00:00.000Z";

describe("Alpha3.2.5-B executable project understanding", () => {
  it("registers inspect/query as fixed executable Macro programs and publishes executable discovery", () => {
    assert.deepEqual(ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.ids, [
      "macro.project.inspect",
      "macro.project.query",
    ]);
    for (const entry of ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.entries) {
      assert.equal(entry.implementation_status, "executable");
      assert.equal(entry.sqlite_policy.mode, "hydrate_or_reuse");
      assert.equal(entry.sqlite_policy.write_authority, false);
      assert.equal(entry.dependencies.runtime_capabilities.includes("project_index.runtime.v1"), true);
    }

    const inspect = createAlpha3_2EProjectInspectMacroDiscoveryItems({ liveRunnableNow: true })[0];
    const query = createAlpha3_2DGenericProjectQueryDiscoveryItems({ liveRunnableNow: true })[0];
    for (const item of [inspect, query]) {
      assert.equal(item.execution_shape, "registered_macro_program");
      assert.equal(item.support_status, "executable_runtime_bound");
      assert.equal(item.live_runnable_now, true);
      assert.equal(item.tags.includes("plan_only"), false);
    }

    const fake = new FakeFoundationBridge({ owner: OWNER, generation: GENERATION });
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: fake,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const executable = runtime.list_templates({
      ids: ["macro.project.inspect", "macro.project.query"],
      fields: ["id", "summary"],
    });
    for (const item of executable.items) {
      assert.equal(item.current_status, "needs_live");
      assert.equal(item.beginner_label, "Start or reconnect OpenReaper");
      assert.match(item.user_message, /needs the configured OpenReaper live route/);
      assert.match(item.next_step, /Start or reconnect the managed OpenReaper bridge/);
      assert.match(item.safety_note, /Registered bounded Macro program/);
      assert.equal(item.next_step.includes("child call_template requests"), false);
      assert.equal(item.safety_note.includes("Macro planner only"), false);
    }
  });

  it("hydrates inspect once, reuses the warm index, and returns compact project understanding", async () => {
    const fixture = await makeFixture();
    const state = { revision: 3, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const input = {
        include: [
          "project_identity",
          "project_path",
          "dirty_state",
          "tracks",
          "items",
          "markers_regions",
          "render",
          "index_status",
        ],
        limit: 25,
      };

      const cold = await runtime.call_template({
        id: "macro.project.inspect",
        input,
        context: callContext(1),
      });
      assert.equal(cold.ok, true, JSON.stringify(cold));
      assert.deepEqual(validateMacroExecutionEnvelope(cold), { valid: true, errors: [] });
      assert.equal(cold.sqlite.source, "cold_hydration");
      assert.equal(cold.sqlite.revision, "reaper-change-count:3");
      assert.equal(cold.result.data.project.path, fixture.projectPath);
      assert.equal(cold.result.data.dirty_state.dirty, false);
      assert.equal(cold.result.data.render.sample_rate, 48_000);
      assert.equal(cold.result.data.scopes.tracks.rows[0].name, "Kick");
      assert.equal(cold.result.data.scopes.items.rows[0].ref, "item:guid:{ITEM-1}");
      assert.equal(cold.result.data.scopes.markers_regions.rows[0].ref, "region:index:1");
      assert.deepEqual(state.calls, [
        "project.read_summary",
        "project.create_observation_bundle",
        "project.read_dirty_state",
        "render.settings.read",
      ]);

      const warm = await runtime.call_template({
        id: "macro.project.inspect",
        input,
        context: callContext(2),
      });
      assert.equal(warm.ok, true, JSON.stringify(warm));
      assert.equal(warm.sqlite.source, "warm_index");
      assert.equal(warm.result.data.refresh.call_count, 0);
      assert.deepEqual(state.calls.slice(4), [
        "project.read_summary",
        "project.read_dirty_state",
        "render.settings.read",
      ]);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("detects a changed REAPER revision, refreshes the affected query scope, and never uses stale rows as write authority", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const first = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(1),
      });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.result.data.rows[0].name, "Kick");

      state.revision = 2;
      state.trackName = "Snare";
      const refreshed = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(2),
      });
      assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
      assert.equal(refreshed.sqlite.source, "refreshed_index");
      assert.equal(refreshed.sqlite.freshness, "refreshed");
      assert.equal(refreshed.sqlite.refreshed, true);
      assert.equal(refreshed.sqlite.revision, "reaper-change-count:2");
      assert.equal(refreshed.result.data.rows.length, 1, JSON.stringify(refreshed));
      assert.equal(refreshed.result.data.rows[0].name, "Snare");
      assert.equal(refreshed.result.data.refs_truth.sqlite_authorizes_writes, false);
      assert.equal(refreshed.result.data.refs_truth.write_requires_live_re_resolution, true);
      assert.equal(refreshed.result.data.refresh.call_count >= 1, true);

      const forcedCallCountBefore = state.calls.length;
      const forced = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(3),
      });
      assert.equal(forced.ok, true, JSON.stringify(forced));
      assert.equal(forced.sqlite.source, "refreshed_index");
      assert.equal(forced.result.data.refresh.call_count > 0, true);
      assert.equal(state.calls.length > forcedCallCountBefore, true);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("materializes live track object refs across staged FX hydration", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Source", calls: [], fxOwnerRefs: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const tracks = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(1),
      });
      assert.equal(tracks.ok, true, JSON.stringify(tracks));

      indexRuntime.invalidateScopes({ scopes: ["fx"], observed_at: NOW });
      const fx = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(2),
      });

      assert.equal(fx.ok, true, JSON.stringify(fx));
      assert.equal(fx.result.data.rows[0].ref, "fx:track:guid:{TRACK-1}:0");
      assert.deepEqual(state.fxOwnerRefs, [{ kind: "track", ref: "track:guid:{TRACK-1}" }]);
      assert.equal(state.calls.includes("fx.list_track_chain"), true);
      assert.equal(fx.result.data.refs_truth.sqlite_authorizes_writes, false);

      const fxCallCountBefore = state.calls.filter((name) => name === "fx.list_track_chain").length;
      const forcedAgain = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(3),
      });
      assert.equal(forcedAgain.ok, true, JSON.stringify(forcedAgain));
      assert.equal(
        state.calls.filter((name) => name === "fx.list_track_chain").length > fxCallCountBefore,
        true,
      );
      assert.equal(
        indexRuntime.adapter.snapshot().rows.tracks.find((row) => row.ref === "track:guid:{TRACK-1}").fx_count,
        1,
      );
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("rejects raw SQL before any live child call", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const rejected = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", raw_sql: "select * from tracks" },
        context: callContext(1),
      });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.contract, "macro.execution.v1");
      assert.equal(rejected.execution.status, "blocked");
      assert.equal(rejected.blockers.some((entry) => entry.code === "RAW_SQL_NOT_ALLOWED"), true);
      assert.deepEqual(state.calls, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("projects packaged Doctor project-query readiness without reopening the frozen B3 module", () => {
    const shared = {
      contract: "alpha3.2.b3.runtime_doctor_readiness.v1",
      mode: "project-query",
      status: "degraded",
      ready: false,
      failure_layer: "task_specific",
      evidence: { request_response: { status: "ready" } },
    };
    const ready = projectAlpha3_2_5BProjectQueryDoctorTask({
      task: shared,
      projectIndexReadiness: {
        status: "ready_warm",
        ready: true,
        next_action: "Use the warm index.",
      },
      projectIndex: {
        lifecycle: "ready",
        backend: "sqlite_file_adapter",
        revision: "reaper-change-count:6",
        rows_available: true,
        sqlite_rows_are_candidates_only: true,
        sqlite_is_truth: false,
      },
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.ready, true);
    assert.equal(ready.failure_layer, null);
    assert.equal(ready.task_specific_readiness, "ready_warm");
    assert.equal(ready.evidence.project_index.revision, "reaper-change-count:6");
    assert.equal(ready.evidence.project_index.sqlite_is_truth, false);

    const cold = projectAlpha3_2_5BProjectQueryDoctorTask({
      task: shared,
      projectIndexReadiness: {
        status: "not_configured",
        ready: false,
        next_action: "Run OpenReaper through the installed wrapper.",
      },
      projectIndex: null,
    });
    assert.equal(cold.status, "degraded");
    assert.equal(cold.failure_layer, "project_index");
    assert.equal(cold.missing_precondition, "project_index_not_configured");
    assert.equal(cold.next_action.instruction, "Run OpenReaper through the installed wrapper.");

    const blocked = projectAlpha3_2_5BProjectQueryDoctorTask({
      task: { ...shared, status: "blocked", failure_layer: "bridge_heartbeat" },
      projectIndexReadiness: { status: "ready_warm", ready: true },
      projectIndex: { lifecycle: "ready" },
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.failure_layer, "bridge_heartbeat");
  });
});

function createRuntime({ fixture, indexRuntime, state }) {
  const fake = new FakeFoundationBridge({
    owner: OWNER,
    generation: GENERATION,
    now: () => new Date(NOW),
  });
  const executor = {
    dispatch(request) {
      state.calls.push(request.operation.name);
      const response = structuredClone(fake.dispatch(request));
      const projectRef = indexRuntime.identity.project_ref;
      if (request.operation.name === "project.read_summary") {
        response.result.summary = {
          project_ref: projectRef,
          name: "Trial",
          path: fixture.projectPath,
          change_count: state.revision,
          track_count: 1,
          item_count: 1,
          marker_count: 0,
          region_count: 1,
        };
        response.result.readback = response.result.summary;
      } else if (
        request.operation.name === "project.create_observation_bundle"
        || request.operation.name === "project.create_project_map_snapshot"
      ) {
        const scope = request.operation.name === "project.create_observation_bundle"
          ? "observation_bundle"
          : "project_map_snapshot";
        response.result.summary = {
          artifact_ref: `artifact:project:${scope}:art_20260712060000000_001_abcdef`,
          project_ref: projectRef,
        };
        response.result.readback = response.result.summary;
        response.result.refs = [{
          kind: "artifact",
          ref: response.result.summary.artifact_ref,
          identity: { scheme: "artifact_ref", value: response.result.summary.artifact_ref },
        }];
      } else if (
        request.operation.name === "tracks.list_tracks"
        || request.operation.name === "tracks.read_mixer_controls"
      ) {
        response.result.readback = trackReadback(state.trackName);
      } else if (request.operation.name === "fx.list_track_chain") {
        state.fxOwnerRefs.push(...request.refs.map((ref) => ({ kind: ref.kind, ref: ref.ref })));
        response.result.summary = {
          owner_ref: "track:guid:{TRACK-1}",
          track_ref: "track:guid:{TRACK-1}",
          fx_count: 1,
          fx: [{
            fx_ref: "fx:track:guid:{TRACK-1}:0",
            owner_ref: "track:guid:{TRACK-1}",
            slot_index: 0,
            name: "VST: ReaComp (Cockos)",
            enabled: true,
          }],
        };
        response.result.readback = response.result.summary;
        response.result.refs = [{
          kind: "fx",
          ref: "fx:track:guid:{TRACK-1}:0",
          identity: { scheme: "track_fx", value: "track:guid:{TRACK-1}:0" },
        }];
      } else if (request.operation.name === "project.read_dirty_state") {
        response.result.summary = {
          project_ref: projectRef,
          dirty: false,
          dirty_state: "clean",
          raw_dirty_state: 0,
        };
        response.result.readback = response.result.summary;
      } else if (request.operation.name === "render.settings.read") {
        response.result.summary = {
          sample_rate: 48_000,
          channels: 2,
          bounds: "project",
        };
        response.result.readback = response.result.summary;
      }
      return response;
    },
  };

  return createCallTemplateRuntime({
    projectIndexRuntime: indexRuntime,
    projectIndexArtifactReader: async ({ template_id }) => ({
      payload: template_id === "template.project.create_observation_bundle"
        ? observationBundlePayload(indexRuntime.identity.project_ref, state.trackName)
        : projectMapPayload(indexRuntime.identity.project_ref, state.trackName),
    }),
    live: {
      opted_in: true,
      executor,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
    },
    now: () => new Date(NOW),
  });
}

function observationBundlePayload(projectRef, trackName) {
  return {
    project_ref: projectRef,
    project_map: projectOverview(projectRef, trackName),
    markers_regions: {
      items: [{
        ref: "region:index:1",
        marker_kind: "region",
        position_seconds: 0,
        end_seconds: 4,
        name: "Intro",
      }],
    },
    coverage: {
      project_map: "complete_page",
      markers_regions: "bounded",
    },
  };
}

function projectMapPayload(projectRef, trackName) {
  return {
    project_ref: projectRef,
    overview: projectOverview(projectRef, trackName),
    coverage: {
      tracks: "complete_page",
      track_items: "bounded_per_track",
      selected_items: "bounded",
    },
  };
}

function projectOverview(projectRef, trackName) {
  return {
    project_ref: projectRef,
    track_count: 1,
    item_count: 1,
    truncated: false,
    tracks: [{
      track_ref: "track:guid:{TRACK-1}",
      name: trackName,
      index: 0,
      items: [{
        item_ref: "item:guid:{ITEM-1}",
        track_ref: "track:guid:{TRACK-1}",
        start_seconds: 0,
        end_seconds: 4,
        active_take_ref: "take:guid:{TAKE-1}",
      }],
    }],
    selected_items: [],
  };
}

function trackReadback(trackName) {
  return {
    tracks: [{
      track_ref: "track:guid:{TRACK-1}",
      name: trackName,
      index: 0,
      selected: false,
    }],
    coverage: "complete",
  };
}

async function makeFixture() {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha325-b-"));
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
    logicalSessionKey: "alpha325-b-test",
    now: () => new Date(NOW),
  });
}

function callContext(requestSequence) {
  return {
    client_id: "alpha325-b-test",
    session_id: "alpha325-b-client",
    expected_owner: OWNER,
    expected_generation: GENERATION,
    created_at: NOW,
    request_sequence: requestSequence,
  };
}
