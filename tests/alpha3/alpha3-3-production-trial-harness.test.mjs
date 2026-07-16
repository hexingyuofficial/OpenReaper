import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  LARGE_PROJECTION_BUDGET,
  MAX_MEDIA_ASSETS_PER_CALL,
  MINIMUM_BUDGET,
  NORMAL_BUDGET,
  PUBLIC_BUDGET_LADDER,
  SCENARIO_MANIFESTS,
  createExecutionContext,
  detectAudioContainer,
  detectMp3BitrateKbps,
  describeTrial,
  editingLayoutRows,
  layoutRows,
  runInstalledTrial,
  runEditingSfx,
  runLargeProduction,
  runMixingDelivery,
  validateManifest,
  verifyRenderedOutput,
  walkProjectQuery,
} from "../../scripts/lib/alpha3-3-installed-trial-runner.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const RUNNER_FILE = path.join(REPO, "scripts/lib/alpha3-3-installed-trial-runner.mjs");
const CLI_FILE = path.join(REPO, "scripts/trial-alpha3-3-production.mjs");

test("declares executable strict-serial scenario manifests without plan-only states", async () => {
  assert.deepEqual(Object.keys(SCENARIO_MANIFESTS), ["large-production", "editing-sfx", "mixing-delivery"]);
  assert.ok(Object.isFrozen(SCENARIO_MANIFESTS));
  for (const manifest of Object.values(SCENARIO_MANIFESTS)) {
    assert.equal(validateManifest(manifest).valid, true);
    assert.equal(manifest.execution_policy, "strict_serial");
    assert.equal(manifest.required_product, "absolute_installed_openreaper_mcp_wrapper");
    assert.ok(manifest.steps.every((step) => step.implementation_status === "proven_executable"));
  }
  const source = await readFile(RUNNER_FILE, "utf8");
  assert.doesNotMatch(source, /PLAN_ONLY|plan_only|blocked_before_connect/u);
});

test("uses the accepted public budgets, media cap, and folder row kind", () => {
  assert.deepEqual(PUBLIC_BUDGET_LADDER, [
    { rung: "minimum", budget: { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 2_048 } },
    { rung: "normal", budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 } },
    { rung: "large_projection", budget: { max_response_bytes: 65_536, max_items: 128, max_inline_value_bytes: 24_576 } },
  ]);
  assert.deepEqual(MINIMUM_BUDGET, PUBLIC_BUDGET_LADDER[0].budget);
  assert.deepEqual(NORMAL_BUDGET, PUBLIC_BUDGET_LADDER[1].budget);
  assert.deepEqual(LARGE_PROJECTION_BUDGET, PUBLIC_BUDGET_LADDER[2].budget);
  assert.equal(MAX_MEDIA_ASSETS_PER_CALL, 8);
  assert.equal(layoutRows(104).length, 104);
  assert.ok(layoutRows(104).filter((row) => row.kind === "folder").length > 0);
  assert.ok(layoutRows(104).every((row) => row.kind !== "folder_track"));
  assert.equal(layoutRows(104).at(-1).folder_depth, -1);
  assert.equal(editingLayoutRows().length, 64);
  assert.equal(editingLayoutRows().at(-1).name, "EDITING-DEEP-EXACT-064");
});

