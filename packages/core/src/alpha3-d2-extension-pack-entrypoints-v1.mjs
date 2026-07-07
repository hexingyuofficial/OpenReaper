import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
  ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT,
  createAlpha3D2ExtensionPackPacket,
  planAlpha3D2ExtensionPackPortability,
  validateAlpha3D2ExtensionPackManifest,
  validateAlpha3D2ExtensionPackPacket,
} from "./alpha3-d2-extension-pack-portability-v1.mjs";

export const ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT = "alpha3.d2.extension_pack_entrypoints.v1";
export const ALPHA3_D2_EXTENSION_PACK_REGISTRY_CONTRACT = "alpha3.d2.extension_pack_registry.v1";

export const ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT,
  mode: "local_filesystem_extension_pack_entrypoints",
  user_word: "pack",
  developer_shape: "extension pack manifest and packet file entrypoints",
  operations: ["save", "scrub", "share", "install", "fork"],
  tool_surface: {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
  },
  install_policy: {
    manifest_outputs: "approved extension pack root only",
    enable_default: false,
    executable_entries_exposed: false,
    global_aliases: false,
  },
  rule: "Installing an extension pack records manifest metadata only. Runtime execution remains authorized through accepted OpenReaper catalog truth.",
});

const PACKET_SUFFIX = ".extension-pack-packet.json";
const MANIFEST_FILENAME = "extension-pack.manifest.json";
const REGISTRY_FILENAME = "extension-pack-registry.json";
const ENTRYPOINT_LOCAL_FIELD_SET = new Set([
  "operation",
  "output_directory",
  "outputDirectory",
  "pack_root",
  "packRoot",
  "relative_path",
  "relativePath",
  "filename",
  "new_namespace",
  "newNamespace",
  "display_name",
  "displayName",
  "version",
  "source",
  "overwrite",
  "enable",
]);

export function saveAlpha3D2ExtensionPack(request = {}, options = {}) {
  return writeExtensionPackPacketOperation("save", request, options);
}

export function scrubAlpha3D2ExtensionPack(request = {}, options = {}) {
  return writeExtensionPackPacketOperation("scrub", request, options);
}

export function shareAlpha3D2ExtensionPack(request = {}, options = {}) {
  return writeExtensionPackPacketOperation("share", request, options);
}

export function installAlpha3D2ExtensionPack(request = {}, options = {}) {
  const plan = planAlpha3D2ExtensionPackPortability(
    extensionPackPortabilityPlanRequest(request, "install"),
    options,
  );
  const blockers = [];
  if (!plan.ok || !plan.packet) blockers.push(...plan.portability.blockers);

  const packRoot = request.pack_root ?? request.packRoot ?? options.packRoot;
  if (!isNonEmptyString(packRoot)) {
    blockers.push(blocker("PACK_ROOT_REQUIRED", "$.pack_root", "Install needs an approved extension pack root."));
  }
  if (request.enable === true) {
    blockers.push(blocker("ENABLE_NOT_IN_PORTABILITY_GATE", "$.enable", "D2.3 install records the pack manifest only; enabling executable entries is a later bounded gate."));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "install",
      plan,
      blockers,
    });
  }

  const manifest = plan.packet.manifest;
  const relativePath = request.relative_path ?? request.relativePath ?? defaultManifestRelativePath(manifest.namespace);
  const resolved = resolveInstallTarget(packRoot, relativePath);
  blockers.push(...resolved.blockers);
  if (resolved.path) {
    blockers.push(...preflightInstallRegistry({
      packRoot,
      manifest,
      targetPath: resolved.path,
      overwrite: request.overwrite === true,
    }));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "install",
      plan,
      blockers,
      paths: resolved.paths,
    });
  }

  const write = writeJsonFileAtomic(resolved.path, manifest, {
    overwrite: request.overwrite === true,
  });
  if (!write.ok) {
    return entrypointResult({
      ok: false,
      operation: "install",
      plan,
      blockers: write.blockers,
      paths: resolved.paths,
    });
  }

  const registry = writeExtensionPackRegistry(packRoot);
  if (!registry.ok) {
    rollbackNewFile(resolved.path, write.wrote_new_file);
    return entrypointResult({
      ok: false,
      operation: "install",
      plan,
      blockers: registry.blockers,
      paths: resolved.paths,
      verification: registry,
    });
  }

  const verify = verifyInstalledPack({
    packRoot,
    namespace: manifest.namespace,
    installedPath: resolved.path,
    wroteNewFile: write.wrote_new_file,
  });
  if (!verify.ok) {
    return entrypointResult({
      ok: false,
      operation: "install",
      plan,
      blockers: verify.blockers,
      paths: resolved.paths,
      verification: verify,
    });
  }

  return entrypointResult({
    ok: true,
    operation: "install",
    plan,
    blockers: [],
    paths: {
      ...resolved.paths,
      registry_path: path.join(realpathSync(path.resolve(packRoot)), REGISTRY_FILENAME),
    },
    verification: verify,
    installed_pack: packSummary(manifest),
    safety: {
      filesystem_write: true,
      install_writes_files: true,
      within_approved_root: true,
    },
  });
}

