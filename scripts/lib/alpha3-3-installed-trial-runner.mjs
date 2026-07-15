import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const MINIMUM_BUDGET = Object.freeze({
  max_response_bytes: 2_048,
  max_items: 50,
  max_inline_value_bytes: 2_048,
});

export const NORMAL_BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_items: 50,
  max_inline_value_bytes: 2_048,
});

export const LARGE_PROJECTION_BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_items: 128,
  max_inline_value_bytes: 24_576,
});

export const PUBLIC_BUDGET_LADDER = Object.freeze([
  Object.freeze({ rung: "minimum", budget: MINIMUM_BUDGET }),
  Object.freeze({ rung: "normal", budget: NORMAL_BUDGET }),
  Object.freeze({ rung: "large_projection", budget: LARGE_PROJECTION_BUDGET }),
]);

export const MAX_MEDIA_ASSETS_PER_CALL = 8;
export const IMPLEMENTED = "proven_executable";
const CALL_TIMEOUT_MS = 300_000;
const MAX_TOTAL_TIMEOUT_MS = 600_000;
const AUDIO_EXTENSIONS = new Set([".wav", ".wave", ".aif", ".aiff", ".flac", ".mp3", ".ogg"]);

const REPORT_ACCOUNTING_FIELDS = Object.freeze([
  "provenance",
  "duration_ms",
  "response_bytes",
  "budget_accounting",
  "truncation",
  "artifacts",
  "calls",
  "failed_calls",
  "retries",
  "ineffective_retries",
  "macro_first",
  "template_fallbacks",
  "project_changes",
  "rendered_outputs",
  "backup_recovery_posture",
]);

function step({
  id,
  prompt,
  tool = "call_template",
  templateId,
  input = {},
  refs,
  budget = NORMAL_BUDGET,
  limits = {},
  verification,
  fallbackReason = null,
  implementationStatus = IMPLEMENTED,
  coverage = [],
  budgetRung = null,
}) {
  return {
    id,
    prompt,
    tool,
    request: templateId
      ? { id: templateId, input, ...(refs ? { refs } : {}), budget }
      : { arguments: input, budget },
    limits: {
      max_calls: 1,
      timeout_ms: CALL_TIMEOUT_MS,
      max_total_timeout_ms: MAX_TOTAL_TIMEOUT_MS,
      ...limits,
    },
    verification_duties: verification,
    fallback_reason: fallbackReason,
    implementation_status: implementationStatus,
    coverage,
    budget_rung: budgetRung,
  };
}

export function layoutRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `production_track_${String(index + 1).padStart(3, "0")}`,
    kind: index % 16 === 0 ? "folder" : "track",
    name: index === count - 1 ? "PRODUCTION-DEEP-EXACT-104" : `Production ${String(index + 1).padStart(3, "0")}`,
    index,
    ...(index % 16 === 0
      ? { folder_depth: 1 }
      : index % 16 === 15 || index === count - 1
        ? { folder_depth: -1 }
        : {}),
  }));
}

function noteRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    start_ppq: index * 120,
    end_ppq: index * 120 + 90,
    pitch: 48 + (index % 24),
    velocity: 72 + (index % 32),
    channel: index % 4,
  }));
}