test("runs the complete large-production trial with exact bounded writes and file evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha33-trial-"));
  const installedWrapper = path.join(root, "openreaper-mcp");
  const sourceProject = path.join(root, "source.RPP");
  const evidenceProject = path.join(root, "trial.RPP");
  const managedRenderRoot = path.join(root, "renders");
  const mediaRoot = path.join(root, "media");
  const mediaAsset = path.join(mediaRoot, "nested", "source.wav");
  await writeFile(installedWrapper, "installed-wrapper-fixture", "utf8");
  await writeFile(sourceProject, "source-project-fixture", "utf8");
  await mkdir(path.dirname(mediaAsset), { recursive: true });
  await writeFile(mediaAsset, wavFixture());
  const harness = createProductionMock({ evidenceProject, managedRenderRoot });

  try {
    const report = await runInstalledTrial({
      scenarios: ["large-production"],
      installedWrapper,
      sourceProject,
      evidenceProject,
      managedRenderRoot,
      mediaRoots: [mediaRoot],
      connectFactory: harness.connectFactory,
    });

    assert.equal(report.ok, true, JSON.stringify(report.error));
    assert.equal(report.status, "completed");
    assert.equal(report.outcome, "completed");
    assert.equal(report.failed_calls.length, 0);
    assert.deepEqual(harness.connects.map(({ clientName }) => clientName), ["primary", "secondary", "primary", "primary"]);
    assert.ok(harness.clients.every((client) => client.closed));

    const calls = harness.requests;
    assert.equal(calls.filter((call) => call.name === "ping").length, 2);
    const saveCalls = calls.filter((call) => call.arguments.id === "macro.project.file");
    assert.deepEqual(saveCalls.map((call) => call.arguments.input.dry_run), [true, false, true, false]);
    assert.equal(saveCalls[1].arguments.input.target_path, evidenceProject);
    assert.equal(saveCalls[1].arguments.input.overwrite, true);
    assert.equal(calls.filter((call) => call.arguments.id === "template.project.read_current_project_path").length, 2);

    const layoutCalls = calls.filter((call) => call.arguments.id === "macro.project.apply_layout" && Array.isArray(call.arguments.input.layout));
    assert.equal(layoutCalls.length, 15);
    assert.equal(layoutCalls.filter((call) => call.arguments.input.dry_run === false && call.arguments.budget.max_response_bytes > MINIMUM_BUDGET.max_response_bytes).length, 7);
    assert.deepEqual(layoutCalls.filter((call) => call.arguments.input.dry_run === false).map((call) => call.arguments.input.layout.length), [32, 32, 12, 12, 12, 12, 12, 12]);
    for (const call of layoutCalls.filter((candidate) => candidate.arguments.input.dry_run !== false || candidate.arguments.budget.max_response_bytes > MINIMUM_BUDGET.max_response_bytes)) {
      assert.ok(call.arguments.input.layout.every((row) => row.kind !== "folder_track"));
      assert.equal(call.arguments.input.match_policy, "create_only");
      assert.equal(call.arguments.input.conflict_policy, "stop");
    }
    const exactLast = calls.find((call) => call.arguments.id === "macro.project.query" && call.arguments.input.filters?.name === "PRODUCTION-DEEP-EXACT-104");
    assert.ok(exactLast);
    assert.deepEqual(exactLast.arguments.budget, MINIMUM_BUDGET);

    const mediaCalls = calls.filter((call) => call.arguments.id === "macro.media.place_assets");
    assert.equal(mediaCalls.length, 32);
    assert.ok(mediaCalls.every((call) => call.arguments.input.assets.length <= MAX_MEDIA_ASSETS_PER_CALL));
    assert.equal(mediaCalls.reduce((count, call) => count + call.arguments.input.assets.length, 0), 250);
    assert.equal(new Set(mediaCalls.flatMap((call) => call.arguments.input.assets.map((asset) => asset.id))).size, 250);
    assert.ok(mediaCalls.every((call, index) => call.arguments.input.placement.start_seconds === index * 16));

    const itemQueries = calls.filter((call) => call.arguments.id === "macro.project.query" && call.arguments.input.entity === "items");
    assert.ok(itemQueries.length >= 5);
    assert.ok(itemQueries.every((call) => call.clientName === "secondary" && call.arguments.input.selectors.refs.length <= 100));
    const itemWrites = calls.filter((call) => call.arguments.id === "macro.items.apply");
    assert.equal(itemWrites.length, 4);
    assert.deepEqual(itemWrites.filter((call) => call.arguments.input.dry_run === false).map((call) => call.arguments.input.mode), ["sequence_with_gap", "stack_on_existing_tracks"]);

    const midiCreates = calls.filter((call) => call.arguments.id === "macro.midi.apply" && call.arguments.input.mode === "create_clips");
    assert.deepEqual(midiCreates.filter((call) => call.arguments.input.dry_run === false).map((call) => call.arguments.input.notes.length), [32, 128]);
    assert.equal(calls.filter((call) => call.arguments.id === "macro.midi.apply" && call.arguments.input.mode === "write_cc").length, 2);
    assert.equal(calls.filter((call) => call.arguments.id === "template.midi.insert_text_sysex_events").length, 2);
    for (const id of ["template.midi.list_take_notes", "template.midi.list_take_cc_events", "template.midi.list_take_text_sysex_events"]) {
      const pages = calls.filter((call) => call.arguments.id === id);
      assert.ok(pages.length > 0);
      assert.ok(pages.every((call) => /^\d+$/u.test(call.arguments.input.cursor)));
    }

    assert.equal(calls.filter((call) => call.arguments.id === "template.fx.parameter_to_envelope_mapping").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "macro.automation.apply").length, 8);
    assert.equal(report.expected_failures.length, 1);
    assert.equal(report.expected_failures[0].error.code, "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED");
    assert.ok(report.performance_measurements.length >= 7);
    assert.equal(report.capability_results.some((row) => row.capability === "track_volume_automation"), true);
    assert.equal(report.rendered_outputs.length, 1);
    assert.equal(report.rendered_outputs[0].verification.ok, true);
    assert.equal(report.backup_recovery_posture.source_project_unchanged, true);
    assert.equal(report.backup_recovery_posture.source_media_preserved, true);
    assert.equal(report.media_hashes[mediaAsset], await sha256Fixture(mediaAsset));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs the complete editing-sfx trial with recursive media, typed recovery, and local render evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha33-editing-"));
  const installedWrapper = path.join(root, "openreaper-mcp");
  const sourceProject = path.join(root, "source.RPP");
  const evidenceProject = path.join(root, "editing.RPP");
  const managedRenderRoot = path.join(root, "renders");
  const mediaRoot = path.join(root, "media");
  const mediaAsset = path.join(mediaRoot, "library", "nested", "source.wav");
  await writeFile(installedWrapper, "installed-wrapper-fixture", "utf8");
  await writeFile(sourceProject, "source-project-fixture", "utf8");
  await mkdir(path.dirname(mediaAsset), { recursive: true });
  await writeFile(mediaAsset, wavFixture());
  const harness = createProductionMock({ evidenceProject, managedRenderRoot });

  try {
    const report = await runInstalledTrial({
      scenarios: ["editing-sfx"],
      installedWrapper,
      sourceProject,
      evidenceProject,
      managedRenderRoot,
      mediaRoots: [mediaRoot],
      connectFactory: harness.connectFactory,
    });

    assert.equal(report.ok, true, JSON.stringify(report.error));
    assert.equal(report.status, "completed");
    assert.equal(report.failed_calls.length, 0);
    assert.ok(harness.clients.every((client) => client.closed));

    const calls = harness.requests;
    const layoutCalls = calls.filter((call) => call.arguments.id === "macro.project.apply_layout");
    assert.equal(layoutCalls.length, 8);
    assert.ok(layoutCalls.every((call) => call.arguments.input.layout.length === 16));
    assert.equal(layoutCalls.filter((call) => call.arguments.input.dry_run === false).flatMap((call) => call.arguments.input.layout).length, 64);
    assert.ok(calls.some((call) => call.arguments.id === "macro.project.query" && call.arguments.input.entity === "tracks" && call.arguments.input.refresh_policy === "force_read_only_refresh"));

    const mediaCalls = calls.filter((call) => call.arguments.id === "macro.media.place_assets");
    assert.equal(mediaCalls.length, 4);
    assert.equal(mediaCalls.flatMap((call) => call.arguments.input.assets).length, 32);
    assert.ok(mediaCalls.every((call) => call.arguments.input.track_policy === "existing_track"));
    assert.ok(mediaCalls.every((call) => call.arguments.input.assets.every((asset) => asset.path === mediaAsset)));

    const itemVolumeExec = calls.filter((call) => call.arguments.id === "macro.items.apply" && call.arguments.input.dry_run === false && Object.hasOwn(call.arguments.input.properties ?? {}, "volume_db"));
    assert.deepEqual(itemVolumeExec.map((call) => call.arguments.input.properties.volume_db), [-6, -3]);
    assert.ok(itemVolumeExec.every((call) => call.arguments.input.target_refs.length === 8));
    assert.equal(report.expected_failures.length, 1);
    assert.equal(report.expected_failures[0].error.code, "ITEM_APPLY_ITEM_PAN_UNSUPPORTED");
    assert.equal(report.retries.some((row) => row.blocker_code === "ITEM_APPLY_ITEM_PAN_UNSUPPORTED" && row.target_kind === "take"), true);

    const takeControlExec = calls.filter((call) => call.arguments.id === "macro.controls.set" && call.arguments.input.dry_run === false);
    assert.equal(takeControlExec.length, 2);
    assert.deepEqual(Object.keys(takeControlExec[0].arguments.input.fields), ["pan", "pitch_semitones", "reverse"]);
    assert.equal(calls.filter((call) => call.arguments.id === "template.items.glue_item").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "template.automation.ensure_take_pitch_envelope").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "template.automation.insert_envelope_points_batch").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "template.automation.read_envelope_points").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "template.tracks.freeze_track").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "template.tracks.unfreeze_track").length, 1);

    const routingExec = calls.find((call) => call.arguments.id === "macro.routing.apply" && call.arguments.input.dry_run === false);
    assert.equal(routingExec.arguments.input.routes.length, 63);
    assert.ok(calls.some((call) => call.arguments.id === "macro.project.query" && call.arguments.input.entity === "routing" && call.arguments.input.refresh_policy === "force_read_only_refresh"));
    assert.equal(calls.filter((call) => call.arguments.id === "macro.automation.apply").length, 4);
    assert.equal(report.capability_results.some((row) => row.capability === "track_volume_automation" && row.pass_count === 2), true);
    assert.ok(report.performance_measurements.length >= 2);

    assert.equal(report.rendered_outputs.length, 1);
    assert.equal(report.rendered_outputs[0].requested_format, "wav");
    assert.equal(report.rendered_outputs[0].verification.ok, true);
    assert.equal(report.backup_recovery_posture.source_project_unchanged, true);
    assert.equal(report.backup_recovery_posture.source_media_preserved, true);
    assert.equal(report.media_hashes[mediaAsset], await sha256Fixture(mediaAsset));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects cursor pages over 100 before issuing a public call", async () => {
  const context = createExecutionContext({
    installedWrapper: "/tmp/openreaper-mcp",
    evidenceProject: "/tmp/trial.RPP",
    managedRenderRoot: "/tmp/renders",
  });
  context.clients.primary = { callTool: async () => assert.fail("must not call") };
  await assert.rejects(
    walkProjectQuery(context, "primary", { entity: "tracks", fields: ["ref"], limit: 101, refresh_policy: "if_stale" }),
    /PUBLIC_PAGE_LIMIT_INVALID/u,
  );
});