export function forkAlpha3D2ExtensionPack(request = {}, options = {}) {
  const basePlan = planAlpha3D2ExtensionPackPortability(
    extensionPackPortabilityPlanRequest(request, "fork"),
    options,
  );
  const blockers = [];
  if (!basePlan.ok || !basePlan.packet) blockers.push(...basePlan.portability.blockers);
  const newNamespace = request.new_namespace ?? request.newNamespace;
  if (!isNonEmptyString(newNamespace)) {
    blockers.push(blocker("NEW_NAMESPACE_REQUIRED", "$.new_namespace", "Fork needs an explicit new extension pack namespace."));
  }
  if (basePlan.packet && newNamespace === basePlan.packet.manifest.namespace) {
    blockers.push(blocker("FORK_NAMESPACE_UNCHANGED", "$.new_namespace", "Fork needs a new namespace so it cannot shadow the parent pack."));
  }

  const outputDirectory = request.output_directory ?? request.outputDirectory ?? options.outputDirectory;
  if (!isNonEmptyString(outputDirectory)) {
    blockers.push(blocker("OUTPUT_DIRECTORY_REQUIRED", "$.output_directory", "Fork needs an output directory for the forked pack packet."));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers,
    });
  }

  const sourcePacket = packetFromExtensionPackEntrypointRequest(request);
  const parentPacketId = sourcePacket?.packet_id ?? basePlan.packet.packet_id;
  const parentPackId = sourcePacket?.manifest?.pack_id ?? basePlan.packet.manifest.pack_id;
  const forkedManifest = rewriteManifestForFork(basePlan.packet.manifest, {
    newNamespace,
    displayName: request.display_name ?? request.displayName,
    version: request.version,
    source: request.source ?? "local",
  });
  const manifestValidation = validateAlpha3D2ExtensionPackManifest(forkedManifest);
  if (!manifestValidation.ok) {
    blockers.push(...manifestValidation.blockers.map((entry) => ({
      ...entry,
      code: entry.code === "MANIFEST_CONTRACT_INVALID" ? entry.code : `FORK_${entry.code}`,
    })));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers,
    });
  }

  const forkedPacket = createAlpha3D2ExtensionPackPacket({
    manifest: forkedManifest,
    source: forkedManifest.source,
    provenance: {
      source: forkedManifest.source,
      parent_pack_id: parentPackId,
      parent_packet_id: parentPacketId,
      forked_from: parentPacketId ?? parentPackId,
    },
  }, options);
  const validation = validateAlpha3D2ExtensionPackPacket(forkedPacket);
  if (!validation.ok) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers: validation.errors.map((error, index) =>
        blocker("FORK_PACKET_INVALID", `$.packet.errors[${index}]`, error)
      ),
    });
  }

  const target = resolveOutputPacketPath({
    outputDirectory,
    filename: request.filename,
    namespace: forkedManifest.namespace,
  });
  if (target.blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers: target.blockers,
    });
  }

  const write = writeJsonFileAtomic(target.path, forkedPacket, {
    overwrite: request.overwrite === true,
  });
  if (!write.ok) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers: write.blockers,
      paths: target.paths,
    });
  }

  return entrypointResult({
    ok: true,
    operation: "fork",
    plan: basePlan,
    packet: forkedPacket,
    blockers: [],
    paths: target.paths,
    forked_pack: packSummary(forkedManifest),
    safety: {
      filesystem_write: true,
      install_writes_files: false,
      within_approved_root: null,
    },
  });
}