const LARGE_PRODUCTION_STEPS = [
  step({
    id: "installed-product-handshake",
    prompt: "Check that OpenReaper is connected and show the small Macro menu.",
    tool: "ping",
    input: {},
    verification: ["Installed wrapper answers ping.", "The product surface exposes fifteen visible Macros."],
    coverage: ["installed-wrapper", "macro-menu"],
  }),
  step({
    id: "save-evidence-project",
    prompt: "Save this as the trial copy, then keep all work in that copy.",
    templateId: "macro.project.file",
    input: { operation: "save_as", target_path: "${evidence_project}", overwrite: true, dry_run: false },
    verification: ["path_after equals the managed evidence project.", "The authorized source project hash remains unchanged."],
    coverage: ["save", "backup-recovery"],
  }),
  step({
    id: "installed-wrapper-reconnect-checkpoint",
    prompt: "Reconnect OpenReaper and confirm that the same trial project is still current.",
    tool: "runner.reconnect_installed_wrapper",
    templateId: "template.project.read_current_project_path",
    input: {},
    verification: ["Close the MCP client and installed-wrapper transport.", "Start a new installed-wrapper transport.", "Read and exactly match the current evidence-project path."],
    coverage: ["restart", "reconnect", "current-project-identity"],
    fallbackReason: "Current-project identity is a narrow read-only Template fallback because no public Macro owns installed-session reconnect verification.",
  }),
  step({
    id: "nested-104-track-layout-batches",
    prompt: "Build a large nested production layout in small batches and stop on any mismatch.",
    templateId: "macro.project.apply_layout",
    input: { layout: layoutRows(104), match_policy: "create_only", conflict_policy: "stop", dry_run: false },
    limits: { batch_size: 13, expected_total_tracks_at_least: 104 },
    verification: ["At least 104 Tracks exist.", "Nested Folder boundaries read back exactly.", "Every batch returns one applied and verified row per requested Track."],
    coverage: ["100-plus-tracks", "nested-folders", "bounded-batches"],
    fallbackReason: null,
  }),
  step({
    id: "repeated-media-placement-batches",
    prompt: "Import the planned files in small batches twice and verify every new Item.",
    templateId: "macro.media.place_assets",
    input: { assets: "${enumerated_asset_batches}", placement: { mode: "sequence_on_one_track", start_seconds: 0, gap_seconds: 0.1 }, track_policy: "existing_track", track_ref: "${media_track_ref}", dry_run: false },
    limits: { batch_size: MAX_MEDIA_ASSETS_PER_CALL, minimum_repetitions: 2, expected_total_items_at_least: 250 },
    verification: ["Every call contains at most eight assets.", "Every returned Item and Take ref resolves exactly.", "At least 250 Items exist after the repeated batches.", "Index invalidation is visible to the second client."],
    coverage: ["250-plus-items", "repeated-media-operation", "write-invalidation", "two-clients"],
  }),
  step({
    id: "repeated-item-operations",
    prompt: "Move and sequence several exact Items twice, with preview and exact readback each time.",
    templateId: "macro.items.apply",
    input: { mode: "stack_on_existing_tracks", track_assignments: "${bounded_item_track_assignments}", dry_run: false },
    limits: { batch_size: 8, minimum_repetitions: 2 },
    verification: ["Each operation is previewed before mutation.", "Every exact Item resolves on its requested Track.", "Repeated writes refresh both clients."],
    coverage: ["repeated-item-operations", "two-clients", "write-invalidation"],
  }),
  step({
    id: "create-32-note-clip",
    prompt: "Make one ordinary 32-note MIDI clip and verify the exact Take.",
    templateId: "macro.midi.apply",
    refs: { track_ref: "${midi_track_ref}" },
    input: { mode: "create_clips", start_seconds: 0, end_seconds: 8, notes: noteRows(32), dry_run: false },
    verification: ["Exactly 32 notes are read back.", "The returned Item and Take refs resolve exactly."],
    coverage: ["32-note-midi", "midi-write"],
  }),
  step({
    id: "create-128-note-clip",
    prompt: "Make a dense 128-note clip, add CC, and keep all later reads paged.",
    templateId: "macro.midi.apply",
    refs: { track_ref: "${midi_track_ref}" },
    input: { mode: "create_clips", start_seconds: 12, end_seconds: 44, notes: noteRows(128), dry_run: false },
    budget: LARGE_PROJECTION_BUDGET,
    budgetRung: "large_projection",
    verification: ["Exactly 128 notes are created once.", "A verification budget failure retains created refs and forbids blind replay."],
    coverage: ["128-note-midi", "dense-events", "do-not-replay-recovery"],
  }),
  step({
    id: "repeat-midi-cc-write",
    prompt: "Write two bounded CC batches to the dense Take and verify them after each edit.",
    templateId: "macro.midi.apply",
    input: { mode: "write_cc", operations: "${two_dense_take_cc_batches}", dry_run: false },
    limits: { minimum_repetitions: 2, batch_size: 32 },
    verification: ["CC writes run more than once.", "Each mutation has exact Take count readback and complete coverage."],
    coverage: ["cc-events", "repeated-midi-operation"],
  }),
  step({
    id: "paged-note-cc-text-sysex-reads",
    prompt: "Read every Note, CC, and text or sysex event in small pages and prove no page is missing.",
    templateId: "template.midi.list_take_notes",
    refs: { take_ref: "${dense_take_ref}" },
    input: { cursor: "0", limit: 16, include_project_time: true },
    budget: MINIMUM_BUDGET,
    budgetRung: "minimum",
    limits: { page_size: 16, sibling_templates: ["template.midi.list_take_cc_events", "template.midi.list_take_text_sysex_events"] },
    verification: ["Follow public cursors to the final page for Notes, CC, and text/sysex.", "No event is duplicated or skipped.", "A typed budget blocker names the safe retry or artifact fallback."],
    coverage: ["note-pagination", "cc-pagination", "text-sysex-pagination", "typed-blocker", "artifact-fallback"],
    fallbackReason: "Direct paged MIDI event reads are required for exact Take verification because no public Macro owns complete event enumeration.",
  }),
  step({
    id: "stock-fx-repeated-automation",
    prompt: "Add ReaEQ and write two independently verified parameter Automation passes.",
    templateId: "macro.fx.apply_chain",
    refs: { track_ref: "${automation_track_ref}" },
    input: { owner_kind: "track", chain: [{ plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" }], dry_run: false },
    verification: ["The returned ReaEQ ref is exact.", "Both Automation writes are applied with completed mutation and passed live readback."],
    coverage: ["stock-fx", "repeated-automation"],
  }),
  step({
    id: "render-large-production-wav",
    prompt: "Render one whole-project WAV under the managed output root and verify its file bytes.",
    templateId: "macro.render.targets",
    input: { target_kind: "whole_project", format: "wav", output_basename: "${unique_basename}", dry_run: false },
    verification: ["The render reports one WAV output.", "The output is a non-empty RIFF/WAVE file below the managed render root."],
    coverage: ["whole-project-render", "wav", "file-evidence"],
  }),
  step({
    id: "save-large-production-project",
    prompt: "Save the trial project after all exact readbacks pass.",
    templateId: "macro.project.file",
    input: { operation: "save_current", dry_run: false },
    budget: NORMAL_BUDGET,
    verification: ["Save uses the required 65,536-byte response budget.", "The current evidence project exists and the source remains unchanged."],
    coverage: ["save", "recovery"],
  }),
  step({
    id: "reopen-equivalent-installed-wrapper-reconnect",
    prompt: "Restart the installed connection and prove the saved project is still the current project.",
    tool: "runner.reconnect_installed_wrapper",
    templateId: "template.project.read_current_project_path",
    input: {},
    verification: ["Close and restart the installed-wrapper transport.", "Confirm current-project identity after save.", "Do not invent a public project reopen operation."],
    coverage: ["save-reconnect", "project-identity"],
    fallbackReason: "Current-project identity is a narrow read-only Template fallback because no public Macro owns installed-session reconnect verification.",
  }),
];

const MIXING_DELIVERY_STEPS = [
  step({
    id: "mix-installed-product-handshake",
    prompt: "Check the installed OpenReaper connection before changing the mix.",
    tool: "ping",
    input: {},
    verification: ["Installed wrapper answers ping.", "Record product provenance before the first project call."],
    coverage: ["installed-wrapper"],
  }),
  step({
    id: "mix-save-evidence-project",
    prompt: "Save a separate mix-delivery trial copy.",
    templateId: "macro.project.file",
    input: { operation: "save_as", target_path: "${evidence_project}", overwrite: true, dry_run: false },
    verification: ["The managed evidence project becomes current.", "Source and recovery copy hashes are retained."],
    coverage: ["save-as", "backup-recovery"],
  }),
  step({
    id: "mix-small-layout",
    prompt: "Create a small source and mix-bus layout and preserve every exact Track ref.",
    templateId: "macro.project.apply_layout",
    input: { layout: "${three_track_layout}", match_policy: "create_only", conflict_policy: "stop", dry_run: false },
    limits: { batch_size: 3 },
    verification: ["All three rows are applied.", "Every row returns an exact Track ref and passed live readback."],
    coverage: ["small-layout", "exact-track-refs"],
  }),
  step({
    id: "inventory-confirm-third-party-fx",
    prompt: "Find one installed third-party effect and report its exact installed identity; do not substitute.",
    templateId: "template.fx.search_installed_fx",
    input: { query: "${requested_third_party_plugin}", limit: 20 },
    verification: ["Return one exact installed identity before use.", "A missing plug-in becomes a typed capability result, never a stock substitution."],
    coverage: ["installed-fx-inventory", "third-party-identity", "no-substitution"],
    fallbackReason: "Direct inventory read is used only when the operator supplies a third-party FX query; a missing result stops the trial without substitution.",
  }),
  step({
    id: "apply-stock-and-confirmed-fx-chain",
    prompt: "Put ReaEQ on the bus and append the exact confirmed third-party effect only when requested.",
    templateId: "macro.fx.apply_chain",
    refs: { track_ref: "${mix_bus_track_ref}" },
    input: { owner_kind: "track", chain: [{ plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" }], dry_run: false },
    verification: ["Exact FX identities and slots read back in requested order.", "No missing effect is substituted.", "Every returned FX ref is exact."],
    coverage: ["ReaEQ", "optional-third-party-fx", "fx-order"],
  }),
  step({
    id: "mix-repeated-fx-automation",
    prompt: "Write two bounded ReaEQ parameter Automation passes and verify every change row.",
    templateId: "macro.automation.apply",
    input: { mode: "insert_fx_parameter_points", fx_refs: ["${exact_fx_ref}"], fx_parameter: "${live_parameter_mapping}", points: "${bounded_points}", dry_run: false },
    limits: { minimum_repetitions: 2, batch_size: 1 },
    verification: ["Each call returns one completed mutation row.", "Both calls pass exact live readback."],
    coverage: ["fx-automation", "repeated-automation-edit"],
  }),
  step({
    id: "render-mix-wav",
    prompt: "Render one whole-project WAV with a unique basename.",
    templateId: "macro.render.targets",
    input: { target_kind: "whole_project", format: "wav", output_basename: "${unique_basename}", dry_run: false },
    limits: { minimum_targets: 1, managed_output_only: true },
    verification: ["The output is reported as WAV.", "File header, extension, size, and managed-root containment all pass."],
    coverage: ["whole-project-render", "wav-delivery"],
  }),
  step({
    id: "save-mix-delivery-project",
    prompt: "Save the separate mix-delivery copy after all delivery checks.",
    templateId: "macro.project.file",
    input: { operation: "save_current", dry_run: false },
    budget: NORMAL_BUDGET,
    verification: ["Save completes at the required response budget.", "Recovery copy remains available and source media remains present."],
    coverage: ["save", "delivery-recovery"],
  }),
  step({
    id: "mix-installed-wrapper-reconnect-checkpoint",
    prompt: "Reconnect the installed product and verify the saved mix project identity.",
    tool: "runner.reconnect_installed_wrapper",
    templateId: "template.project.read_current_project_path",
    input: {},
    verification: ["Close and restart the installed-wrapper transport.", "Exact current-project path matches the mix evidence project."],
    coverage: ["restart", "reconnect", "current-project-identity"],
    fallbackReason: "Current-project identity is a narrow read-only Template fallback because no public Macro owns installed-session reconnect verification.",
  }),
];

export const SCENARIO_MANIFESTS = deepFreeze({
  "large-production": {
    contract: "openreaper.alpha3.3.installed_trial_manifest.v1",
    scenario: "large-production",
    purpose: "Large-project and repeated production-workflow reliability trial.",
    execution_policy: "strict_serial",
    required_product: "absolute_installed_openreaper_mcp_wrapper",
    report_accounting_fields: REPORT_ACCOUNTING_FIELDS,
    steps: LARGE_PRODUCTION_STEPS,
  },
  "mixing-delivery": {
    contract: "openreaper.alpha3.3.installed_trial_manifest.v1",
    scenario: "mixing-delivery",
    purpose: "Small real mix, repeated stock-FX Automation, and whole-project WAV delivery trial.",
    execution_policy: "strict_serial",
    required_product: "absolute_installed_openreaper_mcp_wrapper",
    report_accounting_fields: REPORT_ACCOUNTING_FIELDS,
    steps: MIXING_DELIVERY_STEPS,
  },
});

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.execution_policy !== "strict_serial") errors.push("Manifest must require strict serial execution.");
  if (!Array.isArray(manifest?.steps) || manifest.steps.length === 0) errors.push("Manifest must contain steps.");
  for (const [index, candidate] of (manifest?.steps ?? []).entries()) {
    const at = `${manifest.scenario ?? "unknown"}.steps[${index}]`;
    for (const field of ["id", "tool", "limits", "verification_duties", "fallback_reason", "implementation_status"]) {
      if (!(field in candidate)) errors.push(`${at} is missing ${field}.`);
    }
    if (!candidate.request || !candidate.request.budget) errors.push(`${at} is missing request budget.`);
    if (!Array.isArray(candidate.verification_duties) || candidate.verification_duties.length === 0) errors.push(`${at} has no verification duties.`);
    if (candidate.implementation_status !== IMPLEMENTED) errors.push(`${at} has an invalid implementation_status.`);
    if (String(candidate.request?.id ?? "").startsWith("template.") && !candidate.fallback_reason) {
      errors.push(`${at} must explain its direct Template fallback.`);
    }
    validateBudget(candidate.request?.budget, `${at}.request.budget`, errors);
    if (candidate.id.includes("media") && Number(candidate.limits?.batch_size ?? 0) > MAX_MEDIA_ASSETS_PER_CALL) {
      errors.push(`${at} exceeds the eight-asset media batch limit.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function describeTrial({ scenarios = Object.keys(SCENARIO_MANIFESTS), mode = "describe", installedWrapper = null } = {}) {
  const selected = selectManifests(scenarios);
  const report = createBaseReport({
    scenarios: selected.map((manifest) => manifest.scenario),
    mode,
    installedWrapper,
    status: mode === "describe" ? "described_not_executed" : "dry_run_not_executed",
    unimplemented: [],
    manifests: selected,
  });
  report.manifest_plans = selected;
  return report;
}

export async function runInstalledTrial({
  scenarios,
  mode = "execute",
  installedWrapper,
  sourceProject = null,
  evidenceProject,
  managedRenderRoot,
  mediaRoots = [],
  mediaAssets = [],
  thirdPartyFxQuery = null,
  connectFactory = connectInstalledWrapper,
} = {}) {
  const selected = selectManifests(scenarios);
  for (const manifest of selected) {
    const validation = validateManifest(manifest);
    if (!validation.valid) throw new Error(`Invalid ${manifest.scenario} manifest: ${validation.errors.join(" ")}`);
  }
  if (mode === "describe" || mode === "dry-run") {
    return describeTrial({ scenarios: selected.map((manifest) => manifest.scenario), mode, installedWrapper: installedWrapper ?? null });
  }
  if (mode !== "execute") throw new Error(`Unsupported trial mode: ${mode}`);
  if (selected.length !== 1) throw new Error("Actual execution requires one scenario and one independent evidence project per run.");

  assertAbsoluteInstalledWrapper(installedWrapper);
  if (!path.isAbsolute(sourceProject ?? "")) throw new Error("Actual execution requires an absolute sourceProject path.");
  if (!path.isAbsolute(evidenceProject ?? "")) throw new Error("Actual execution requires an absolute evidenceProject path.");
  if (!path.isAbsolute(managedRenderRoot ?? "")) throw new Error("Actual execution requires an absolute managedRenderRoot path.");
  assertAbsolutePaths(mediaRoots, "mediaRoots");
  assertAbsolutePaths(mediaAssets, "mediaAssets");

  const started = performance.now();
  const report = createBaseReport({
    scenarios: selected.map((manifest) => manifest.scenario),
    mode,
    installedWrapper,
    status: "running",
    unimplemented: [],
    manifests: selected,
  });
  report.provenance.installed_wrapper_sha256 = await sha256(installedWrapper);
  const context = createExecutionContext({
    installedWrapper,
    sourceProject,
    evidenceProject,
    managedRenderRoot,
    mediaRoots,
    mediaAssets,
    thirdPartyFxQuery,
    connectFactory,
  });
  context.source_hashes.before = await sha256(sourceProject);
  try {
    for (const manifest of selected) {
      await connectScenarioClients(context, manifest.scenario);
      if (manifest.scenario === "large-production") await runLargeProduction(context);
      else await runMixingDelivery(context);
      await closeScenarioClients(context);
    }
    report.status = "completed";
    report.outcome = "completed";
    report.ok = true;
  } catch (error) {
    report.status = "failed";
    report.outcome = "failed";
    report.error = {
      name: error?.name ?? "Error",
      code: error?.code ?? error?.cause?.code ?? null,
      message: error?.message ?? String(error),
      details: error?.details ?? null,
      cause: error?.cause ?? null,
    };
  } finally {
    await closeScenarioClients(context);
    report.duration_ms = Math.round(performance.now() - started);
  }
  report.calls = context.calls;
  report.failed_calls = context.failures;
  report.retries = context.recoveries;
  report.ineffective_retries = context.ineffective_retries;
  report.project_changes = context.calls.flatMap((call) => call.value?.result?.changes ?? []);
  for (const call of report.calls) updateReportAccounting(report, call);
  report.source_hashes = context.source_hashes;
  report.copy_hashes = context.copy_hashes;
  report.media_hashes = context.media_hashes;
  report.backup_recovery_posture = context.backup_recovery_posture;
  return report;
}

export async function connectInstalledWrapper({ installedWrapper, scenario = "trial", clientName = "primary" }) {
  assertAbsoluteInstalledWrapper(installedWrapper);
  const client = new Client({ name: `openreaper-alpha33-${scenario}-${clientName}-trial`, version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: installedWrapper,
    args: [],
    cwd: path.dirname(installedWrapper),
    env: process.env,
  }));
  return client;
}

export function createExecutionContext({ installedWrapper, sourceProject = null, evidenceProject, managedRenderRoot, mediaRoots = [], mediaAssets = [], thirdPartyFxQuery = null, connectFactory = connectInstalledWrapper }) {
  return {
    clients: { primary: null, secondary: null },
    refs: new Map(),
    calls: [],
    failures: [],
    recoveries: [],
    ineffective_retries: [],
    source_hashes: {},
    copy_hashes: {},
    media_hashes: {},
    installedWrapper,
    sourceProject,
    evidenceProject,
    managedRenderRoot,
    mediaRoots,
    mediaAssets,
    thirdPartyFxQuery,
    backup_recovery_posture: {
      source_project_unchanged: null,
      recovery_copy: sourceProject,
      evidence_project: evidenceProject,
      source_media_preserved: null,
    },
    connectFactory,
    scenario: null,
  };
}

export async function runLargeProduction(context) {
  await assertInstalledHandshake(context, "primary", "installed-product-handshake");
  await assertInstalledHandshake(context, "secondary", "secondary-client-handshake");

  const mediaFiles = await discoverMediaFiles(context.mediaRoots, context.mediaAssets);
  assertValue(mediaFiles.length > 0, "LARGE_PRODUCTION_MEDIA_REQUIRED", {
    media_roots: context.mediaRoots,
    media_assets: context.mediaAssets,
  });
  for (const file of mediaFiles) context.media_hashes[file] = await sha256(file);

  const save = await previewThenExecute(context, "primary", "save-evidence-project", {
    id: "macro.project.file",
    input: { operation: "save_as", target_path: context.evidenceProject, overwrite: true },
  });
  assertValue(save?.result?.data?.path_after === context.evidenceProject, "SAVE_AS_PATH_MISMATCH", {
    expected: context.evidenceProject,
    observed: save?.result?.data?.path_after ?? null,
  });

  await reconnectClient(context, "primary");
  const current = await callTemplate(context, "primary", "reconnect-current-project", {
    id: "template.project.read_current_project_path",
    input: {},
  });
  assertValue(current?.result?.summary?.path === context.evidenceProject, "CURRENT_PROJECT_IDENTITY_MISMATCH", {
    expected: context.evidenceProject,
    observed: current?.result?.summary?.path ?? null,
  });

  const rows = layoutRows(104);
  for (let offset = 0; offset < rows.length; offset += 13) {
    const batch = rows.slice(offset, offset + 13);
    const value = await previewThenExecute(context, "primary", `layout-${offset / 13 + 1}`, {
      id: "macro.project.apply_layout",
      input: { layout: batch, match_policy: "create_only", conflict_policy: "stop" },
    });
    const changes = value?.result?.changes ?? [];
    assertValue(changes.length === 13, "LAYOUT_BATCH_ROW_COUNT_MISMATCH", { offset, observed: changes.length });
    for (const change of changes) {
      assertVerifiedMutation(change, "LAYOUT_ROW_NOT_VERIFIED");
      assertExactRef(change?.target_ref, "track:", "LAYOUT_TRACK_REF_MISSING");
      context.refs.set(change.operation_id, change.target_ref);
    }
  }

  const tracks = await walkProjectQuery(context, "secondary", {
    entity: "tracks",
    fields: ["ref", "name", "index"],
    limit: 100,
    refresh_policy: "if_stale",
  });
  const createdRefs = new Set([...context.refs.values()]);
  assertValue(tracks.filter((row) => createdRefs.has(row.ref)).length === 104, "LAYOUT_TRACKS_MISSING_FROM_CURSOR_QUERY", {
    expected: 104,
    observed: tracks.filter((row) => createdRefs.has(row.ref)).length,
  });
  const last = tracks.filter((row) => row.name === "PRODUCTION-DEEP-EXACT-104");
  assertValue(last.length === 1 && last[0].index === 103, "DEEP_TRACK_QUERY_MISMATCH", { observed: last });
  const exactLast = await callTemplate(context, "secondary", "query-last-track-exact-name", {
    id: "macro.project.query",
    input: {
      entity: "tracks",
      fields: ["ref", "name", "index"],
      filters: { name: "PRODUCTION-DEEP-EXACT-104" },
      limit: 1,
      refresh_policy: "never",
    },
    budget: MINIMUM_BUDGET,
  });
  assertValue(
    exactLast?.result?.data?.rows?.length === 1
      && exactLast.result.data.rows[0].ref === last[0].ref
      && exactLast.result.data.rows[0].index === 103,
    "DEEP_TRACK_EXACT_NAME_QUERY_MISMATCH",
    exactLast?.result?.data,
  );
  context.refs.set("production_last_track", last[0].ref);

  const mediaTrackRef = context.refs.get("production_track_002");
  const itemRefs = [];
  const takeRefs = [];
  for (let offset = 0; itemRefs.length < 250; offset += MAX_MEDIA_ASSETS_PER_CALL) {
    const count = Math.min(MAX_MEDIA_ASSETS_PER_CALL, 250 - itemRefs.length);
    const assets = Array.from({ length: count }, (_, index) => ({
      id: `production_media_${String(offset + index + 1).padStart(3, "0")}`,
      path: mediaFiles[(offset + index) % mediaFiles.length],
    }));
    const value = await callTemplate(context, "primary", `media-${offset / MAX_MEDIA_ASSETS_PER_CALL + 1}`, {
      id: "macro.media.place_assets",
      input: {
        assets,
        placement: { mode: "sequence_on_one_track", start_seconds: offset * 2, gap_seconds: 0.1 },
        track_policy: "existing_track",
        track_ref: mediaTrackRef,
        dry_run: false,
      },
    });
    const changes = value?.result?.changes ?? [];
    assertValue(changes.length === assets.length, "MEDIA_BATCH_ROW_COUNT_MISMATCH", { requested: assets.length, observed: changes.length });
    for (const [index, change] of changes.entries()) {
      assertVerifiedMutation(change, "MEDIA_CHANGE_NOT_VERIFIED");
      assertValue(change.asset_id === assets[index].id && change.live_readback?.track_ref === mediaTrackRef, "MEDIA_CHANGE_IDENTITY_MISMATCH", change);
      assertExactRef(change.live_readback?.item_ref, "item:", "MEDIA_ITEM_REF_MISSING");
      assertExactRef(change.live_readback?.take_ref, "take:", "MEDIA_TAKE_REF_MISSING");
      itemRefs.push(change.live_readback.item_ref);
      takeRefs.push(change.live_readback.take_ref);
    }
  }

  const queriedItems = [];
  for (let offset = 0; offset < itemRefs.length; offset += 100) {
    queriedItems.push(...await walkProjectQuery(context, "secondary", {
      entity: "items",
      fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
      selectors: { refs: itemRefs.slice(offset, offset + 100) },
      limit: 100,
      refresh_policy: "if_stale",
    }));
  }
  assertValue(queriedItems.length === itemRefs.length && queriedItems.every((row) => itemRefs.includes(row.ref) && row.track_ref === mediaTrackRef), "MEDIA_EXACT_ITEM_QUERY_MISMATCH", { expected: itemRefs.length, observed: queriedItems.length });

  const firstItems = itemRefs.slice(0, 8);
  const firstItemWrite = await previewThenExecute(context, "primary", "items-sequence", {
    id: "macro.items.apply",
    input: { mode: "sequence_with_gap", target_refs: firstItems, anchor_seconds: 600, gap_seconds: 0.2 },
  });
  assertVerifiedChanges(firstItemWrite, firstItems.length, "FIRST_ITEM_WRITE_NOT_VERIFIED");
  assertChangeTargets(firstItemWrite, firstItems, "FIRST_ITEM_TARGET_MISMATCH");
  await assertExactItemsVisible(context, firstItems, mediaTrackRef, "items-sequence");

  const secondItems = itemRefs.slice(8, 16);
  const secondTrackRef = context.refs.get("production_track_003");
  const secondItemWrite = await previewThenExecute(context, "primary", "items-reassign", {
    id: "macro.items.apply",
    input: { mode: "stack_on_existing_tracks", track_assignments: secondItems.map((item_ref) => ({ item_ref, target_track_ref: secondTrackRef })) },
  });
  assertVerifiedChanges(secondItemWrite, secondItems.length, "SECOND_ITEM_WRITE_NOT_VERIFIED");
  assertChangeTargets(secondItemWrite, secondItems, "SECOND_ITEM_TARGET_MISMATCH");
  await assertExactItemsVisible(context, secondItems, secondTrackRef, "items-reassign");

  const midiTrackRef = context.refs.get("production_track_004");
  const ordinaryMidi = await createMidiClip(context, "create-32-note-clip", midiTrackRef, 0, 8, 32);
  const denseMidi = await createMidiClip(context, "create-128-note-clip", midiTrackRef, 12, 44, 128, LARGE_PROJECTION_BUDGET);
  assertValue(ordinaryMidi.takeRef !== denseMidi.takeRef, "MIDI_TAKE_REUSE_UNEXPECTED", { ordinary: ordinaryMidi, dense: denseMidi });

  for (let pass = 0; pass < 2; pass += 1) {
    const events = Array.from({ length: 32 }, (_, index) => ({
      ppq: pass * 32 * 120 + index * 120,
      channel: 0,
      controller: pass === 0 ? 1 : 11,
      value: (index * 4) % 128,
    }));
    const cc = await callTemplate(context, "primary", `dense-cc-pass-${pass + 1}`, {
      id: "macro.midi.apply",
      input: { mode: "write_cc", operations: [{ operation_id: `dense_cc_${pass + 1}`, take_ref: denseMidi.takeRef, events }], dry_run: false },
    });
    assertVerifiedChanges(cc, 1, "MIDI_CC_WRITE_NOT_VERIFIED");
    const readback = cc.result.changes[0].live_readback;
    assertValue(Number.isInteger(readback?.before_count) && readback?.after_count === readback.before_count + 32 && readback?.coverage_complete === true, "MIDI_CC_COUNT_MISMATCH", readback);
  }

  const notes = await walkMidiEvents(context, "template.midi.list_take_notes", denseMidi.takeRef, "notes");
  const ccEvents = await walkMidiEvents(context, "template.midi.list_take_cc_events", denseMidi.takeRef, "cc_events");
  const textEvents = await walkMidiEvents(context, "template.midi.list_take_text_sysex_events", denseMidi.takeRef, "events");
  assertValue(notes.length === 128, "MIDI_NOTE_CURSOR_COUNT_MISMATCH", { observed: notes.length });
  assertValue(ccEvents.length === 64, "MIDI_CC_CURSOR_COUNT_MISMATCH", { observed: ccEvents.length });
  assertValue(Array.isArray(textEvents), "MIDI_TEXT_CURSOR_INVALID");

  const automationTrackRef = context.refs.get("production_track_005");
  const fx = await previewThenExecute(context, "primary", "add-production-reaeq", {
    id: "macro.fx.apply_chain",
    refs: { track_ref: automationTrackRef },
    input: { owner_kind: "track", chain: [{ plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" }] },
  });
  assertVerifiedChanges(fx, 1, "FX_CHAIN_NOT_VERIFIED");
  const fxRef = requireFxRef(fx, "ReaEQ");
  const paramIdent = await readFxParameterIdent(context, fxRef, "production-reaeq-mapping");
  await writeFxAutomationPasses(context, fxRef, paramIdent, "production");

  await renderVerifiedWav(context, "large-production");
  await saveAndReconnect(context, "large-production");
  await finalizeRecoveryPosture(context);
  return context;
}

export async function runMixingDelivery(context) {
  await assertInstalledHandshake(context, "primary", "mix-installed-product-handshake");
  await assertInstalledHandshake(context, "secondary", "mix-secondary-client-handshake");

  const save = await previewThenExecute(context, "primary", "mix-save-evidence-project", {
    id: "macro.project.file",
    input: { operation: "save_as", target_path: context.evidenceProject, overwrite: true },
  });
  assertValue(save?.result?.data?.path_after === context.evidenceProject, "MIX_SAVE_AS_PATH_MISMATCH", save?.result?.data);

  const layout = [
    { id: "mix_source_a", kind: "track", name: "TRIAL SOURCE A", index: 0 },
    { id: "mix_source_b", kind: "track", name: "TRIAL SOURCE B", index: 1 },
    { id: "mix_bus", kind: "track", name: "TRIAL MIX BUS", index: 2 },
  ];
  const layoutValue = await previewThenExecute(context, "primary", "mix-small-layout", {
    id: "macro.project.apply_layout",
    input: { layout, match_policy: "create_only", conflict_policy: "stop" },
  });
  assertVerifiedChanges(layoutValue, 3, "MIX_LAYOUT_NOT_VERIFIED");
  const trackRefs = new Map(layoutValue.result.changes.map((row) => [row.operation_id, row.target_ref]));
  assertValue([...trackRefs.values()].every((ref) => typeof ref === "string" && ref.startsWith("track:")), "MIX_TRACK_REF_MISSING");

  let thirdPartyName = null;
  if (context.thirdPartyFxQuery) {
    const inventory = await callTemplate(context, "primary", "mix-third-party-inventory", {
      id: "template.fx.search_installed_fx",
      input: { query: context.thirdPartyFxQuery, limit: 20 },
    });
    const rows = inventory?.result?.summary?.rows ?? [];
    assertValue(rows.length > 0, "REQUESTED_THIRD_PARTY_FX_NOT_INSTALLED", { query: context.thirdPartyFxQuery });
    assertValue(rows.length === 1 && inventory?.result?.summary?.matched_count === 1 && inventory?.result?.summary?.truncated !== true, "REQUESTED_THIRD_PARTY_FX_AMBIGUOUS", {
      query: context.thirdPartyFxQuery,
      matched_count: inventory?.result?.summary?.matched_count ?? rows.length,
      rows,
    });
    thirdPartyName = rows[0].name;
    assertValue(typeof thirdPartyName === "string" && thirdPartyName.length > 0, "THIRD_PARTY_FX_IDENTITY_MISSING", rows[0]);
  }

  const chain = [{ plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" }];
  if (thirdPartyName) chain.push({ plugin_name: thirdPartyName, duplicate_policy: "fail_if_present" });
  const fx = await previewThenExecute(context, "primary", "mix-apply-fx-chain", {
    id: "macro.fx.apply_chain",
    refs: { track_ref: trackRefs.get("mix_bus") },
    input: { owner_kind: "track", chain },
  });
  assertVerifiedChanges(fx, chain.length, "MIX_FX_CHAIN_NOT_VERIFIED");
  const fxRef = requireFxRef(fx, "ReaEQ");
  const paramIdent = await readFxParameterIdent(context, fxRef, "mix-reaeq-mapping");
  await writeFxAutomationPasses(context, fxRef, paramIdent, "mix");

  await renderVerifiedWav(context, "mixing-delivery");
  await saveAndReconnect(context, "mixing-delivery");
  await finalizeRecoveryPosture(context);
  return context;
}

async function discoverMediaFiles(roots, assets) {
  const found = new Set();
  const visit = async (candidate) => {
    const info = await stat(candidate).catch(() => null);
    if (!info) return;
    if (info.isFile()) {
      if (AUDIO_EXTENSIONS.has(path.extname(candidate).toLowerCase())) found.add(path.resolve(candidate));
      return;
    }
    if (!info.isDirectory()) return;
    const entries = await readdir(candidate, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isFile()) await visit(path.join(candidate, entry.name));
    }
  };
  for (const root of roots) await visit(root);
  for (const asset of assets) await visit(asset);
  return [...found].sort((left, right) => left.localeCompare(right));
}

async function assertExactItemsVisible(context, itemRefs, trackRef, stepId) {
  const rows = await walkProjectQuery(context, "secondary", {
    entity: "items",
    fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
    selectors: { refs: itemRefs },
    limit: 100,
    refresh_policy: "if_stale",
  });
  assertValue(rows.length === itemRefs.length && rows.every((row) => itemRefs.includes(row.ref) && row.track_ref === trackRef), "ITEM_WRITE_EXACT_READBACK_MISMATCH", { step_id: stepId, expected_track_ref: trackRef, rows });
}

async function createMidiClip(context, stepId, trackRef, startSeconds, endSeconds, count, budget = NORMAL_BUDGET) {
  const value = await previewThenExecute(context, "primary", stepId, {
    id: "macro.midi.apply",
    refs: { track_ref: trackRef },
    input: { mode: "create_clips", start_seconds: startSeconds, end_seconds: endSeconds, notes: noteRows(count) },
    budget,
  });
  assertValue(value?.result?.data?.note_count === count, "MIDI_NOTE_COUNT_MISMATCH", { expected: count, observed: value?.result?.data?.note_count });
  const itemRef = value?.result?.data?.item_ref;
  const takeRef = value?.result?.data?.take_ref;
  assertExactRef(itemRef, "item:", "MIDI_ITEM_REF_MISSING");
  assertExactRef(takeRef, "take:", "MIDI_TAKE_REF_MISSING");
  assertValue(value?.result?.data?.track_ref === trackRef, "MIDI_TRACK_REF_MISMATCH", value?.result?.data);
  return { itemRef, takeRef };
}

async function walkMidiEvents(context, templateId, takeRef, resultField) {
  const rows = [];
  let cursor = "0";
  do {
    assertValue(/^\d+$/u.test(cursor), "MIDI_CURSOR_NOT_DECIMAL", { template_id: templateId, cursor });
    const value = await callTemplate(context, "secondary", `${templateId}-cursor-${cursor}`, {
      id: templateId,
      refs: { take_ref: takeObjectRef(takeRef) },
      input: { cursor, limit: 16, ...(templateId.endsWith("notes") ? { include_project_time: true } : {}) },
      budget: MINIMUM_BUDGET,
    });
    const summary = value?.result?.summary ?? {};
    assertValue(summary.take_ref === takeRef && Array.isArray(summary[resultField]), "MIDI_PAGE_SHAPE_INVALID", { template_id: templateId, summary });
    assertValue(summary.returned_count === summary[resultField].length, "MIDI_PAGE_COUNT_MISMATCH", { template_id: templateId, summary });
    rows.push(...summary[resultField]);
    cursor = summary.next_cursor ?? null;
    assertValue(summary.truncated !== true || (typeof cursor === "string" && /^\d+$/u.test(cursor)), "MIDI_NEXT_CURSOR_MISSING", { template_id: templateId, summary });
  } while (cursor);
  return rows;
}

function requireFxRef(value, label) {
  const finalChain = value?.result?.data?.final_chain?.fx ?? [];
  const row = finalChain.find((candidate) => String(candidate.name ?? "").toLowerCase().includes(label.toLowerCase()));
  const ref = row?.fx_ref ?? value?.result?.canonical_refs?.find((candidate) => typeof candidate === "string" && candidate.startsWith("fx:"));
  assertExactRef(ref, "fx:", "FX_REF_MISSING");
  return ref;
}

async function readFxParameterIdent(context, fxRef, stepId) {
  const value = await callTemplate(context, "secondary", stepId, {
    id: "template.fx.parameter_to_envelope_mapping",
    refs: { fx_ref: fxObjectRef(fxRef) },
    input: { param_index: 0 },
  });
  assertValue(value?.result?.summary?.fx_ref === fxRef, "FX_MAPPING_REF_MISMATCH", value?.result?.summary);
  const paramIdent = value?.result?.summary?.param_ident;
  assertValue(typeof paramIdent === "string" && paramIdent.length > 0, "FX_PARAM_IDENT_MISSING", value?.result?.summary);
  return paramIdent;
}

async function writeFxAutomationPasses(context, fxRef, paramIdent, prefix) {
  for (let pass = 0; pass < 2; pass += 1) {
    const value = await previewThenExecute(context, "primary", `${prefix}-automation-${pass + 1}`, {
      id: "macro.automation.apply",
      input: {
        mode: "insert_fx_parameter_points",
        fx_refs: [fxRef],
        fx_parameter: { param_index: 0, param_ident: paramIdent, create_if_missing: true },
        points: [{ time_seconds: pass * 2 + 1, value: pass === 0 ? 0.25 : 0.75, shape: 0, tension: 0, selected: false }],
      },
    });
    assertVerifiedChanges(value, 1, "FX_AUTOMATION_NOT_VERIFIED");
    const createdEnvelope = value.result.changes[0].live_readback?.created_envelope;
    assertValue(createdEnvelope === (pass === 0), "FX_AUTOMATION_CREATE_PATH_MISMATCH", { pass, created_envelope: createdEnvelope });
  }
}

async function renderVerifiedWav(context, prefix) {
  const basename = `${prefix}-${Date.now()}-${context.calls.length}`;
  const value = await previewThenExecute(context, "primary", `${prefix}-render-wav`, {
    id: "macro.render.targets",
    input: { target_kind: "whole_project", format: "wav", output_basename: basename },
  });
  assertValue(value?.execution?.status === "completed" && value?.result?.verification?.status === "passed", "RENDER_EXECUTION_NOT_VERIFIED", {
    execution: value?.execution,
    verification: value?.result?.verification,
  });
  const outputs = value?.result?.data?.outputs ?? [];
  assertValue(outputs.length === 1, "RENDER_OUTPUT_COUNT_MISMATCH", { outputs });
  const output = outputs[0];
  assertValue(output.requested_format === "wav" && output.actual_format === "wav" && output.output_basename === basename, "RENDER_OUTPUT_IDENTITY_MISMATCH", output);
  const evidence = await verifyRenderedOutput({ absolutePath: output.absolute_path, requestedFormat: "wav", managedRenderRoot: context.managedRenderRoot });
  assertValue(evidence.ok, "RENDER_FILE_VERIFICATION_FAILED", evidence);
  const call = context.calls.at(-1);
  assertValue(call?.requested_id === "macro.render.targets", "RENDER_CALL_ACCOUNTING_MISSING");
  call.rendered_outputs.push({ ...output, verification: evidence });
}

async function saveAndReconnect(context, prefix) {
  await previewThenExecute(context, "primary", `${prefix}-save-current`, {
    id: "macro.project.file",
    input: { operation: "save_current" },
    budget: NORMAL_BUDGET,
  });
  await reconnectClient(context, "primary");
  const current = await callTemplate(context, "primary", `${prefix}-saved-project-identity`, {
    id: "template.project.read_current_project_path",
    input: {},
  });
  assertValue(current?.result?.summary?.path === context.evidenceProject, "SAVED_PROJECT_IDENTITY_MISMATCH", current?.result?.summary);
}

async function finalizeRecoveryPosture(context) {
  const sourceAfter = await sha256(context.sourceProject);
  context.source_hashes.after = sourceAfter;
  context.copy_hashes.evidence_project = await sha256(context.evidenceProject);
  context.backup_recovery_posture.source_project_unchanged = sourceAfter === context.source_hashes.before;
  context.backup_recovery_posture.evidence_project = context.evidenceProject;
  context.backup_recovery_posture.source_media_preserved = await mediaHashesStillMatch(context.media_hashes);
  assertValue(context.backup_recovery_posture.source_project_unchanged, "SOURCE_PROJECT_CHANGED", context.source_hashes);
  assertValue(context.backup_recovery_posture.source_media_preserved, "SOURCE_MEDIA_CHANGED", context.media_hashes);
}

async function mediaHashesStillMatch(mediaHashes) {
  for (const [file, expected] of Object.entries(mediaHashes)) {
    if (await sha256(file).catch(() => null) !== expected) return false;
  }
  return true;
}

function assertVerifiedChanges(value, count, code) {
  const changes = value?.result?.changes ?? [];
  assertValue(changes.length === count, code, { expected: count, observed: changes.length });
  for (const change of changes) assertVerifiedMutation(change, code);
}

function assertVerifiedMutation(change, code) {
  assertValue(
    change?.status === "applied"
      && change?.mutation?.status === "completed"
      && change?.live_readback?.status === "passed"
      && ["completed", "skipped"].includes(change?.index_maintenance?.status),
    code,
    change,
  );
}

function assertChangeTargets(value, expectedRefs, code) {
  const observed = value?.result?.changes?.map((change) => change.target_ref).sort() ?? [];
  assertValue(JSON.stringify(observed) === JSON.stringify([...expectedRefs].sort()), code, { expected: expectedRefs, observed });
}

async function assertInstalledHandshake(context, clientName, stepId) {
  const value = await callJson(context, clientName, stepId, "ping", {});
  const macroIds = value?.product_surface?.agent_context_macro_guide?.macro_menu?.macro_ids;
  assertValue(
    Array.isArray(macroIds) && macroIds.length === 15 && new Set(macroIds).size === 15 && macroIds.every((id) => String(id).startsWith("macro.")),
    "INSTALLED_MACRO_MENU_INVALID",
    { macro_ids: macroIds ?? null },
  );
}

function assertExactRef(ref, prefix, code) {
  assertValue(typeof ref === "string" && ref.startsWith(prefix), code, { ref });
}

function takeObjectRef(ref) {
  const match = /^take:guid:(.+)$/u.exec(ref);
  assertValue(match, "TAKE_REF_INVALID", { ref });
  return { kind: "take", ref, identity: { scheme: "guid", value: match[1] } };
}

function fxObjectRef(ref) {
  const match = /^fx:(track|take):guid:(.+):(\d+)$/u.exec(ref);
  assertValue(match, "FX_REF_INVALID", { ref });
  return { kind: "fx", ref, identity: { scheme: `${match[1]}_fx`, value: `${match[1]}:guid:${match[2]}:${match[3]}` } };
}

export async function walkProjectQuery(context, clientName, input) {
  assertValue(Number.isInteger(input.limit) && input.limit > 0 && input.limit <= 100, "PUBLIC_PAGE_LIMIT_INVALID", { limit: input.limit });
  const rows = [];
  let cursor;
  do {
    const value = await callTemplate(context, clientName, `query-${input.entity}-page-${rows.length}`, {
      id: "macro.project.query",
      input: { ...input, ...(cursor ? { cursor } : {}), refresh_policy: cursor ? "never" : input.refresh_policy },
    });
    rows.push(...(value?.result?.data?.rows ?? []));
    const page = value?.result?.data?.page ?? {};
    cursor = page.has_more ? page.next_cursor : null;
    assertValue(page.has_more !== true || (typeof cursor === "string" && cursor.length > 0), "PUBLIC_CURSOR_MISSING", page);
  } while (cursor);
  return rows;
}

async function connectScenarioClients(context, scenario) {
  context.scenario = scenario;
  context.clients.primary = await context.connectFactory({ installedWrapper: context.installedWrapper, scenario, clientName: "primary" });
  context.clients.secondary = await context.connectFactory({ installedWrapper: context.installedWrapper, scenario, clientName: "secondary" });
}

async function closeScenarioClients(context) {
  for (const name of ["primary", "secondary"]) {
    await context.clients[name]?.close?.().catch(() => {});
    context.clients[name] = null;
  }
}

async function reconnectClient(context, clientName) {
  await context.clients[clientName]?.close?.();
  context.clients[clientName] = await context.connectFactory({ installedWrapper: context.installedWrapper, scenario: context.scenario, clientName });
  context.recoveries.push({ kind: "installed_wrapper_reconnect", client: clientName });
}

async function previewThenExecute(context, clientName, stepId, request) {
  const preview = await callTemplate(context, clientName, `${stepId}-preview`, {
    ...request,
    input: { ...request.input, dry_run: true },
  });
  assertValue(preview?.execution?.status === "dry_run_completed", "WRITE_PREVIEW_FAILED", { step_id: stepId, status: preview?.execution?.status });
  const retry = preview?.result?.data?.executable_retry;
  const executable = retry?.id
    ? { id: retry.id, input: retry.input, ...(retry.refs ? { refs: retry.refs } : request.refs ? { refs: request.refs } : {}), ...(request.budget ? { budget: request.budget } : {}) }
    : { ...request, input: { ...request.input, dry_run: false } };
  context.recoveries.push({ kind: "preview_execute", step_id: stepId, used_executable_retry: Boolean(retry?.id) });
  return callTemplate(context, clientName, `${stepId}-execute`, executable);
}

async function callTemplate(context, clientName, stepId, request) {
  return callJson(context, clientName, stepId, "call_template", {
    id: request.id,
    input: request.input,
    ...(request.refs ? { refs: request.refs } : {}),
    budget: request.budget ?? NORMAL_BUDGET,
  });
}

async function callJson(context, clientName, stepId, tool, args) {
  const started = performance.now();
  const call = {
    ordinal: context.calls.length + 1,
    scenario: context.scenario,
    client: clientName,
    step_id: stepId,
    tool,
    requested_id: args.id ?? null,
    request: args,
    request_budget: args.budget ?? null,
    duration_ms: null,
    response_bytes: 0,
    actual_bytes: null,
    truncated: null,
    artifact_fallback: null,
    artifacts: [],
    internal_count: null,
    public_count: null,
    pre_mutation_evidence_fit: null,
    verification_duties: [],
    macro_first: String(args.id ?? "").startsWith("macro."),
    template_fallback: String(args.id ?? "").startsWith("template."),
    fallback_reason: String(args.id ?? "").startsWith("template.") ? "Bounded direct readback with no public Macro equivalent." : null,
    rendered_outputs: [],
    ok: false,
    error: null,
    value: null,
  };
  try {
    const client = context.clients[clientName];
    assertValue(client, "CLIENT_NOT_CONNECTED", { client: clientName });
    const response = await client.callTool(
      { name: tool, arguments: args },
      undefined,
      { timeout: CALL_TIMEOUT_MS, maxTotalTimeout: MAX_TOTAL_TIMEOUT_MS },
    );
    const text = response?.content?.find((entry) => entry.type === "text")?.text;
    if (typeof text !== "string") throw new Error(`${tool} returned no JSON text.`);
    const value = JSON.parse(text);
    call.value = value;
    call.response_bytes = Buffer.byteLength(text, "utf8");
    call.actual_bytes = value?.budget?.actual_bytes ?? value?.budget?.response_bytes ?? call.response_bytes;
    call.truncated = findTruncation(value);
    call.artifact_fallback = findArtifactFallback(value);
    call.artifacts = findArtifacts(value) ?? [];
    call.internal_count = findInternalCount(value);
    call.public_count = findPublicCount(value);
    call.pre_mutation_evidence_fit = findPreMutationFit(value);
    call.ok = value?.ok === true;
    if (!call.ok && !call.error) call.error = value?.error ?? { code: "TRIAL_STEP_FAILED", blockers: value?.blockers ?? [] };
    if (!call.ok) throw Object.assign(new Error(`${stepId} failed`), { cause: call.error });
    return value;
  } catch (error) {
    if (!call.error) call.error = { name: error?.name ?? "Error", message: error?.message ?? String(error), cause: error?.cause ?? null };
    context.failures.push(call);
    throw error;
  } finally {
    call.duration_ms = Math.round(performance.now() - started);
    context.calls.push(call);
  }
}

function assertValue(condition, code, details = null) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

export async function verifyRenderedOutput({ absolutePath, requestedFormat, requestedMp3BitrateKbps = null, managedRenderRoot }) {
  const absoluteOutput = typeof absolutePath === "string" && path.isAbsolute(absolutePath);
  const absoluteRoot = typeof managedRenderRoot === "string" && path.isAbsolute(managedRenderRoot);
  const resolved = absoluteOutput ? path.resolve(absolutePath) : "";
  const managed = absoluteRoot ? path.resolve(managedRenderRoot) : "";
  const relative = absoluteOutput && absoluteRoot ? path.relative(managed, resolved) : "";
  const underManagedRoot = Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  const bytes = underManagedRoot ? await readFile(resolved).catch(() => null) : null;
  const info = bytes ? await stat(resolved).catch(() => null) : null;
  const detected = bytes ? detectAudioContainer(bytes) : null;
  const actualMp3BitrateKbps = bytes && detected === "mp3" ? detectMp3BitrateKbps(bytes) : null;
  const extension = path.extname(resolved).slice(1).toLowerCase();
  const bitrateMatches = requestedFormat !== "mp3" || requestedMp3BitrateKbps === actualMp3BitrateKbps;
  return {
    ok: Boolean(bytes && info?.size > 0 && underManagedRoot && detected === requestedFormat && extension === requestedFormat && bitrateMatches),
    requested_format: requestedFormat,
    actual_format: detected,
    actual_extension: extension,
    detected_header_container: detected,
    byte_size: info?.size ?? 0,
    managed_absolute_path: underManagedRoot ? resolved : null,
    requested_mp3_bitrate_kbps: requestedMp3BitrateKbps,
    actual_mp3_bitrate_kbps: actualMp3BitrateKbps,
  };
}

export function detectAudioContainer(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) return null;
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "wav";
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (findMp3Frame(bytes) !== null) return "mp3";
  return null;
}

export function detectMp3BitrateKbps(bytes) {
  const offset = findMp3Frame(bytes);
  if (offset === null) return null;
  const byte1 = bytes[offset + 1];
  const byte2 = bytes[offset + 2];
  const versionBits = (byte1 >> 3) & 0b11;
  const layerBits = (byte1 >> 1) & 0b11;
  const bitrateIndex = (byte2 >> 4) & 0b1111;
  if (bitrateIndex === 0 || bitrateIndex === 15 || layerBits === 0) return null;
  const version1 = versionBits === 0b11;
  const table = version1
    ? layerBits === 0b11
      ? [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
      : layerBits === 0b10
        ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
        : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : layerBits === 0b11
      ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  return table[bitrateIndex] ?? null;
}

function findMp3Frame(bytes) {
  let start = 0;
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === "ID3") {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    start = 10 + size;
  }
  for (let offset = start; offset + 3 < bytes.length; offset += 1) {
    if (isValidMp3FrameHeader(bytes, offset)) return offset;
  }
  return null;
}

function isValidMp3FrameHeader(bytes, offset) {
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
  const versionBits = (bytes[offset + 1] >> 3) & 0b11;
  const layerBits = (bytes[offset + 1] >> 1) & 0b11;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0b1111;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0b11;
  return versionBits !== 0b01 && layerBits !== 0 && bitrateIndex !== 0 && bitrateIndex !== 15 && sampleRateIndex !== 0b11;
}

function createBaseReport({ scenarios, mode, installedWrapper, status, unimplemented, manifests }) {
  return {
    contract: "openreaper.alpha3.3.installed_production_trial_report.v1",
    generated_at: new Date().toISOString(),
    ok: false,
    status,
    outcome: status,
    mode,
    scenarios,
    provenance: {
      runtime: "installed_wrapper_only",
      installed_wrapper: installedWrapper,
      installed_wrapper_sha256: null,
    },
    duration_ms: 0,
    response_bytes: { total: 0, maximum_single_call: 0 },
    budget_accounting: {
      ladder: PUBLIC_BUDGET_LADDER,
      calls: [],
      required_fields: ["request_budget", "actual_bytes", "truncated", "artifact_fallback", "internal_count", "public_count", "pre_mutation_evidence_fit"],
    },
    truncation: [],
    artifacts: [],
    calls: [],
    failed_calls: [],
    retries: [],
    ineffective_retries: [],
    macro_first: { count: 0, total_template_calls: 0, rate: 0 },
    template_fallbacks: [],
    project_changes: [],
    rendered_outputs: [],
    backup_recovery_posture: {
      source_project_unchanged: null,
      recovery_copy: null,
      evidence_project: null,
      source_media_preserved: null,
    },
    unimplemented_steps: unimplemented,
    manifest_summary: manifests.map((manifest) => ({
      scenario: manifest.scenario,
      execution_policy: manifest.execution_policy,
      step_count: manifest.steps.length,
      implemented_step_count: manifest.steps.filter((candidate) => candidate.implementation_status === IMPLEMENTED).length,
      unimplemented_step_count: 0,
    })),
  };
}

function updateReportAccounting(report, call) {
  report.response_bytes.total += call.response_bytes;
  report.response_bytes.maximum_single_call = Math.max(report.response_bytes.maximum_single_call, call.response_bytes);
  report.budget_accounting.calls.push({
    scenario: call.scenario,
    step_id: call.step_id,
    request_budget: call.request_budget,
    actual_bytes: call.actual_bytes,
    truncated: call.truncated,
    artifact_fallback: call.artifact_fallback,
    internal_count: call.internal_count,
    public_count: call.public_count,
    pre_mutation_evidence_fit: call.pre_mutation_evidence_fit,
  });
  if (call.truncated === true) report.truncation.push({ scenario: call.scenario, step_id: call.step_id });
  if (call.artifacts.length > 0) report.artifacts.push(...call.artifacts);
  if (call.macro_first) report.macro_first.count += 1;
  if (call.requested_id) report.macro_first.total_template_calls += 1;
  report.macro_first.rate = report.macro_first.total_template_calls === 0 ? 0 : report.macro_first.count / report.macro_first.total_template_calls;
  if (call.template_fallback) report.template_fallbacks.push({ scenario: call.scenario, step_id: call.step_id, template_id: call.requested_id, reason: call.fallback_reason });
  report.rendered_outputs.push(...call.rendered_outputs);
}

function selectManifests(scenarios) {
  const names = scenarios?.length ? scenarios : Object.keys(SCENARIO_MANIFESTS);
  return names.map((name) => {
    const manifest = SCENARIO_MANIFESTS[name];
    if (!manifest) throw new Error(`Unknown scenario: ${name}`);
    return manifest;
  });
}

function validateBudget(budget, label, errors) {
  if (!budget || !Number.isInteger(budget.max_response_bytes) || budget.max_response_bytes < MINIMUM_BUDGET.max_response_bytes || budget.max_response_bytes > NORMAL_BUDGET.max_response_bytes) {
    errors.push(`${label}.max_response_bytes must be between 2048 and 65536.`);
  }
  if (!Number.isInteger(budget?.max_items) || budget.max_items < MINIMUM_BUDGET.max_items || budget.max_items > LARGE_PROJECTION_BUDGET.max_items) errors.push(`${label}.max_items must be between 50 and 128.`);
  if (!Number.isInteger(budget?.max_inline_value_bytes) || budget.max_inline_value_bytes < MINIMUM_BUDGET.max_inline_value_bytes || budget.max_inline_value_bytes > LARGE_PROJECTION_BUDGET.max_inline_value_bytes) errors.push(`${label}.max_inline_value_bytes must be between 2048 and 24576.`);
}

function assertAbsoluteInstalledWrapper(installedWrapper) {
  if (typeof installedWrapper !== "string" || !path.isAbsolute(installedWrapper)) {
    throw new Error("Actual execution requires an absolute installed openreaper-mcp wrapper path.");
  }
}

function assertAbsolutePaths(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !path.isAbsolute(value))) {
    throw new Error(`Actual execution requires every ${label} entry to be an absolute path.`);
  }
}

function findTruncation(value) {
  return value?.truncated ?? value?.result?.summary?.truncated ?? value?.result?.data?.coverage?.truncated ?? false;
}

function findArtifactFallback(value) {
  const fallback = value?.budget?.artifact_fallback ?? value?.result?.data?.artifact_fallback;
  return typeof fallback === "boolean" ? fallback : null;
}

function findArtifacts(value) {
  const refs = value?.result?.artifact_refs ?? value?.result?.data?.artifact_refs ?? value?.artifacts ?? [];
  return Array.isArray(refs) && refs.length > 0 ? refs : null;
}

function findInternalCount(value) {
  return value?.result?.data?.coverage?.known_total_row_count ?? value?.result?.summary?.total_count ?? value?.result?.data?.refresh?.logical_refresh?.row_counts ?? null;
}

function findPublicCount(value) {
  return value?.result?.data?.rows?.length ?? value?.result?.changes?.length ?? value?.result?.summary?.returned_count ?? null;
}

function findPreMutationFit(value) {
  if (value?.error?.code === "MEDIA_RESPONSE_BUDGET_EXCEEDED") return false;
  const fit = value?.budget?.pre_mutation_evidence_fit ?? value?.result?.data?.pre_mutation_evidence_fit;
  return typeof fit === "boolean" ? fit : null;
}

function ascii(bytes, start, end) {
  return Buffer.from(bytes).subarray(start, end).toString("ascii");
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
