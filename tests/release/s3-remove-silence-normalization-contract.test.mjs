import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildLiveBridgeBundle,
  handlerModuleFilesFromRegistry,
  loadBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";
import {
  ALPHA3_3_B1C_ITEMS_APPLY_MODES,
  ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY,
} from "../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
import { createAcceptedOfficialTemplateCatalog } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MACRO_PATH = "packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
const DESCRIPTOR_ID = "template.items.split_item_by_silence";
const REGISTRY_PATH = "reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json";
const BRIDGE_PATH = "reaper/bridge/openreaper-live-bridge.lua";
const D27_PATH = "reaper/bridge/src/handlers/analysis/d27_item_audio_analysis.lua";
const SCOPES = Object.freeze(["all", "leading", "trailing", "edges", "internal"]);
const NORMALIZATION_METRICS = Object.freeze([
  "lufs_i",
  "rms_i",
  "peak",
  "true_peak",
  "lufs_m_max",
  "lufs_s_max",
]);
const NORMALIZATION_CODES = Object.freeze({
  lufs_i: 0,
  rms_i: 1,
  peak: 2,
  true_peak: 3,
  lufs_m_max: 4,
  lufs_s_max: 5,
});
const SILENCE_FIELDS = Object.freeze({
  silence_threshold_dbfs: { minimum: -150, maximum: 0, default: -60 },
  min_silence_ms: { minimum: 1, maximum: 60000, default: 250 },
  keep_before_ms: { minimum: 0, maximum: 5000, default: 20 },
  keep_after_ms: { minimum: 0, maximum: 5000, default: 20 },
  min_kept_audio_ms: { minimum: 0, maximum: 60000, default: 80 },
  fade_ms: { minimum: 0, maximum: 1000, default: 5 },
});
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".lua", ".json", ".sh", ".ps1"]);

function readProductFile(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function walkSourceFiles(root, output = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".tmp-")) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(absolute, output);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      output.push(absolute);
    }
  }
  return output;
}

function productSources() {
  return ["packages", "reaper", "scripts"]
    .flatMap((directory) => walkSourceFiles(path.join(ROOT, directory)))
    .map((absolute) => ({
      path: path.relative(ROOT, absolute),
      source: readFileSync(absolute, "utf8"),
    }));
}

function sourceWith(text, pattern, message) {
  assert.match(text, pattern, message);
}

function sourceHas(sources, pattern, message) {
  const matched = sources.some(({ source }) => {
    pattern.lastIndex = 0;
    return pattern.test(source);
  });
  assert.ok(matched, message);
}