export function loadAlpha3D2ExtensionPackRegistry(packRoot) {
  return buildExtensionPackRegistry(packRoot);
}

function writeExtensionPackPacketOperation(operation, request, options) {
  const plan = planAlpha3D2ExtensionPackPortability(
    extensionPackPortabilityPlanRequest(request, operation),
    options,
  );
  const blockers = [];
  if (!plan.ok || !plan.packet) blockers.push(...plan.portability.blockers);

  const outputDirectory = request.output_directory ?? request.outputDirectory ?? options.outputDirectory;
  if (!isNonEmptyString(outputDirectory)) {
    blockers.push(blocker("OUTPUT_DIRECTORY_REQUIRED", "$.output_directory", `${operation} needs an output directory.`));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation,
      plan,
      blockers,
    });
  }

  const target = resolveOutputPacketPath({
    outputDirectory,
    filename: request.filename,
    namespace: plan.packet.manifest.namespace,
  });
  if (target.blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation,
      plan,
      blockers: target.blockers,
    });
  }

  const write = writeJsonFileAtomic(target.path, plan.packet, {
    overwrite: request.overwrite === true,
  });
  if (!write.ok) {
    return entrypointResult({
      ok: false,
      operation,
      plan,
      blockers: write.blockers,
      paths: target.paths,
    });
  }

  return entrypointResult({
    ok: true,
    operation,
    plan,
    packet: plan.packet,
    blockers: [],
    paths: target.paths,
    saved_pack: packSummary(plan.packet.manifest),
    safety: {
      filesystem_write: true,
      install_writes_files: false,
      within_approved_root: null,
    },
  });
}

function entrypointResult({
  ok,
  operation,
  plan = null,
  packet = null,
  blockers = [],
  paths = {},
  verification = null,
  saved_pack = null,
  installed_pack = null,
  forked_pack = null,
  safety = {},
}) {
  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT,
    ok,
    operation,
    status: ok ? "succeeded" : "blocked",
    mode: "local_filesystem_extension_pack_entrypoint",
    user_word: "pack",
    paths,
    packet,
    pack: saved_pack ?? installed_pack ?? forked_pack ?? (plan?.pack ?? null),
    blockers: uniqueBlockers(blockers),
    verification,
    safety: {
      added_tools: 0,
      public_call_recipe: false,
      hidden_executor: false,
      raw_lua_action_shell_or_ui: false,
      live_reaper: false,
      safe_write: false,
      executable_entries_exposed: false,
      package_scoped_aliases_only: true,
      filesystem_write: safety.filesystem_write === true,
      install_writes_files: safety.install_writes_files === true,
      within_approved_root: safety.within_approved_root ?? null,
      execution_path: ["list_templates", "list_recipes", "call_template", "get_state"],
    },
    next_step: ok
      ? nextStep(operation)
      : "Resolve blockers and retry the extension pack file entrypoint.",
  });
}

