import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_RISKS,
} from "../packages/core/src/template-descriptor-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";

const root = process.cwd();
const REGISTRY_CONTRACT = "openreaper.bridge_handler_registry.v1";
const LEGACY_MONOLITH_MARKER = "legacy_monolith";
const REQUIRED_ENTRY_FIELDS = Object.freeze([
  "template_id",
  "operation",
  "pack",
  "risk",
  "route",
  "handler_file",
  "handler_export",
  "artifact_policy",
  "tests",
]);
const ARTIFACT_POLICIES = new Set(["none", "metadata", "write"]);
const PACK_ID_SET = new Set(FOUNDATION_BRIDGE_PACK_IDS);
const RISK_SET = new Set(TEMPLATE_DESCRIPTOR_RISKS);
const OPERATION_FAMILY_SET = new Set(FOUNDATION_BRIDGE_OPERATION_FAMILIES);

export const sourceFiles = Object.freeze([
  "00-bridge-kernel.lua",
  "10-file-transport.lua",
  "20-bridge-envelope-kernel.lua",
  "30-artifact-helper.lua",
  "35-route-policy.lua",
  "40-route-pack-handlers.lua",
  "90-file-transport-loop.lua",
]);

export const registryFile = "reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json";
export const routeMetadataFile = "reaper/bridge/registry/BRIDGE_ROUTE_METADATA_V1.json";
export const handlerSourceRoot = "reaper/bridge/src/handlers";

export const E5_ROUTING_WRITE_TEMPLATE_IDS = Object.freeze([
  "template.routing.create_track_send",
  "template.routing.set_send_volume",
  "template.routing.set_send_pan",
  "template.routing.set_send_mute",
  "template.routing.set_send_mode",
  "template.routing.set_master_parent_send",
  "template.routing.set_track_channel_count",
  "template.routing.set_send_audio_channels",
  "template.routing.set_send_phase",
  "template.routing.set_send_mono",
  "template.routing.set_send_midi_channels",
]);

export const E5_ROUTING_AUTOMATION_EXTRA_TEMPLATE_IDS = Object.freeze([
  "template.routing.read_fx_pin_mapping",
  "template.automation.resolve_envelope_ref",
  "template.automation.read_envelope_summary",
  "template.automation.read_envelope_points",
  "template.automation.evaluate_envelope_at_time",
  "template.automation.set_envelope_lane_state",
  "template.automation.insert_envelope_point",
  "template.automation.set_track_automation_mode",
  "template.automation.read_track_automation_mode",
  "template.automation.read_automation_items",
  "template.automation.set_envelope_point",
  "template.automation.insert_envelope_points_batch",
  "template.automation.set_send_automation_mode",
  "template.automation.create_automation_item",
  "template.automation.set_automation_item_bounds",
  "template.automation.resolve_send_envelope",
]);

export const E2_FX_B1_WRITE_TEMPLATE_IDS = Object.freeze([
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_bypass",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.reorder_fx",
]);

export const registryRoutes = Object.freeze({
  wave0: Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
    tests: Object.freeze([
      "tests/layer4d2/openreaper-live-bridge.test.mjs",
      "tests/layer4dx/read-handler-expansion.test.mjs",
    ]),
  }),
  "wave1a-read-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/read-handler-expansion.test.mjs"]),
  }),
  "d6-project-tempo-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d6-project-tempo-handler-expansion.test.mjs"]),
  }),
  "d9-tracks-mixer-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d9-tracks-mixer-handler-expansion.test.mjs"]),
  }),
  "d10-read-overview-actions-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d10-read-overview-actions-handler-expansion.test.mjs"]),
  }),
  "d11-project-marker-region-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d11-project-marker-region-handler-expansion.test.mjs"]),
  }),
  "d12-transport-safe-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d12-transport-safe-handler-expansion.test.mjs"]),
  }),
  "d13-items-core-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d13-items-core-handler-expansion.test.mjs"]),
  }),
  "d14-items-delete-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d14-items-delete-handler-expansion.test.mjs"]),
  }),
  "d15-items-source-phase-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/d15-items-source-phase-handler-expansion.test.mjs"]),
  }),
  "read-b": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/read-b-handler-expansion.test.mjs"]),
  }),
  "e3-media-live-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e3-media-live-handler-expansion.test.mjs"]),
  }),
  "e4-item-live-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e4-item-live-handler-expansion.test.mjs"]),
  }),
  "e5-r1-routing-read-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e5-r1-routing-read-handler-expansion.test.mjs"]),
  }),
  "e5-routing-write-handlers": Object.freeze({
    ids: E5_ROUTING_WRITE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e5-routing-write-handler-expansion.test.mjs"]),
  }),
  "e5-routing-automation-extra-handlers": Object.freeze({
    ids: E5_ROUTING_AUTOMATION_EXTRA_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e5-routing-automation-extra-handler-expansion.test.mjs"]),
  }),
  "e2-fx-l1-read-handlers": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e2-fx-l1-read-handler-expansion.test.mjs"]),
  }),
  "e2-fx-b1-write-handlers": Object.freeze({
    ids: E2_FX_B1_WRITE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/e2-fx-l1-read-handler-expansion.test.mjs"]),
  }),
  "first-real-a1": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/first-real-a1-handler-expansion.test.mjs"]),
  }),
  "first-real-a2-render": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/first-real-a2-render-route.test.mjs"]),
  }),
  "first-real-a3-layer-report": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/first-real-a3-layer-report-route.test.mjs"]),
  }),
  "safe-write-a": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/safe-write-a-handler-expansion.test.mjs"]),
  }),
});