test("runs the minimal mixing-delivery trial and only inventories explicitly requested third-party FX", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha33-mix-"));
  const installedWrapper = path.join(root, "openreaper-mcp");
  const sourceProject = path.join(root, "source.RPP");
  const evidenceProject = path.join(root, "mix.RPP");
  const managedRenderRoot = path.join(root, "renders");
  const mediaAsset = path.join(root, "source.wav");
  await writeFile(installedWrapper, "installed-wrapper-fixture", "utf8");
  await writeFile(sourceProject, "source-project-fixture", "utf8");
  await writeFile(mediaAsset, wavFixture());
  const harness = createProductionMock({ evidenceProject, managedRenderRoot });

  try {
    const report = await runInstalledTrial({
      scenarios: ["mixing-delivery"],
      installedWrapper,
      sourceProject,
      evidenceProject,
      managedRenderRoot,
      mediaAssets: [mediaAsset],
      connectFactory: harness.connectFactory,
    });
    assert.equal(report.ok, true, JSON.stringify(report.error));
    const calls = harness.requests;
    assert.equal(calls.filter((call) => call.name === "ping").length, 2);
    assert.equal(calls.filter((call) => call.arguments.id === "template.fx.search_installed_fx").length, 0);
    const layoutCalls = calls.filter((call) => call.arguments.id === "macro.project.apply_layout" && Array.isArray(call.arguments.input.layout));
    assert.equal(layoutCalls.length, 2);
    assert.ok(layoutCalls.every((call) => call.arguments.input.layout.length === 16));
    assert.equal(calls.filter((call) => call.arguments.id === "macro.media.place_assets").length, 1);
    assert.equal(calls.find((call) => call.arguments.id === "macro.media.place_assets").arguments.input.track_policy, "explicit_per_asset");
    const fxExec = calls.find((call) => call.arguments.id === "macro.fx.apply_chain" && call.arguments.input.dry_run === false);
    assert.deepEqual(fxExec.arguments.input.chain.map((row) => row.plugin_query), ["ReaEQ", "ReaComp"]);
    assert.equal(calls.filter((call) => call.arguments.id === "macro.automation.apply").length, 8);
    assert.equal(report.rendered_outputs.length, 3);
    assert.ok(report.rendered_outputs.every((row) => row.verification.ok));
    assert.deepEqual(report.rendered_outputs.map((row) => row.actual_format).sort(), ["mp3", "ogg", "wav"]);
    assert.equal(report.backup_recovery_posture.source_project_unchanged, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects relative execution paths before connecting", async () => {
  let connected = false;
  const connectFactory = async () => {
    connected = true;
    assert.fail("must not connect");
  };
  const base = {
    scenarios: ["large-production"],
    installedWrapper: "/tmp/openreaper-mcp",
    sourceProject: "/tmp/source.RPP",
    evidenceProject: "/tmp/trial.RPP",
    managedRenderRoot: "/tmp/renders",
    connectFactory,
  };
  await assert.rejects(runInstalledTrial({ ...base, sourceProject: "source.RPP" }), /absolute sourceProject/u);
  await assert.rejects(runInstalledTrial({ ...base, mediaRoots: ["media"] }), /every mediaRoots entry/u);
  await assert.rejects(runInstalledTrial({ ...base, mediaAssets: ["source.wav"] }), /every mediaAssets entry/u);
  assert.equal(connected, false);
});

test("requires one independent scenario and evidence project per execute run", async () => {
  await assert.rejects(runInstalledTrial({
    scenarios: ["large-production", "mixing-delivery"],
    installedWrapper: "/tmp/openreaper-mcp",
    sourceProject: "/tmp/source.RPP",
    evidenceProject: "/tmp/trial.RPP",
    managedRenderRoot: "/tmp/renders",
  }), /one scenario and one independent evidence project/u);
});

test("uses an exact requested third-party identity and stops without substitution when absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha33-third-party-"));
  const paths = {
    installedWrapper: path.join(root, "openreaper-mcp"),
    sourceProject: path.join(root, "source.RPP"),
    evidenceProject: path.join(root, "mix.RPP"),
    managedRenderRoot: path.join(root, "renders"),
  };
  await writeFile(paths.installedWrapper, "installed-wrapper-fixture", "utf8");
  await writeFile(paths.sourceProject, "source-project-fixture", "utf8");
  const mediaAsset = path.join(root, "source.wav");
  await writeFile(mediaAsset, wavFixture());

  try {
    const identity = "VST3: TrialVerb (Example)";
    const ident = "/Library/Audio/Plug-Ins/VST3/TrialVerb.vst3";
    const foundHarness = createProductionMock({
      evidenceProject: paths.evidenceProject,
      managedRenderRoot: paths.managedRenderRoot,
      installedFxRows: [{ name: identity, ident }],
    });
    const found = await runInstalledTrial({
      scenarios: ["mixing-delivery"],
      ...paths,
      mediaAssets: [mediaAsset],
      thirdPartyFxQuery: "TrialVerb",
      connectFactory: foundHarness.connectFactory,
    });
    assert.equal(found.ok, true, JSON.stringify(found.error));
    const chain = foundHarness.requests.find((call) => call.arguments.id === "macro.fx.apply_chain" && call.arguments.input.dry_run === false).arguments.input.chain;
    assert.deepEqual(chain, [
      { plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" },
      { plugin_query: "ReaComp", duplicate_policy: "fail_if_present", controls: { threshold_db: -18, ratio: 3 } },
      { plugin_name: identity, duplicate_policy: "fail_if_present" },
    ]);
    assert.equal(JSON.stringify(chain).includes(ident), false);
    assert.equal(found.capability_results.some((row) => row.capability === "generic_third_party_fx" && row.status === "passed"), true);

    const missingHarness = createProductionMock({ evidenceProject: paths.evidenceProject, managedRenderRoot: paths.managedRenderRoot });
    const missing = await runInstalledTrial({
      scenarios: ["mixing-delivery"],
      ...paths,
      mediaAssets: [mediaAsset],
      thirdPartyFxQuery: "MissingVerb",
      connectFactory: missingHarness.connectFactory,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.message, "REQUESTED_THIRD_PARTY_FX_NOT_INSTALLED");
    assert.equal(missingHarness.requests.filter((call) => call.arguments.id === "macro.fx.apply_chain").length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a malformed MCP response fails the scenario and records the failed call", async () => {
  const context = createExecutionContext({
    installedWrapper: "/tmp/openreaper-mcp",
    evidenceProject: "/tmp/trial.RPP",
    managedRenderRoot: "/tmp/renders",
  });
  context.clients.primary = { callTool: async () => ({ content: [{ type: "text", text: "not-json" }] }) };
  context.clients.secondary = { callTool: async () => jsonResponse({ ok: true }) };
  await assert.rejects(runLargeProduction(context), SyntaxError);
  assert.equal(context.failures.length, 1);
  assert.equal(context.failures[0].step_id, "installed-product-handshake");
});

test("describe and dry-run never connect or claim completion", async () => {
  for (const mode of ["describe", "dry-run"]) {
    const report = mode === "describe"
      ? describeTrial({ scenarios: ["large-production"], mode })
      : await runInstalledTrial({ scenarios: ["large-production"], mode });
    assert.equal(report.ok, false);
    assert.equal(report.status, mode === "describe" ? "described_not_executed" : "dry_run_not_executed");
    assert.equal(report.unimplemented_steps.length, 0);
  }

  for (const args of [["--scenario", "large-production", "--describe"], ["--all", "--dry-run"]]) {
    const result = spawnSync(process.execPath, [CLI_FILE, ...args], { cwd: REPO, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(JSON.parse(result.stdout).status, "completed");
  }
});

test("uses only the absolute installed wrapper as the transport command", async () => {
  const source = await readFile(RUNNER_FILE, "utf8");
  assert.match(source, /new StdioClientTransport\(\{\s*command: installedWrapper,\s*args: \[\],\s*cwd: path\.dirname\(installedWrapper\)/u);
  assert.doesNotMatch(source, /process\.execPath[\s\S]{0,160}openreaper-mcp-stdio/u);
  assert.doesNotMatch(source, /rootOverrides|root_overrides|root-override/u);
});

test("detects WAV, OGG, and valid MP3 headers and verifies managed render evidence", async () => {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.write("WAVE", 8, "ascii");
  const ogg = Buffer.from("OggS\u0000fixture", "binary");
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0, 0xff, 0xfb, 0xe0, 0x00]);
  assert.equal(detectAudioContainer(wav), "wav");
  assert.equal(detectAudioContainer(ogg), "ogg");
  assert.equal(detectAudioContainer(mp3), "mp3");
  assert.equal(detectMp3BitrateKbps(mp3), 320);

  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha33-render-"));
  const inside = path.join(root, "delivery.wav");
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.wav`);
  try {
    await writeFile(inside, wav);
    await writeFile(outside, wav);
    assert.equal((await verifyRenderedOutput({ absolutePath: inside, requestedFormat: "wav", managedRenderRoot: root })).ok, true);
    assert.equal((await verifyRenderedOutput({ absolutePath: outside, requestedFormat: "wav", managedRenderRoot: root })).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

function createProductionMock({ evidenceProject, managedRenderRoot, installedFxRows = [] }) {
  const requests = [];
  const connects = [];
  const clients = [];
  const state = {
    tracks: [],
    trackByOperation: new Map(),
    nextTrack: 1,
    items: new Map(),
    nextItem: 1,
    midi: new Map(),
    routings: [],
    envelopes: new Map(),
    fxByRef: new Map(),
    fxParameterValues: new Map(),
    automatedTargets: new Set(),
    freezeCounts: new Map(),
  };
  const connectFactory = async ({ scenario, clientName }) => {
    const client = {
      closed: false,
      async close() { this.closed = true; },
      async callTool(request) {
        requests.push({ ...request, scenario, clientName });
        return respond(request, { evidenceProject, managedRenderRoot, state, installedFxRows });
      },
    };
    connects.push({ scenario, clientName });
    clients.push(client);
    return client;
  };
  return { connectFactory, requests, connects, clients };
}

async function respond(request, { evidenceProject, managedRenderRoot, state, installedFxRows }) {
  if (request.name === "ping") return jsonResponse({ ok: true, product_surface: { agent_context_macro_guide: { macro_menu: { macro_ids: Array.from({ length: 15 }, (_, index) => `macro.${index}`) } } } });
  const { id, input, refs, budget } = request.arguments;
  if (id === "macro.project.apply_layout" && input?.dry_run === false && Array.isArray(input.layout) && input.layout.length >= 20 && budget?.max_response_bytes === MINIMUM_BUDGET.max_response_bytes) {
    return jsonResponse({
      contract: "macro.execution.v1",
      ok: false,
      execution: { status: "blocked" },
      result: { changes: [] },
      error: { code: "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED", message: "Split the layout into smaller calls.", recoverable: true },
    });
  }
  if (id === "macro.items.apply" && input?.dry_run === false && Object.hasOwn(input.properties ?? {}, "pan")) {
    return jsonResponse({
      contract: "macro.execution.v1",
      ok: false,
      execution: { status: "blocked" },
      result: { changes: [] },
      error: { code: "ITEM_APPLY_ITEM_PAN_UNSUPPORTED", message: "Use the exact Active Take.", recoverable: true },
    });
  }
  if (input?.dry_run === true) {
    return jsonResponse({
      contract: "macro.execution.v1",
      ok: true,
      execution: { status: "dry_run_completed" },
      result: { data: { executable_retry: { id, input: { ...input, dry_run: false } } }, changes: [], verification: { status: "passed" } },
    });
  }
  if (id === "macro.project.file") {
    await writeFile(evidenceProject, `evidence-${input.operation}`, "utf8");
    return jsonResponse({ contract: "macro.execution.v1", ok: true, execution: { status: "completed" }, result: { data: { path_after: evidenceProject }, changes: [], verification: { status: "passed" } } });
  }
  if (id === "template.project.read_current_project_path") {
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { path: evidenceProject } } });
  }
  if (id === "macro.project.apply_layout") {
    if (Array.isArray(input.annotations)) {
      return jsonResponse(macroResult({
        changes: input.annotations.map((row, index) => verifiedChange({
          operation_id: row.id,
          target_ref: `${row.kind}:index:${index + 1}`,
        })),
      }));
    }
    const changes = input.layout.map((row) => {
      let trackRef = state.trackByOperation.get(row.id);
      if (!trackRef) {
        trackRef = `track:guid:{TRACK-${state.nextTrack++}}`;
        state.trackByOperation.set(row.id, trackRef);
        state.tracks.push({ ref: trackRef, name: row.name, index: row.index, folder_depth: row.folder_depth ?? 0 });
        state.tracks.sort((left, right) => left.index - right.index);
      }
      return verifiedChange({
        operation_id: row.id,
        target_ref: trackRef,
        live_readback: { track_ref: trackRef, name: row.name, index: row.index },
      });
    });
    return jsonResponse({
      contract: "macro.execution.v1",
      ok: true,
      execution: { status: "completed" },
      result: {
        changes,
        verification: { status: "passed" },
      },
    });
  }
  if (id === "macro.project.query") {
    let allRows = input.entity === "items"
      ? [...state.items.values()]
      : input.entity === "routing"
        ? state.routings
        : state.tracks;
    if (input.selectors?.refs) allRows = allRows.filter((row) => input.selectors.refs.includes(row.ref));
    if (input.filters?.name) allRows = allRows.filter((row) => row.name === input.filters.name);
    const offset = input.cursor ? Number(String(input.cursor).split(":").at(-1)) : 0;
    const rows = allRows.slice(offset, offset + input.limit);
    const nextOffset = offset + rows.length;
    const hasMore = nextOffset < allRows.length;
    return jsonResponse(macroResult({ data: { rows, page: { has_more: hasMore, next_cursor: hasMore ? `${input.entity}:${nextOffset}` : null }, coverage: { status: "complete", known_total_row_count: allRows.length } } }));
  }
  if (id === "macro.media.place_assets") {
    const changes = input.assets.map((asset, index) => {
      const ordinal = state.nextItem++;
      const itemRef = `item:guid:{ITEM-${ordinal}}`;
      const takeRef = `take:guid:{TAKE-${ordinal}}`;
      const trackRef = input.track_ref ?? asset.track_ref;
      state.items.set(itemRef, { ref: itemRef, track_ref: trackRef, start_seconds: (input.placement.start_seconds ?? 0) + index, length_seconds: 1, active_take_ref: takeRef, volume_db: 0 });
      return verifiedChange({ asset_id: asset.id, target_ref: itemRef, live_readback: { item_ref: itemRef, take_ref: takeRef, track_ref: trackRef } });
    });
    return jsonResponse(macroResult({ changes }));
  }
  if (id === "macro.items.apply") {
    const targets = input.mode === "stack_on_existing_tracks" ? input.track_assignments : input.target_refs.map((item_ref) => ({ item_ref }));
    const changes = targets.map((target) => {
      const row = state.items.get(target.item_ref);
      if (target.target_track_ref) row.track_ref = target.target_track_ref;
      if (input.mode === "sequence_with_gap") row.start_seconds = target.position_seconds ?? row.start_seconds;
      if (input.properties?.volume_db !== undefined) row.volume_db = input.properties.volume_db;
      return verifiedChange({ target_ref: target.item_ref, live_readback: { ...row } });
    });
    return jsonResponse(macroResult({ changes }));
  }
  if (id === "macro.controls.set") {
    const itemRef = refs?.item_ref;
    const item = state.items.get(itemRef);
    const changes = Object.entries(input.fields).map(([field, value]) => verifiedChange({ target_ref: item?.active_take_ref ?? itemRef, live_readback: { field, requested_value: value, observed_value: value } }));
    return jsonResponse(macroResult({ changes }));
  }
  if (id === "template.items.glue_item") {
    const sourceItemRef = refs.item_ref.ref;
    const source = state.items.get(sourceItemRef);
    const ordinal = state.nextItem++;
    const gluedItemRef = `item:guid:{GLUED-${ordinal}}`;
    const gluedTakeRef = `take:guid:{GLUED-${ordinal}}`;
    state.items.delete(sourceItemRef);
    state.items.set(gluedItemRef, { ...source, ref: gluedItemRef, active_take_ref: gluedTakeRef });
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { source_item_ref: sourceItemRef, glued_item_ref: gluedItemRef, glued_take_ref: gluedTakeRef, old_item_guid_absent: true, new_item_unique: true, item_count_unchanged: true } } });
  }
  if (id === "template.automation.ensure_take_pitch_envelope") {
    const envelopeRef = `envelope:guid:{PITCH-${refs.take_ref.ref}}`;
    state.envelopes.set(envelopeRef, []);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { take_ref: refs.take_ref.ref, envelope_ref: envelopeRef, created: true } } });
  }
  if (id === "template.automation.resolve_envelope_ref") {
    const trackRef = refs.track_ref.ref;
    const envelopeRef = `envelope:guid:{VOLUME-${trackRef}}`;
    if (!state.envelopes.has(envelopeRef)) state.envelopes.set(envelopeRef, []);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { envelope_ref: envelopeRef, parent_kind: "track", name: "Volume", point_count: state.envelopes.get(envelopeRef).length } } });
  }
  if (id === "template.automation.insert_envelope_points_batch") {
    const envelopeRef = refs.envelope_ref.ref;
    const points = state.envelopes.get(envelopeRef) ?? [];
    points.push(...input.points);
    state.envelopes.set(envelopeRef, points);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { envelope_ref: envelopeRef, inserted_count: input.points.length } } });
  }
  if (id === "template.automation.read_envelope_points") {
    const envelopeRef = refs.envelope_ref.ref;
    const points = state.envelopes.get(envelopeRef) ?? [];
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { envelope_ref: envelopeRef, points, returned_count: points.length, total_count: points.length, next_cursor: null, truncated: false } } });
  }
  if (id === "template.tracks.freeze_track" || id === "template.tracks.unfreeze_track") {
    const trackRef = refs.track_ref.ref;
    const before = state.freezeCounts.get(trackRef) ?? 0;
    const after = id.endsWith("freeze_track") && !id.endsWith("unfreeze_track") ? before + 1 : Math.max(0, before - 1);
    state.freezeCounts.set(trackRef, after);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { track_ref: trackRef, freeze_count_before: before, freeze_count_after: after, selection_restored: true } } });
  }
  if (id === "macro.routing.apply") {
    const changes = input.routes.map((route, index) => {
      const row = { ref: `send:track:guid:{SEND-${state.routings.length + index + 1}}:0`, source_track_ref: route.source_track_ref, destination_track_ref: route.destination_track_ref, send_index: 0, volume_db: 0, pan: route.pan };
      state.routings.push(row);
      return verifiedChange({ operation_id: route.id, target_ref: row.ref, live_readback: row });
    });
    return jsonResponse(macroResult({ changes }));
  }
  if (id === "macro.midi.apply" && input.mode === "create_clips") {
    const count = input.notes.length;
    const itemRef = `item:guid:{MIDI-${count}}`;
    const takeRef = `take:guid:{MIDI-${count}}`;
    state.midi.set(takeRef, { notes: input.notes, cc_events: [], events: [] });
    return jsonResponse(macroResult({ data: { note_count: count, item_ref: itemRef, take_ref: takeRef, track_ref: refs.track_ref } }));
  }
  if (id === "macro.midi.apply" && input.mode === "write_cc") {
    const operation = input.operations[0];
    const take = state.midi.get(operation.take_ref);
    const before = take.cc_events.length;
    take.cc_events.push(...operation.events);
    return jsonResponse(macroResult({ changes: [verifiedChange({ operation_id: operation.operation_id, live_readback: { before_count: before, after_count: take.cc_events.length, coverage_complete: true } })] }));
  }
  if (id === "template.midi.insert_text_sysex_events") {
    const take = state.midi.get(refs.take_ref.ref);
    take.events.push(...input.events);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { take_ref: refs.take_ref.ref, inserted_count: input.events.length, text_sysex_count: take.events.length } } });
  }
  if (["template.midi.list_take_notes", "template.midi.list_take_cc_events", "template.midi.list_take_text_sysex_events"].includes(id)) {
    const take = state.midi.get(refs.take_ref.ref);
    const field = id.endsWith("notes") ? "notes" : id.endsWith("cc_events") ? "cc_events" : "events";
    const cursor = Number(input.cursor);
    const rows = take[field].slice(cursor, cursor + input.limit);
    const next = cursor + rows.length < take[field].length ? String(cursor + rows.length) : null;
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { take_ref: refs.take_ref.ref, [field]: rows, returned_count: rows.length, next_cursor: next, truncated: next !== null } } });
  }
  if (id === "macro.fx.apply_chain") {
    const ownerRef = refs.track_ref;
    const fxRows = input.chain.map((candidate, index) => {
      const row = { name: candidate.plugin_name ?? candidate.plugin_query, fx_ref: `fx:${ownerRef}:${index}` };
      state.fxByRef.set(row.fx_ref, row);
      return row;
    });
    return jsonResponse(macroResult({ data: { final_chain: { fx: fxRows } }, changes: fxRows.map((row) => verifiedChange({ target_ref: row.fx_ref })) }));
  }
  if (id === "template.fx.parameter_to_envelope_mapping") {
    const fx = state.fxByRef.get(refs.fx_ref.ref);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { fx_ref: refs.fx_ref.ref, param_ident: fx?.name?.includes("TrialVerb") ? "param:0" : "0:gain", envelope_exists: state.automatedTargets.has(refs.fx_ref.ref) } } });
  }
  if (id === "template.fx.search_installed_fx") {
    const rows = installedFxRows.filter((row) => String(row.name).toLowerCase().includes(input.query.toLowerCase()));
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { query: input.query, rows, row_count: rows.length, matched_count: rows.length, truncated: false } } });
  }
  if (id === "template.fx.list_fx_parameters") {
    const parameterCount = 130;
    const offset = input.offset ?? 0;
    const end = Math.min(parameterCount, offset + input.limit);
    const parameters = Array.from({ length: end - offset }, (_, index) => {
      const paramIndex = offset + index;
      const normalized = state.fxParameterValues.get(`${refs.fx_ref.ref}:${paramIndex}`) ?? 0.25;
      return { param_index: paramIndex, param_ident: `param:${paramIndex}`, name: paramIndex === 0 ? "Enabled" : `Parameter ${paramIndex}`, normalized_value: normalized, formatted_value: fxFormattedValue(paramIndex, normalized) };
    });
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { parameter_count: parameterCount, parameters, returned_count: parameters.length, offset, next_offset: end < parameterCount ? end : null, truncated: end < parameterCount, inventory_complete: end === parameterCount, coverage_status: end === parameterCount ? "complete" : "paged" } } });
  }
  if (id === "template.fx.read_fx_parameter") {
    const normalized = input.probe_normalized_value ?? state.fxParameterValues.get(`${refs.fx_ref.ref}:${input.param_index}`) ?? 0.25;
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { fx_ref: refs.fx_ref.ref, param_index: input.param_index, param_ident: input.param_ident, name: input.param_index === 0 ? "Enabled" : `Parameter ${input.param_index}`, normalized_value: normalized, formatted_value: fxFormattedValue(input.param_index, normalized), step_sizes_available: input.param_index === 0, step_size: input.param_index === 0 ? 1 : null, is_toggle: input.param_index === 0, is_discrete: input.param_index === 0 } } });
  }
  if (id === "template.fx.set_fx_parameter_normalized") {
    const observed = input.param_index === 0 ? (input.normalized_value >= 0.5 ? 1 : 0) : input.normalized_value;
    state.fxParameterValues.set(`${refs.fx_ref.ref}:${input.param_index}`, observed);
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { fx_ref: refs.fx_ref.ref, param_index: input.param_index, param_ident: input.param_ident, normalized_value: observed, formatted_value: fxFormattedValue(input.param_index, observed), updated: true, verification_mode: input.param_index === 0 ? "native_discrete_format" : "numeric_tolerance", is_toggle: input.param_index === 0, is_discrete: input.param_index === 0 } } });
  }
  if (id === "template.fx.set_fx_bypass") {
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { fx_ref: refs.fx_ref.ref, enabled: input.enabled, updated: true } } });
  }
  if (id === "macro.fx.set_controls") {
    return jsonResponse(macroResult({ changes: Object.entries(input.controls).map(([field, value]) => verifiedChange({ target_ref: refs.fx_ref, live_readback: { field, requested_value: value, observed_value: value } })) }));
  }
  if (id === "macro.automation.apply") {
    const targetRef = input.fx_refs?.[0] ?? input.envelope_refs?.[0];
    const createdEnvelope = !state.automatedTargets.has(targetRef);
    state.automatedTargets.add(targetRef);
    return jsonResponse(macroResult({ changes: [verifiedChange({ target_ref: targetRef, live_readback: { created_envelope: createdEnvelope } })] }));
  }
  if (id === "macro.render.targets") {
    await mkdir(managedRenderRoot, { recursive: true });
    const absolutePath = path.join(managedRenderRoot, `${input.output_basename}.${input.format}`);
    await writeFile(absolutePath, input.format === "wav" ? wavFixture() : input.format === "ogg" ? oggFixture() : mp3Fixture());
    return jsonResponse(macroResult({ data: { outputs: [{ absolute_path: absolutePath, requested_format: input.format, actual_format: input.format, requested_bitrate_kbps: input.mp3_bitrate_kbps ?? null, actual_bitrate_kbps: input.mp3_bitrate_kbps ?? null, output_basename: input.output_basename }] } }));
  }
  return jsonResponse({ ok: false, error: { code: "UNEXPECTED_REQUEST", id } });
}

function macroResult({ data = {}, changes = [] } = {}) {
  return { contract: "macro.execution.v1", ok: true, execution: { status: "completed" }, result: { data, changes, verification: { status: "passed" } } };
}

function verifiedChange({ live_readback = {}, ...rest } = {}) {
  return {
    ...rest,
    status: "applied",
    mutation: { status: "completed" },
    live_readback: { status: "passed", ...live_readback },
    index_maintenance: { status: "completed" },
  };
}

function requestsForState(state, key) {
  state[key] ??= [];
  return state[key];
}

function wavFixture() {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return bytes;
}

function oggFixture() {
  return Buffer.from("OggS\u0000openreaper-fixture", "binary");
}

function mp3Fixture() {
  return Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0, 0xff, 0xfb, 0xe0, 0x00]);
}

function fxFormattedValue(paramIndex, normalized) {
  return paramIndex === 0 ? (normalized >= 0.5 ? "On" : "Off") : normalized.toFixed(3);
}

async function sha256Fixture(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function jsonResponse(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