function resolveOutputPacketPath({ outputDirectory, filename, namespace }) {
  const blockers = [];
  const directory = path.resolve(outputDirectory);
  const targetFilename = filename ?? defaultPacketFilename(namespace);
  if (!isSafeBasename(targetFilename) || !targetFilename.endsWith(PACKET_SUFFIX)) {
    blockers.push(blocker("PACKET_FILENAME_INVALID", "$.filename", `Packet filename must be a basename ending with ${PACKET_SUFFIX}.`));
  }
  if (blockers.length > 0) return { blockers, path: null, paths: {} };
  mkdirSync(directory, { recursive: true });
  const resolvedPath = path.join(directory, targetFilename);
  return {
    blockers,
    path: resolvedPath,
    paths: {
      output_directory: directory,
      packet_path: resolvedPath,
      packet_filename: targetFilename,
    },
  };
}

function resolveInstallTarget(packRoot, relativePath) {
  const blockers = [];
  const root = path.resolve(packRoot);
  if (!isSafeRelativePath(relativePath) || !relativePath.endsWith(MANIFEST_FILENAME)) {
    blockers.push(blocker("INSTALL_PATH_INVALID", "$.relative_path", `Install path must be relative and end with ${MANIFEST_FILENAME}.`));
    return { blockers, path: null, paths: { pack_root: root } };
  }

  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const targetPath = path.resolve(rootReal, relativePath);
  if (!isInsideRoot(rootReal, targetPath)) {
    blockers.push(blocker("INSTALL_PATH_ESCAPE", "$.relative_path", "Install path must stay inside the approved pack root."));
    return { blockers, path: null, paths: { pack_root: rootReal } };
  }
  const parent = path.dirname(targetPath);
  mkdirSync(parent, { recursive: true });
  const parentReal = realpathSync(parent);
  if (!isInsideRoot(rootReal, parentReal)) {
    blockers.push(blocker("INSTALL_PATH_ESCAPE", "$.relative_path", "Install parent resolved outside the approved pack root."));
    return { blockers, path: null, paths: { pack_root: rootReal } };
  }

  return {
    blockers,
    path: targetPath,
    paths: {
      pack_root: rootReal,
      manifest_path: targetPath,
      relative_path: relativePath,
    },
  };
}

function preflightInstallRegistry({ packRoot, manifest, targetPath, overwrite }) {
  const blockers = [];
  if (existsSync(targetPath) && !overwrite) {
    blockers.push(blocker("TARGET_EXISTS", "$.relative_path", "Install target already exists. Pass overwrite only when intended."));
  }
  let registry = null;
  try {
    registry = buildExtensionPackRegistry(packRoot);
  } catch (error) {
    blockers.push(blocker("PACK_ROOT_INVALID", "$.pack_root", `Existing pack root is not loadable: ${error.message}`));
    return blockers;
  }

  const byNamespace = registry.packs.find((entry) => entry.namespace === manifest.namespace);
  if (byNamespace && (path.resolve(byNamespace.path) !== path.resolve(targetPath) || !overwrite)) {
    blockers.push(blocker("PACK_NAMESPACE_ALREADY_INSTALLED", "$.manifest.namespace", `Pack namespace ${manifest.namespace} is already installed at ${byNamespace.path}.`));
  }
  const byId = registry.packs.find((entry) => entry.pack_id === manifest.pack_id);
  if (byId && (path.resolve(byId.path) !== path.resolve(targetPath) || !overwrite)) {
    blockers.push(blocker("PACK_ID_ALREADY_INSTALLED", "$.manifest.pack_id", `Pack id ${manifest.pack_id} is already installed at ${byId.path}.`));
  }
  return blockers;
}

