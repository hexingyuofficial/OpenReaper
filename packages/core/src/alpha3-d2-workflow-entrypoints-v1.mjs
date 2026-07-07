import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  ALPHA3_D2_WORKFLOW_PACKET_CONTRACT,
  createAlpha3D2WorkflowPacket,
  planAlpha3D2WorkflowPortability,
  validateAlpha3D2WorkflowPacket,
} from "./alpha3-d2-workflow-portability-v1.mjs";
import {
  RECIPE_CONTRACT,
  normalizeRecipeContract,
} from "./recipe-contract-v1.mjs";
import {
  loadUserRecipeAuthoringCatalog,
} from "./user-recipe-authoring-v1.mjs";

export const ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT = "alpha3.d2.workflow_entrypoints.v1";

export const ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
  mode: "local_filesystem_workflow_entrypoints",
  user_word: "workflow",
  developer_shape: "recipe-backed workflow file entrypoints",
  operations: ["save", "scrub", "share", "install", "fork"],
  tool_surface: {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
  },
  filesystem_policy: {
    packet_outputs: "explicit output directory only",
    install_root: "approved recipe root only",
    overwrite_default: false,
  },
  rule: "These entrypoints write workflow packet or recipe files only. Agents still run workflows by reading list_recipes and calling declared call_template/get_state steps.",
});

const USER_SOURCE_LIFECYCLES = Object.freeze({
  user: Object.freeze(["draft", "validated"]),
  community: Object.freeze(["draft", "validated", "community"]),
});

const WORKFLOW_PACKET_SUFFIX = ".workflow-packet.json";
const RECIPE_FILE_SUFFIX = ".recipe.json";
const ENTRYPOINT_LOCAL_FIELD_SET = new Set([
  "operation",
  "output_directory",
  "outputDirectory",
  "recipe_root",
  "recipeRoot",
  "relative_path",
  "relativePath",
  "filename",
  "new_id",
  "newId",
  "title",
  "summary",
  "lifecycle",
  "overwrite",
  "official_recipe_ids",
  "officialRecipeIds",
  "reserved_recipe_ids",
  "reservedRecipeIds",
]);

export function saveAlpha3D2Workflow(request = {}, options = {}) {
  return writeWorkflowPacketOperation("save", request, options);
}

export function scrubAlpha3D2Workflow(request = {}, options = {}) {
  return writeWorkflowPacketOperation("scrub", request, options);
}

export function shareAlpha3D2Workflow(request = {}, options = {}) {
  return writeWorkflowPacketOperation("share", request, options);
}

