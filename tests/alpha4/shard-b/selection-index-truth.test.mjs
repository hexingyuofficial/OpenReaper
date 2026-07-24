import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  openAlpha3_2DProjectIndexRuntime,
} from "../../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";

const NOW = "2026-07-24T00:00:00.000Z";

describe("Alpha4 Shard B Selection and Index truth", () => {
  it("keeps a live selection fingerprint/epoch independent from project change_count", async () => {
    const fixture = await makeFixture();
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      observe(runtime, identity, "selection-a", selectionReadback(identity.project_ref, [
        { item_ref: "item:guid:{ITEM-A}", track_ref: "track:guid:{TRACK-A}", selected: true, takes: [{ take_ref: "take:guid:{TAKE-A}" }] },
      ]));
      const first = runtime.status();
      assert.equal(typeof first.selection_identity?.fingerprint, "string", JSON.stringify(first));
      assert.equal(Number.isInteger(first.selection_identity?.epoch), true, JSON.stringify(first));
      assert.notEqual(first.selection_identity.revision, first.revision, JSON.stringify(first));
      assert.equal(first.selection_identity.project_ref, identity.project_ref);
      assert.equal(first.selection_identity.object_kinds.includes("item"), true);
      assert.equal(first.selection_identity.object_kinds.includes("take"), true);

      observe(runtime, identity, "selection-b", selectionReadback(identity.project_ref, [
        { item_ref: "item:guid:{ITEM-B}", track_ref: "track:guid:{TRACK-B}", selected: true, takes: [{ take_ref: "take:guid:{TAKE-B}" }] },
      ]));
      const second = runtime.status();
      assert.equal(second.project_change_count, first.project_change_count);
      assert.notEqual(second.selection_identity.fingerprint, first.selection_identity.fingerprint, JSON.stringify({ first, second }));
      assert.equal(second.selection_identity.epoch > first.selection_identity.epoch, true);
      assert.equal(second.revision, first.revision);
      assert.deepEqual(
        runtime.adapter.snapshot().rows.selection_state
          .filter((row) => row.scope_kind !== "project_head")
          .map((row) => row.ref)
          .sort(),
        ["item:guid:{ITEM-B}", "take:guid:{TAKE-B}", "track:guid:{TRACK-B}"],
      );

      observe(runtime, identity, "selection-empty", selectionReadback(identity.project_ref, []));
      const empty = runtime.status();
      assert.equal(empty.selection_identity.lifecycle, "live");
      assert.equal(empty.selection_identity.row_count, 0);
      assert.deepEqual(empty.selection_identity.object_kinds, []);
      assert.deepEqual(
        runtime.adapter.snapshot().rows.selection_state
          .filter((row) => row.scope_kind !== "project_head"),
        [],
      );

      runtime.adapter.replaceSelection({
        snapshot_id: "snapshot:selection-all-kinds",
        observed_at: NOW,
        source_template_id: "template.project.create_observation_bundle",
        projectRef: identity.project_ref,
        bridgeOwner: identity.bridge_owner,
        bridgeGeneration: identity.bridge_generation,
        sessionId: identity.session_id,
        rows: [
          { scope_kind: "track", ref: "track:guid:{TRACK-B}", owner_ref: identity.project_ref, summary: { selected: true } },
          { scope_kind: "item", ref: "item:guid:{ITEM-B}", owner_ref: "track:guid:{TRACK-B}", summary: { selected: true } },
          { scope_kind: "take", ref: "take:guid:{TAKE-B}", owner_ref: "item:guid:{ITEM-B}", summary: { selected: true } },
          { scope_kind: "fx", ref: "fx:track:guid:{TRACK-B}:slot:0", owner_ref: "track:guid:{TRACK-B}", summary: { selected: true } },
          { scope_kind: "automation", ref: "envelope:track:guid:{TRACK-B}:volume", owner_ref: "track:guid:{TRACK-B}", summary: { selected: true } },
        ],
        coverage_status: "fresh",
        freshness_status: "fresh",
      });
      const allKinds = runtime.status();
      assert.deepEqual(allKinds.selection_identity.object_kinds.sort(), ["automation", "fx", "item", "take", "track"]);
      assert.equal(allKinds.sqlite_rows_are_candidates_only, true);
      assert.equal(allKinds.sqlite_may_authorize_write, false);
    } finally {
      runtime?.close();
      await fixture.cleanup();
    }
  });

  it("stales selection identity on project switch and restart, and keeps Undo/Redo selection changes live", async () => {
    const firstFixture = await makeFixture("first");
    const secondFixture = await makeFixture("second");
    let runtime;
    let switched;
    try {
      runtime = await openRuntime(firstFixture);
      const firstIdentity = runtimeIdentity(runtime);
      observe(runtime, firstIdentity, "undo-before", selectionReadback(firstIdentity.project_ref, [
        { item_ref: "item:guid:{UNDO-BEFORE}", track_ref: "track:guid:{TRACK}", selected: true },
      ], { selection_event: "undo" }));
      const beforeUndo = runtime.status().selection_identity;
      observe(runtime, firstIdentity, "redo-after", selectionReadback(firstIdentity.project_ref, [
        { item_ref: "item:guid:{REDO-AFTER}", track_ref: "track:guid:{TRACK}", selected: true },
      ], { selection_event: "redo" }));
      const afterRedo = runtime.status().selection_identity;
      assert.notEqual(afterRedo.fingerprint, beforeUndo.fingerprint);
      assert.equal(afterRedo.epoch > beforeUndo.epoch, true);

      runtime.close();
      const restarted = await openRuntime(firstFixture);
      assert.equal(restarted.status().selection_identity.lifecycle, "stale_until_live_readback");
      restarted.close();

      switched = await openRuntime(secondFixture);
      const secondIdentity = runtimeIdentity(switched);
      assert.notEqual(secondIdentity.project_ref, firstIdentity.project_ref);
      assert.equal(switched.status().selection_identity.lifecycle, "stale_until_live_readback");
      observe(switched, secondIdentity, "switch-live", selectionReadback(secondIdentity.project_ref, [
        { item_ref: "item:guid:{SWITCHED}", track_ref: "track:guid:{SWITCHED-TRACK}", selected: true },
      ]));
      assert.equal(switched.status().selection_identity.project_ref, secondIdentity.project_ref);
      assert.equal(switched.status().selection_identity.lifecycle, "live");
    } finally {
      switched?.close();
      runtime?.close();
      await firstFixture.cleanup();
      await secondFixture.cleanup();
    }
  });

  it("does not turn a SQLite write failure into mutation authority", async () => {
    const fixture = await makeFixture("sqlite-failure");
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      // Corrupt only this disposable cache after the adapter has opened it so
      // the next candidate-cache persist exercises the real SQLite failure path.
      await truncate(runtime.status().db_path, 0);
      const observed = observe(runtime, identity, "sqlite-failure", selectionReadback(identity.project_ref, [
        { item_ref: "item:guid:{SQLITE-FAIL}", track_ref: "track:guid:{TRACK}", selected: true },
      ]));
      assert.equal(observed.ok, false, JSON.stringify(observed));
      assert.equal(observed.blockers[0].code, "STORE_WRITE_FAILED");
      assert.equal(runtime.status().sqlite_rows_are_candidates_only, true);
      assert.equal(runtime.status().sqlite_may_authorize_write, false);
    } finally {
      try { runtime?.close(); } catch {}
      await fixture.cleanup();
    }
  });
});