function verifyInstalledPack({ packRoot, namespace, installedPath, wroteNewFile }) {
  try {
    const registry = buildExtensionPackRegistry(packRoot);
    const installed = registry.packs.find((entry) =>
      entry.namespace === namespace && path.resolve(entry.path) === path.resolve(installedPath)
    );
    if (!installed) {
      return {
        ok: false,
        rolled_back: rollbackNewFile(installedPath, wroteNewFile),
        blockers: [blocker("INSTALL_VERIFY_FAILED", "$.manifest", "Installed pack was not visible to the extension pack registry.")],
      };
    }
    return {
      ok: true,
      registry_contract: registry.contract,
      installed_namespace: namespace,
      installed_path: installedPath,
      executable_entries_exposed: false,
      rolled_back: false,
    };
  } catch (error) {
    return {
      ok: false,
      rolled_back: rollbackNewFile(installedPath, wroteNewFile),
      blockers: [blocker("INSTALL_VERIFY_FAILED", "$.pack_root", `Installed pack registry verification failed: ${error.message}`)],
    };
  }
}

function writeExtensionPackRegistry(packRoot) {
  try {
    const registry = buildExtensionPackRegistry(packRoot);
    const rootReal = realpathSync(path.resolve(packRoot));
    const registryPath = path.join(rootReal, REGISTRY_FILENAME);
    const write = writeJsonFileAtomic(registryPath, registry, { overwrite: true });
    if (!write.ok) return { ok: false, blockers: write.blockers };
    return { ok: true, registry, path: registryPath, blockers: [] };
  } catch (error) {
    return {
      ok: false,
      blockers: [blocker("REGISTRY_WRITE_FAILED", "$.pack_root", `Extension pack registry write failed: ${error.message}`)],
    };
  }
}

function buildExtensionPackRegistry(packRoot) {
  const root = path.resolve(packRoot);
  if (!existsSync(root)) {
    return deepFreeze({
      contract: ALPHA3_D2_EXTENSION_PACK_REGISTRY_CONTRACT,
      mode: "manifest_registry_no_execution_enable",
      pack_root: root,
      packs: [],
      executable_entries_exposed: false,
    });
  }
  const rootReal = realpathSync(root);
  const manifests = discoverManifestFiles(rootReal);
  const packs = [];
  const blockers = [];
  const seenNamespace = new Map();
  const seenPackId = new Map();

  for (const manifestPath of manifests) {
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      blockers.push(blocker("MANIFEST_JSON_INVALID", manifestPath, `Manifest is not strict JSON: ${error.message}`));
      continue;
    }
    const validation = validateAlpha3D2ExtensionPackManifest(parsed);
    if (!validation.ok) {
      blockers.push(...validation.blockers.map((entry) => ({
        ...entry,
        path: `${manifestPath}${entry.path}`,
      })));
      continue;
    }
    const manifest = validation.manifest;
    const relativePath = path.relative(rootReal, manifestPath).split(path.sep).join("/");
    const priorNamespace = seenNamespace.get(manifest.namespace);
    if (priorNamespace) blockers.push(blocker("PACK_NAMESPACE_DUPLICATE", manifestPath, `Duplicate namespace with ${priorNamespace}.`));
    const priorPackId = seenPackId.get(manifest.pack_id);
    if (priorPackId) blockers.push(blocker("PACK_ID_DUPLICATE", manifestPath, `Duplicate pack id with ${priorPackId}.`));
    seenNamespace.set(manifest.namespace, manifestPath);
    seenPackId.set(manifest.pack_id, manifestPath);
    packs.push({
      ...packSummary(manifest),
      path: manifestPath,
      relative_path: relativePath,
      enabled: false,
      executable_entries_exposed: false,
    });
  }

  if (blockers.length > 0) {
    const error = new Error(`Extension pack registry validation failed: ${blockers.map((entry) => entry.message).join("; ")}`);
    error.blockers = blockers;
    throw error;
  }

  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_REGISTRY_CONTRACT,
    mode: "manifest_registry_no_execution_enable",
    pack_root: rootReal,
    packs: packs.sort((left, right) => left.namespace.localeCompare(right.namespace)),
    executable_entries_exposed: false,
  });
}

function discoverManifestFiles(root) {
  const output = [];
  walkDirectory(root, output, new Set([root]));
  return output.sort();
}