export function buildLiveBridgeBundle({ cwd = process.cwd() } = {}) {
  const registry = loadBridgeHandlerRegistry({ cwd });
  const registrySummary = validateBridgeHandlerRegistry({ cwd, registry });
  const handlerModules = readBridgeHandlerModules({ cwd, registry });
  const sourceDir = path.join(cwd, "reaper/bridge/src");
  const body = sourceFiles
    .map((file) => wrapSourceModule(file, readFileSync(path.join(sourceDir, file), "utf8"), handlerModules))
    .join("");
  return [
    "-- OpenReaper generated live bridge.",
    `-- Handler registry: ${registryFile} (${registrySummary.entryCount} registered template handler row(s); ${registrySummary.legacyMonolithCount} legacy_monolith row(s); ${registrySummary.extractedHandlerCount} extracted handler row(s); ${registrySummary.handlerModuleCount} handler module file(s)).`,
    "",
    body,
  ].join("\n");
}

export function loadBridgeHandlerRegistry({ cwd = process.cwd() } = {}) {
  const registryPath = path.join(cwd, registryFile);
  try {
    return JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${registryFile}: ${error.message}`);
  }
}

export function handlerModuleFilesFromRegistry(registry) {
  const files = [];
  const seen = new Set();
  for (const entry of registry?.entries ?? []) {
    if (!entry || typeof entry !== "object" || entry.handler_file === LEGACY_MONOLITH_MARKER) continue;
    if (typeof entry.handler_file !== "string" || seen.has(entry.handler_file)) continue;
    seen.add(entry.handler_file);
    files.push(entry.handler_file);
  }
  return files;
}

export function readBridgeHandlerModules({ cwd = process.cwd(), registry = loadBridgeHandlerRegistry({ cwd }) } = {}) {
  const exportsByFile = new Map();
  for (const entry of registry.entries ?? []) {
    if (!entry || entry.handler_file === LEGACY_MONOLITH_MARKER) continue;
    if (typeof entry.handler_file !== "string" || typeof entry.handler_export !== "string") continue;
    const exports = exportsByFile.get(entry.handler_file) ?? [];
    if (!exports.includes(entry.handler_export)) exports.push(entry.handler_export);
    exportsByFile.set(entry.handler_file, exports);
  }
  return handlerModuleFilesFromRegistry(registry).map((file) => ({
    file,
    exports: Object.freeze(exportsByFile.get(file) ?? []),
    source: readFileSync(path.join(cwd, handlerSourceRoot, file), "utf8"),
  }));
}

export function validateBridgeHandlerRegistry({ cwd = process.cwd(), registry = loadBridgeHandlerRegistry({ cwd }) } = {}) {
  const errors = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error(`${registryFile} must be a JSON object.`);
  }
  if (registry.contract !== REGISTRY_CONTRACT) {
    errors.push(`Registry contract must be ${REGISTRY_CONTRACT}.`);
  }
  if (!Array.isArray(registry.entries)) {
    errors.push("Registry entries must be an array.");
  }

  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const catalog = createAcceptedOfficialTemplateCatalog();
  const byTemplateId = new Map();
  const routeIds = new Map(Object.keys(registryRoutes).map((route) => [route, []]));
  const operationKeys = new Set();
  const operationCapabilityKeys = new Set();
  let legacyMonolithCount = 0;
  let extractedHandlerCount = 0;
  const handlerModuleFiles = new Set();

  for (const [index, entry] of entries.entries()) {
    const prefix = `entries[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (!Object.hasOwn(entry, field)) errors.push(`${prefix}.${field} is required.`);
    }
    if (typeof entry.template_id !== "string") {
      errors.push(`${prefix}.template_id must be a string.`);
    } else if (byTemplateId.has(entry.template_id)) {
      errors.push(`${prefix}.template_id duplicates ${byTemplateId.get(entry.template_id)}: ${entry.template_id}.`);
    } else {
      byTemplateId.set(entry.template_id, prefix);
    }

    const descriptor = typeof entry.template_id === "string" ? catalog.get(entry.template_id) : null;
    if (!descriptor && typeof entry.template_id === "string") {
      errors.push(`${prefix}.template_id is not in the accepted official catalog: ${entry.template_id}.`);
    }

    if (!entry.operation || typeof entry.operation !== "object" || Array.isArray(entry.operation)) {
      errors.push(`${prefix}.operation must be an object.`);
    } else {
      if (!OPERATION_FAMILY_SET.has(entry.operation.family)) {
        errors.push(`${prefix}.operation.family is outside foundation.bridge.v1: ${String(entry.operation.family)}.`);
      }
      if (typeof entry.operation.name !== "string" || entry.operation.name.trim() === "") {
        errors.push(`${prefix}.operation.name must be a non-empty string.`);
      }
      if (descriptor) {
        if (entry.operation.family !== descriptor.bridge.operation_family) {
          errors.push(`${prefix}.operation.family must match descriptor bridge operation family.`);
        }
        if (entry.operation.name !== descriptor.bridge.operation_name) {
          errors.push(`${prefix}.operation.name must match descriptor bridge operation name.`);
        }
      }
      if (typeof entry.operation.family === "string" && typeof entry.operation.name === "string") {
        operationKeys.add(operationKey(entry));
        const capability = entry.capability ?? "";
        const operationCapabilityKey = `${operationKey(entry)}:${capability}`;
        if (operationCapabilityKeys.has(operationCapabilityKey)) {
          errors.push(`${prefix} duplicates operation/capability key: ${operationCapabilityKey}.`);
        }
        operationCapabilityKeys.add(operationCapabilityKey);
      }
    }

    if (!PACK_ID_SET.has(entry.pack)) errors.push(`${prefix}.pack must be one of the fixed pack ids.`);
    if (!RISK_SET.has(entry.risk)) errors.push(`${prefix}.risk must be a template descriptor risk.`);
    if (descriptor) {
      if (entry.pack !== descriptor.pack) errors.push(`${prefix}.pack must match descriptor pack.`);
      if (entry.risk !== descriptor.risk) errors.push(`${prefix}.risk must match descriptor risk.`);
    }
    if (!Object.hasOwn(registryRoutes, entry.route)) {
      errors.push(`${prefix}.route is not an accepted live route: ${String(entry.route)}.`);
    } else {
      routeIds.get(entry.route).push(entry.template_id);
    }
    if (!ARTIFACT_POLICIES.has(entry.artifact_policy)) {
      errors.push(`${prefix}.artifact_policy must be one of none, metadata, write.`);
    }
    if (descriptor && entry.artifact_policy !== artifactPolicyForDescriptor(descriptor)) {
      errors.push(`${prefix}.artifact_policy must match descriptor artifacts.mode.`);
    }
    if (entry.operation?.name === "template.execute") {
      if (entry.capability !== descriptor?.bridge.capability) {
        errors.push(`${prefix}.capability must match descriptor bridge capability for template.execute.`);
      }
    } else if (Object.hasOwn(entry, "capability")) {
      errors.push(`${prefix}.capability is allowed only for shared template.execute routes.`);
    }
    validateHandlerLocation({ cwd, entry, prefix, errors });
    validateTestList({ cwd, entry, prefix, errors });
    if (entry.handler_file === LEGACY_MONOLITH_MARKER) {
      legacyMonolithCount += 1;
    } else if (typeof entry.handler_file === "string") {
      extractedHandlerCount += 1;
      handlerModuleFiles.add(entry.handler_file);
    }
  }

  const expectedIds = Object.values(registryRoutes).flatMap((route) => route.ids);
  assertSameList("registry template ids", [...byTemplateId.keys()], expectedIds, errors);
  for (const [route, spec] of Object.entries(registryRoutes)) {
    assertSameList(`registry route ${route}`, routeIds.get(route) ?? [], spec.ids, errors);
  }

  const source = readFileSync(path.join(cwd, "reaper/bridge/src/40-route-pack-handlers.lua"), "utf8");
  const luaOperationKeys = extractLuaDispatchOperationKeys(source);
  assertSameList("Lua dispatch operation keys", luaOperationKeys, [...operationKeys].sort(), errors);
  validateExtractedHandlerBindings({ entries, source, errors });

  if (errors.length > 0) {
    throw new Error(`Bridge handler registry validation failed:\n- ${errors.join("\n- ")}`);
  }
  return Object.freeze({
    contract: registry.contract,
    entryCount: entries.length,
    legacyMonolithCount,
    extractedHandlerCount,
    handlerModuleCount: handlerModuleFiles.size,
    routeCount: Object.keys(registryRoutes).length,
    operationCount: operationKeys.size,
  });
}