export function installAlpha3D2Workflow(request = {}, options = {}) {
  const plan = planAlpha3D2WorkflowPortability(
    workflowPortabilityPlanRequest(request, "install"),
    options,
  );
  const blockers = [];
  if (!plan.ok || !plan.packet) blockers.push(...plan.portability.blockers);

  const recipeRoot = request.recipe_root ?? request.recipeRoot ?? options.recipeRoot;
  if (!isNonEmptyString(recipeRoot)) {
    blockers.push(blocker("RECIPE_ROOT_REQUIRED", "$.recipe_root", "Install needs an approved recipe root."));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "install",
      plan,
      blockers,
    });
  }

  const recipe = plan.packet.recipe;
  const relativePath = request.relative_path ?? request.relativePath ?? defaultRecipeRelativePath(recipe.id);
  const targetSource = classifyInstallTargetSource(relativePath);
  blockers.push(...validateRecipeLifecycleForInstall(recipe, targetSource));
  blockers.push(...validateInstallSourceIdentity({
    request,
    plannedPacket: plan.packet,
    targetSource,
  }));
  const resolved = resolveInstallTarget(recipeRoot, relativePath);
  const reservedRecipeIds = normalizeStringSet(
    request.official_recipe_ids
      ?? request.officialRecipeIds
      ?? request.reserved_recipe_ids
      ?? request.reservedRecipeIds
      ?? options.officialRecipeIds
      ?? options.reservedRecipeIds
      ?? [],
  );
  blockers.push(...resolved.blockers);
  if (resolved.path) {
    blockers.push(...preflightInstallCatalog({
      recipeRoot,
      recipeId: recipe.id,
      targetPath: resolved.path,
      overwrite: request.overwrite === true,
      officialRecipeIds: reservedRecipeIds,
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

  const write = writeJsonFileAtomic(resolved.path, recipe, {
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

  const verify = verifyInstalledRecipe({
    recipeRoot,
    recipeId: recipe.id,
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
    paths: resolved.paths,
    verification: verify,
    installed_recipe: recipeSummary(recipe),
    safety: {
      filesystem_write: true,
      install_writes_files: true,
      within_approved_root: true,
    },
  });
}

export function forkAlpha3D2Workflow(request = {}, options = {}) {
  const basePlan = planAlpha3D2WorkflowPortability(
    workflowPortabilityPlanRequest(request, "fork"),
    options,
  );
  const blockers = [];
  if (!basePlan.ok || !basePlan.packet) blockers.push(...basePlan.portability.blockers);
  if (!isNonEmptyString(request.new_id ?? request.newId)) {
    blockers.push(blocker("NEW_RECIPE_ID_REQUIRED", "$.new_id", "Fork needs an explicit new recipe id."));
  }
  if (
    basePlan.packet
    && isNonEmptyString(request.new_id ?? request.newId)
    && (request.new_id ?? request.newId) === basePlan.packet.recipe.id
  ) {
    blockers.push(blocker(
      "FORK_RECIPE_ID_UNCHANGED",
      "$.new_id",
      "Fork needs a new workflow id so it cannot shadow the parent workflow.",
    ));
  }

  const outputDirectory = request.output_directory ?? request.outputDirectory ?? options.outputDirectory;
  if (!isNonEmptyString(outputDirectory)) {
    blockers.push(blocker("OUTPUT_DIRECTORY_REQUIRED", "$.output_directory", "Fork needs an output directory for the forked workflow packet."));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers,
    });
  }

  let forkedRecipe = null;
  try {
    forkedRecipe = normalizeRecipeContract({
      ...basePlan.packet.recipe,
      id: request.new_id ?? request.newId,
      title: boundedRecipeTitle(request.title ?? `${basePlan.packet.recipe.title} fork`),
      summary: boundedRecipeSummary(request.summary ?? `${basePlan.packet.recipe.summary} Forked workflow variant.`),
      lifecycle: request.lifecycle ?? "draft",
    });
  } catch (error) {
    blockers.push(blocker(
      "FORK_RECIPE_INVALID",
      "$.new_id",
      `Forked recipe is invalid: ${error.errors?.join("; ") ?? error.message}`,
    ));
  }

  if (blockers.length > 0) {
    return entrypointResult({
      ok: false,
      operation: "fork",
      plan: basePlan,
      blockers,
    });
  }

  const sourcePacket = packetFromWorkflowEntrypointRequest(request);
  const parentPacketId = sourcePacket?.packet_id ?? basePlan.packet.packet_id;
  const parentRecipeId = sourcePacket?.recipe?.id ?? basePlan.packet.recipe.id;
  const forkedPacket = createAlpha3D2WorkflowPacket({
    recipe: forkedRecipe,
    source: "user",
    provenance: {
      source: "user",
      parent_recipe_id: parentRecipeId,
      parent_packet_id: parentPacketId,
      forked_from: parentPacketId ?? parentRecipeId,
    },
  }, options);
  const validation = validateAlpha3D2WorkflowPacket(forkedPacket);
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
    recipeId: forkedRecipe.id,
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
    forked_recipe: recipeSummary(forkedRecipe),
    safety: {
      filesystem_write: true,
      install_writes_files: false,
      within_approved_root: null,
    },
  });
}

function writeWorkflowPacketOperation(operation, request, options) {
  const plan = planAlpha3D2WorkflowPortability(
    workflowPortabilityPlanRequest(request, operation),
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
    recipeId: plan.packet.recipe.id,
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
    saved_workflow: recipeSummary(plan.packet.recipe),
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
  saved_workflow = null,
  installed_recipe = null,
  forked_recipe = null,
  safety = {},
}) {
  return deepFreeze({
    contract: ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
    ok,
    operation,
    status: ok ? "succeeded" : "blocked",
    mode: "local_filesystem_workflow_entrypoint",
    user_word: "workflow",
    paths,
    packet,
    workflow: saved_workflow ?? installed_recipe ?? forked_recipe ?? (plan?.workflow ?? null),
    blockers: uniqueBlockers(blockers),
    verification,
    safety: {
      added_tools: 0,
      public_call_recipe: false,
      hidden_executor: false,
      raw_lua_action_shell_or_ui: false,
      live_reaper: false,
      safe_write: false,
      filesystem_write: safety.filesystem_write === true,
      install_writes_files: safety.install_writes_files === true,
      within_approved_root: safety.within_approved_root ?? null,
      execution_path: ["list_recipes", "call_template", "get_state"],
    },
    next_step: ok
      ? nextStep(operation)
      : "Resolve blockers and retry the workflow file entrypoint.",
  });
}

function resolveOutputPacketPath({ outputDirectory, filename, recipeId }) {
  const blockers = [];
  const directory = path.resolve(outputDirectory);
  const targetFilename = filename ?? defaultWorkflowPacketFilename(recipeId);
  if (!isSafeBasename(targetFilename) || !targetFilename.endsWith(WORKFLOW_PACKET_SUFFIX)) {
    blockers.push(blocker("PACKET_FILENAME_INVALID", "$.filename", `Packet filename must be a basename ending with ${WORKFLOW_PACKET_SUFFIX}.`));
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

function resolveInstallTarget(recipeRoot, relativePath) {
  const blockers = [];
  const root = path.resolve(recipeRoot);
  if (!isSafeRelativePath(relativePath) || !relativePath.endsWith(RECIPE_FILE_SUFFIX)) {
    blockers.push(blocker("INSTALL_PATH_INVALID", "$.relative_path", `Install path must be a relative path ending with ${RECIPE_FILE_SUFFIX}.`));
    return { blockers, path: null, paths: { recipe_root: root } };
  }

  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const targetPath = path.resolve(rootReal, relativePath);
  if (!isInsideRoot(rootReal, targetPath)) {
    blockers.push(blocker("INSTALL_PATH_ESCAPE", "$.relative_path", "Install path must stay inside the approved recipe root."));
    return { blockers, path: null, paths: { recipe_root: rootReal } };
  }
  const parent = path.dirname(targetPath);
  mkdirSync(parent, { recursive: true });
  const parentReal = realpathSync(parent);
  if (!isInsideRoot(rootReal, parentReal)) {
    blockers.push(blocker("INSTALL_PATH_ESCAPE", "$.relative_path", "Install parent resolved outside the approved recipe root."));
    return { blockers, path: null, paths: { recipe_root: rootReal } };
  }

  return {
    blockers,
    path: targetPath,
    paths: {
      recipe_root: rootReal,
      recipe_path: targetPath,
      relative_path: relativePath,
    },
  };
}

function preflightInstallCatalog({ recipeRoot, recipeId, targetPath, overwrite, officialRecipeIds = [] }) {
  const blockers = [];
  const root = path.resolve(recipeRoot);
  const discoveredOfficialIds = discoverSiblingOfficialRecipeIds(root);
  blockers.push(...discoveredOfficialIds.blockers);
  const reservedIds = normalizeStringSet([
    ...officialRecipeIds,
    ...discoveredOfficialIds.ids,
  ]);
  if (reservedIds.has(recipeId)) {
    blockers.push(blocker(
      "RECIPE_ID_RESERVED",
      "$.recipe.id",
      `Recipe id ${recipeId} is reserved by an official workflow; fork before installing into a user root.`,
    ));
  }
  if (existsSync(targetPath) && !overwrite) {
    blockers.push(blocker("TARGET_EXISTS", "$.relative_path", "Install target already exists. Pass overwrite only when the user intends to replace it."));
  }

  let authoring = null;
  try {
    authoring = loadUserRecipeAuthoringCatalog({
      roots: [{ source: "user", root }],
      officialRecipeIds: [...reservedIds],
    });
  } catch (error) {
    blockers.push(blocker("INSTALL_ROOT_INVALID", "$.recipe_root", `Existing recipe root is not loadable: ${error.message}`));
    return blockers;
  }

  const existing = authoring.sources.filter((source) => source.id === recipeId);
  for (const source of existing) {
    const samePath = path.resolve(source.path) === path.resolve(targetPath);
    if (!samePath || !overwrite) {
      blockers.push(blocker("RECIPE_ID_ALREADY_INSTALLED", "$.recipe.id", `Recipe id ${recipeId} is already installed at ${source.path}.`));
    }
  }
  return blockers;
}

function discoverSiblingOfficialRecipeIds(recipeRoot) {
  const root = path.resolve(recipeRoot);
  const recipesDir = path.dirname(root);
  if (path.basename(root) !== "user" || path.basename(recipesDir) !== "recipes") {
    return { ids: [], blockers: [] };
  }
  const officialRoot = path.join(recipesDir, "official");
  if (!existsSync(officialRoot)) return { ids: [], blockers: [] };

  try {
    const official = loadUserRecipeAuthoringCatalog({
      roots: [{ source: "official", root: officialRoot }],
    });
    return {
      ids: official.sources
        .filter((source) => source.source === "official")
        .map((source) => source.id),
      blockers: [],
    };
  } catch (error) {
    return {
      ids: [],
      blockers: [blocker(
        "OFFICIAL_RECIPE_INDEX_UNREADABLE",
        "$.recipe_root",
        `Sibling official recipe catalog could not be read before install: ${error.message}`,
      )],
    };
  }
}

function verifyInstalledRecipe({ recipeRoot, recipeId, installedPath, wroteNewFile }) {
  try {
    const authoring = loadUserRecipeAuthoringCatalog({
      roots: [{ source: "user", root: path.resolve(recipeRoot) }],
    });
    const installed = authoring.sources.find((source) =>
      source.id === recipeId && path.resolve(source.path) === path.resolve(installedPath)
    );
    if (!installed) {
      return {
        ok: false,
        rolled_back: rollbackNewFile(installedPath, wroteNewFile),
        blockers: [blocker("INSTALL_VERIFY_FAILED", "$.recipe", "Installed recipe was not visible to the user recipe catalog.")],
      };
    }
    return {
      ok: true,
      catalog_contract: authoring.contract,
      installed_id: recipeId,
      installed_path: installedPath,
      rolled_back: false,
    };
  } catch (error) {
    return {
      ok: false,
      rolled_back: rollbackNewFile(installedPath, wroteNewFile),
      blockers: [blocker("INSTALL_VERIFY_FAILED", "$.recipe_root", `Installed recipe catalog verification failed: ${error.message}`)],
    };
  }
}

function rollbackNewFile(filePath, wroteNewFile) {
  if (!wroteNewFile) return false;
  rmSync(filePath, { force: true });
  return true;
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

function validateRecipeLifecycleForInstall(recipe, targetSource) {
  const allowed = USER_SOURCE_LIFECYCLES[targetSource] ?? USER_SOURCE_LIFECYCLES.user;
  if (allowed.includes(recipe.lifecycle)) return [];
  return [blocker(
    "INSTALL_LIFECYCLE_NOT_ALLOWED",
    "$.recipe.lifecycle",
    `${targetSource} installs may not claim lifecycle ${recipe.lifecycle}. Fork or downgrade the workflow before installing.`,
  )];
}

function validateInstallSourceIdentity({ request, plannedPacket, targetSource }) {
  const sourcePacket = packetFromWorkflowEntrypointRequest(request);
  const source = sourcePacket?.provenance?.source ?? plannedPacket?.provenance?.source;
  if (source !== "official" || targetSource === "official") return [];
  return [blocker(
    "OFFICIAL_WORKFLOW_INSTALL_REQUIRES_FORK",
    "$.packet.provenance.source",
    "Official workflows must be forked to a new user workflow id before installing into a user or community recipe root.",
  )];
}

function classifyInstallTargetSource(relativePath) {
  return String(relativePath).split("/")[0] === "community" ? "community" : "user";
}

function defaultWorkflowPacketFilename(recipeId) {
  return `${recipeId.replace(/^recipe\./, "")}${WORKFLOW_PACKET_SUFFIX}`;
}

function defaultRecipeRelativePath(recipeId) {
  const withoutPrefix = recipeId.replace(/^recipe\./, "");
  const [pack, ...segments] = withoutPrefix.split(".");
  return path.posix.join(pack, `${segments.join(".")}${RECIPE_FILE_SUFFIX}`);
}

function packetFromWorkflowEntrypointRequest(request) {
  if (request?.contract === ALPHA3_D2_WORKFLOW_PACKET_CONTRACT) {
    return cleanEntrypointAugmentedPacket(request);
  }
  if (isPlainObject(request?.packet) && request.packet.contract === ALPHA3_D2_WORKFLOW_PACKET_CONTRACT) {
    return request.packet;
  }
  return null;
}

function workflowPortabilityPlanRequest(request, operation) {
  const planRequest = { operation };
  if (isNonEmptyString(request?.source)) planRequest.source = request.source;
  if (isPlainObject(request?.provenance)) planRequest.provenance = request.provenance;
  if (isNonEmptyString(request?.forked_from)) planRequest.forked_from = request.forked_from;

  if (request?.contract === ALPHA3_D2_WORKFLOW_PACKET_CONTRACT) {
    const packet = cleanEntrypointAugmentedPacket(request);
    planRequest.packet = packet;
    applyPacketProvenanceToPlanRequest(planRequest, packet);
  } else if (request?.contract === RECIPE_CONTRACT) {
    planRequest.recipe = request;
  } else {
    if (isPlainObject(request?.packet)) {
      planRequest.packet = request.packet;
      applyPacketProvenanceToPlanRequest(planRequest, request.packet);
    }
    if (isPlainObject(request?.recipe)) planRequest.recipe = request.recipe;
  }

  return planRequest;
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

function recipeSummary(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    summary: recipe.summary,
    pack: recipe.pack,
    lifecycle: recipe.lifecycle,
    risk: recipe.risk,
  };
}

function nextStep(operation) {
  if (operation === "install") return "Run list_recipes or load the user recipe catalog to discover the installed workflow.";
  if (operation === "fork") return "Install the forked packet only after the user approves the new workflow id.";
  if (operation === "share") return "Send the workflow packet; the receiver should validate before installing.";
  if (operation === "scrub") return "Use this scrubbed workflow packet for share/install/fork.";
  return "Keep or share the saved workflow packet.";
}

function boundedRecipeTitle(title) {
  const text = String(title).trim();
  return text.length <= 80 ? text : text.slice(0, 80);
}

function boundedRecipeSummary(summary) {
  const text = String(summary).trim();
  return text.length <= 240 ? text : text.slice(0, 240);
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

function normalizeStringSet(values) {
  const list = Array.isArray(values) ? values : [values];
  return new Set(list.filter(isNonEmptyString));
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