function sourceHasNo(sources, pattern, message) {
  const matched = sources.some(({ source }) => {
    pattern.lastIndex = 0;
    return pattern.test(source);
  });
  assert.equal(matched, false, message);
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source section: ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end of source section: ${end}`);
  return text.slice(startIndex, endIndex);
}

function nearby(text, left, right, window = 240) {
  let index = text.indexOf(left);
  while (index >= 0) {
    const slice = text.slice(Math.max(0, index - window), index + left.length + window);
    if (slice.includes(right)) return true;
    index = text.indexOf(left, index + left.length);
  }
  return false;
}

function nearbyInSources(sources, left, right, window = 240) {
  return sources.some(({ source }) => nearby(source, left, right, window));
}

const macroSource = readProductFile(MACRO_PATH);
const d27Source = readProductFile(D27_PATH);
const bridgeSource = readProductFile(BRIDGE_PATH);
const registrySource = readProductFile(REGISTRY_PATH);
const catalog = createAcceptedOfficialTemplateCatalog();
const descriptor = catalog.get(DESCRIPTOR_ID);
const macroEntry = ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.get("macro.items.apply");
const bridgeRegistry = loadBridgeHandlerRegistry({ cwd: ROOT });
const bridgeBundle = buildLiveBridgeBundle({ cwd: ROOT });
const allProductSources = productSources();
const actionSources = allProductSources.filter(({ path: sourcePath, source }) =>
  sourcePath.startsWith("reaper/actions/")
  && (source.includes("OpenReaper: Remove Silence...")
    || source.includes("OpenReaper: Repeat Remove Silence with Last Settings")));
const s3ProductSources = allProductSources.filter(({ path: sourcePath, source }) =>
  [MACRO_PATH, D27_PATH, BRIDGE_PATH, REGISTRY_PATH].includes(sourcePath)
  || /(?:remove[_ -]?silence|normalize[_ -]?level|s3[_-])/i.test(sourcePath)
  || source.includes("OpenReaper: Remove Silence...")
  || source.includes("OpenReaper: Repeat Remove Silence with Last Settings"));
const s3SourceEntries = [{ path: REGISTRY_PATH, source: registrySource }, ...s3ProductSources];
const actionSourceCorpus = actionSources.map(({ source }) => source).join("\n");

describe("S3 remove-silence and normalization static release contract", () => {
  it("exposes the bounded remove_silence and normalize_level input contract", () => {
    assert.ok(ALPHA3_3_B1C_ITEMS_APPLY_MODES.includes("remove_silence"));
    assert.ok(ALPHA3_3_B1C_ITEMS_APPLY_MODES.includes("normalize_level"));
    assert.ok(macroEntry, "macro.items.apply must remain a registered Macro");

    const properties = macroEntry.input_schema.properties;
    assert.deepEqual(properties.silence_scope.enum, SCOPES);
    assert.equal(properties.target.enum.includes("selected"), true);
    assert.equal(properties.target_refs.maxItems, 64);
    assert.equal(properties.dry_run.type, "boolean");
    for (const [field, expected] of Object.entries(SILENCE_FIELDS)) {
      assert.ok(properties[field], `macro.items.apply schema is missing ${field}`);
      assert.equal(properties[field].minimum, expected.minimum, `${field} minimum drifted`);
      assert.equal(properties[field].maximum, expected.maximum, `${field} maximum drifted`);
      assert.equal(properties[field].default, expected.default, `${field} default drifted`);
    }

    assert.deepEqual(properties.normalization_metric.enum, NORMALIZATION_METRICS);
    assert.equal(properties.normalization_target.maximum, 0);
    assert.equal(properties.normalization_target.type, "number");

    const descriptorProperties = descriptor.inputSchema.properties;
    assert.deepEqual(descriptorProperties.silence_scope.enum, SCOPES);
    for (const [field, expected] of Object.entries(SILENCE_FIELDS)) {
      assert.ok(descriptorProperties[field], `split-item descriptor is missing ${field}`);
      assert.equal(descriptorProperties[field].minimum, expected.minimum, `${field} descriptor minimum drifted`);
      assert.equal(descriptorProperties[field].maximum, expected.maximum, `${field} descriptor maximum drifted`);
      assert.equal(descriptorProperties[field].default, expected.default, `${field} descriptor default drifted`);
    }
    assert.equal(descriptor.outputSchema.properties.source_media_deleted.const, false);
    assert.equal(descriptor.outputSchema.properties.changed.type, "boolean");
    assert.ok(descriptor.outputSchema.required.includes("source_media_deleted"));
  });

  it("keeps the stock-native analysis decision and rejects dialog-driven Actions", () => {
    sourceWith(d27Source, /CreateTakeAudioAccessor/, "silence analysis must use a native Take accessor");
    sourceWith(d27Source, /GetAudioAccessorSamples/, "silence analysis must use native sample reads");
    sourceWith(d27Source, /SplitMediaItem/, "mutation must use native non-destructive Item splitting");
    sourceWith(d27Source, /DeleteTrackMediaItem/, "mutation must delete only native Item fragments");
    sourceWith(d27Source, /CalculateNormalization/, "normalization must use REAPER CalculateNormalization");

    sourceHasNo(
      s3SourceEntries,
      /(?:Main_OnCommand(?:Ex)?|call_reaper)\s*\([^\n]*(?:40315|40760)/,
      "S3 must not automate REAPER's dialog-backed remove-silence Actions",
    );
    sourceHasNo(
      s3SourceEntries,
      /\b(?:dynamicsplit|reaper\.ini)\b/i,
      "S3 must not persist native dialog settings through reaper.ini",
    );
  });

  it("hashes the resolved audio plan independently of selected versus exact entry", () => {
    const checksumBody = between(
      d27Source,
      "local function d27_batch_checksum_plan(rows, params, operation)",
      "local function d27_batch_owner_track(context)",
    );
    assert.doesNotMatch(
      checksumBody,
      /params\.target/,
      "equivalent selected and exact requests must share one compiled plan hash",
    );
    assert.match(checksumBody, /row\.item_ref/);
    assert.match(checksumBody, /row\.context\.item_position/);
    assert.match(checksumBody, /row\.context\.item_length/);
    assert.match(checksumBody, /row\.scan[\s\S]*silence_segments/);
    assert.match(checksumBody, /row\.ranges/);
  });

  it("reports MIDI as typed unsupported truth before native audio metadata probing", () => {
    sourceWith(d27Source, /TakeIsMIDI[\s\S]{0,320}MIDI_UNSUPPORTED/u, "MIDI must be identified with native TakeIsMIDI and typed unsupported truth");
    sourceWith(d27Source, /MIDI_UNSUPPORTED[\s\S]{0,160}typed_truth/u, "MIDI rejection must carry typed truth");
  });

  it("ships both no-Agent Action names through one shared silence implementation", () => {
    assert.ok(actionSources.length > 0, "the two S3 Actions must exist in product source, not only in tests");
    assert.match(actionSourceCorpus, /OpenReaper: Remove Silence\.\.\./);
    assert.match(actionSourceCorpus, /OpenReaper: Repeat Remove Silence with Last Settings/);

    for (const { path: sourcePath, source } of actionSources) {
      assert.match(source, /GetUserInputs|ShowMessageBox/, `${sourcePath}: Action settings must use REAPER's built-in input/message APIs`);
      assert.match(source, /GetExtState/, `${sourcePath}: Action settings must read OpenReaper-owned ExtState`);
      assert.match(source, /SetExtState/, `${sourcePath}: Action settings must persist OpenReaper-owned ExtState`);
      assert.match(source, /plan_hash/, `${sourcePath}: Action must expose the shared compiled plan hash`);
      assert.match(
        source,
        /alpha33_[A-Za-z0-9_]*silence|template\.items\.split_item_by_silence/,
        `${sourcePath}: Action must call/reference the shared remove-silence core`,
      );
      assert.doesNotMatch(source, /\b(?:40315|40760)\b/, `${sourcePath}: no dialog-backed stock Action automation`);
    }

    const sharedCore = allProductSources.find(({ path: sourcePath, source }) =>
      sourcePath.startsWith("reaper/")
      && /function\s+[A-Za-z0-9_]*silence[A-Za-z0-9_]*batch|function\s+[A-Za-z0-9_]*batch[A-Za-z0-9_]*silence/.test(source)
      && source.includes("plan_hash"));
    assert.ok(sharedCore, "one REAPER-side shared silence batch core must own plan_hash generation");
    sourceHas([{ source: macroSource }], /template\.items\.split_item_by_silence/, "Macro must reference the shared silence Template");
    sourceHas([{ source: macroSource }], /plan_hash/, "Macro must expose the shared compiled plan hash");
    assert.equal(nearby(sharedCore.source, "plan_hash", "silence_scope"), true);
  });

  it("makes remove_silence a single internal batch dispatch with aggregate truth", () => {
    const body = between(
      macroSource,
      "async function executeRemoveSilencePlan",
      "async function executeArrangementPlan",
    );
    assert.match(body, /batch/i, "remove_silence must dispatch an internal batch job");
    assert.doesNotMatch(body, /for\s*\(const\s+operation\s+of\s+plan\.operations\)/, "the Macro must not loop over Items for child dispatch");
    assert.equal(
      countMatches(body, /\b(?:runAtomic|runAtomicCounted)\s*\(/g),
      1,
      "remove_silence must have exactly one child dispatch from the Macro",
    );
    sourceWith(body, /aggregate[_ -]?readback/i, "batch child result must be consumed as aggregate readback");
    sourceWith(body, /plan_hash/, "batch child result must carry the compiled plan hash");
  });

  it("retains typed zero-write and fail-closed truth for every bounded target class", () => {
    sourceHas(s3SourceEntries, /ALL_SILENT_RETAINED/, "all-silent Items must be retained with typed truth");
    sourceHas(s3SourceEntries, /midi[\s\S]{0,240}(skip|unsupported|fail|typed)/i, "MIDI targets must be skipped or rejected with typed truth");
    sourceHas(s3SourceEntries, /unsupported/i, "unreadable/unsupported targets must fail closed");
    sourceHas(s3SourceEntries, /zero_write/, "blocked target sets must report zero-write truth");
    assert.equal(nearby(macroSource, "65", "zero_write", 1200), true, "65-target silence rejection must be zero-write before analysis/mutation");
    assert.equal(macroEntry.input_schema.properties.target_refs.maxItems, 64, "exact target_refs must be bounded at 64");
    sourceHas(s3SourceEntries, /source_media_deleted/, "source media preservation must be explicit in the result truth");
  });

  it("maps all six normalization metrics to CalculateNormalization and preserves pre-FX scope", () => {
    sourceHas([{ source: macroSource }], /normalize_level/, "macro.items.apply must expose the single normalization mode");
    sourceWith(d27Source, /CalculateNormalization/, "native normalization must remain REAPER-owned");
    for (const metric of NORMALIZATION_METRICS) {
      sourceHas(s3SourceEntries, new RegExp(`\\b${metric}\\b`), `missing normalization metric ${metric}`);
      assert.equal(
        nearbyInSources(s3SourceEntries, metric, String(NORMALIZATION_CODES[metric]), 320)
          || nearbyInSources(s3SourceEntries, String(NORMALIZATION_CODES[metric]), metric, 320),
        true,
        `${metric} must retain its documented CalculateNormalization metric code ${NORMALIZATION_CODES[metric]}`,
      );
    }
    sourceHas(s3SourceEntries, /measurement[_ -]?scope\s*[=:]\s*["']?source_item_take_pre_fx/i, "normalization must report source/Item/Take pre-FX scope");
    assert.equal(nearby(macroSource, "normalize_level", "65", 2600), true, "normalization must include a 65-target guard");
    assert.equal(nearby(macroSource, "normalize_level", "zero_write", 2600), true, "65-target normalization rejection must be zero-write");
  });

  it("exposes timings, counters, aggregate evidence, and one closed Undo boundary", () => {
    for (const field of [
      "timings",
      "native_counters",
      "aggregate_readback",
      "plan_hash",
      "undo",
      "undo_opened",
      "undo_closed",
      "total_ms",
    ]) {
      sourceHas(s3SourceEntries, new RegExp(field), `S3 evidence is missing ${field}`);
    }
    for (const field of [
      "batch_timings",
      "native_mutation_count",
      "native_readback_count",
      "aggregate_readback_count",
      "continuation_yield_count",
      "aggregate_readback",
      "plan_hash",
      "undo_opened",
      "undo_closed",
    ]) {
      sourceWith(bridgeBundle, new RegExp(field), `generated bridge bundle is missing ${field}`);
    }
    sourceHas(s3SourceEntries, /(?:single|one|once)[_ -]?undo|undo[_ -]?(?:call|count)[^\n]*1/i, "S3 must declare one invocation-level Undo");
    assert.match(bridgeSource, /undo\.mode\s*==\s*["']required["']|required_undo/, "write bridge route must require Undo");
    sourceHas(s3SourceEntries, /30[_]?000|30000/, "the internal sub-30-second release gate must be represented in source evidence");
  });

  it("keeps the shared handler registered and present in the generated bridge bundle", () => {
    const entry = bridgeRegistry.entries.find((row) => row.template_id === DESCRIPTOR_ID);
    assert.ok(entry, `${DESCRIPTOR_ID} must remain registered in the bridge handler registry`);
    assert.match(registrySource, new RegExp(DESCRIPTOR_ID.replaceAll(".", "\\.")));
    assert.notEqual(entry.handler_file, "legacy_monolith");
    assert.notEqual(entry.handler_export, "legacy_monolith");
    assert.ok(existsSync(path.join(ROOT, "reaper/bridge/src/handlers", entry.handler_file)));
    assert.ok(handlerModuleFilesFromRegistry(bridgeRegistry).includes(entry.handler_file));
    assert.match(bridgeBundle, new RegExp(entry.handler_export));
    assert.match(bridgeBundle, /CalculateNormalization/);
  });
});