export function buildBridgeRouteMetadata({ cwd = process.cwd(), registry = loadBridgeHandlerRegistry({ cwd }) } = {}) {
  const registrySummary = validateBridgeHandlerRegistry({ cwd, registry });
  const entries = registry.entries ?? [];
  return {
    contract: "openreaper.bridge_route_metadata.v1",
    generated_from: registryFile,
    registry_summary: registrySummary,
    routes: Object.entries(registryRoutes).map(([route, spec]) => {
      const routeEntries = entries.filter((entry) => entry.route === route);
      return {
        route,
        template_count: routeEntries.length,
        handler_module_count: new Set(routeEntries.map((entry) => entry.handler_file)).size,
        operation_count: new Set(routeEntries.map(operationCapabilityKey)).size,
        packs: sortedUnique(routeEntries.map((entry) => entry.pack)),
        risks: sortedUnique(routeEntries.map((entry) => entry.risk)),
        artifact_policies: sortedUnique(routeEntries.map((entry) => entry.artifact_policy)),
        tests: [...spec.tests],
        template_ids: routeEntries.map((entry) => entry.template_id),
      };
    }),
  };
}

function wrapSourceModule(file, source, handlerModules) {
  if (file !== "40-route-pack-handlers.lua") return source;
  const handlerExportNames = [...new Set(handlerModules.flatMap((module) => module.exports))].sort();
  const routedSource = bindRouteSourceToHandlerExports(source, handlerExportNames);
  return [
    "-- OpenReaper bridge handler module wrapper: keeps handler locals out of the main Lua chunk and out of one giant function.",
    "local dispatch_request = (function()",
    "local OPENREAPER_HANDLER_EXPORTS = {}",
    "local OPENREAPER_HANDLER_SHARED = {}",
    "local function __openreaper_register_handler_module(module_name, loader)",
    "  local module = loader()",
    "  if type(module) ~= \"table\" then",
    "    error(\"OpenReaper bridge handler module did not return exports: \" .. tostring(module_name))",
    "  end",
    "  if type(module.shared) == \"table\" then",
    "    for key, value in pairs(module.shared) do",
    "      OPENREAPER_HANDLER_SHARED[key] = value",
    "    end",
    "  end",
    "  if type(module.exports) == \"table\" then",
    "    for key, value in pairs(module.exports) do",
    "      OPENREAPER_HANDLER_EXPORTS[key] = value",
    "    end",
    "  end",
    "end",
    ...handlerModules.map((module) => wrapHandlerModule(module, handlerExportNames)),
    routedSource,
    "return dispatch_request",
    "end)()",
    "",
  ].join("\n");
}

