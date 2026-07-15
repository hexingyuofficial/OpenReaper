import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_2D_PROJECT_INDEX_DB_BASENAME,
  ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
  openAlpha3_2DProjectIndexRuntime,
  validateManagedStateRoot,
} from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const NOW = "2026-07-11T02:00:00.000Z";
const now = () => new Date(NOW);

describe("Alpha3.2-D Product Project Index runtime", () => {
  it("requires an explicit canonical real writable state root and rejects reserved or symlink overlap", async () => {
    const fixture = await makeFixture();
    const alias = path.join(fixture.root, "state-alias");
    const fileRoot = path.join(fixture.root, "not-a-directory");
    const linkedDbRoot = path.join(fixture.root, "linked-db-state");
    const externalDb = path.join(fixture.root, "external.sqlite");
    await symlink(fixture.stateRoot, alias);
    await writeFile(fileRoot, "x");
    await mkdir(linkedDbRoot);
    await writeFile(externalDb, "not sqlite");
    await symlink(externalDb, path.join(linkedDbRoot, ALPHA3_2D_PROJECT_INDEX_DB_BASENAME));
    try {
      assert.equal((await validateManagedStateRoot("relative/state")).blockers[0].code, "STATE_ROOT_NOT_ABSOLUTE");
      assert.equal((await validateManagedStateRoot(alias)).blockers.some((row) => row.code === "STATE_ROOT_SYMLINK" || row.code === "STATE_ROOT_NOT_CANONICAL"), true);
      assert.equal((await validateManagedStateRoot(fileRoot)).blockers.some((row) => row.code === "STATE_ROOT_NOT_DIRECTORY"), true);
      assert.equal((await validateManagedStateRoot(linkedDbRoot)).blockers.some((row) => row.code === "INDEX_DB_SYMLINK"), true);
      assert.equal((await validateManagedStateRoot(fixture.stateRoot, { reservedRoots: [fixture.root] })).blockers.some((row) => row.code === "STATE_ROOT_RESERVED_OVERLAP"), true);

      await chmod(fixture.stateRoot, 0o500);
      const unwritable = await validateManagedStateRoot(fixture.stateRoot);
      assert.equal(unwritable.ok, false);
      assert.equal(unwritable.blockers.some((row) => row.code === "STATE_ROOT_NOT_WRITABLE" || row.code === "STATE_ROOT_WRITE_PROBE_FAILED"), true);
      await chmod(fixture.stateRoot, 0o700);
    } finally {
      await chmod(fixture.stateRoot, 0o700).catch(() => {});
      await fixture.cleanup();
    }
  });

  it("opens the real node:sqlite adapter when available and exposes truthful status without defaulting to a repo path", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      assert.equal(runtime.contract, ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT);
      assert.equal(runtime.ok, true);
      assert.equal(path.dirname(runtime.db_path), fixture.stateRoot);
      assert.match(path.basename(runtime.db_path), /^openreaper-project-index\.[a-f0-9]{24}\.sqlite$/);
      assert.notEqual(runtime.db_path, path.join(fixture.stateRoot, ALPHA3_2D_PROJECT_INDEX_DB_BASENAME));
      assert.notEqual(runtime.db_path.includes("/Documents/openreaper/"), true);
      const status = runtime.status();
      assert.equal(status.backend, sqliteAvailable() ? "sqlite_file_adapter" : "resident_memory_fallback");
      assert.equal(status.project_path, fixture.projectPath);
      assert.equal(status.bridge_owner, "bridge:alpha3.2d:test");
      assert.equal(status.bridge_generation, 7);
      assert.match(status.session_id, /^session:alpha3\.2d:[a-f0-9]{32}$/);
      assert.equal(status.ownership.mode, "process_isolated");
      assert.equal(status.ownership.shared_between_processes, false);
      assert.equal(status.ownership.peer_database_unlink_allowed, false);
      assert.equal(status.ownership.recovery_scope, "owned_database_only");
      assert.equal(status.ownership.db_path, runtime.db_path);
      assert.equal(status.rows_available, true);
      assert.equal(status.snapshot_id, null);
      assert.equal(status.revision, null);
      assert.equal(status.freshness_token, null);
      assert.equal(typeof runtime.adapter.snapshot, "function");
      assert.equal(runtime.close().lifecycle, "closed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a symlink substituted at the process-isolated database path", async () => {
    if (!await hasSqlite()) return;
    const fixture = await makeFixture();
    const externalDb = path.join(fixture.root, "external-owned.sqlite");
    try {
      const initial = await openRuntime(fixture, { processIdentity: "symlink-owner" });
      const dbPath = initial.db_path;
      initial.close();
      await unlink(dbPath);
      await writeFile(externalDb, "external\n");
      await symlink(externalDb, dbPath);

      const blocked = await openRuntime(fixture, { processIdentity: "symlink-owner" });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.status().degraded_reason, "INDEX_DB_SYMLINK");
      assert.equal(blocked.status().ownership.mode, "process_isolated");
      assert.equal(blocked.status().ownership.db_path, dbPath);
      assert.deepEqual(await readFile(externalDb, "utf8"), "external\n");
    } finally {
      await fixture.cleanup();
    }
  });

  it("projects validated real handler summary shapes for tracks, items, takes, fx, routing, automation, markers, media, selection, and project head", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, {
        tracks: [{ track_ref: "track:guid:{T1}", index: 0, name: "Kick", selected: true, muted: false, record_armed: true }],
        track_count: 1,
      }));
      assertObserved(runtime, execution("template.items.list_items_on_track", identity, {
        track_ref: "track:guid:{T1}",
        items: [{
          item_ref: "item:guid:{I1}", track_ref: "track:guid:{T1}", position_seconds: 1, length_seconds: 2,
          takes: [{ take_ref: "take:guid:{K1}", active: true, source_ref: "file:path:/audio/kick.wav" }],
        }],
      }));
      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, {
        owner_ref: "track:guid:{T1}", fx: [{ fx_ref: "fx:track:guid:{T1}:slot:0", owner_ref: "track:guid:{T1}", slot_index: 0, name: "ReaEQ", enabled: true }],
      }));
      assertObserved(runtime, execution("template.routing.read_project_routing_graph", identity, {
        edges: [{ send_ref: "send:track:guid:{T1}:0", source_track_ref: "track:guid:{T1}", destination_track_ref: "track:guid:{T2}", volume: 1, pan: 0 }],
      }));
      assertObserved(runtime, execution("template.automation.list_project_envelopes", identity, {
        envelopes: [{ envelope_ref: "envelope:track:guid:{T1}:volume", owner_ref: "track:guid:{T1}", name: "Volume", point_count: 3 }],
      }));
      assertObserved(runtime, execution("template.project.list_markers_regions", identity, {
        items: [{ marker_ref: "marker:index:1", kind: "marker", name: "Verse", position_seconds: 4 }, { region_ref: "region:index:2", kind: "region", name: "Chorus", position_seconds: 8, end_seconds: 16 }],
      }));
      assertObserved(runtime, execution("template.media.read_project_media_files", identity, {
        file_refs: ["file:path:/audio/kick.wav"], source_count: 1,
      }));

      const artifact = runtime.observeSuccessfulTemplateExecution({
        ...execution("template.project.create_observation_bundle", identity, { project_ref: identity.project_ref, track_count: 1, item_count: 1 }),
        result: {
          readback: { project_ref: identity.project_ref, track_count: 1, item_count: 1 },
          refs: [{ kind: "artifact", ref: "artifact:alpha3.2d:observation" }],
        },
      });
      assert.equal(artifact.ok, false);
      assert.equal(artifact.status, "artifact_payload_required");
      assert.equal(artifact.blockers[0].code, "ARTIFACT_PAYLOAD_REQUIRED");
      const unvalidatedPayload = runtime.observeArtifactPayload({
        ...identity,
        artifactRef: "artifact:alpha3.2d:observation",
        templateId: "template.project.create_observation_bundle",
        payload: { project_map: { tracks: [] } },
      });
      assert.equal(unvalidatedPayload.ok, false);
      assert.equal(unvalidatedPayload.blockers[0].code, "ARTIFACT_PAYLOAD_NOT_VALIDATED");
      const payload = runtime.observeArtifactPayload({
        ...identity,
        artifactRef: "artifact:alpha3.2d:observation",
        templateId: "template.project.create_observation_bundle",
        validated: true,
        payload: {
          project_ref: identity.project_ref,
          metadata: { title: "Trial" },
          track_count: 1,
          item_count: 1,
          markers_regions: { items: [{ marker_ref: "marker:index:1", kind: "marker", name: "Verse", position_seconds: 4 }] },
          project_map: {
            project_ref: identity.project_ref,
            tracks: [{ track_ref: "track:guid:{T1}", index: 0, name: "Kick", items: [{ item_ref: "item:guid:{I1}", track_ref: "track:guid:{T1}", position_seconds: 1, length_seconds: 2 }] }],
            selected_items: [{ item_ref: "item:guid:{I1}", track_ref: "track:guid:{T1}", position_seconds: 1, length_seconds: 2, selected: true }],
          },
          coverage: { project_map: "complete_page", selected_items: "bounded" },
        },
      });
      assert.equal(payload.ok, true);
      assert.equal(payload.payload_ref, "artifact:alpha3.2d:observation");

      const snapshot = runtime.adapter.snapshot();
      assert.deepEqual(snapshot.rows.tracks.map((row) => row.ref), ["track:guid:{T1}"]);
      assert.deepEqual(snapshot.rows.items.map((row) => row.ref), ["item:guid:{I1}"]);
      // Artifact project maps do not currently carry take refs, so the prior canonical take page is retained rather than fabricated or erased.
      assert.deepEqual(snapshot.rows.takes.map((row) => row.ref), ["take:guid:{K1}"]);
      assert.deepEqual(snapshot.rows.fx.map((row) => row.ref), ["fx:track:guid:{T1}:slot:0"]);
      assert.deepEqual(snapshot.rows.sends.map((row) => row.ref), ["send:track:guid:{T1}:0"]);
      assert.deepEqual(snapshot.rows.envelopes.map((row) => row.ref), ["envelope:track:guid:{T1}:volume"]);
      assert.deepEqual(snapshot.rows.markers_regions.map((row) => row.ref), ["marker:index:1"]);
      assert.deepEqual(snapshot.rows.media_sources.map((row) => row.ref), ["file:path:/audio/kick.wav"]);
      assert.equal(snapshot.rows.selection_state.some((row) => row.scope_kind === "project_head" && row.ref === identity.project_ref), true);
      assert.equal(snapshot.rows.selection_state.some((row) => row.ref === "item:guid:{I1}"), true);
      assert.equal(Object.values(snapshot.freshness_scopes).every((scope) => typeof scope.source_template_id === "string" && typeof scope.observed_at === "string"), true);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("downgrades impossible complete track coverage when an artifact contains fewer rows than its REAPER total", async () => {
    const fixture = await makeFixture();
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      const artifactRef = "artifact:alpha3.2d:short-observation";
      const pending = runtime.observeSuccessfulTemplateExecution({
        ...execution("template.project.create_observation_bundle", identity, {
          artifact_ref: artifactRef,
          project_ref: identity.project_ref,
          track_count: 14,
          returned_track_count: 6,
          map_truncated: false,
        }),
        result: {
          readback: {
            artifact_ref: artifactRef,
            project_ref: identity.project_ref,
            track_count: 14,
            returned_track_count: 6,
            map_truncated: false,
          },
          refs: [{ kind: "artifact", ref: artifactRef }],
        },
      });
      assert.equal(pending.ok, false);
      assert.equal(pending.blockers[0].code, "ARTIFACT_PAYLOAD_REQUIRED");

      const observed = runtime.observeArtifactPayload({
        ...identity,
        templateId: "template.project.create_observation_bundle",
        artifactRef,
        validated: true,
        payload: {
          project_ref: identity.project_ref,
          project_map: {
            project_ref: identity.project_ref,
            track_count: 14,
            item_count: 0,
            truncated: false,
            tracks: Array.from({ length: 6 }, (_, index) => ({
              track_ref: `track:guid:{SHORT-${index + 1}}`,
              name: `Short ${index + 1}`,
              index,
              items: [],
            })),
            selected_items: [],
          },
          coverage: { project_map: "complete_page" },
        },
      });

      assert.equal(observed.ok, true, JSON.stringify(observed));
      const snapshot = runtime.adapter.snapshot();
      assert.equal(snapshot.rows.tracks.length, 6);
      assert.equal(snapshot.freshness_scopes.tracks.status, "fresh");
      assert.equal(snapshot.freshness_scopes.tracks.coverage_status, "partial");
      const projectHead = snapshot.rows.selection_state.find((row) => row.scope_kind === "project_head");
      assert.equal(projectHead.summary.track_count, 14);
    } finally {
      runtime?.close();
      await fixture.cleanup();
    }
  });

  it("preserves rich track counts across full and scoped mixer refreshes", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, {
        tracks: [
          { track_ref: "track:guid:{T1}", index: 0, name: "Kick", item_count: 2, fx_count: 1 },
          { track_ref: "track:guid:{T2}", index: 1, name: "Bus", item_count: 0, fx_count: 2 },
        ],
        track_count: 2,
        truncated: false,
      }));

      assertObserved(runtime, execution("template.tracks.read_mixer_controls", identity, {
        tracks: [
          { track_ref: "track:guid:{T1}", index: 0, name: "Kick", muted: false },
          { track_ref: "track:guid:{T2}", index: 1, name: "Bus", muted: false },
        ],
        track_count: 2,
        truncated: false,
      }, { input: { include_selected: false }, refs: [] }));
      let rows = runtime.adapter.snapshot().rows.tracks;
      assert.deepEqual(rows.map((row) => [row.ref, row.item_count, row.fx_count]), [
        ["track:guid:{T1}", 2, 1],
        ["track:guid:{T2}", 0, 2],
      ]);

      assertObserved(runtime, execution("template.tracks.read_mixer_controls", identity, {
        tracks: [],
        track_count: 0,
        truncated: false,
      }, { input: { include_selected: true }, refs: [] }));
      assert.equal(runtime.adapter.snapshot().rows.tracks.length, 2);

      assertObserved(runtime, execution("template.tracks.read_mixer_controls", identity, {
        tracks: [{ track_ref: "track:guid:{T1}", index: 0, name: "Kick", muted: true }],
        track_count: 1,
        truncated: false,
      }, { input: { include_selected: true }, refs: [{ kind: "track", ref: "track:guid:{T1}" }] }));
      rows = runtime.adapter.snapshot().rows.tracks;
      assert.equal(rows.length, 2);
      assert.equal(rows.find((row) => row.ref === "track:guid:{T1}").muted, true);
      assert.equal(rows.find((row) => row.ref === "track:guid:{T1}").item_count, 2);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("preserves evidenced derived counts across complete project maps and accepts explicit zero", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, {
        tracks: [{
          track_ref: "track:guid:{COUNT-KEEP}", index: 0, name: "Count Keep",
          item_count: 4, fx_count: 0, send_count: 1,
        }],
        track_count: 1,
        truncated: false,
      }));
      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, {
        owner_ref: "track:guid:{COUNT-KEEP}",
        fx_count: 1,
        fx: [{
          fx_ref: "fx:track:guid:{COUNT-KEEP}:slot:0",
          owner_ref: "track:guid:{COUNT-KEEP}",
          slot_index: 0,
          name: "ReaEQ",
        }],
      }));

      const observeProjectMap = (tracks) => assertObserved(runtime, execution("template.project.create_observation_bundle", identity, {
        payload: {
          project_ref: identity.project_ref,
          project_map: {
            project_ref: identity.project_ref,
            track_count: tracks.length,
            item_count: 4,
            truncated: false,
            tracks,
            selected_items: [],
          },
          coverage: { project_map: "complete_page" },
        },
      }));

      observeProjectMap([
        { track_ref: "track:guid:{COUNT-KEEP}", index: 0, name: "Count Keep", items: [] },
        { track_ref: "track:guid:{COUNT-NEW}", index: 1, name: "Count New", items: [] },
      ]);
      let rows = runtime.adapter.snapshot().rows.tracks;
      const kept = rows.find((row) => row.ref === "track:guid:{COUNT-KEEP}");
      const unknown = rows.find((row) => row.ref === "track:guid:{COUNT-NEW}");
      assert.deepEqual([kept.item_count, kept.fx_count, kept.send_count], [4, 1, 1]);
      assert.deepEqual(
        [kept.summary.item_count, kept.summary.fx_count, kept.summary.send_count],
        [4, 1, 1],
      );
      assert.deepEqual([unknown.item_count, unknown.fx_count, unknown.send_count], [0, 0, 0]);
      assert.equal(Object.hasOwn(unknown.summary, "item_count"), false);
      assert.equal(Object.hasOwn(unknown.summary, "fx_count"), false);
      assert.equal(Object.hasOwn(unknown.summary, "send_count"), false);

      observeProjectMap([
        {
          track_ref: "track:guid:{COUNT-KEEP}", index: 0, name: "Count Keep",
          item_count: 0, fx_count: 0, send_count: 0, items: [],
        },
        { track_ref: "track:guid:{COUNT-NEW}", index: 1, name: "Count New", items: [] },
      ]);
      rows = runtime.adapter.snapshot().rows.tracks;
      const cleared = rows.find((row) => row.ref === "track:guid:{COUNT-KEEP}");
      assert.deepEqual([cleared.item_count, cleared.fx_count, cleared.send_count], [0, 0, 0]);
      assert.deepEqual(
        [cleared.summary.item_count, cleared.summary.fx_count, cleared.summary.send_count],
        [0, 0, 0],
      );
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps unknown derived counts distinct from known zero through public query and inspect dispatch", async () => {
    const fixture = await makeFixture();
    let indexRuntime;
    try {
      indexRuntime = await openRuntime(fixture);
      const identity = runtimeIdentity(indexRuntime);
      assertObserved(indexRuntime, execution("template.tracks.list_tracks", identity, {
        tracks: [{
          track_ref: "track:guid:{COUNT-RETAINED}", index: 0, name: "Retained Counts",
          item_count: 4, fx_count: 1, send_count: 1,
        }],
        track_count: 1,
        truncated: false,
      }));
      assertObserved(indexRuntime, execution("template.project.create_observation_bundle", identity, {
        payload: {
          project_ref: identity.project_ref,
          project_map: {
            project_ref: identity.project_ref,
            track_count: 3,
            item_count: 4,
            truncated: false,
            tracks: [
              { track_ref: "track:guid:{COUNT-RETAINED}", index: 0, name: "Retained Counts" },
              { track_ref: "track:guid:{COUNT-UNKNOWN}", index: 1, name: "Unknown Counts" },
              {
                track_ref: "track:guid:{COUNT-ZERO}", index: 2, name: "Known Zero Counts",
                item_count: 0, fx_count: 0, send_count: 0,
              },
            ],
            selected_items: [],
          },
          coverage: { project_map: "complete_page" },
        },
      }));

      indexRuntime.close();
      indexRuntime = await openRuntime(fixture);
      const reopenedRows = indexRuntime.adapter.snapshot().rows.tracks;
      const reopenedRetained = reopenedRows.find((row) => row.ref === "track:guid:{COUNT-RETAINED}");
      const reopenedUnknown = reopenedRows.find((row) => row.ref === "track:guid:{COUNT-UNKNOWN}");
      const reopenedZero = reopenedRows.find((row) => row.ref === "track:guid:{COUNT-ZERO}");
      for (const field of ["item_count", "fx_count", "send_count"]) {
        assert.equal(reopenedRetained.summary[field] > 0, true);
        assert.equal(Object.hasOwn(reopenedUnknown.summary, field), false);
        assert.equal(reopenedZero.summary[field], 0);
      }

      const fake = new FakeFoundationBridge({
        owner: identity.bridge_owner,
        generation: identity.bridge_generation,
        now,
      });
      const executor = {
        dispatch(request) {
          const response = structuredClone(fake.dispatch(request));
          if (request.operation.name === "project.read_summary") {
            response.result.summary = {
              project_ref: identity.project_ref,
              path: fixture.projectPath,
              change_count: 1,
              track_count: 3,
              item_count: 4,
            };
            response.result.readback = response.result.summary;
          }
          return response;
        },
      };
      const publicRuntime = createCallTemplateRuntime({
        projectIndexRuntime: indexRuntime,
        live: {
          opted_in: true,
          executor,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
        },
        now,
      });
      const fields = ["ref", "name", "item_count", "fx_count", "send_count"];
      const query = await publicRuntime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", fields, refresh_policy: "never", limit: 25 },
        context: callContext(identity, 1),
      });
      const inspect = await publicRuntime.call_template({
        id: "macro.project.inspect",
        input: {
          include: ["tracks"],
          fields_by_scope: { tracks: fields },
          refresh_policy: "never",
          limit: 25,
        },
        context: callContext(identity, 2),
      });

      assert.equal(query.ok, true, JSON.stringify(query));
      assert.equal(inspect.ok, true, JSON.stringify(inspect));
      const publicRows = [
        ["query", query.result.data.rows],
        ["inspect", inspect.result.data.scopes.tracks.rows],
      ];
      const countFields = ["item_count", "fx_count", "send_count"];
      const countTruth = (row) => Object.fromEntries(countFields.map((field) => [
        field,
        { known: Object.hasOwn(row, field), value: Object.hasOwn(row, field) ? row[field] : null },
      ]));
      assert.deepEqual(publicRows.map(([surface, rows]) => ({
        surface,
        retained: countTruth(rows.find((row) => row.ref === "track:guid:{COUNT-RETAINED}")),
        unknown: countTruth(rows.find((row) => row.ref === "track:guid:{COUNT-UNKNOWN}")),
        known_zero: countTruth(rows.find((row) => row.ref === "track:guid:{COUNT-ZERO}")),
      })), ["query", "inspect"].map((surface) => ({
        surface,
        retained: {
          item_count: { known: true, value: 4 },
          fx_count: { known: true, value: 1 },
          send_count: { known: true, value: 1 },
        },
        unknown: Object.fromEntries(countFields.map((field) => [field, { known: false, value: null }])),
        known_zero: Object.fromEntries(countFields.map((field) => [field, { known: true, value: 0 }])),
      })));

      let filterSequence = 3;
      for (const filterField of ["has_items", "has_fx", "has_sends"]) {
        const knownFalse = await publicRuntime.call_template({
          id: "macro.project.query",
          input: {
            entity: "tracks",
            fields,
            filters: { [filterField]: false },
            refresh_policy: "never",
            limit: 25,
          },
          context: callContext(identity, filterSequence),
        });
        filterSequence += 1;
        assert.equal(knownFalse.ok, true, JSON.stringify(knownFalse));
        assert.deepEqual(knownFalse.result.data.rows.map((row) => row.ref), ["track:guid:{COUNT-ZERO}"]);
        assert.equal(knownFalse.result.data.coverage.match_status, "candidate_matches_from_incomplete_coverage");

        const unknownFalse = await publicRuntime.call_template({
          id: "macro.project.query",
          input: {
            entity: "tracks",
            fields,
            filters: { name: "Unknown Counts", [filterField]: false },
            refresh_policy: "never",
            limit: 25,
          },
          context: callContext(identity, filterSequence),
        });
        filterSequence += 1;
        assert.equal(unknownFalse.ok, false, JSON.stringify(unknownFalse));
        assert.equal(unknownFalse.blockers.some((entry) => entry.code === "INDEX_COVERAGE_INCOMPLETE"), true);
        assert.deepEqual(unknownFalse.result.data.rows, []);
        assert.equal(unknownFalse.result.data.coverage.match_status, "no_match_not_definitive");

        const unknownTrue = await publicRuntime.call_template({
          id: "macro.project.query",
          input: {
            entity: "tracks",
            fields,
            filters: { name: "Unknown Counts", [filterField]: true },
            refresh_policy: "never",
            limit: 25,
          },
          context: callContext(identity, filterSequence),
        });
        filterSequence += 1;
        assert.equal(unknownTrue.ok, false, JSON.stringify(unknownTrue));
        assert.equal(unknownTrue.blockers.some((entry) => entry.code === "INDEX_COVERAGE_INCOMPLETE"), true);
        assert.deepEqual(unknownTrue.result.data.rows, []);
        assert.equal(unknownTrue.result.data.coverage.match_status, "no_match_not_definitive");
      }
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("keeps FX rows isolated by owner and clears only the owner with an empty chain", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, {
        tracks: [
          { track_ref: "track:guid:{T1}", index: 0, name: "Kick", fx_count: 0 },
          { track_ref: "track:guid:{T2}", index: 1, name: "Bass", fx_count: 0 },
        ],
        track_count: 2,
        truncated: false,
      }));
      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, {
        owner_ref: "track:guid:{T1}",
        fx_count: 1,
        fx: [{ fx_ref: "fx:track:guid:{T1}:slot:0", owner_ref: "track:guid:{T1}", slot_index: 0, name: "ReaEQ" }],
      }));
      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, {
        owner_ref: "track:guid:{T2}",
        fx_count: 1,
        fx: [{ fx_ref: "fx:track:guid:{T2}:slot:0", owner_ref: "track:guid:{T2}", slot_index: 0, name: "ReaComp" }],
      }));

      assert.deepEqual(runtime.adapter.snapshot().rows.fx.map((row) => [row.owner_ref, row.ref]), [
        ["track:guid:{T1}", "fx:track:guid:{T1}:slot:0"],
        ["track:guid:{T2}", "fx:track:guid:{T2}:slot:0"],
      ]);
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => [row.ref, row.fx_count]), [
        ["track:guid:{T1}", 1],
        ["track:guid:{T2}", 1],
      ]);
      assert.equal(runtime.adapter.snapshot().freshness_scopes.tracks.coverage_status, "complete");

      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, { owner_ref: "track:guid:{T1}", fx_count: 0, fx: [] }));
      assert.deepEqual(runtime.adapter.snapshot().rows.fx.map((row) => [row.owner_ref, row.ref]), [
        ["track:guid:{T2}", "fx:track:guid:{T2}:slot:0"],
      ]);
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => [row.ref, row.fx_count]), [
        ["track:guid:{T1}", 0],
        ["track:guid:{T2}", 1],
      ]);
      runtime.close();

      const reopened = await openRuntime(fixture);
      assert.deepEqual(reopened.adapter.snapshot().rows.tracks.map((row) => [row.ref, row.fx_count]), [
        ["track:guid:{T1}", 0],
        ["track:guid:{T2}", 1],
      ]);
      assert.equal(reopened.adapter.snapshot().freshness_scopes.tracks.coverage_status, "complete");
      reopened.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("scoped item replacement preserves items and takes owned by other tracks", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.items.list_items_on_track", identity, {
        track_ref: "track:guid:{T1}",
        items: [{ item_ref: "item:guid:{I1}", track_ref: "track:guid:{T1}", take_count: 1, active_take_ref: "take:guid:{K1}" }],
      }));
      assertObserved(runtime, execution("template.items.list_items_on_track", identity, {
        track_ref: "track:guid:{T2}",
        items: [{ item_ref: "item:guid:{I2}", track_ref: "track:guid:{T2}", take_count: 1, active_take_ref: "take:guid:{K2}" }],
      }));
      assertObserved(runtime, execution("template.items.list_items_on_track", identity, {
        track_ref: "track:guid:{T1}",
        items: [{ item_ref: "item:guid:{I3}", track_ref: "track:guid:{T1}", take_count: 1, active_take_ref: "take:guid:{K3}" }],
      }));

      const snapshot = runtime.adapter.snapshot();
      assert.deepEqual(snapshot.rows.items.map((row) => row.ref).sort(), ["item:guid:{I2}", "item:guid:{I3}"]);
      assert.deepEqual(snapshot.rows.takes.map((row) => row.ref).sort(), ["take:guid:{K2}", "take:guid:{K3}"]);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for malformed item summaries and retains prior rows", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.items.read_item_summary", identity, {
        item_ref: "item:guid:{SAFE}", track_ref: "track:guid:{T1}", take_count: 0,
      }));
      const before = JSON.stringify(runtime.adapter.snapshot());

      const missingItemRef = runtime.observeSuccessfulTemplateExecution(execution("template.items.read_item_summary", identity, {
        track_ref: "track:guid:{T1}", take_count: 0,
      }));
      assert.equal(missingItemRef.ok, false);
      assert.equal(missingItemRef.status, "invalid_readback");
      assert.equal(missingItemRef.blockers[0].code, "NO_CANONICAL_ROWS");
      assert.equal(JSON.stringify(runtime.adapter.snapshot()), before);

      const missingTakeRef = runtime.observeSuccessfulTemplateExecution(execution("template.items.read_item_summary", identity, {
        item_ref: "item:guid:{SAFE}", track_ref: "track:guid:{T1}", take_count: 1,
      }));
      assert.equal(missingTakeRef.ok, false);
      assert.equal(missingTakeRef.status, "invalid_readback");
      assert.equal(missingTakeRef.blockers[0].code, "NO_CANONICAL_TAKE_ROWS");
      assert.equal(JSON.stringify(runtime.adapter.snapshot()), before);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("projects active_take_ref into a canonical active take row", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.items.read_item_summary", identity, {
        item_ref: "item:guid:{I1}",
        track_ref: "track:guid:{T1}",
        take_count: 1,
        active_take_ref: "take:guid:{K1}",
        active_take_name: "Kick take",
      }));

      const take = runtime.adapter.snapshot().rows.takes[0];
      assert.equal(take.ref, "take:guid:{K1}");
      assert.equal(take.item_ref, "item:guid:{I1}");
      assert.equal(take.owner_ref, "item:guid:{I1}");
      assert.equal(take.track_ref, "track:guid:{T1}");
      assert.equal(take.active, true);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for unsuccessful, partial, oversized, unknown, malformed, and identity-mismatched observations", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      const initial = JSON.stringify(runtime.adapter.snapshot());
      const cases = [
        { input: { ok: false }, status: "ignored_unsuccessful_execution" },
        { input: execution("template.unknown.read", identity, { rows: [] }), status: "unknown_refresh_template" },
        { input: { ...execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{A}" }] }), partial: true }, status: "partial_execution_rejected" },
        { input: { ...execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{A}" }] }), identity: { ...identity, bridge_generation: 8 } }, status: "identity_mismatch" },
        { input: { ...execution("template.tracks.list_tracks", identity, { tracks: [{ name: "missing ref" }] }) }, status: "invalid_readback" },
        { input: execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{A}", name: "x".repeat(1_100_000) }] }), status: "pressure_rejected" },
      ];
      for (const row of cases) {
        const result = runtime.observeSuccessfulTemplateExecution(row.input);
        assert.equal(result.ok, false);
        assert.equal(result.status, row.status);
        assert.equal(result.child_calls_executed, 0);
        assert.equal(JSON.stringify(runtime.adapter.snapshot()), initial);
      }
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a 5000-row refresh before any store mutation", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      const rows = Array.from({ length: 5000 }, (_, index) => ({ track_ref: `track:guid:{PRESSURE-${index}}`, index, name: `Track ${index}` }));
      const result = runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", identity, { tracks: rows }));
      assert.equal(result.ok, false);
      assert.equal(result.status, "pressure_rejected");
      assert.equal(result.blockers[0].code, "READBACK_ROWS_EXCEEDED");
      assert.equal(runtime.adapter.snapshot().rows.tracks.length, 0);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("exposes deterministic snapshot freshness evidence that advances after accepted refresh observations", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assert.equal(runtime.status().freshness_token, null);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{REV-A}", name: "A" }] }));
      const first = runtime.status();
      assert.match(first.snapshot_id, /^snapshot:alpha3\.2d:/);
      assert.match(first.revision, /^freshness:alpha3\.2d:[a-f0-9]{24}$/);
      assert.equal(first.revision, first.freshness_token);
      assert.equal(first.revision, runtime.status().revision);

      assertObserved(runtime, execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{REV-B}", name: "B" }] }));
      const second = runtime.status();
      assert.notEqual(second.snapshot_id, first.snapshot_id);
      assert.notEqual(second.freshness_token, first.freshness_token);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("accepts project change counts without discarding rows and reconciles only dependent scopes", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{KEEP}", name: "Keep" }] }));
      assertObserved(runtime, execution("template.project.read_summary", identity, {
        project_ref: identity.project_ref,
        change_count: 41,
        track_count: 1,
      }));
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{KEEP}"]);
      assert.equal(runtime.adapter.snapshot().rows.selection_state.find((row) => row.scope_kind === "project_head").summary.change_count, 41);
      assert.equal(runtime.status().revision, "reaper-change-count:41");
      assert.equal(runtime.status().revision_source, "reaper_project_state_change_count");

      assertObserved(runtime, execution("template.project.create_observation_bundle", identity, {
        payload: {
          project_ref: identity.project_ref,
          project_map: {
            project_ref: identity.project_ref,
            track_count: 1,
            item_count: 0,
            tracks: [{ track_ref: "track:guid:{KEEP}", name: "Keep", items: [] }],
            selected_items: [],
          },
          markers_regions: { items: [] },
          coverage: { project_map: "complete_page", markers_regions: "bounded" },
        },
      }));
      assert.equal(runtime.status().revision, "reaper-change-count:41");

      const matched = runtime.reconcileProjectRevision({ change_count: 41 });
      assert.equal(matched.ok, true);
      assert.equal(matched.status, "revision_matched");
      const changed = runtime.reconcileProjectRevision({ change_count: 42 });
      assert.equal(changed.ok, true);
      assert.equal(changed.status, "revision_changed");
      assert.equal(changed.live_change_count, 42);
      assert.equal(runtime.status().revision, "reaper-change-count:42");
      assert.equal(runtime.status().sqlite_is_truth, false);
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{KEEP}"]);
      for (const scope of ["selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media"]) {
        assert.equal(runtime.adapter.snapshot().freshness_scopes[scope].status, "stale");
      }
      assert.equal(runtime.reconcileProjectRevision({ change_count: -1 }).blockers[0].code, "PROJECT_CHANGE_COUNT_REQUIRED");
      assert.equal(runtime.reconcileProjectRevision(null).blockers[0].code, "PROJECT_CHANGE_COUNT_REQUIRED");
      runtime.close();

      if (await hasSqlite()) {
        const reopened = await openRuntime(fixture);
        assert.equal(reopened.status().project_change_count, 42);
        assert.equal(reopened.status().revision, "reaper-change-count:42");
        reopened.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("initializes a live project revision without a prior read-summary observation", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const initialized = runtime.reconcileProjectRevision({ change_count: 7 });
      assert.equal(initialized.ok, true);
      assert.equal(initialized.status, "revision_initialized");
      assert.equal(initialized.changed, false);
      assert.equal(runtime.status().revision, "reaper-change-count:7");
      assert.equal(runtime.adapter.snapshot().freshness_scopes.selection.status, "fresh");
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("stages three hidden artifact pages and atomically commits complete 40-track knowledge only after revision confirmation", async () => {
    const fixture = await makeFixture();
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, {
        tracks: [
          { track_ref: "track:guid:{LOGICAL-1}", name: "Logical 1", item_count: 2, fx_count: 1, send_count: 1 },
          { track_ref: "track:guid:{PREVIOUS}", name: "Previous" },
        ],
        track_count: 2,
        truncated: false,
      }));
      assertObserved(runtime, execution("template.project.read_summary", identity, {
        project_ref: identity.project_ref,
        change_count: 41,
        track_count: 40,
      }));
      const started = runtime.beginLogicalRefresh({
        scopes: ["tracks"],
        expected_revision: "reaper-change-count:41",
        declared_track_count: 40,
        observed_at: NOW,
      });
      assert.equal(started.ok, true);
      assert.equal(started.sqlite_updated, false);
      assert.match(started.transaction_id, /^logical-refresh:/);
      const transactionId = started.transaction_id;

      for (const [cursor, count] of [[0, 16], [16, 16], [32, 8]]) {
        const nextCursor = cursor + count < 40 ? cursor + count : null;
        const artifactRef = `artifact:alpha3.3:logical-tracks-${cursor}`;
        const tracks = Array.from({ length: count }, (_, offset) => {
          const index = cursor + offset;
          return { track_ref: `track:guid:{LOGICAL-${index + 1}}`, name: `Logical ${index + 1}`, index, items: [] };
        });
        const summary = {
          artifact_ref: artifactRef,
          project_ref: identity.project_ref,
          track_count: 40,
          track_cursor: cursor,
          returned_track_count: count,
          next_track_cursor: nextCursor === null ? null : String(nextCursor),
          truncated: nextCursor !== null,
        };
        const envelope = execution("template.project.create_observation_bundle", identity, summary, {
          logical_refresh: { transaction_id: transactionId, scope: "tracks" },
        });
        envelope.result = {
          readback: summary,
          refs: [{ kind: "artifact", ref: artifactRef }],
        };
        const pending = runtime.observeSuccessfulTemplateExecution(envelope);
        assert.equal(pending.ok, false);
        assert.equal(pending.blockers[0].code, "ARTIFACT_PAYLOAD_REQUIRED");

        const staged = runtime.observeArtifactPayload({
          ...identity,
          artifactRef,
          templateId: "template.project.create_observation_bundle",
          validated: true,
          payload: {
            project_ref: identity.project_ref,
            project_map: {
              project_ref: identity.project_ref,
              track_count: 40,
              item_count: 0,
              track_cursor: cursor,
              returned_track_count: count,
              next_track_cursor: nextCursor === null ? null : String(nextCursor),
              truncated: nextCursor !== null,
              tracks,
              selected_items: [],
            },
            coverage: { project_map: nextCursor === null ? "complete_page" : "paged_partial" },
          },
        });
        assert.equal(staged.ok, true, JSON.stringify(staged));
        assert.equal(staged.status, "logical_refresh_page_staged");
        assert.equal(staged.sqlite_updated, false);
        assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => row.ref), [
          "track:guid:{LOGICAL-1}",
          "track:guid:{PREVIOUS}",
        ]);
      }

      assert.equal(runtime.status().logical_refreshes_staged, 1);
      const committed = runtime.commitLogicalRefresh({
        transaction_id: transactionId,
        observed_revision: "reaper-change-count:41",
        observed_at: NOW,
      });
      assert.equal(committed.ok, true, JSON.stringify(committed));
      assert.equal(committed.status, "logical_refresh_committed");
      assert.equal(committed.page_count, 3);
      assert.equal(committed.row_count, 40);
      assert.deepEqual(committed.applied_scopes, ["tracks"]);
      assert.deepEqual(committed.row_counts, { tracks: 40 });
      assert.deepEqual(committed.coverage, { tracks: "complete" });
      assert.equal(committed.sqlite_updated, true);
      const snapshot = runtime.adapter.snapshot();
      assert.equal(snapshot.rows.tracks.length, 40);
      assert.equal(snapshot.rows.tracks.at(-1).ref, "track:guid:{LOGICAL-40}");
      assert.equal(snapshot.rows.tracks.some((row) => row.ref === "track:guid:{PREVIOUS}"), false);
      const logicalFirst = snapshot.rows.tracks.find((row) => row.ref === "track:guid:{LOGICAL-1}");
      assert.deepEqual([logicalFirst.item_count, logicalFirst.fx_count, logicalFirst.send_count], [2, 1, 1]);
      assert.deepEqual(
        [logicalFirst.summary.item_count, logicalFirst.summary.fx_count, logicalFirst.summary.send_count],
        [2, 1, 1],
      );
      assert.equal(snapshot.freshness_scopes.tracks.coverage_status, "complete");
      assert.equal(runtime.status().revision, "reaper-change-count:41");
      assert.equal(runtime.status().logical_refreshes_staged, 0);
    } finally {
      runtime?.close();
      await fixture.cleanup();
    }
  });

  it("atomically commits complete 14-envelope knowledge across hidden automation pages and marks it stale after a write", async () => {
    const fixture = await makeFixture();
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.automation.list_project_envelopes", identity, {
        envelopes: [{ envelope_ref: "envelope:track:guid:{OLD}:volume", owner_ref: "track:guid:{OLD}", name: "Old" }],
        returned_count: 1,
        total_count: 1,
        next_cursor: null,
        truncated: false,
        coverage_status: "complete",
      }));
      assertObserved(runtime, execution("template.project.read_summary", identity, {
        project_ref: identity.project_ref,
        change_count: 51,
      }));
      const started = runtime.beginLogicalRefresh({
        scopes: ["automation"],
        expected_revision: "reaper-change-count:51",
        declared_envelope_count: 14,
        observed_at: NOW,
      });
      assert.equal(started.ok, true);
      assert.equal(started.scope, "automation");
      assert.equal(started.declared_envelope_count, 14);
      const transactionId = started.transaction_id;

      for (const [cursor, count] of [[0, 5], [5, 5], [10, 4]]) {
        const nextCursor = cursor + count < 14 ? cursor + count : null;
        const envelopes = Array.from({ length: count }, (_, offset) => {
          const index = cursor + offset;
          return {
            envelope_ref: `envelope:track:guid:{AUTO-${index + 1}}:volume`,
            owner_ref: `track:guid:{AUTO-${index + 1}}`,
            name: index === 13 ? "Automation Envelope 14 Exact" : `Automation Envelope ${index + 1}`,
            parent_kind: "track",
            visible: true,
            point_count: index,
          };
        });
        const staged = runtime.observeSuccessfulTemplateExecution(execution(
          "template.automation.list_project_envelopes",
          identity,
          {
            envelopes,
            returned_count: count,
            total_count: 14,
            next_cursor: nextCursor === null ? null : String(nextCursor),
            truncated: nextCursor !== null,
            coverage_status: nextCursor === null ? "complete" : "paged",
          },
          {
            input: { cursor: cursor === 0 ? undefined : String(cursor), limit: 5 },
            logical_refresh: {
              transaction_id: transactionId,
              scope: "automation",
              envelope_cursor: cursor,
              revision: "reaper-change-count:51",
            },
          },
        ));
        assert.equal(staged.ok, true, JSON.stringify(staged));
        assert.equal(staged.status, "logical_refresh_page_staged");
        assert.equal(staged.envelope_cursor, cursor);
        assert.equal(staged.next_envelope_cursor, nextCursor);
        assert.equal(staged.declared_envelope_count, 14);
        assert.equal(staged.sqlite_updated, false);
        assert.deepEqual(runtime.adapter.snapshot().rows.envelopes.map((row) => row.ref), ["envelope:track:guid:{OLD}:volume"]);
      }

      const committed = runtime.commitLogicalRefresh({
        transaction_id: transactionId,
        observed_revision: "reaper-change-count:51",
        observed_at: NOW,
      });
      assert.equal(committed.ok, true, JSON.stringify(committed));
      assert.equal(committed.scope, "automation");
      assert.equal(committed.declared_envelope_count, 14);
      assert.deepEqual(committed.applied_scopes, ["automation"]);
      assert.deepEqual(committed.row_counts, { automation: 14 });
      assert.deepEqual(committed.coverage, { automation: "complete" });
      const snapshot = runtime.adapter.snapshot();
      assert.equal(snapshot.rows.envelopes.length, 14);
      assert.equal(snapshot.rows.envelopes.at(-1).ref, "envelope:track:guid:{AUTO-14}:volume");
      assert.equal(snapshot.rows.envelopes.at(-1).name, "Automation Envelope 14 Exact");
      assert.equal(snapshot.freshness_scopes.automation.status, "fresh");
      assert.equal(snapshot.freshness_scopes.automation.coverage_status, "complete");

      const publicPage = runtime.observeSuccessfulTemplateExecution(execution(
        "template.automation.list_project_envelopes",
        identity,
        {
          envelopes: snapshot.rows.envelopes.slice(0, 2).map((row) => ({
            envelope_ref: row.ref,
            owner_ref: row.owner_ref,
            name: row.name,
            parent_kind: row.parent_kind,
            visible: row.visible,
            point_count: row.point_count,
          })),
          returned_count: 2,
          total_count: 14,
          next_cursor: "2",
          truncated: true,
          coverage_status: "paged",
        },
        { input: { limit: 2 } },
      ));
      assert.equal(publicPage.ok, true, JSON.stringify(publicPage));
      assert.equal(runtime.adapter.snapshot().rows.envelopes.length, 14);
      assert.equal(runtime.adapter.snapshot().rows.envelopes.at(-1).ref, "envelope:track:guid:{AUTO-14}:volume");
      assert.equal(runtime.adapter.snapshot().freshness_scopes.automation.coverage_status, "complete");

      const invalidated = runtime.invalidateScopes({ scopes: ["automation"], observed_at: NOW });
      assert.equal(invalidated.ok, true);
      assert.equal(runtime.adapter.snapshot().freshness_scopes.automation.status, "stale");
      assert.equal(runtime.adapter.snapshot().freshness_scopes.automation.coverage_status, "complete");
      assert.equal(runtime.adapter.snapshot().rows.envelopes.length, 14);
    } finally {
      runtime?.close();
      await fixture.cleanup();
    }
  });

  it("discards gapped, incomplete, duplicate, and mixed-revision automation refreshes without replacing prior complete rows", async () => {
    const fixture = await makeFixture();
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.automation.list_project_envelopes", identity, {
        envelopes: [{ envelope_ref: "envelope:track:guid:{KEEP-AUTO}:volume", owner_ref: "track:guid:{KEEP-AUTO}", name: "Keep Automation" }],
        returned_count: 1,
        total_count: 1,
        next_cursor: null,
        truncated: false,
        coverage_status: "complete",
      }));
      assertObserved(runtime, execution("template.project.read_summary", identity, { project_ref: identity.project_ref, change_count: 61 }));
      const priorRows = () => runtime.adapter.snapshot().rows.envelopes.map((row) => row.ref);
      const page = ({ transactionId, cursor, refs, totalCount, nextCursor, revision = "reaper-change-count:61", coverageStatus }) =>
        runtime.observeSuccessfulTemplateExecution(execution(
          "template.automation.list_project_envelopes",
          identity,
          {
            envelopes: refs.map((ref, index) => ({ envelope_ref: ref, owner_ref: `track:guid:{OWNER-${cursor + index}}`, name: ref })),
            returned_count: refs.length,
            total_count: totalCount,
            next_cursor: nextCursor === null ? null : String(nextCursor),
            truncated: nextCursor !== null,
            coverage_status: coverageStatus ?? (nextCursor === null ? "complete" : "paged"),
          },
          { logical_refresh: { transaction_id: transactionId, scope: "automation", envelope_cursor: cursor, revision } },
        ));

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "auto-gap", scope: "automation", expected_revision: "reaper-change-count:61", declared_envelope_count: 3 }).ok, true);
      assert.equal(page({ transactionId: "auto-gap", cursor: 0, refs: ["envelope:track:guid:{GAP-1}:volume", "envelope:track:guid:{GAP-2}:volume"], totalCount: 3, nextCursor: 2 }).ok, true);
      assert.equal(page({ transactionId: "auto-gap", cursor: 3, refs: ["envelope:track:guid:{GAP-3}:volume"], totalCount: 3, nextCursor: null }).ok, true);
      const gap = runtime.commitLogicalRefresh({ transaction_id: "auto-gap", observed_revision: "reaper-change-count:61" });
      assert.equal(gap.ok, false);
      assert.equal(gap.blockers[0].code, "LOGICAL_REFRESH_CURSOR_GAP");
      assert.deepEqual(priorRows(), ["envelope:track:guid:{KEEP-AUTO}:volume"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "auto-incomplete", scope: "automation", expected_revision: "reaper-change-count:61", declared_envelope_count: 2 }).ok, true);
      assert.equal(page({ transactionId: "auto-incomplete", cursor: 0, refs: ["envelope:track:guid:{INCOMPLETE}:volume"], totalCount: 2, nextCursor: 1 }).ok, true);
      const incomplete = runtime.commitLogicalRefresh({ transaction_id: "auto-incomplete", observed_revision: "reaper-change-count:61" });
      assert.equal(incomplete.ok, false);
      assert.equal(incomplete.blockers[0].code, "LOGICAL_REFRESH_COVERAGE_INCOMPLETE");
      assert.deepEqual(priorRows(), ["envelope:track:guid:{KEEP-AUTO}:volume"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "auto-duplicate", scope: "automation", expected_revision: "reaper-change-count:61", declared_envelope_count: 2 }).ok, true);
      const duplicateRef = "envelope:track:guid:{DUPLICATE}:volume";
      const duplicatePage = page({ transactionId: "auto-duplicate", cursor: 0, refs: [duplicateRef, duplicateRef], totalCount: 2, nextCursor: null });
      assert.equal(duplicatePage.ok, false);
      assert.equal(duplicatePage.blockers[0].code, "LOGICAL_REFRESH_RETURNED_COUNT_MISMATCH");
      assert.deepEqual(priorRows(), ["envelope:track:guid:{KEEP-AUTO}:volume"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "auto-revision", scope: "automation", expected_revision: "reaper-change-count:61", declared_envelope_count: 2 }).ok, true);
      assert.equal(page({ transactionId: "auto-revision", cursor: 0, refs: ["envelope:track:guid:{REV-1}:volume"], totalCount: 2, nextCursor: 1 }).ok, true);
      const mixed = page({ transactionId: "auto-revision", cursor: 1, refs: ["envelope:track:guid:{REV-2}:volume"], totalCount: 2, nextCursor: null, revision: "reaper-change-count:62" });
      assert.equal(mixed.ok, false);
      assert.equal(mixed.blockers[0].code, "LOGICAL_REFRESH_REVISION_MISMATCH");
      assert.deepEqual(priorRows(), ["envelope:track:guid:{KEEP-AUTO}:volume"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "auto-unknown", scope: "automation", expected_revision: "reaper-change-count:61", declared_envelope_count: 1 }).ok, true);
      const unknown = page({ transactionId: "auto-unknown", cursor: 0, refs: ["envelope:track:guid:{UNKNOWN}:volume"], totalCount: 1, nextCursor: null, coverageStatus: "unknown" });
      assert.equal(unknown.ok, false);
      assert.equal(unknown.blockers[0].code, "LOGICAL_REFRESH_COVERAGE_INCOMPLETE");
      assert.deepEqual(priorRows(), ["envelope:track:guid:{KEEP-AUTO}:volume"]);
    } finally {
      runtime?.close();
      await fixture.cleanup();
    }
  });

  it("discards gapped, incomplete, duplicate-count, or revision-mismatched logical refreshes without replacing prior SQLite rows", async () => {
    const fixture = await makeFixture();
    let runtime;
    try {
      runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, {
        tracks: [{ track_ref: "track:guid:{KEEP-LOGICAL}", name: "Keep Logical" }],
        track_count: 1,
        truncated: false,
      }));
      assertObserved(runtime, execution("template.project.read_summary", identity, {
        project_ref: identity.project_ref,
        change_count: 41,
        track_count: 1,
      }));
      const priorRows = () => runtime.adapter.snapshot().rows.tracks.map((row) => row.ref);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "gap", expected_revision: "reaper-change-count:41", declared_track_count: 3 }).ok, true);
      assert.equal(runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", identity, {
        tracks: [
          { track_ref: "track:guid:{GAP-1}", index: 0 },
          { track_ref: "track:guid:{GAP-2}", index: 1 },
        ],
        track_count: 3,
        track_cursor: 0,
        returned_track_count: 2,
        next_track_cursor: "2",
        truncated: true,
      }, { logical_refresh: { transaction_id: "gap" } })).ok, true);
      assert.equal(runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", identity, {
        tracks: [{ track_ref: "track:guid:{GAP-3}", index: 2 }],
        track_count: 3,
        track_cursor: 3,
        returned_track_count: 1,
        next_track_cursor: null,
        truncated: false,
      }, { logical_refresh: { transaction_id: "gap" } })).ok, true);
      const gap = runtime.commitLogicalRefresh({ transaction_id: "gap", observed_revision: "reaper-change-count:41" });
      assert.equal(gap.ok, false);
      assert.equal(gap.blockers[0].code, "LOGICAL_REFRESH_CURSOR_GAP");
      assert.deepEqual(priorRows(), ["track:guid:{KEEP-LOGICAL}"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "incomplete", expected_revision: "reaper-change-count:41", declared_track_count: 2 }).ok, true);
      assert.equal(runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", identity, {
        tracks: [{ track_ref: "track:guid:{INCOMPLETE-1}", index: 0 }],
        track_count: 2,
        track_cursor: 0,
        returned_track_count: 1,
        next_track_cursor: "1",
        truncated: true,
      }, { logical_refresh: { transaction_id: "incomplete" } })).ok, true);
      const incomplete = runtime.commitLogicalRefresh({ transaction_id: "incomplete", observed_revision: "reaper-change-count:41" });
      assert.equal(incomplete.ok, false);
      assert.equal(incomplete.blockers[0].code, "LOGICAL_REFRESH_COVERAGE_INCOMPLETE");
      assert.deepEqual(priorRows(), ["track:guid:{KEEP-LOGICAL}"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "duplicates", expected_revision: "reaper-change-count:41", declared_track_count: 2 }).ok, true);
      assert.equal(runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", identity, {
        tracks: [
          { track_ref: "track:guid:{DUPLICATE}", index: 0 },
          { track_ref: "track:guid:{DUPLICATE}", index: 1 },
        ],
        track_count: 2,
        track_cursor: 0,
        returned_track_count: 1,
        next_track_cursor: null,
        truncated: false,
      }, { logical_refresh: { transaction_id: "duplicates" } })).ok, true);
      const duplicates = runtime.commitLogicalRefresh({ transaction_id: "duplicates", observed_revision: "reaper-change-count:41" });
      assert.equal(duplicates.ok, false);
      assert.equal(duplicates.blockers[0].code, "LOGICAL_REFRESH_TRACK_COUNT_MISMATCH");
      assert.deepEqual(priorRows(), ["track:guid:{KEEP-LOGICAL}"]);

      assert.equal(runtime.beginLogicalRefresh({ transaction_id: "revision", expected_revision: "reaper-change-count:41", declared_track_count: 1 }).ok, true);
      assert.equal(runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", identity, {
        tracks: [{ track_ref: "track:guid:{REVISION}", index: 0 }],
        track_count: 1,
        track_cursor: 0,
        returned_track_count: 1,
        next_track_cursor: null,
        truncated: false,
      }, { logical_refresh: { transaction_id: "revision" } })).ok, true);
      const revision = runtime.commitLogicalRefresh({ transaction_id: "revision", observed_revision: "reaper-change-count:42" });
      assert.equal(revision.ok, false);
      assert.equal(revision.blockers[0].code, "LOGICAL_REFRESH_REVISION_MISMATCH");
      assert.deepEqual(priorRows(), ["track:guid:{KEEP-LOGICAL}"]);

      const abortable = runtime.beginLogicalRefresh({ scopes: ["tracks"], expected_revision: "reaper-change-count:41" });
      const aborted = runtime.abortLogicalRefresh({ transaction_id: abortable.transaction_id, reason: "caller_cancelled", observed_at: NOW });
      assert.equal(aborted.ok, true);
      assert.equal(aborted.status, "logical_refresh_aborted");
      assert.equal(aborted.transaction_id, abortable.transaction_id);
      assert.equal(aborted.reason, "caller_cancelled");
      assert.equal(aborted.sqlite_updated, false);
      assert.equal(runtime.status().logical_refreshes_staged, 0);
    } finally {
      runtime?.close();
      await fixture.cleanup();
    }
  });

  it("dedupes targeted known-scope invalidation and rejects unknown, stale, or closed runtimes", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.tracks.list_tracks", identity, { tracks: [{ track_ref: "track:guid:{TARGET}", name: "Target" }] }));
      const invalidated = runtime.invalidateScopes({ scopes: ["tracks", "routing", "tracks"] });
      assert.equal(invalidated.ok, true);
      assert.deepEqual(invalidated.scopes, ["tracks", "routing"]);
      assert.equal(invalidated.sqlite_rows_are_candidates_only, true);
      assert.equal(runtime.adapter.snapshot().freshness_scopes.tracks.status, "stale");
      assert.equal(runtime.adapter.snapshot().freshness_scopes.routing.status, "stale");
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{TARGET}"]);
      const beforeUnknown = JSON.stringify(runtime.adapter.snapshot());
      const unknown = runtime.invalidateScopes({ scopes: ["tracks", "unknown_scope"] });
      assert.equal(unknown.ok, false);
      assert.equal(unknown.blockers[0].code, "INDEX_SCOPE_UNKNOWN");
      assert.equal(JSON.stringify(runtime.adapter.snapshot()), beforeUnknown);

      runtime.adapter.markStaleSession({ reason: "test_stale" });
      assert.equal(runtime.invalidateScopes({ scopes: ["tracks"] }).status, "stale_session");
      runtime.close();
      assert.equal(runtime.invalidateScopes({ scopes: ["tracks"] }).status, "runtime_closed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("persists across close/reopen for one process identity and isolates project, owner, and generation databases", async () => {
    if (!await hasSqlite()) return;
    const fixture = await makeFixture();
    const alternateProject = path.join(fixture.root, "Alternate.RPP");
    await writeFile(alternateProject, "<REAPER_PROJECT 0.1>\n");
    try {
      const first = await openRuntime(fixture);
      const firstIdentity = runtimeIdentity(first);
      const observed = first.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", firstIdentity, { tracks: [{ track_ref: "track:guid:{RESTORE}", name: "Restore" }] }));
      assert.equal(observed.ok, true);
      const stableSession = first.session_id;
      const stableDbPath = first.db_path;
      first.close();

      const second = await openRuntime(fixture);
      assert.equal(second.session_id, stableSession);
      assert.equal(second.db_path, stableDbPath);
      assert.equal(second.status().lifecycle, "ready");
      assert.deepEqual(second.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{RESTORE}"]);
      second.close();

      for (const overrides of [
        { projectPath: alternateProject },
        { bridgeOwner: "bridge:other-owner" },
        { bridgeGeneration: 8 },
      ]) {
        const mismatch = await openRuntime(fixture, overrides);
        assert.equal(mismatch.status().lifecycle, "ready");
        assert.equal(mismatch.status().rows_available, true);
        assert.equal(mismatch.status().recovery, null);
        assert.notEqual(mismatch.db_path, stableDbPath);
        assert.notEqual(mismatch.session_id, stableSession);
        assert.deepEqual(mismatch.adapter.snapshot().rows.tracks, []);
        const observedCurrentIdentity = mismatch.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", runtimeIdentity(mismatch), { tracks: [{ track_ref: "track:guid:{NEW}", name: "New" }] }));
        assert.equal(observedCurrentIdentity.ok, true);
        assert.deepEqual(mismatch.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{NEW}"]);
        mismatch.close();
      }

      const restored = await openRuntime(fixture);
      assert.equal(restored.db_path, stableDbPath);
      assert.deepEqual(restored.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{RESTORE}"]);
      restored.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps simultaneous process owners isolated and rebuilds only the stale owner's database while a peer is active", async () => {
    if (!await hasSqlite()) return;
    const fixture = await makeFixture();
    let peerA;
    let recoveredB;
    try {
      peerA = await openRuntime(fixture, { processIdentity: "process-owner-a" });
      assertObserved(peerA, execution("template.tracks.list_tracks", runtimeIdentity(peerA), {
        tracks: [{ track_ref: "track:guid:{PROCESS-A}", name: "Process A" }],
        track_count: 1,
        truncated: false,
      }));
      const peerABytes = await readFile(peerA.db_path);

      const peerB = await openRuntime(fixture, { processIdentity: "process-owner-b" });
      assert.notEqual(peerB.session_id, peerA.session_id);
      assert.notEqual(peerB.db_path, peerA.db_path);
      assert.notEqual(peerB.status().ownership.owner_id, peerA.status().ownership.owner_id);
      assert.deepEqual(peerB.adapter.snapshot().rows.tracks, []);
      assertObserved(peerB, execution("template.tracks.list_tracks", runtimeIdentity(peerB), {
        tracks: [{ track_ref: "track:guid:{PROCESS-B}", name: "Process B" }],
        track_count: 1,
        truncated: false,
      }));
      const peerBPath = peerB.db_path;
      peerB.close();

      await copyFile(peerA.db_path, peerBPath);
      recoveredB = await openRuntime(fixture, { processIdentity: "process-owner-b" });
      assert.equal(recoveredB.db_path, peerBPath);
      assert.equal(recoveredB.status().recovery.status, "recovered");
      assert.equal(recoveredB.status().recovery.db_rebuilt, true);
      assert.equal(recoveredB.status().recovery.recovery_scope, "owned_database_only");
      assert.equal(recoveredB.status().recovery.peer_database_untouched, true);
      assert.deepEqual(recoveredB.adapter.snapshot().rows.tracks, []);
      assert.deepEqual(peerA.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{PROCESS-A}"]);
      assert.deepEqual(await readFile(peerA.db_path), peerABytes);

      assertObserved(recoveredB, execution("template.tracks.list_tracks", runtimeIdentity(recoveredB), {
        tracks: [{ track_ref: "track:guid:{PROCESS-B-RECOVERED}", name: "Process B Recovered" }],
        track_count: 1,
        truncated: false,
      }));
      recoveredB.close();
      recoveredB = null;
      peerA.close();
      peerA = null;

      const reopenedA = await openRuntime(fixture, { processIdentity: "process-owner-a" });
      const reopenedB = await openRuntime(fixture, { processIdentity: "process-owner-b" });
      assert.deepEqual(reopenedA.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{PROCESS-A}"]);
      assert.deepEqual(reopenedB.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{PROCESS-B-RECOVERED}"]);
      reopenedA.close();
      reopenedB.close();
    } finally {
      recoveredB?.close();
      peerA?.close();
      await fixture.cleanup();
    }
  });

  it("uses a truthful resident degraded fallback when node:sqlite is unavailable", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture, { sqliteModuleLoader: async () => { throw Object.assign(new Error("disabled"), { code: "ERR_UNKNOWN_BUILTIN_MODULE" }); } });
      assert.equal(runtime.ok, true);
      assert.equal(runtime.backend, "resident_memory_fallback");
      assert.equal(runtime.status().lifecycle, "degraded");
      assert.equal(runtime.status().degraded_reason, "SQLITE_BACKEND_UNAVAILABLE");
      assert.equal(runtime.status().blockers[0].code, "SQLITE_BACKEND_UNAVAILABLE");
      const result = runtime.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", runtimeIdentity(runtime), { tracks: [{ track_ref: "track:guid:{RESIDENT}", name: "Resident" }] }));
      assert.equal(result.ok, true);
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{RESIDENT}"]);
      assert.equal(await fileExists(runtime.db_path), false);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("degrades without trusting or replacing a corrupt/incompatible database", async () => {
    if (!await hasSqlite()) return;
    const fixture = await makeFixture();
    const corrupt = Buffer.from("not-a-sqlite-database\n");
    try {
      const initial = await openRuntime(fixture, { processIdentity: "corrupt-owner" });
      const dbPath = initial.db_path;
      initial.close();
      await writeFile(dbPath, corrupt);
      const runtime = await openRuntime(fixture, { processIdentity: "corrupt-owner" });
      assert.equal(runtime.backend, "resident_memory_fallback");
      assert.equal(runtime.status().lifecycle, "degraded");
      assert.match(runtime.status().degraded_reason, /SQLITE_/);
      assert.equal(runtime.status().ownership.mode, "process_isolated");
      assert.equal(runtime.status().ownership.recovery_scope, "owned_database_only");
      assert.deepEqual(await import("node:fs/promises").then(({ readFile }) => readFile(dbPath)), corrupt);
      assert.deepEqual(runtime.adapter.snapshot().rows.tracks, []);
      runtime.close();
    } finally {
      await fixture.cleanup();
    }
  });
});

async function makeFixture() {
  const raw = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha3-2d-runtime-"));
  const root = await realpath(raw);
  const stateRoot = path.join(root, "state");
  const projectPath = path.join(root, "Trial.RPP");
  await mkdir(stateRoot);
  await writeFile(projectPath, "<REAPER_PROJECT 0.1>\n");
  return {
    root,
    stateRoot,
    projectPath,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

async function openRuntime(fixture, overrides = {}) {
  return openAlpha3_2DProjectIndexRuntime({
    stateRoot: fixture.stateRoot,
    projectPath: fixture.projectPath,
    bridgeOwner: "bridge:alpha3.2d:test",
    bridgeGeneration: 7,
    logicalSessionKey: "installed-alpha-session",
    processIdentity: "test-process-default",
    now,
    ...overrides,
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

function callContext(identity, requestSequence) {
  return {
    client_id: "alpha3-2d-count-truth",
    session_id: "alpha3-2d-count-truth-session",
    expected_owner: identity.bridge_owner,
    expected_generation: identity.bridge_generation,
    created_at: NOW,
    request_sequence: requestSequence,
  };
}

let requestSequence = 0;
function execution(templateId, identity, readback, observationContext = null) {
  requestSequence += 1;
  return {
    ok: true,
    template: { id: templateId },
    identity,
    observed_at: NOW,
    request: { id: `request:${templateId}:${requestSequence}` },
    result: { readback },
    ...(observationContext ? { project_index_observation_context: observationContext } : {}),
  };
}

function assertObserved(runtime, input) {
  const result = runtime.observeSuccessfulTemplateExecution(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.status, "observed");
  assert.equal(result.child_calls_executed, 0);
}

async function hasSqlite() {
  try { await import("node:sqlite"); return true; } catch { return false; }
}
function sqliteAvailable() { return Number(process.versions.node.split(".")[0]) >= 22; }
async function fileExists(target) { try { await lstat(target); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
