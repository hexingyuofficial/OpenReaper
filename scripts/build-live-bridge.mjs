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
  "40-route-pack-handlers.lua",
  "90-file-transport-loop.lua",
]);

export const registryFile = "reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json";
export const handlerSourceRoot = "reaper/bridge/src/handlers";

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
  "read-b": Object.freeze({
    ids: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
    tests: Object.freeze(["tests/layer4dx/read-b-handler-expansion.test.mjs"]),
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
  return handlerModuleFilesFromRegistry(registry).map((file) => ({
    file,
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

function wrapSourceModule(file, source, handlerModules) {
  if (file !== "40-route-pack-handlers.lua") return source;
  return [
    "-- OpenReaper bridge handler module wrapper: keeps handler locals out of the main Lua chunk.",
    "local dispatch_request = (function()",
    ...handlerModules.map(wrapHandlerModule),
    source,
    "return dispatch_request",
    "end)()",
    "",
  ].join("\n");
}

function wrapHandlerModule({ file, source }) {
  return [
    `-- OpenReaper bridge handler module: ${handlerSourceRoot}/${file}`,
    source.trimEnd(),
    "",
  ].join("\n");
}

function artifactPolicyForDescriptor(descriptor) {
  if (descriptor.artifacts.mode === "none") return "none";
  if (descriptor.artifacts.mode === "metadata") return "metadata";
  return "write";
}

function operationKey(entry) {
  return `${entry.operation.family}:${entry.operation.name}`;
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
  const check = process.argv.includes("--check");
  const bundled = buildLiveBridgeBundle({ cwd: root });

  if (check) {
    const current = readFileSync(outputPath, "utf8");
    if (current !== bundled) {
      console.error("openreaper-live-bridge.lua is not up to date with reaper/bridge/src.");
      console.error("Run: npm run build:live-bridge");
      process.exit(1);
    }
    const registrySummary = validateBridgeHandlerRegistry({ cwd: root });
    console.log(
      `Live bridge bundle ok (${sourceFiles.length} source module(s), ${registrySummary.handlerModuleCount} handler module file(s), ${registrySummary.entryCount} registered handler row(s)).`,
    );
  } else {
    writeFileSync(outputPath, bundled);
    const registrySummary = validateBridgeHandlerRegistry({ cwd: root });
    console.log(`Built reaper/bridge/openreaper-live-bridge.lua from ${sourceFiles.length} source module(s), ${registrySummary.handlerModuleCount} handler module file(s), and registry gate.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