function wrapHandlerModule({ file, exports, source }, handlerExportNames) {
  const sharedPreamble = sharedHandlerNames
    .filter((name) => source.includes(name) && !new RegExp(`\\blocal\\s+${name}\\s*=`).test(source))
    .map((name) => `local ${name} = OPENREAPER_HANDLER_SHARED.${name}`);
  const exportedDependencyPreamble = handlerExportNames
    .filter((name) => !exports.includes(name))
    .filter((name) => source.includes(name) && !new RegExp(`\\blocal\\s+function\\s+${escapeRegExp(name)}\\s*\\(`).test(source))
    .map((name) => [
      `local function ${name}(...)`,
      `  return OPENREAPER_HANDLER_EXPORTS.${name}(...)`,
      "end",
    ].join("\n"));
  const sharedExports = sharedHandlerNames
    .filter((name) => new RegExp(`\\blocal\\s+${name}\\s*=`).test(source))
    .map((name) => `${name} = ${name}`);
  return [
    `-- OpenReaper bridge handler module: ${handlerSourceRoot}/${file}`,
    `__openreaper_register_handler_module(${JSON.stringify(file)}, function()`,
    ...sharedPreamble,
    ...exportedDependencyPreamble,
    source.trimEnd(),
    "return {",
    `  exports = { ${exports.map((name) => `${name} = ${name}`).join(", ")} },`,
    `  shared = { ${sharedExports.join(", ")} },`,
    "}",
    "end)",
    "",
  ].join("\n");
}