async function makeFixture(suffix = "fixture") {
  const raw = await mkdtemp(path.join(os.tmpdir(), `openreaper-alpha4-b-index-${suffix}-`));
  const root = await realpath(raw);
  const stateRoot = path.join(root, "state");
  const projectPath = path.join(root, `${suffix}.RPP`);
  await mkdir(stateRoot);
  await writeFile(projectPath, "<REAPER_PROJECT 0.1>\n");
  return {
    root,
    stateRoot,
    projectPath,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

async function openRuntime(fixture) {
  return openAlpha3_2DProjectIndexRuntime({
    stateRoot: fixture.stateRoot,
    projectPath: fixture.projectPath,
    bridgeOwner: "bridge:alpha4-shard-b",
    bridgeGeneration: 1,
    logicalSessionKey: "alpha4-shard-b-selection",
    processIdentity: "alpha4-shard-b-test",
    now: () => new Date(NOW),
  });
}

function runtimeIdentity(runtime) {
  const status = runtime.status();
  return {
    project_ref: status.project_ref,
    project_path: status.project_path,
    bridge_owner: status.bridge_owner,
    bridge_generation: status.bridge_generation,
    session_id: status.session_id,
  };
}

function observe(runtime, identity, requestId, readback) {
  return runtime.observeSuccessfulTemplateExecution({
    ok: true,
    template: { id: "template.project.create_observation_bundle" },
    identity,
    observed_at: NOW,
    request: { id: `request:${requestId}` },
    result: { readback: { payload: readback } },
  });
}

function selectionReadback(projectRef, selectedItems, extra = {}) {
  return {
    project_ref: projectRef,
    change_count: 17,
    track_count: 1,
    item_count: selectedItems.length,
    selected_count: selectedItems.length,
    ...extra,
    project_map: {
      project_ref: projectRef,
      track_count: 1,
      item_count: selectedItems.length,
      truncated: false,
      tracks: [{ track_ref: selectedItems[0]?.track_ref ?? "track:guid:{TRACK}", index: 0, name: "Selection Track", selected: selectedItems.length > 0, items: selectedItems }],
      selected_items: selectedItems,
    },
    coverage: { project_map: "complete_page", selected_items: "selected_only" },
  };
}
