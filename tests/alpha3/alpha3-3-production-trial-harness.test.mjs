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
  layoutRows,
  runInstalledTrial,
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
  assert.deepEqual(Object.keys(SCENARIO_MANIFESTS), ["large-production", "mixing-delivery"]);
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

    const layoutCalls = calls.filter((call) => call.arguments.id === "macro.project.apply_layout");
    assert.equal(layoutCalls.length, 16);
    assert.equal(layoutCalls.filter((call) => call.arguments.input.dry_run === false).length, 8);
    for (const call of layoutCalls) {
      assert.equal(call.arguments.input.layout.length, 13);
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
    for (const id of ["template.midi.list_take_notes", "template.midi.list_take_cc_events", "template.midi.list_take_text_sysex_events"]) {
      const pages = calls.filter((call) => call.arguments.id === id);
      assert.ok(pages.length > 0);
      assert.ok(pages.every((call) => /^\d+$/u.test(call.arguments.input.cursor)));
    }

    assert.equal(calls.filter((call) => call.arguments.id === "template.fx.parameter_to_envelope_mapping").length, 1);
    assert.equal(calls.filter((call) => call.arguments.id === "macro.automation.apply").length, 4);
    assert.equal(report.rendered_outputs.length, 1);
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
  await writeFile(installedWrapper, "installed-wrapper-fixture", "utf8");
  await writeFile(sourceProject, "source-project-fixture", "utf8");
  const harness = createProductionMock({ evidenceProject, managedRenderRoot });

  try {
    const report = await runInstalledTrial({
      scenarios: ["mixing-delivery"],
      installedWrapper,
      sourceProject,
      evidenceProject,
      managedRenderRoot,
      connectFactory: harness.connectFactory,
    });
    assert.equal(report.ok, true, JSON.stringify(report.error));
    const calls = harness.requests;
    assert.equal(calls.filter((call) => call.name === "ping").length, 2);
    assert.equal(calls.filter((call) => call.arguments.id === "template.fx.search_installed_fx").length, 0);
    const layoutCalls = calls.filter((call) => call.arguments.id === "macro.project.apply_layout");
    assert.equal(layoutCalls.length, 2);
    assert.ok(layoutCalls.every((call) => call.arguments.input.layout.length === 3));
    const fxExec = calls.find((call) => call.arguments.id === "macro.fx.apply_chain" && call.arguments.input.dry_run === false);
    assert.deepEqual(fxExec.arguments.input.chain.map((row) => row.plugin_query), ["ReaEQ"]);
    assert.equal(calls.filter((call) => call.arguments.id === "macro.automation.apply").length, 4);
    assert.equal(report.rendered_outputs.length, 1);
    assert.equal(report.rendered_outputs[0].verification.ok, true);
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
      thirdPartyFxQuery: "TrialVerb",
      connectFactory: foundHarness.connectFactory,
    });
    assert.equal(found.ok, true, JSON.stringify(found.error));
    const chain = foundHarness.requests.find((call) => call.arguments.id === "macro.fx.apply_chain" && call.arguments.input.dry_run === false).arguments.input.chain;
    assert.deepEqual(chain, [
      { plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" },
      { plugin_name: identity, duplicate_policy: "fail_if_present" },
    ]);
    assert.equal(JSON.stringify(chain).includes(ident), false);

    const missingHarness = createProductionMock({ evidenceProject: paths.evidenceProject, managedRenderRoot: paths.managedRenderRoot });
    const missing = await runInstalledTrial({
      scenarios: ["mixing-delivery"],
      ...paths,
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
  const trackRows = layoutRows(104).map((row, index) => ({ ref: `track:guid:{TRACK-${index + 1}}`, name: row.name, index }));
  const state = { items: new Map(), nextItem: 1, midi: new Map() };
  const connectFactory = async ({ scenario, clientName }) => {
    const client = {
      closed: false,
      async close() { this.closed = true; },
      async callTool(request) {
        requests.push({ ...request, scenario, clientName });
        return respond(request, { evidenceProject, managedRenderRoot, trackRows, state, installedFxRows });
      },
    };
    connects.push({ scenario, clientName });
    clients.push(client);
    return client;
  };
  return { connectFactory, requests, connects, clients };
}

async function respond(request, { evidenceProject, managedRenderRoot, trackRows, state, installedFxRows }) {
  if (request.name === "ping") return jsonResponse({ ok: true, product_surface: { agent_context_macro_guide: { macro_menu: { macro_ids: Array.from({ length: 15 }, (_, index) => `macro.${index}`) } } } });
  const { id, input, refs } = request.arguments;
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
    return jsonResponse({
      contract: "macro.execution.v1",
      ok: true,
      execution: { status: "completed" },
      result: {
        changes: input.layout.map((row) => ({
          operation_id: row.id,
          target_ref: trackRows[Number(row.index)].ref,
          status: "applied",
          mutation: { status: "completed" },
          live_readback: { status: "passed" },
          index_maintenance: { status: "completed" },
        })),
        verification: { status: "passed" },
      },
    });
  }
  if (id === "macro.project.query") {
    if (input.entity === "items") {
      const rows = input.selectors.refs.map((ref) => state.items.get(ref)).filter(Boolean);
      return jsonResponse(macroResult({ data: { rows, page: { has_more: false, next_cursor: null }, coverage: { status: "complete" } } }));
    }
    if (input.filters?.name) {
      const rows = trackRows.filter((row) => row.name === input.filters.name).slice(0, input.limit);
      return jsonResponse(macroResult({ data: { rows, page: { has_more: false, next_cursor: null }, coverage: { status: "complete" } } }));
    }
    const second = input.cursor === "tracks-page-2";
    const rows = second ? trackRows.slice(100) : trackRows.slice(0, 100);
    return jsonResponse({
      contract: "macro.execution.v1",
      ok: true,
      execution: { status: "completed" },
      result: { data: { rows, page: { has_more: !second, next_cursor: second ? null : "tracks-page-2" }, coverage: { status: "complete" } }, verification: { status: "passed" } },
    });
  }
  if (id === "macro.media.place_assets") {
    const changes = input.assets.map((asset, index) => {
      const ordinal = state.nextItem++;
      const itemRef = `item:guid:{ITEM-${ordinal}}`;
      const takeRef = `take:guid:{TAKE-${ordinal}}`;
      state.items.set(itemRef, { ref: itemRef, track_ref: input.track_ref, start_seconds: input.placement.start_seconds + index, length_seconds: 1 });
      return verifiedChange({ asset_id: asset.id, live_readback: { item_ref: itemRef, take_ref: takeRef, track_ref: input.track_ref } });
    });
    return jsonResponse(macroResult({ changes }));
  }
  if (id === "macro.items.apply") {
    const targets = input.mode === "stack_on_existing_tracks" ? input.track_assignments : input.target_refs.map((item_ref) => ({ item_ref }));
    const changes = targets.map((target) => {
      const row = state.items.get(target.item_ref);
      if (target.target_track_ref) row.track_ref = target.target_track_ref;
      return verifiedChange({ target_ref: target.item_ref });
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
    const fxRows = input.chain.map((candidate, index) => ({ name: candidate.plugin_name ?? candidate.plugin_query, fx_ref: `fx:${ownerRef}:${index}` }));
    return jsonResponse(macroResult({ data: { final_chain: { fx: fxRows } }, changes: fxRows.map((row) => verifiedChange({ target_ref: row.fx_ref })) }));
  }
  if (id === "template.fx.parameter_to_envelope_mapping") {
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { fx_ref: refs.fx_ref.ref, param_ident: "0:gain", envelope_exists: false } } });
  }
  if (id === "template.fx.search_installed_fx") {
    const rows = installedFxRows.filter((row) => String(row.name).toLowerCase().includes(input.query.toLowerCase()));
    return jsonResponse({ contract: "template.execution.v1", ok: true, result: { summary: { query: input.query, rows, row_count: rows.length, matched_count: rows.length, truncated: false } } });
  }
  if (id === "macro.automation.apply") {
    const automationWrites = requestsForState(state, "automation_writes");
    const createdEnvelope = automationWrites.length === 0;
    automationWrites.push({ fx_ref: input.fx_refs[0] });
    return jsonResponse(macroResult({ changes: [verifiedChange({ target_ref: input.fx_refs[0], live_readback: { created_envelope: createdEnvelope } })] }));
  }
  if (id === "macro.render.targets") {
    await mkdir(managedRenderRoot, { recursive: true });
    const absolutePath = path.join(managedRenderRoot, `${input.output_basename}.wav`);
    await writeFile(absolutePath, wavFixture());
    return jsonResponse(macroResult({ data: { outputs: [{ absolute_path: absolutePath, requested_format: "wav", actual_format: "wav", output_basename: input.output_basename }] } }));
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

async function sha256Fixture(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function jsonResponse(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
