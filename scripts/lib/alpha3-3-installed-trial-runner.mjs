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
  "expected_failures",
  "retries",
  "ineffective_retries",
  "performance_measurements",
  "capability_results",
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

export function editingLayoutRows(count = 64) {
  return Array.from({ length: count }, (_, index) => ({
    id: `editing_track_${String(index + 1).padStart(3, "0")}`,
    kind: index % 16 === 0 ? "folder" : "track",
    name: index === count - 1 ? "EDITING-DEEP-EXACT-064" : `Editing ${String(index + 1).padStart(3, "0")}`,
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

const EDITING_SFX_STEPS = [
  step({
    id: "editing-installed-product-handshake",
    prompt: "Open my editing project and make sure the OpenReaper connection is actually usable.",
    tool: "ping",
    input: {},
    verification: ["Both installed-wrapper clients answer.", "The visible product surface contains exactly fifteen Macros."],
    coverage: ["installed-wrapper", "ordinary-vague-prompt", "two-clients"],
  }),
  step({
    id: "editing-64-track-project",
    prompt: "Make this a fairly big nested editing session with about sixty-four tracks.",
    templateId: "macro.project.apply_layout",
    input: { layout: editingLayoutRows(64), match_policy: "create_only", conflict_policy: "stop", dry_run: false },
    limits: { batch_size: 16, expected_total_tracks_at_least: 64 },
    verification: ["Every Track and Folder row has exact live readback.", "The last Track resolves from a compact exact-name query."],
    coverage: ["60-plus-tracks", "nested-folders", "large-project-read-write"],
  }),
  step({
    id: "editing-recursive-media-and-item-controls",
    prompt: "Bring in that whole folder twice, then make the clips quieter and put the active takes a little right, pitched up, and reversed.",
    templateId: "macro.media.place_assets",
    input: { assets: "${recursive_media_batches}", placement: { mode: "sequence_on_one_track" }, track_policy: "existing_track", track_ref: "${editing_media_track_ref}", dry_run: false },
    limits: { batch_size: MAX_MEDIA_ASSETS_PER_CALL, minimum_repetitions: 2 },
    verification: ["Recursive discovery is bounded to audio files and source hashes remain unchanged.", "Item volume and Active Take pan, pitch, and reverse read back exactly."],
    coverage: ["recursive-media", "repeated-import", "item-volume", "take-pan", "take-pitch", "reverse"],
  }),
  step({
    id: "editing-item-pan-recovery",
    prompt: "Pan this item right a bit.",
    templateId: "macro.items.apply",
    input: { mode: "set_properties", target_refs: ["${editing_item_ref}"], properties: { pan: 0.25 }, dry_run: false },
    verification: ["The unsupported Item-level field returns ITEM_APPLY_ITEM_PAN_UNSUPPORTED before mutation.", "Recovery uses macro.controls.set target_kind=take and verifies the same Active Take."],
    coverage: ["typed-blocker", "zero-mutation", "executable-recovery"],
  }),
  step({
    id: "editing-glue-pitch-freeze-local-render",
    prompt: "Glue that clip, draw some pitch movement, freeze and unfreeze its track, then render just that result.",
    templateId: "template.items.glue_item",
    input: {},
    refs: { item_ref: "${editing_item_object_ref}" },
    verification: ["Glue returns a replacement Item and Take with live identity truth.", "Take Pitch points, freeze/unfreeze counts, and explicit-Item WAV render all verify."],
    coverage: ["glue", "take-pitch-automation", "freeze", "unfreeze", "partial-render"],
    fallbackReason: "Glue, exact Take Pitch Envelope creation, and Track freeze are reviewed lifecycle atoms that currently have no equivalent public Macro highway.",
  }),
  step({
    id: "editing-take-fx-automation",
    prompt: "Put ReaEQ on the glued take and draw two parameter moves that really read back from that Take FX.",
    templateId: "template.fx.add_take_fx",
    refs: { take_ref: "${glued_take_ref}" },
    input: { plugin_name: "ReaEQ (Cockos)" },
    verification: ["The new FX ref is owned by the exact glued Take.", "Both Automation writes map the same native parameter and pass live readback."],
    coverage: ["take-fx", "take-fx-automation", "repeated-automation-edit"],
    fallbackReason: "Take-FX insertion is a reviewed lifecycle atom; the public Automation Macro owns the repeated parameter writes after exact FX resolution.",
  }),
  step({
    id: "editing-subproject-lifecycle",
    prompt: "Make a real child project for this edit, put it on the requested track, update it, and prove the parent project came back intact.",
    templateId: "template.project.create_subproject",
    input: { name: "${unique_subproject_name}", activate: true, inherit_time_selection: false },
    verification: ["A real child RPP and RPP-PROX exist.", "The inserted Item resolves on the exact Track and points at that child.", "Synchronous update completes and restores the parent project."],
    coverage: ["subproject-create", "subproject-insert", "subproject-update", "parent-restore", "file-evidence"],
    fallbackReason: "Subproject creation, insertion, and synchronous update are reviewed native lifecycle atoms with no equivalent public Macro highway.",
  }),
  step({
    id: "editing-complete-routing-graph",
    prompt: "Wire this big edit session into a useful internal chain and show me the whole routing graph.",
    templateId: "macro.routing.apply",
    input: { routes: "${editing_route_rows}", dry_run: false },
    limits: { batch_size: 64, expected_edges_at_least: 60 },
    verification: ["Every route row has live readback.", "macro.project.query returns the complete 60+ edge graph without a small-project cap."],
    coverage: ["large-routing", "complete-graph", "public-pagination"],
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
  "editing-sfx": {
    contract: "openreaper.alpha3.3.installed_trial_manifest.v1",
    scenario: "editing-sfx",
    purpose: "Large editing/SFX workflow with recursive import, Item/Take lifecycle, Automation, Routing, freeze, and local render.",
    execution_policy: "strict_serial",
    required_product: "absolute_installed_openreaper_mcp_wrapper",
    report_accounting_fields: REPORT_ACCOUNTING_FIELDS,
    steps: EDITING_SFX_STEPS,
  },
  "mixing-delivery": {
    contract: "openreaper.alpha3.3.installed_trial_manifest.v1",
    scenario: "mixing-delivery",
    purpose: "Real source-to-bus mix with Marker/Region batches, stock and exact third-party FX, Automation, and WAV/OGG/MP3 delivery.",
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
      else if (manifest.scenario === "editing-sfx") await runEditingSfx(context);
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
  report.expected_failures = context.expectedFailures;
  report.retries = context.recoveries;
  report.ineffective_retries = context.ineffective_retries;
  report.performance_measurements = context.performanceMeasurements;
  report.capability_results = context.capabilityResults;
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
    expectedFailures: [],
    recoveries: [],
    ineffective_retries: [],
    performanceMeasurements: [],
    capabilityResults: [],
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
  const minimumLayoutRows = rows.slice(0, 32);
  const blockedLayout = await callExpectedFailure(context, "primary", "layout-minimum-budget-blocker", {
    id: "macro.project.apply_layout",
    input: { layout: minimumLayoutRows, match_policy: "create_only", conflict_policy: "stop", dry_run: false },
    budget: MINIMUM_BUDGET,
  }, ["PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED"]);
  assertValue((blockedLayout?.result?.changes?.length ?? 0) === 0, "MINIMUM_BUDGET_LAYOUT_MUTATED", blockedLayout?.result);
  const absentAfterBlock = await measure(context, "large.minimum_budget_zero_mutation_query", () => walkProjectQuery(context, "secondary", {
    entity: "tracks",
    fields: ["ref", "name", "index"],
    limit: 100,
    refresh_policy: "force_read_only_refresh",
  }));
  const blockedNames = new Set(minimumLayoutRows.map((row) => row.name));
  assertValue(absentAfterBlock.every((row) => !blockedNames.has(row.name)), "MINIMUM_BUDGET_LAYOUT_LEFT_TRACKS", { rows: absentAfterBlock.filter((row) => blockedNames.has(row.name)) });
  context.recoveries.push({ kind: "typed_budget_recovery", step_id: "layout-minimum-budget-blocker", blocker_code: "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED", replay_safe: true, zero_mutation_proven: true });

  const layoutBatches = [minimumLayoutRows];
  for (let offset = minimumLayoutRows.length; offset < rows.length; offset += 12) layoutBatches.push(rows.slice(offset, offset + 12));
  for (const [batchIndex, batch] of layoutBatches.entries()) {
    const value = await previewThenExecute(context, "primary", `layout-${batchIndex + 1}`, {
      id: "macro.project.apply_layout",
      input: { layout: batch, match_policy: "create_only", conflict_policy: "stop" },
    });
    const changes = value?.result?.changes ?? [];
    assertValue(changes.length === batch.length, "LAYOUT_BATCH_ROW_COUNT_MISMATCH", { batch_index: batchIndex, expected: batch.length, observed: changes.length });
    for (const change of changes) {
      assertVerifiedMutation(change, "LAYOUT_ROW_NOT_VERIFIED");
      assertExactRef(change?.target_ref, "track:", "LAYOUT_TRACK_REF_MISSING");
      context.refs.set(change.operation_id, change.target_ref);
    }
  }

  const tracks = await measure(context, "large.cold_full_track_read", () => walkProjectQuery(context, "secondary", {
    entity: "tracks",
    fields: ["ref", "name", "index"],
    limit: 100,
    refresh_policy: "force_read_only_refresh",
  }));
  const createdRefs = new Set([...context.refs.values()]);
  assertValue(tracks.filter((row) => createdRefs.has(row.ref)).length === 104, "LAYOUT_TRACKS_MISSING_FROM_CURSOR_QUERY", {
    expected: 104,
    observed: tracks.filter((row) => createdRefs.has(row.ref)).length,
  });
  const last = tracks.filter((row) => row.name === "PRODUCTION-DEEP-EXACT-104");
  assertValue(last.length === 1 && last[0].index === 103, "DEEP_TRACK_QUERY_MISMATCH", { observed: last });
  const exactLast = await measure(context, "large.warm_last_track_exact_lookup", () => callTemplate(context, "secondary", "query-last-track-exact-name", {
    id: "macro.project.query",
    input: {
      entity: "tracks",
      fields: ["ref", "name", "index"],
      filters: { name: "PRODUCTION-DEEP-EXACT-104" },
      limit: 1,
      refresh_policy: "never",
    },
    budget: MINIMUM_BUDGET,
  }));
  assertValue(
    exactLast?.result?.data?.rows?.length === 1
      && exactLast.result.data.rows[0].ref === last[0].ref
      && exactLast.result.data.rows[0].index === 103,
    "DEEP_TRACK_EXACT_NAME_QUERY_MISMATCH",
    exactLast?.result?.data,
  );
  context.refs.set("production_last_track", last[0].ref);
  for (const [rung, budget] of PUBLIC_BUDGET_LADDER.map((entry) => [entry.rung, entry.budget])) {
    const value = await measure(context, `large.budget_ladder.${rung}`, () => callTemplate(context, "secondary", `query-last-track-${rung}`, {
      id: "macro.project.query",
      input: { entity: "tracks", fields: ["ref", "name", "index"], filters: { name: "PRODUCTION-DEEP-EXACT-104" }, limit: 1, refresh_policy: rung === "large_projection" ? "force_read_only_refresh" : "never" },
      budget,
    }));
    assertValue(value?.result?.data?.rows?.[0]?.ref === last[0].ref, "BUDGET_LADDER_EXACT_LOOKUP_MISMATCH", { rung, data: value?.result?.data });
  }

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

  const expectedSysexBodies = [[0x7d, 0x10, 0x01], [0x7d, 0x10, 0x02]];
  for (let pass = 0; pass < 2; pass += 1) {
    const textWrite = await callTemplate(context, "primary", `dense-text-sysex-pass-${pass + 1}`, {
      id: "template.midi.insert_text_sysex_events",
      input: {
        position_unit: "ppq",
        sort_events: true,
        events: [
          { ppq: pass * 960, event_kind: "lyric", text: pass === 0 ? "verse" : "chorus" },
          {
            ppq: pass * 960 + 240,
            event_kind: "sysex",
            bytes: pass === 0 ? "F0 7D 10 01 F7" : [0xf0, 0x7d, 0x10, 0x02, 0xf7],
          },
        ],
      },
      refs: { take_ref: takeObjectRef(denseMidi.takeRef) },
    });
    const summary = textWrite?.result?.summary ?? {};
    assertValue(
      textWrite?.ok === true
        && summary.inserted_count === 2
        && summary.verified_text_sysex_count === 2
        && summary.verified_by_kind?.lyric === 1
        && summary.verified_by_kind?.sysex === 1
        && summary.verification_mode === "exact_row_multiset_delta",
      "MIDI_TEXT_SYSEX_WRITE_FAILED",
      summary,
    );
  }

  const notes = await walkMidiEvents(context, "template.midi.list_take_notes", denseMidi.takeRef, "notes");
  const ccEvents = await walkMidiEvents(context, "template.midi.list_take_cc_events", denseMidi.takeRef, "cc_events");
  const textEvents = await walkMidiEvents(context, "template.midi.list_take_text_sysex_events", denseMidi.takeRef, "events");
  assertValue(notes.length === 128, "MIDI_NOTE_CURSOR_COUNT_MISMATCH", { observed: notes.length });
  assertValue(ccEvents.length === 64, "MIDI_CC_CURSOR_COUNT_MISMATCH", { observed: ccEvents.length });
  assertValue(textEvents.length === 4, "MIDI_TEXT_CURSOR_COUNT_MISMATCH", { observed: textEvents.length });
  const sysexBodies = textEvents.filter((event) => event.event_kind === "sysex").map((event) => midiTextBytes(event.text));
  assertValue(JSON.stringify(sysexBodies) === JSON.stringify(expectedSysexBodies), "MIDI_SYSEX_BINARY_READBACK_MISMATCH", { expected: expectedSysexBodies, observed: sysexBodies });

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
  await writeTrackAutomationPasses(context, automationTrackRef, "production");

  await measure(context, "large.post_write_last_track_lookup", () => callTemplate(context, "secondary", "query-last-track-post-write", {
    id: "macro.project.query",
    input: { entity: "tracks", fields: ["ref", "name", "index"], filters: { name: "PRODUCTION-DEEP-EXACT-104" }, limit: 1, refresh_policy: "if_stale" },
    budget: MINIMUM_BUDGET,
  }));

  await renderVerifiedWav(context, "large-production");
  await saveAndReconnect(context, "large-production");
  await finalizeRecoveryPosture(context);
  return context;
}

export async function runEditingSfx(context) {
  await assertInstalledHandshake(context, "primary", "editing-installed-product-handshake");
  await assertInstalledHandshake(context, "secondary", "editing-secondary-client-handshake");

  const mediaFiles = await discoverMediaFiles(context.mediaRoots, context.mediaAssets);
  assertValue(mediaFiles.length > 0, "EDITING_MEDIA_REQUIRED", { media_roots: context.mediaRoots, media_assets: context.mediaAssets });
  for (const file of mediaFiles) context.media_hashes[file] = await sha256(file);

  const save = await previewThenExecute(context, "primary", "editing-save-evidence-project", {
    id: "macro.project.file",
    input: { operation: "save_as", target_path: context.evidenceProject, overwrite: true },
  });
  assertValue(save?.result?.data?.path_after === context.evidenceProject, "EDITING_SAVE_AS_PATH_MISMATCH", save?.result?.data);

  const rows = editingLayoutRows(64);
  for (let offset = 0; offset < rows.length; offset += 16) {
    const batch = rows.slice(offset, offset + 16);
    const value = await previewThenExecute(context, "primary", `editing-layout-${offset / 16 + 1}`, {
      id: "macro.project.apply_layout",
      input: { layout: batch, match_policy: "create_only", conflict_policy: "stop" },
    });
    assertVerifiedChanges(value, batch.length, "EDITING_LAYOUT_NOT_VERIFIED");
    for (const change of value.result.changes) context.refs.set(change.operation_id, change.target_ref);
  }

  const tracks = await measure(context, "editing.cold_full_track_read", () => walkProjectQuery(context, "secondary", {
    entity: "tracks",
    fields: ["ref", "name", "index"],
    limit: 100,
    refresh_policy: "force_read_only_refresh",
  }));
  assertValue(tracks.filter((row) => row.name?.startsWith("Editing ") || row.name === "EDITING-DEEP-EXACT-064").length === 64, "EDITING_TRACK_COVERAGE_INCOMPLETE", { count: tracks.length });
  const lastTrack = tracks.find((row) => row.name === "EDITING-DEEP-EXACT-064");
  assertExactRef(lastTrack?.ref, "track:", "EDITING_LAST_TRACK_MISSING");

  const mediaTrackRef = context.refs.get("editing_track_002");
  const itemRefs = [];
  const takeRefs = [];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let offset = 0; offset < 16; offset += MAX_MEDIA_ASSETS_PER_CALL) {
      const assets = Array.from({ length: MAX_MEDIA_ASSETS_PER_CALL }, (_, index) => ({
        id: `editing_media_${pass + 1}_${offset + index + 1}`,
        path: mediaFiles[(offset + index) % mediaFiles.length],
      }));
      const value = await callTemplate(context, "primary", `editing-media-${pass + 1}-${offset / MAX_MEDIA_ASSETS_PER_CALL + 1}`, {
        id: "macro.media.place_assets",
        input: {
          assets,
          placement: { mode: "sequence_on_one_track", start_seconds: pass * 180 + offset * 2, gap_seconds: 0.1 },
          track_policy: "existing_track",
          track_ref: mediaTrackRef,
          dry_run: false,
        },
      });
      assertVerifiedChanges(value, assets.length, "EDITING_MEDIA_NOT_VERIFIED");
      for (const change of value.result.changes) {
        assertExactRef(change.live_readback?.item_ref, "item:", "EDITING_ITEM_REF_MISSING");
        assertExactRef(change.live_readback?.take_ref, "take:", "EDITING_TAKE_REF_MISSING");
        itemRefs.push(change.live_readback.item_ref);
        takeRefs.push(change.live_readback.take_ref);
      }
    }
  }

  const controlledItems = itemRefs.slice(0, 8);
  for (const [pass, volumeDb] of [-6, -3].entries()) {
    const volume = await previewThenExecute(context, "primary", `editing-item-volume-${pass + 1}`, {
      id: "macro.items.apply",
      input: { mode: "set_properties", target_refs: controlledItems, properties: { volume_db: volumeDb } },
    });
    assertVerifiedChanges(volume, controlledItems.length, "EDITING_ITEM_VOLUME_NOT_VERIFIED");
  }

  const beforeBlockedPan = await queryExactItems(context, controlledItems.slice(0, 1), "editing-item-pan-before");
  const blockedPan = await callExpectedFailure(context, "primary", "editing-item-pan-blocked", {
    id: "macro.items.apply",
    input: { mode: "set_properties", target_refs: controlledItems.slice(0, 1), properties: { pan: 0.25 }, dry_run: false },
  }, ["ITEM_APPLY_ITEM_PAN_UNSUPPORTED"]);
  assertValue((blockedPan?.result?.changes?.length ?? 0) === 0, "EDITING_ITEM_PAN_BLOCK_MUTATED", blockedPan?.result);
  const afterBlockedPan = await queryExactItems(context, controlledItems.slice(0, 1), "editing-item-pan-after");
  assertValue(JSON.stringify(beforeBlockedPan) === JSON.stringify(afterBlockedPan), "EDITING_ITEM_PAN_BLOCK_CHANGED_ITEM", { beforeBlockedPan, afterBlockedPan });

  for (let pass = 0; pass < 2; pass += 1) {
    const takeControls = await previewThenExecute(context, "primary", `editing-take-controls-${pass + 1}`, {
      id: "macro.controls.set",
      refs: { item_ref: controlledItems[0] },
      input: {
        target_kind: "take",
        fields: { pan: pass === 0 ? 0.25 : -0.15, pitch_semitones: pass === 0 ? 3 : -2, reverse: pass === 0 },
      },
    });
    assertValue((takeControls?.result?.changes ?? []).length === 3, "EDITING_TAKE_CONTROL_ROW_COUNT_MISMATCH", takeControls?.result);
    for (const change of takeControls.result.changes) assertVerifiedMutation(change, "EDITING_TAKE_CONTROL_NOT_VERIFIED");
  }
  context.recoveries.push({ kind: "typed_field_recovery", blocker_code: "ITEM_APPLY_ITEM_PAN_UNSUPPORTED", recovery_macro: "macro.controls.set", target_kind: "take", exact_item_ref: controlledItems[0] });

  const glue = await callTemplate(context, "primary", "editing-glue-item", {
    id: "template.items.glue_item",
    input: {},
    refs: { item_ref: objectRef("item", controlledItems[0]) },
  });
  const glueSummary = glue?.result?.summary ?? {};
  assertValue(glueSummary.source_item_ref === controlledItems[0] && glueSummary.old_item_guid_absent === true && glueSummary.new_item_unique === true, "EDITING_GLUE_IDENTITY_MISMATCH", glueSummary);
  assertExactRef(glueSummary.glued_item_ref, "item:", "EDITING_GLUED_ITEM_REF_MISSING");
  assertExactRef(glueSummary.glued_take_ref, "take:", "EDITING_GLUED_TAKE_REF_MISSING");

  const pitchEnsure = await callTemplate(context, "primary", "editing-pitch-envelope-ensure", {
    id: "template.automation.ensure_take_pitch_envelope",
    input: {},
    refs: { take_ref: objectRef("take", glueSummary.glued_take_ref) },
  });
  const pitchEnvelopeRef = pitchEnsure?.result?.summary?.envelope_ref;
  assertExactRef(pitchEnvelopeRef, "envelope:", "EDITING_PITCH_ENVELOPE_REF_MISSING");
  const pitchPoints = [
    { time_seconds: 0, value: 0, shape: 0, tension: 0, selected: false },
    { time_seconds: 0.25, value: 3, shape: 0, tension: 0, selected: false },
    { time_seconds: 0.5, value: -2, shape: 0, tension: 0, selected: false },
  ];
  const pitchWrite = await callTemplate(context, "primary", "editing-pitch-envelope-points", {
    id: "template.automation.insert_envelope_points_batch",
    input: { points: pitchPoints },
    refs: { envelope_ref: objectRef("envelope", pitchEnvelopeRef) },
  });
  assertValue(pitchWrite?.result?.summary?.inserted_count === pitchPoints.length, "EDITING_PITCH_POINT_COUNT_MISMATCH", pitchWrite?.result?.summary);
  const pitchRead = await callTemplate(context, "secondary", "editing-pitch-envelope-read", {
    id: "template.automation.read_envelope_points",
    input: { autoitem_index: -1, start_seconds: 0, end_seconds: 1, limit: 16 },
    refs: { envelope_ref: objectRef("envelope", pitchEnvelopeRef) },
  });
  assertValue(pitchRead?.result?.summary?.truncated === false && (pitchRead?.result?.summary?.points?.length ?? 0) >= pitchPoints.length, "EDITING_PITCH_READBACK_INCOMPLETE", pitchRead?.result?.summary);

  const takeFx = await callTemplate(context, "primary", "editing-add-take-reaeq", {
    id: "template.fx.add_take_fx",
    input: { plugin_name: "ReaEQ (Cockos)" },
    refs: { take_ref: takeObjectRef(glueSummary.glued_take_ref) },
  });
  const takeFxSummary = takeFx?.result?.summary ?? {};
  assertValue(takeFxSummary.created === true && takeFxSummary.owner_kind === "take", "EDITING_TAKE_FX_CREATE_NOT_VERIFIED", takeFxSummary);
  assertExactRef(takeFxSummary.fx_ref, `fx:${glueSummary.glued_take_ref}:`, "EDITING_TAKE_FX_REF_MISSING");
  const takeFxParamIdent = await readFxParameterIdent(context, takeFxSummary.fx_ref, "editing-take-reaeq-mapping");
  await writeFxAutomationPasses(context, takeFxSummary.fx_ref, takeFxParamIdent, "editing-take-fx", "take");
  context.capabilityResults.push({
    capability: "take_fx_parameter_automation",
    status: "passed",
    take_ref: glueSummary.glued_take_ref,
    fx_ref: takeFxSummary.fx_ref,
    param_ident: takeFxParamIdent,
    pass_count: 2,
  });

  await runSubprojectLifecycle(context, context.refs.get("editing_track_004"), "editing");

  await writeTrackAutomationPasses(context, context.refs.get("editing_track_003"), "editing");
  const freezeTrackRef = context.refs.get("editing_track_002");
  const frozen = await callTemplate(context, "primary", "editing-freeze-track", {
    id: "template.tracks.freeze_track",
    input: { mode: "stereo" },
    refs: { track_ref: objectRef("track", freezeTrackRef) },
  });
  assertValue(frozen?.result?.summary?.freeze_count_after > frozen?.result?.summary?.freeze_count_before, "EDITING_FREEZE_COUNT_NOT_INCREASED", frozen?.result?.summary);
  const unfrozen = await callTemplate(context, "primary", "editing-unfreeze-track", {
    id: "template.tracks.unfreeze_track",
    input: {},
    refs: { track_ref: objectRef("track", freezeTrackRef) },
  });
  assertValue(unfrozen?.result?.summary?.freeze_count_after < unfrozen?.result?.summary?.freeze_count_before, "EDITING_UNFREEZE_COUNT_NOT_DECREASED", unfrozen?.result?.summary);

  const routeRows = rows.slice(0, 63).map((row, index) => ({
    id: `editing_route_${index + 1}`,
    action: "create",
    source_track_ref: context.refs.get(row.id),
    destination_track_ref: context.refs.get(rows[index + 1].id),
    volume: 0.5,
    pan: 0,
    muted: false,
  }));
  const routing = await previewThenExecute(context, "primary", "editing-routing-graph", {
    id: "macro.routing.apply",
    input: { routes: routeRows },
    budget: LARGE_PROJECTION_BUDGET,
  });
  assertVerifiedChanges(routing, routeRows.length, "EDITING_ROUTING_NOT_VERIFIED");
  const routingRows = await measure(context, "editing.complete_routing_graph_read", () => walkProjectQuery(context, "secondary", {
    entity: "routing",
    fields: ["ref", "source_track_ref", "destination_track_ref", "send_index", "volume_db", "pan"],
    limit: 100,
    refresh_policy: "force_read_only_refresh",
  }));
  assertValue(routingRows.length >= routeRows.length, "EDITING_ROUTING_GRAPH_INCOMPLETE", { expected: routeRows.length, observed: routingRows.length });

  await renderVerifiedTarget(context, "editing-explicit-item", {
    targetKind: "explicit_items",
    itemRefs: [glueSummary.glued_item_ref],
    format: "wav",
  });
  await saveAndReconnect(context, "editing-sfx");
  await finalizeRecoveryPosture(context);
  return context;
}

export async function runMixingDelivery(context) {
  await assertInstalledHandshake(context, "primary", "mix-installed-product-handshake");
  await assertInstalledHandshake(context, "secondary", "mix-secondary-client-handshake");

  const mediaFiles = await discoverMediaFiles(context.mediaRoots, context.mediaAssets);
  assertValue(mediaFiles.length > 0, "MIX_MEDIA_REQUIRED", { media_roots: context.mediaRoots, media_assets: context.mediaAssets });
  for (const file of mediaFiles) context.media_hashes[file] = await sha256(file);

  const save = await previewThenExecute(context, "primary", "mix-save-evidence-project", {
    id: "macro.project.file",
    input: { operation: "save_as", target_path: context.evidenceProject, overwrite: true },
  });
  assertValue(save?.result?.data?.path_after === context.evidenceProject, "MIX_SAVE_AS_PATH_MISMATCH", save?.result?.data);

  const layout = [
    { id: "mix_sources", kind: "folder", name: "TRIAL SOURCES", index: 0, folder_depth: 1 },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `mix_source_${index + 1}`, kind: "track", name: `TRIAL SOURCE ${index + 1}`, index: index + 1, ...(index === 7 ? { folder_depth: -1 } : {}) })),
    { id: "mix_buses", kind: "folder", name: "TRIAL BUSES", index: 9, folder_depth: 1 },
    { id: "mix_music_bus", kind: "track", name: "TRIAL MUSIC BUS", index: 10 },
    { id: "mix_fx_bus", kind: "track", name: "TRIAL FX BUS", index: 11 },
    { id: "mix_master_bus", kind: "track", name: "TRIAL MIX BUS", index: 12, folder_depth: -1 },
    { id: "mix_prints", kind: "folder", name: "TRIAL PRINTS", index: 13, folder_depth: 1 },
    { id: "mix_print_a", kind: "track", name: "TRIAL PRINT A", index: 14 },
    { id: "mix_print_b", kind: "track", name: "TRIAL PRINT B", index: 15, folder_depth: -1 },
  ];
  const layoutValue = await previewThenExecute(context, "primary", "mix-production-layout", {
    id: "macro.project.apply_layout",
    input: { layout, match_policy: "create_only", conflict_policy: "stop" },
  });
  assertVerifiedChanges(layoutValue, layout.length, "MIX_LAYOUT_NOT_VERIFIED");
  const trackRefs = new Map(layoutValue.result.changes.map((row) => [row.operation_id, row.target_ref]));
  assertValue([...trackRefs.values()].every((ref) => typeof ref === "string" && ref.startsWith("track:")), "MIX_TRACK_REF_MISSING");

  const annotations = [
    { id: "mix_marker_intro", kind: "marker", name: "Intro", position_seconds: 0 },
    { id: "mix_marker_drop", kind: "marker", name: "Drop", position_seconds: 16 },
    { id: "mix_marker_outro", kind: "marker", name: "Outro", position_seconds: 32 },
    { id: "mix_region_intro", kind: "region", name: "Intro Region", start_seconds: 0, end_seconds: 8 },
    { id: "mix_region_body", kind: "region", name: "Body Region", start_seconds: 8, end_seconds: 32 },
    { id: "mix_region_outro", kind: "region", name: "Outro Region", start_seconds: 32, end_seconds: 40 },
  ];
  const annotationValue = await previewThenExecute(context, "primary", "mix-marker-region-batch", {
    id: "macro.project.apply_layout",
    input: { annotations },
  });
  assertVerifiedChanges(annotationValue, annotations.length, "MIX_ANNOTATIONS_NOT_VERIFIED");

  const mixAssets = Array.from({ length: 8 }, (_, index) => ({
    id: `mix_asset_${index + 1}`,
    path: mediaFiles[index % mediaFiles.length],
    track_ref: trackRefs.get(`mix_source_${index + 1}`),
  }));
  const placed = await callTemplate(context, "primary", "mix-place-source-assets", {
    id: "macro.media.place_assets",
    input: {
      assets: mixAssets,
      placement: { mode: "stack_on_separate_tracks", start_seconds: 0, gap_seconds: 0 },
      track_policy: "explicit_per_asset",
      dry_run: false,
    },
  });
  assertVerifiedChanges(placed, mixAssets.length, "MIX_MEDIA_NOT_VERIFIED");

  const routeRows = Array.from({ length: 8 }, (_, index) => ({
    id: `mix_source_route_${index + 1}`,
    action: "create",
    source_track_ref: trackRefs.get(`mix_source_${index + 1}`),
    destination_track_ref: trackRefs.get(index < 6 ? "mix_music_bus" : "mix_fx_bus"),
    volume: 0.75,
    pan: (index - 3.5) / 7,
    muted: false,
  }));
  routeRows.push(
    { id: "mix_music_to_master", action: "create", source_track_ref: trackRefs.get("mix_music_bus"), destination_track_ref: trackRefs.get("mix_master_bus"), volume: 1, pan: 0, muted: false },
    { id: "mix_fx_to_master", action: "create", source_track_ref: trackRefs.get("mix_fx_bus"), destination_track_ref: trackRefs.get("mix_master_bus"), volume: 0.5, pan: 0, muted: false },
  );
  const routes = await previewThenExecute(context, "primary", "mix-source-bus-routing", {
    id: "macro.routing.apply",
    input: { routes: routeRows },
  });
  assertVerifiedChanges(routes, routeRows.length, "MIX_ROUTING_NOT_VERIFIED");

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

  const chain = [
    { plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" },
    { plugin_query: "ReaComp", duplicate_policy: "fail_if_present", controls: { threshold_db: -18, ratio: 3 } },
  ];
  if (thirdPartyName) chain.push({ plugin_name: thirdPartyName, duplicate_policy: "fail_if_present" });
  const fx = await previewThenExecute(context, "primary", "mix-apply-fx-chain", {
    id: "macro.fx.apply_chain",
    refs: { track_ref: trackRefs.get("mix_master_bus") },
    input: { owner_kind: "track", chain },
  });
  assertVerifiedChanges(fx, chain.length, "MIX_FX_CHAIN_NOT_VERIFIED");
  const fxRef = requireFxRef(fx, "ReaEQ");
  const paramIdent = await readFxParameterIdent(context, fxRef, "mix-reaeq-mapping");
  await writeFxAutomationPasses(context, fxRef, paramIdent, "mix");
  const compRef = requireFxRef(fx, "ReaComp");
  const stockControls = await previewThenExecute(context, "primary", "mix-reacomp-controls", {
    id: "macro.fx.set_controls",
    refs: { fx_ref: compRef },
    input: { plugin: "reacomp", controls: { threshold_db: -12, ratio: 4 } },
  });
  assertValue(stockControls?.result?.verification?.status === "passed", "MIX_STOCK_CONTROL_NOT_VERIFIED", stockControls?.result);
  await writeTrackAutomationPasses(context, trackRefs.get("mix_music_bus"), "mix-track");

  if (thirdPartyName) {
    const thirdPartyRef = requireFxRef(fx, thirdPartyName);
    await exerciseGenericThirdPartyFx(context, thirdPartyRef, thirdPartyName);
  }

  await renderVerifiedTarget(context, "mixing-delivery-wav", { targetKind: "whole_project", format: "wav" });
  await renderFormatCapability(context, "mixing-delivery-ogg", { targetKind: "whole_project", format: "ogg", oggQuality: 0.6 });
  await renderFormatCapability(context, "mixing-delivery-mp3", { targetKind: "explicit_tracks", trackRefs: [trackRefs.get("mix_master_bus")], format: "mp3", mp3BitrateKbps: 320 });
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

async function queryExactItems(context, itemRefs, stepId) {
  const rows = await walkProjectQuery(context, "secondary", {
    entity: "items",
    fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
    selectors: { refs: itemRefs },
    limit: 100,
    refresh_policy: "force_read_only_refresh",
  });
  assertValue(rows.length === itemRefs.length, "EXACT_ITEM_QUERY_INCOMPLETE", { step_id: stepId, expected: itemRefs, rows });
  return [...rows].sort((left, right) => left.ref.localeCompare(right.ref));
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

async function writeFxAutomationPasses(context, fxRef, paramIdent, prefix, expectedOwnerKind = "track") {
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
    const readback = value.result.changes[0].live_readback ?? {};
    const createdEnvelope = readback.created_envelope;
    assertValue(createdEnvelope === (pass === 0), "FX_AUTOMATION_CREATE_PATH_MISMATCH", { pass, created_envelope: createdEnvelope });
    assertValue(
      readback.fx_ref === fxRef && readback.owner_kind === expectedOwnerKind && readback.param_ident === paramIdent,
      "FX_AUTOMATION_OWNER_READBACK_MISMATCH",
      { expected_fx_ref: fxRef, expected_owner_kind: expectedOwnerKind, expected_param_ident: paramIdent, readback },
    );
  }
}

async function runSubprojectLifecycle(context, trackRef, prefix) {
  assertExactRef(trackRef, "track:", "SUBPROJECT_TARGET_TRACK_REF_MISSING");
  const name = `OpenReaper ${prefix} ${Date.now()} ${context.calls.length}`;
  const created = await callTemplate(context, "primary", `${prefix}-subproject-create`, {
    id: "template.project.create_subproject",
    input: { name, activate: true, inherit_time_selection: false },
  });
  const createSummary = created?.result?.summary ?? {};
  assertValue(createSummary.created === true && createSummary.parent_restored === true, "SUBPROJECT_CREATE_NOT_VERIFIED", createSummary);
  assertExactRef(createSummary.subproject_project_ref, "project:path:", "SUBPROJECT_PROJECT_REF_MISSING");
  assertValue(
    path.isAbsolute(createSummary.child_project_path)
      && createSummary.subproject_project_ref === `project:path:${createSummary.child_project_path}`
      && createSummary.proxy_path === `${createSummary.child_project_path}-PROX`
      && createSummary.live_materialization === "native_rpp_proxy_verified",
    "SUBPROJECT_CREATE_IDENTITY_MISMATCH",
    createSummary,
  );
  const childFile = await stat(createSummary.child_project_path).catch(() => null);
  const proxyFile = await stat(createSummary.proxy_path).catch(() => null);
  assertValue(childFile?.isFile() === true && childFile.size > 0 && proxyFile?.isFile() === true && proxyFile.size > 0, "SUBPROJECT_FILES_MISSING", {
    child_project_path: createSummary.child_project_path,
    child_size: childFile?.size ?? 0,
    proxy_path: createSummary.proxy_path,
    proxy_size: proxyFile?.size ?? 0,
  });

  const inserted = await callTemplate(context, "primary", `${prefix}-subproject-insert`, {
    id: "template.project.insert_subproject_item",
    input: { position_seconds: 720, name: "OPENREAPER TRIAL SUBPROJECT" },
    refs: {
      subproject_project_ref: objectRef("project", createSummary.subproject_project_ref),
      track_ref: objectRef("track", trackRef),
    },
  });
  const insertSummary = inserted?.result?.summary ?? {};
  assertExactRef(insertSummary.item_ref, "item:", "SUBPROJECT_ITEM_REF_MISSING");
  assertValue(
    insertSummary.inserted === true
      && insertSummary.subproject_project_ref === createSummary.subproject_project_ref
      && insertSummary.requested_proxy_path === createSummary.proxy_path
      && insertSummary.source_path_mode === "exact_requested_child_project"
      && insertSummary.source_path === createSummary.child_project_path
      && insertSummary.source_proxy_path === createSummary.proxy_path
      && insertSummary.subproject_item_status === "native_source_verified"
      && insertSummary.parent_ui_restored === true,
    "SUBPROJECT_INSERT_NOT_VERIFIED",
    insertSummary,
  );
  const sourceFile = await stat(insertSummary.source_path).catch(() => null);
  const sourceProxyFile = await stat(insertSummary.source_proxy_path).catch(() => null);
  assertValue(sourceFile?.isFile() === true && sourceFile.size > 0 && sourceProxyFile?.isFile() === true && sourceProxyFile.size > 0, "SUBPROJECT_SOURCE_FILES_MISSING", {
    source_path: insertSummary.source_path,
    source_size: sourceFile?.size ?? 0,
    source_proxy_path: insertSummary.source_proxy_path,
    source_proxy_size: sourceProxyFile?.size ?? 0,
  });
  const itemRows = await walkProjectQuery(context, "secondary", {
    entity: "items",
    fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
    selectors: { refs: [insertSummary.item_ref] },
    limit: 1,
    refresh_policy: "force_read_only_refresh",
  });
  assertValue(itemRows.length === 1 && itemRows[0].ref === insertSummary.item_ref && itemRows[0].track_ref === trackRef, "SUBPROJECT_ITEM_QUERY_MISMATCH", {
    expected_item_ref: insertSummary.item_ref,
    expected_track_ref: trackRef,
    rows: itemRows,
  });

  const updated = await callTemplate(context, "primary", `${prefix}-subproject-update`, {
    id: "template.project.render_or_update_subproject",
    input: { mode: "render_or_update", wait_for_completion: true },
    refs: {
      subproject_project_ref: objectRef("project", createSummary.subproject_project_ref),
      item_ref: objectRef("item", insertSummary.item_ref),
    },
  });
  const updateSummary = updated?.result?.summary ?? {};
  assertValue(
    updateSummary.completed === true
      && updateSummary.queued === false
      && updateSummary.synchronous === true
      && updateSummary.linked_item_verified === true
      && updateSummary.parent_restored === true
      && updateSummary.subproject_project_ref === createSummary.subproject_project_ref
      && updateSummary.proxy_path === createSummary.proxy_path,
    "SUBPROJECT_UPDATE_NOT_VERIFIED",
    updateSummary,
  );
  assertExactRef(updateSummary.job_ref, "job:", "SUBPROJECT_JOB_REF_MISSING");
  const updatedProxy = await stat(updateSummary.proxy_path).catch(() => null);
  assertValue(updatedProxy?.isFile() === true && updatedProxy.size > 0, "SUBPROJECT_UPDATED_PROXY_MISSING", updateSummary);
  context.capabilityResults.push({
    capability: "subproject_lifecycle",
    status: "passed",
    subproject_project_ref: createSummary.subproject_project_ref,
    item_ref: insertSummary.item_ref,
    track_ref: trackRef,
    job_ref: updateSummary.job_ref,
    child_project_path: createSummary.child_project_path,
    proxy_path: updateSummary.proxy_path,
    source_path: insertSummary.source_path,
    source_proxy_path: insertSummary.source_proxy_path,
    requested_proxy_path: insertSummary.requested_proxy_path,
    source_path_mode: insertSummary.source_path_mode,
  });
}

function midiTextBytes(value) {
  assertValue(typeof value === "string", "MIDI_SYSEX_TEXT_READBACK_INVALID", { value });
  return Array.from(value, (character) => character.codePointAt(0));
}

async function writeTrackAutomationPasses(context, trackRef, prefix) {
  assertExactRef(trackRef, "track:", "TRACK_AUTOMATION_TRACK_REF_MISSING");
  const resolved = await callTemplate(context, "secondary", `${prefix}-resolve-volume-envelope`, {
    id: "template.automation.resolve_envelope_ref",
    input: { parent_kind: "track", envelope_name: "Volume" },
    refs: { track_ref: objectRef("track", trackRef) },
  });
  const envelopeRef = resolved?.result?.summary?.envelope_ref;
  assertExactRef(envelopeRef, "envelope:", "TRACK_AUTOMATION_ENVELOPE_REF_MISSING");
  for (let pass = 0; pass < 2; pass += 1) {
    const value = await previewThenExecute(context, "primary", `${prefix}-track-automation-${pass + 1}`, {
      id: "macro.automation.apply",
      input: {
        mode: "insert_points",
        envelope_refs: [envelopeRef],
        points: [{ time_seconds: pass * 2 + 0.5, value: pass === 0 ? 0.5 : 0.85, shape: 0, tension: 0, selected: false }],
      },
    });
    assertVerifiedChanges(value, 1, "TRACK_AUTOMATION_NOT_VERIFIED");
  }
  context.capabilityResults.push({ capability: "track_volume_automation", status: "passed", track_ref: trackRef, envelope_ref: envelopeRef, pass_count: 2 });
}

async function exerciseGenericThirdPartyFx(context, fxRef, pluginName) {
  const pages = [];
  const parameters = [];
  let offset = 0;
  await measure(context, "mix.third_party_parameter_inventory", async () => {
    while (true) {
      const page = await callTemplate(context, "secondary", `mix-third-party-parameters-${offset}`, {
        id: "template.fx.list_fx_parameters",
        input: { limit: 64, offset },
        refs: { fx_ref: fxObjectRef(fxRef) },
        budget: LARGE_PROJECTION_BUDGET,
      });
      const summary = page?.result?.summary ?? {};
      assertValue(summary.offset === offset && summary.returned_count === summary.parameters?.length, "THIRD_PARTY_PARAMETER_PAGE_INVALID", { plugin_name: pluginName, summary });
      pages.push({ offset, returned_count: summary.returned_count, next_offset: summary.next_offset ?? null });
      parameters.push(...summary.parameters);
      if (summary.next_offset == null) {
        assertValue(summary.truncated === false && summary.inventory_complete === true && summary.coverage_status === "complete", "THIRD_PARTY_PARAMETER_INVENTORY_INCOMPLETE", { plugin_name: pluginName, summary });
        assertValue(summary.parameter_count === parameters.length, "THIRD_PARTY_PARAMETER_COUNT_MISMATCH", { plugin_name: pluginName, expected: summary.parameter_count, observed: parameters.length });
        break;
      }
      assertValue(summary.truncated === true && summary.inventory_complete === false && summary.coverage_status === "paged" && Number.isInteger(summary.next_offset) && summary.next_offset > offset, "THIRD_PARTY_PARAMETER_CURSOR_INVALID", { plugin_name: pluginName, summary });
      offset = summary.next_offset;
    }
  });
  assertValue(new Set(parameters.map((row) => row.param_index)).size === parameters.length, "THIRD_PARTY_PARAMETER_DUPLICATES", { plugin_name: pluginName });

  const candidates = parameters.filter((row) => (
    typeof row.param_ident === "string"
    && row.param_ident.length > 0
    && typeof row.name === "string"
    && !/^(?:bank|bypass|delta|midi cc|preset|program|wet)$/iu.test(row.name.trim())
  ));
  let selected = null;
  for (const parameter of candidates.slice(0, 12)) {
    const low = await readFxParameter(context, fxRef, parameter, 0.25, `mix-third-party-probe-low-${parameter.param_index}`);
    const high = await readFxParameter(context, fxRef, parameter, 0.75, `mix-third-party-probe-high-${parameter.param_index}`);
    if (low.formatted_value !== high.formatted_value) {
      selected = parameter;
      break;
    }
  }
  assertValue(selected, "THIRD_PARTY_WRITABLE_PARAMETER_NOT_FOUND", { plugin_name: pluginName, candidate_count: candidates.length });
  const target = await readFxParameter(context, fxRef, selected, 0.5, "mix-third-party-probe-target");
  const write = await callTemplate(context, "primary", "mix-third-party-set-parameter", {
    id: "template.fx.set_fx_parameter_normalized",
    input: { param_index: selected.param_index, param_ident: selected.param_ident, normalized_value: 0.5, tolerance: 0.000001 },
    refs: { fx_ref: fxObjectRef(fxRef) },
  });
  const written = write?.result?.summary ?? {};
  assertValue(written.updated === true && written.param_ident === selected.param_ident && written.formatted_value === target.formatted_value, "THIRD_PARTY_PARAMETER_WRITE_NOT_VERIFIED", { plugin_name: pluginName, requested: target, observed: written });

  for (const enabled of [false, true]) {
    const bypass = await callTemplate(context, "primary", `mix-third-party-enabled-${enabled}`, {
      id: "template.fx.set_fx_bypass",
      input: { enabled },
      refs: { fx_ref: fxObjectRef(fxRef) },
    });
    assertValue(bypass?.result?.summary?.updated === true && bypass?.result?.summary?.enabled === enabled, "THIRD_PARTY_BYPASS_NOT_VERIFIED", { plugin_name: pluginName, enabled, summary: bypass?.result?.summary });
  }

  const paramIdent = await readFxParameterIdent(context, fxRef, "mix-third-party-automation-mapping");
  await writeFxAutomationPasses(context, fxRef, paramIdent, "mix-third-party");
  context.capabilityResults.push({
    capability: "generic_third_party_fx",
    status: "passed",
    plugin_name: pluginName,
    fx_ref: fxRef,
    parameter_count: parameters.length,
    page_count: pages.length,
    selected_parameter: { param_index: selected.param_index, param_ident: selected.param_ident, name: selected.name },
    verification_mode: written.verification_mode ?? null,
    is_discrete: written.is_discrete ?? null,
    is_toggle: written.is_toggle ?? null,
    automation_pass_count: 2,
  });
}

async function readFxParameter(context, fxRef, parameter, probeNormalizedValue, stepId) {
  const value = await callTemplate(context, "secondary", stepId, {
    id: "template.fx.read_fx_parameter",
    input: {
      param_index: parameter.param_index,
      param_ident: parameter.param_ident,
      ...(probeNormalizedValue === undefined ? {} : { probe_normalized_value: probeNormalizedValue }),
    },
    refs: { fx_ref: fxObjectRef(fxRef) },
  });
  const summary = value?.result?.summary ?? {};
  assertValue(summary.param_ident === parameter.param_ident && typeof summary.formatted_value === "string", "THIRD_PARTY_PARAMETER_READ_INVALID", { parameter, summary });
  return summary;
}

async function renderVerifiedWav(context, prefix) {
  return renderVerifiedTarget(context, `${prefix}-render-wav`, { targetKind: "whole_project", format: "wav" });
}

async function renderVerifiedTarget(context, prefix, { targetKind, itemRefs = [], trackRefs = [], format, oggQuality = null, mp3BitrateKbps = null }) {
  const basename = `${prefix}-${Date.now()}-${context.calls.length}`;
  const input = {
    target_kind: targetKind,
    format,
    output_basename: basename,
    ...(targetKind === "explicit_items" ? { item_refs: itemRefs } : {}),
    ...(targetKind === "explicit_tracks" ? { track_refs: trackRefs } : {}),
    ...(format === "ogg" ? { ogg_quality: oggQuality ?? 0.6 } : {}),
    ...(format === "mp3" ? { mp3_bitrate_kbps: mp3BitrateKbps ?? 320 } : {}),
  };
  const value = await previewThenExecute(context, "primary", `${prefix}-render`, {
    id: "macro.render.targets",
    input,
  });
  assertValue(value?.execution?.status === "completed" && value?.result?.verification?.status === "passed", "RENDER_EXECUTION_NOT_VERIFIED", {
    execution: value?.execution,
    verification: value?.result?.verification,
  });
  const outputs = value?.result?.data?.outputs ?? [];
  const expectedCount = targetKind === "explicit_items" ? itemRefs.length : targetKind === "explicit_tracks" ? trackRefs.length : 1;
  assertValue(outputs.length === expectedCount, "RENDER_OUTPUT_COUNT_MISMATCH", { expected: expectedCount, outputs });
  const call = context.calls.at(-1);
  assertValue(call?.requested_id === "macro.render.targets", "RENDER_CALL_ACCOUNTING_MISSING");
  for (const output of outputs) {
    assertValue(output.requested_format === format && output.actual_format === format && output.output_basename === basename, "RENDER_OUTPUT_IDENTITY_MISMATCH", output);
    const evidence = await verifyRenderedOutput({
      absolutePath: output.absolute_path,
      requestedFormat: format,
      requestedMp3BitrateKbps: format === "mp3" ? input.mp3_bitrate_kbps : null,
      managedRenderRoot: context.managedRenderRoot,
    });
    assertValue(evidence.ok, "RENDER_FILE_VERIFICATION_FAILED", evidence);
    call.rendered_outputs.push({ ...output, verification: evidence });
  }
  context.capabilityResults.push({ capability: `render_${format}`, status: "passed", target_kind: targetKind, output_count: outputs.length, output_basename: basename });
  return value;
}

async function renderFormatCapability(context, prefix, options) {
  return measure(context, `render.${options.format}.${options.targetKind}`, () => renderVerifiedTarget(context, prefix, options));
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

function objectRef(kind, ref) {
  assertValue(typeof ref === "string" && ref.startsWith(`${kind}:`), "OBJECT_REF_INVALID", { kind, ref });
  const remainder = ref.slice(kind.length + 1);
  const separator = remainder.indexOf(":");
  assertValue(separator > 0 && separator < remainder.length - 1, "OBJECT_REF_INVALID", { kind, ref });
  return { kind, ref, identity: { scheme: remainder.slice(0, separator), value: remainder.slice(separator + 1) } };
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

async function callExpectedFailure(context, clientName, stepId, request, expectedErrorCodes) {
  assertValue(Array.isArray(expectedErrorCodes) && expectedErrorCodes.length > 0, "EXPECTED_FAILURE_CODES_REQUIRED");
  return callJson(context, clientName, stepId, "call_template", {
    id: request.id,
    input: request.input,
    ...(request.refs ? { refs: request.refs } : {}),
    budget: request.budget ?? NORMAL_BUDGET,
  }, { expectedErrorCodes });
}

async function measure(context, id, action) {
  const started = performance.now();
  const firstCallOrdinal = context.calls.length + 1;
  try {
    const value = await action();
    context.performanceMeasurements.push({
      id,
      status: "passed",
      duration_ms: Math.round(performance.now() - started),
      first_call_ordinal: firstCallOrdinal,
      last_call_ordinal: context.calls.length,
      call_count: context.calls.length - firstCallOrdinal + 1,
    });
    return value;
  } catch (error) {
    context.performanceMeasurements.push({
      id,
      status: "failed",
      duration_ms: Math.round(performance.now() - started),
      first_call_ordinal: firstCallOrdinal,
      last_call_ordinal: context.calls.length,
      call_count: Math.max(0, context.calls.length - firstCallOrdinal + 1),
      error_code: error?.code ?? error?.cause?.code ?? null,
    });
    throw error;
  }
}

async function callJson(context, clientName, stepId, tool, args, { expectedErrorCodes = [] } = {}) {
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
    expected_failure: false,
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
    if (!call.ok && expectedErrorCodes.some((code) => responseErrorCodes(value).includes(code))) {
      call.expected_failure = true;
      context.expectedFailures.push(call);
      return value;
    }
    if (call.ok && expectedErrorCodes.length > 0) {
      call.error = { code: "EXPECTED_FAILURE_NOT_OBSERVED", expected_error_codes: expectedErrorCodes };
      throw Object.assign(new Error(`${stepId} unexpectedly succeeded`), { cause: call.error });
    }
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

function responseErrorCodes(value) {
  return [...new Set([
    value?.error?.code,
    ...(value?.blockers ?? []).map((entry) => entry?.code),
    ...(value?.result?.blockers ?? []).map((entry) => entry?.code),
  ].filter((entry) => typeof entry === "string"))];
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
    expected_failures: [],
    retries: [],
    ineffective_retries: [],
    performance_measurements: [],
    capability_results: [],
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