const sharedHandlerNames = Object.freeze([
  "READ_B_ACTIONS",
  "READ_B_MEDIA",
  "READ_B_MIDI",
]);

function bindRouteSourceToHandlerExports(source, handlerExportNames) {
  let routedSource = source;
  for (const exportName of handlerExportNames) {
    routedSource = routedSource.replace(
      new RegExp(`(\\bhandler\\s*=\\s*)${escapeRegExp(exportName)}\\b`, "g"),
      `$1OPENREAPER_HANDLER_EXPORTS.${exportName}`,
    );
    routedSource = routedSource.replace(
      new RegExp(`(\\[[^\\n\\]]+\\]\\s*=\\s*)${escapeRegExp(exportName)}\\b`, "g"),
      `$1OPENREAPER_HANDLER_EXPORTS.${exportName}`,
    );
  }
  return routedSource;
}

function artifactPolicyForDescriptor(descriptor) {
  if (descriptor.artifacts.mode === "none") return "none";
  if (descriptor.artifacts.mode === "metadata") return "metadata";
  return "write";
}

function operationKey(entry) {
  return `${entry.operation.family}:${entry.operation.name}`;
}

function operationCapabilityKey(entry) {
  const capability = entry.capability ? `:${entry.capability}` : "";
  return `${operationKey(entry)}${capability}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function validateHandlerLocation({ cwd, entry, prefix, errors }) {
  const handlerFile = entry.handler_file;
  const handlerExport = entry.handler_export;
  if (handlerFile === LEGACY_MONOLITH_MARKER || handlerExport === LEGACY_MONOLITH_MARKER) {
    if (handlerFile !== LEGACY_MONOLITH_MARKER || handlerExport !== LEGACY_MONOLITH_MARKER) {
      errors.push(`${prefix}.handler_file and handler_export must both use legacy_monolith during transition.`);
    }
    return;
  }
  if (
    typeof handlerFile !== "string" ||
    handlerFile.includes("\0") ||
    handlerFile.includes("\\") ||
    path.isAbsolute(handlerFile) ||
    /^[A-Za-z]:[\\/]/.test(handlerFile) ||
    handlerFile.split("/").includes("..") ||
    !handlerFile.endsWith(".lua")
  ) {
    errors.push(`${prefix}.handler_file must be a relative .lua path under reaper/bridge/src/handlers.`);
    return;
  }
  const handlerExportValid = typeof handlerExport === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(handlerExport);
  if (!handlerExportValid) {
    errors.push(`${prefix}.handler_export must be a Lua identifier.`);
  }
  const handlerRoot = path.resolve(cwd, handlerSourceRoot);
  const handlerPath = path.resolve(handlerRoot, handlerFile);
  if (!handlerPath.startsWith(handlerRoot + path.sep)) {
    errors.push(`${prefix}.handler_file must remain under reaper/bridge/src/handlers.`);
  }
  if (!existsSync(handlerPath)) {
    errors.push(`${prefix}.handler_file does not exist: ${handlerFile}.`);
    return;
  }
  if (handlerExportValid) {
    const source = readFileSync(handlerPath, "utf8");
    const exportPattern = new RegExp(`\\blocal\\s+function\\s+${escapeRegExp(handlerExport)}\\s*\\(`);
    if (!exportPattern.test(source)) {
      errors.push(`${prefix}.handler_export was not found as a local function in ${handlerFile}.`);
    }
  }
}

function validateExtractedHandlerBindings({ entries, source, errors }) {
  for (const entry of entries) {
    if (!entry || entry.handler_file === LEGACY_MONOLITH_MARKER) continue;
    if (typeof entry.handler_export !== "string") continue;
    if (entry.operation?.name === "template.execute") {
      const capability = typeof entry.capability === "string" ? entry.capability : "";
      const pattern = new RegExp(
        `\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${escapeRegExp(entry.handler_export)}\\b`,
      );
      if (!pattern.test(source)) {
        errors.push(`${entry.template_id} extracted Safe-Write-A handler export is not bound in 40-route-pack-handlers.lua: ${entry.handler_export}.`);
      }
      continue;
    }
    const key = operationKey(entry);
    const pattern = new RegExp(
      `\\["${escapeRegExp(key)}"\\]\\s*=\\s*\\{[\\s\\S]*?handler\\s*=\\s*${escapeRegExp(entry.handler_export)}\\b`,
    );
    if (!pattern.test(source)) {
      errors.push(`${entry.template_id} extracted handler export is not bound in 40-route-pack-handlers.lua: ${entry.handler_export}.`);
    }
  }
}

function validateTestList({ cwd, entry, prefix, errors }) {
  if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
    errors.push(`${prefix}.tests must be a non-empty array.`);
    return;
  }
  const routeSpec = registryRoutes[entry.route];
  for (const testPath of entry.tests) {
    if (typeof testPath !== "string" || testPath.startsWith("/") || testPath.includes("..")) {
      errors.push(`${prefix}.tests entries must be relative test paths.`);
      continue;
    }
    if (!existsSync(path.join(cwd, testPath))) {
      errors.push(`${prefix}.tests entry does not exist: ${testPath}.`);
    }
  }
  if (routeSpec) assertSameList(`${prefix}.tests`, entry.tests, routeSpec.tests, errors);
}

function extractLuaDispatchOperationKeys(source) {
  return [
    ...new Set(
      [...source.matchAll(/\["(query_state|run_command|run_job|run_action|artifact_metadata):([^"]+)"\]\s*=/g)]
        .map((match) => `${match[1]}:${match[2]}`),
    ),
  ].sort();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSameList(label, actual, expected, errors) {
  const actualList = [...actual];
  const expectedList = [...expected];
  if (
    actualList.length !== expectedList.length ||
    actualList.some((value, index) => value !== expectedList[index])
  ) {
    errors.push(`${label} mismatch.\n  actual: ${JSON.stringify(actualList)}\n  expected: ${JSON.stringify(expectedList)}`);
  }
}

function run() {
  const outputPath = path.join(root, "reaper/bridge/openreaper-live-bridge.lua");
  const metadataPath = path.join(root, routeMetadataFile);
  const check = process.argv.includes("--check");
  const bundled = buildLiveBridgeBundle({ cwd: root });
  const routeMetadata = `${JSON.stringify(buildBridgeRouteMetadata({ cwd: root }), null, 2)}\n`;

  if (check) {
    const current = readFileSync(outputPath, "utf8");
    if (current !== bundled) {
      console.error("openreaper-live-bridge.lua is not up to date with reaper/bridge/src.");
      console.error("Run: npm run build:live-bridge");
      process.exit(1);
    }
    const currentRouteMetadata = readFileSync(metadataPath, "utf8");
    if (currentRouteMetadata !== routeMetadata) {
      console.error(`${routeMetadataFile} is not up to date with ${registryFile}.`);
      console.error("Run: npm run build:live-bridge");
      process.exit(1);
    }
    const registrySummary = validateBridgeHandlerRegistry({ cwd: root });
    console.log(
      `Live bridge bundle ok (${sourceFiles.length} source module(s), ${registrySummary.handlerModuleCount} handler module file(s), ${registrySummary.entryCount} registered handler row(s)).`,
    );
  } else {
    writeFileSync(outputPath, bundled);
    writeFileSync(metadataPath, routeMetadata);
    const registrySummary = validateBridgeHandlerRegistry({ cwd: root });
    console.log(`Built reaper/bridge/openreaper-live-bridge.lua and ${routeMetadataFile} from ${sourceFiles.length} source module(s), ${registrySummary.handlerModuleCount} handler module file(s), and registry gate.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
