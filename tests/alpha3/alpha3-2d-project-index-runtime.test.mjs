import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_2D_PROJECT_INDEX_DB_BASENAME,
  ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
  openAlpha3_2DProjectIndexRuntime,
  validateManagedStateRoot,
} from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";

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
      assert.equal(runtime.db_path, path.join(fixture.stateRoot, ALPHA3_2D_PROJECT_INDEX_DB_BASENAME));
      assert.notEqual(runtime.db_path.includes("/Documents/openreaper/"), true);
      const status = runtime.status();
      assert.equal(status.backend, sqliteAvailable() ? "sqlite_file_adapter" : "resident_memory_fallback");
      assert.equal(status.project_path, fixture.projectPath);
      assert.equal(status.bridge_owner, "bridge:alpha3.2d:test");
      assert.equal(status.bridge_generation, 7);
      assert.match(status.session_id, /^session:alpha3\.2d:[a-f0-9]{32}$/);
      assert.equal(status.rows_available, true);
      assert.equal(typeof runtime.adapter.snapshot, "function");
      assert.equal(runtime.close().lifecycle, "closed");
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

  it("keeps FX rows isolated by owner and clears only the owner with an empty chain", async () => {
    const fixture = await makeFixture();
    try {
      const runtime = await openRuntime(fixture);
      const identity = runtimeIdentity(runtime);
      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, {
        owner_ref: "track:guid:{T1}",
        fx: [{ fx_ref: "fx:track:guid:{T1}:slot:0", owner_ref: "track:guid:{T1}", slot_index: 0, name: "ReaEQ" }],
      }));
      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, {
        owner_ref: "track:guid:{T2}",
        fx: [{ fx_ref: "fx:track:guid:{T2}:slot:0", owner_ref: "track:guid:{T2}", slot_index: 0, name: "ReaComp" }],
      }));

      assert.deepEqual(runtime.adapter.snapshot().rows.fx.map((row) => [row.owner_ref, row.ref]), [
        ["track:guid:{T1}", "fx:track:guid:{T1}:slot:0"],
        ["track:guid:{T2}", "fx:track:guid:{T2}:slot:0"],
      ]);

      assertObserved(runtime, execution("template.fx.list_track_fx_chain", identity, { owner_ref: "track:guid:{T1}", fx: [] }));
      assert.deepEqual(runtime.adapter.snapshot().rows.fx.map((row) => [row.owner_ref, row.ref]), [
        ["track:guid:{T2}", "fx:track:guid:{T2}:slot:0"],
      ]);
      runtime.close();
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

  it("persists across close/reopen for the same logical installed session and withholds rows on project, owner, or generation mismatch", async () => {
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
      first.close();

      const second = await openRuntime(fixture);
      assert.equal(second.session_id, stableSession);
      assert.equal(second.status().lifecycle, "ready");
      assert.deepEqual(second.adapter.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{RESTORE}"]);
      second.close();

      for (const overrides of [
        { projectPath: alternateProject },
        { bridgeOwner: "bridge:other-owner" },
        { bridgeGeneration: 8 },
      ]) {
        const mismatch = await openRuntime(fixture, overrides);
        assert.equal(mismatch.status().lifecycle, "stale_session");
        assert.equal(mismatch.status().rows_available, false);
        assert.equal(mismatch.adapter.snapshot().rows_withheld, true);
        assert.deepEqual(mismatch.adapter.snapshot().rows.tracks, []);
        const blocked = mismatch.observeSuccessfulTemplateExecution(execution("template.tracks.list_tracks", runtimeIdentity(mismatch), { tracks: [{ track_ref: "track:guid:{NEW}" }] }));
        assert.equal(blocked.status, "stale_session");
        mismatch.close();
      }
    } finally {
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
    const dbPath = path.join(fixture.stateRoot, ALPHA3_2D_PROJECT_INDEX_DB_BASENAME);
    const corrupt = Buffer.from("not-a-sqlite-database\n");
    await writeFile(dbPath, corrupt);
    try {
      const runtime = await openRuntime(fixture);
      assert.equal(runtime.backend, "resident_memory_fallback");
      assert.equal(runtime.status().lifecycle, "degraded");
      assert.match(runtime.status().degraded_reason, /SQLITE_/);
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

let requestSequence = 0;
function execution(templateId, identity, readback) {
  requestSequence += 1;
  return {
    ok: true,
    template: { id: templateId },
    identity,
    observed_at: NOW,
    request: { id: `request:${templateId}:${requestSequence}` },
    result: { readback },
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