function walkDirectory(directory, output, visited) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store" || entry.name === REGISTRY_FILENAME) continue;
    const fullPath = path.join(directory, entry.name);
    const realPath = realpathSync(fullPath);
    if (entry.isDirectory()) {
      if (visited.has(realPath)) continue;
      visited.add(realPath);
      walkDirectory(realPath, output, visited);
      continue;
    }
    if (entry.isFile() && entry.name === MANIFEST_FILENAME) output.push(realPath);
  }
}

function writeJsonFileAtomic(filePath, value, { overwrite = false } = {}) {
  if (existsSync(filePath) && !overwrite) {
    return {
      ok: false,
      wrote_new_file: false,
      blockers: [blocker("TARGET_EXISTS", "$.path", "Target file already exists. Pass overwrite only when intended.")],
    };
  }
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  if (existsSync(filePath)) {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return {
        ok: false,
        wrote_new_file: false,
        blockers: [blocker("TARGET_NOT_FILE", "$.path", "Target exists but is not a file.")],
      };
    }
  }
  const tempPath = path.join(parent, `.${path.basename(filePath)}.${process.pid}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const wroteNewFile = !existsSync(filePath);
  renameSync(tempPath, filePath);
  return {
    ok: true,
    path: filePath,
    wrote_new_file: wroteNewFile,
    blockers: [],
  };
}

function rollbackNewFile(filePath, wroteNewFile) {
  if (!wroteNewFile) return false;
  rmSync(filePath, { force: true });
  return true;
}

function extensionPackPortabilityPlanRequest(request, operation) {
  const planRequest = { operation };
  if (isNonEmptyString(request?.source)) planRequest.source = request.source;
  if (isPlainObject(request?.provenance)) planRequest.provenance = request.provenance;
  if (isNonEmptyString(request?.forked_from)) planRequest.forked_from = request.forked_from;

  if (request?.contract === ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT) {
    const packet = cleanEntrypointAugmentedPacket(request);
    planRequest.packet = packet;
    applyPacketProvenanceToPlanRequest(planRequest, packet);
  } else if (request?.contract === ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT) {
    planRequest.manifest = request;
  } else {
    if (isPlainObject(request?.packet)) {
      planRequest.packet = request.packet;
      applyPacketProvenanceToPlanRequest(planRequest, request.packet);
    }
    if (isPlainObject(request?.manifest)) planRequest.manifest = request.manifest;
  }
  return planRequest;
}

function packetFromExtensionPackEntrypointRequest(request) {
  if (request?.contract === ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT) return cleanEntrypointAugmentedPacket(request);
  if (isPlainObject(request?.packet) && request.packet.contract === ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT) {
    return request.packet;
  }
  return null;
}

function applyPacketProvenanceToPlanRequest(planRequest, packet) {
  if (!isPlainObject(packet?.provenance)) return;
  if (!isNonEmptyString(planRequest.source) && isNonEmptyString(packet.provenance.source)) {
    planRequest.source = packet.provenance.source;
  }
  if (!isPlainObject(planRequest.provenance)) {
    planRequest.provenance = packet.provenance;
  }
  if (!isNonEmptyString(planRequest.forked_from) && isNonEmptyString(packet.provenance.forked_from)) {
    planRequest.forked_from = packet.provenance.forked_from;
  }
}

function cleanEntrypointAugmentedPacket(packet) {
  const clean = {};
  for (const [key, value] of Object.entries(packet)) {
    if (ENTRYPOINT_LOCAL_FIELD_SET.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function rewriteManifestForFork(manifest, { newNamespace, displayName, version, source }) {
  const next = JSON.parse(JSON.stringify(manifest));
  next.namespace = newNamespace;
  next.pack_id = `extension_pack.${newNamespace}`;
  next.display_name = displayName ?? `${manifest.display_name} fork`;
  next.version = version ?? manifest.version;
  next.source = source ?? "local";
  next.support_status = next.support_status === "supported" || next.support_status === "live_smoked"
    ? "schema_validated"
    : next.support_status;
  next.dependencies = rewriteDependencyNamespace(next.dependencies, manifest.namespace, newNamespace);
  next.contributed_capabilities = next.contributed_capabilities.map((capability) => {
    const oldPrefix = `capability.${manifest.namespace}.`;
    return rewriteCapabilityNamespace(capability, oldPrefix, `capability.${newNamespace}.`, manifest.namespace, newNamespace);
  });
  next.aliases = next.aliases.map((alias) => ({
    ...alias,
    alias: `${newNamespace}.${alias.alias.split(".").slice(manifest.namespace.split(".").length).join(".")}`,
    target: alias.target.replace(`capability.${manifest.namespace}.`, `capability.${newNamespace}.`),
    scope: "package",
    exact_match: true,
  }));
  return next;
}

function rewriteDependencyNamespace(dependencies, oldNamespace, newNamespace) {
  const next = JSON.parse(JSON.stringify(dependencies));
  for (const field of ["services", "indexes"]) {
    if (Array.isArray(next[field])) next[field] = rewriteNamespaceStrings(next[field], oldNamespace, newNamespace);
  }
  return next;
}

function rewriteCapabilityNamespace(capability, oldPrefix, newPrefix, oldNamespace, newNamespace) {
  const next = JSON.parse(JSON.stringify(capability));
  next.capability_id = next.capability_id.replace(oldPrefix, newPrefix);
  for (const field of ["required_services", "required_indexes"]) {
    if (Array.isArray(next[field])) next[field] = rewriteNamespaceStrings(next[field], oldNamespace, newNamespace);
  }
  return next;
}

function rewriteNamespaceStrings(values, oldNamespace, newNamespace) {
  return values.map((value) => {
    if (typeof value !== "string") return value;
    if (value === oldNamespace) return newNamespace;
    if (value.startsWith(`${oldNamespace}.`)) return `${newNamespace}${value.slice(oldNamespace.length)}`;
    return value;
  });
}

function defaultPacketFilename(namespace) {
  return `${namespace}${PACKET_SUFFIX}`;
}

function defaultManifestRelativePath(namespace) {
  return path.posix.join(namespace, MANIFEST_FILENAME);
}

function packSummary(manifest) {
  return {
    pack_id: manifest.pack_id,
    namespace: manifest.namespace,
    display_name: manifest.display_name,
    kind: manifest.kind,
    source: manifest.source,
    version: manifest.version,
    support_status: manifest.support_status,
    permissions: [...manifest.permissions].sort(),
    capability_count: manifest.contributed_capabilities.length,
    alias_count: manifest.aliases.length,
  };
}

function nextStep(operation) {
  if (operation === "install") return "Review pack dependencies and permissions before any later enable step.";
  if (operation === "fork") return "Install the forked pack only after the user approves the new namespace.";
  if (operation === "share") return "Send the pack packet; the receiver should validate before installing.";
  if (operation === "scrub") return "Use this scrubbed pack packet for share/install/fork.";
  return "Keep or share the saved pack packet.";
}

function isSafeBasename(name) {
  return isNonEmptyString(name)
    && path.basename(name) === name
    && !name.includes("\\")
    && !name.includes("..");
}

function isSafeRelativePath(relativePath) {
  if (!isNonEmptyString(relativePath)) return false;
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.includes("\0")) return false;
  const normalized = path.posix.normalize(relativePath);
  return normalized === relativePath
    && !normalized.startsWith("../")
    && normalized !== ".."
    && normalized !== ".";
}

function isInsideRoot(root, candidatePath) {
  const relative = path.relative(root, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function blocker(code, pathValue, message) {
  return {
    severity: "blocker",
    code,
    path: pathValue,
    message,
    recoverable: true,
  };
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  const output = [];
  for (const entry of blockers) {
    const key = `${entry.code}:${entry.path}:${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
