import {
  lstatSync,
  opendirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  FOUNDATION_BRIDGE_REF_KINDS,
} from "./foundation-bridge-v1.mjs";
import {
  RECIPE_BUDGETS,
  RecipeContractValidationError,
  createRecipeCatalog,
  normalizeRecipeContract,
} from "./recipe-contract-v1.mjs";
import {
  EXECUTABLE_RECIPE_REVISION_CONTRACT,
  createExecutableDependencyCatalog,
  executableRevisionDiscoveryProjection,
  normalizeExecutableRecipeRevision,
} from "./executable-recipe-contract-v1.mjs";
import {
  ARTIFACT_LAST_RESULT_POLICY,
  parseArtifactRef,
} from "./artifact-state-store-v1.mjs";
import {
  createTemplateCatalogAlpha3C3Templates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "./template-catalog-fixtures-v1.mjs";
import { createTemplateCatalog } from "./template-catalog-v1.mjs";
import { TEMPLATE_DESCRIPTOR_TAG_PATTERN } from "./template-descriptor-v1.mjs";

export const USER_RECIPE_AUTHORING_CONTRACT = "user_recipe_authoring.v1";
export const USER_EXECUTABLE_RECIPE_REVISION_SUFFIX = ".executable-revision.json";
export const USER_EXECUTABLE_RECIPE_STORE_CONTRACT = "recipe.executable.store.v1";

export const USER_RECIPE_SOURCE_TYPES = Object.freeze([
  "official",
  "user",
  "community",
]);

export const USER_RECIPE_SOURCE_LIFECYCLES = Object.freeze({
  official: Object.freeze([
    "draft",
    "validated",
    "fake_smoked",
    "live_smoked",
    "official",
    "deprecated",
  ]),
  user: Object.freeze(["draft", "validated"]),
  community: Object.freeze(["draft", "validated", "community"]),
});

export const USER_RECIPE_FILE_SUFFIX = ".recipe.json";

const SOURCE_TYPE_SET = new Set(USER_RECIPE_SOURCE_TYPES);
const REF_KIND_SET = new Set(FOUNDATION_BRIDGE_REF_KINDS);
const IGNORED_RECIPE_ROOT_FILES = new Set([".gitkeep", ".DS_Store"]);
const BLOCKED_RECIPE_SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".lua",
  ".sh",
  ".command",
  ".yaml",
  ".yml",
]);
const BLOCKED_ARTIFACT_REF_PATTERNS = Object.freeze([
  /^file:\/\//i,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
  /^(?:\/|~\/|[A-Za-z]:[\\/])/,
  /\$\{/,
]);
const BLOCKED_LITERAL_REF_PATTERNS = Object.freeze([
  /^(?:shell|sh|bash|python|node|osascript|action|lua|bridge):/i,
  /^file:\/\//i,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
  /^(?:\/|~\/|[A-Za-z]:[\\/])/,
  /\$\{/,
  /^(?:run_command|run_action|run_job|query_state|artifact_metadata)$/i,
  /(?:^|[._:-])(?:raw_lua|lua|script|run_shell|shell_command|run_action|action_id|bridge_operation)(?:[._:-]|$)/i,
]);

const ACCEPTED_TEMPLATE_CATALOG = createTemplateCatalog({
  templates: [
    ...createTemplateCatalogWave1aTemplates(),
    ...createTemplateCatalogWave2aTemplates(),
    ...createTemplateCatalogWave3bTemplates(),
    ...createTemplateCatalogP1Templates(),
    ...createTemplateCatalogAlpha3C3Templates(),
  ],
});
const ACCEPTED_TEMPLATE_BY_ID = new Map(
  ACCEPTED_TEMPLATE_CATALOG.list().map((descriptor) => [descriptor.id, descriptor]),
);

export class UserRecipeAuthoringError extends Error {
  constructor(message, errors = [message], details = {}) {
    super(message);
    this.name = "UserRecipeAuthoringError";
    this.errors = errors;
    this.details = details;
    if (details?.code) this.code = details.code;
  }
}

export function defaultUserRecipeSourceRoots(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  return Object.freeze([
    Object.freeze({ source: "official", root: path.join(root, "recipes", "official") }),
    Object.freeze({ source: "user", root: path.join(root, "recipes", "user") }),
  ]);
}

export function loadUserRecipeCatalog(options = {}) {
  return loadUserRecipeAuthoringCatalog(options).catalog;
}

export function loadUserRecipeAuthoringCatalog(options = {}) {
  const roots = normalizeSourceRoots(options.roots ?? defaultUserRecipeSourceRoots(options.repoRoot));
  const files = discoverRecipeSourceFiles(roots);
  const executableFiles = discoverExecutableRevisionFiles(roots);
  const records = [];
  const executableRevisions = [];
  const errors = [];
  const dependencyCatalog = options.executableDependencyCatalog
    ?? createExecutableDependencyCatalog(options.executableDependencyFacts ?? {
      macros: [],
      templates: [],
      capabilities: [],
    });

  for (const file of files) {
    try {
      const parsed = parseRecipeSourceFile(file);
      const recipe = normalizeRecipeContract(parsed);
      validateRecipeSourcePolicy(recipe, file.source, file.relative_path);
      validateRecipeAuthoringGraph(recipe);
      records.push({
        source: file.source,
        root: file.root,
        path: file.path,
        relative_path: file.relative_path,
        recipe,
      });
    } catch (error) {
      if (error instanceof RecipeContractValidationError || error instanceof UserRecipeAuthoringError) {
        for (const detail of error.errors) {
          errors.push(`${file.relative_path}: ${detail}`);
        }
      } else {
        throw error;
      }
    }
  }

  for (const file of executableFiles) {
    try {
      const parsed = parseExecutableRevisionSourceFile(file);
      const revision = normalizeExecutableRecipeRevision(parsed, {
        catalog: dependencyCatalog,
      });
      executableRevisions.push({
        source: file.source,
        root: file.root,
        path: file.path,
        relative_path: file.relative_path,
        revision,
        discovery: executableRevisionDiscoveryProjection(revision, {
          catalog: dependencyCatalog,
        }),
      });
    } catch (error) {
      if (error?.errors && Array.isArray(error.errors)) {
        for (const detail of error.errors) {
          errors.push(`${file.relative_path}: ${detail}`);
        }
      } else {
        throw error;
      }
    }
  }

  const reservedOfficialIds = options.officialRecipeIds ?? [];
  errors.push(...validateRecipeSourceIdentity(records, reservedOfficialIds));
  errors.push(...validateExecutableRevisionIdentity(executableRevisions, reservedOfficialIds));
  errors.push(...validateCrossFormatRecipeOwnership(records, executableRevisions, reservedOfficialIds));

  if (errors.length > 0) {
    throw new UserRecipeAuthoringError(
      `User recipe authoring validation failed: ${errors.join("; ")}`,
      errors,
    );
  }

  const catalog = createRecipeCatalog({ recipes: records.map((record) => record.recipe) });
  return deepFreeze({
    contract: USER_RECIPE_AUTHORING_CONTRACT,
    sources: records.map((record) => ({
      source: record.source,
      path: record.path,
      relative_path: record.relative_path,
      id: record.recipe.id,
      lifecycle: record.recipe.lifecycle,
    })),
    executable_revisions: executableRevisions.map((record) => ({
      source: record.source,
      path: record.path,
      relative_path: record.relative_path,
      recipe_id: record.revision.recipe_id,
      version: record.revision.version,
      revision: record.revision.revision,
      content_hash: record.revision.content_hash,
      immutable: record.revision.immutable,
      discovery: record.discovery,
    })),
    catalog,
  });
}

export function discoverRecipeSourceFiles(roots) {
  const sourceRoots = normalizeSourceRoots(roots);
  const files = [];
  const errors = [];

  for (const sourceRoot of sourceRoots) {
    if (!sourceRoot.exists) continue;
    walkRecipeSourceRoot({
      sourceRoot,
      currentPath: sourceRoot.real_root,
      relativePath: "",
      files,
      errors,
      visitedDirectories: new Set([sourceRoot.real_root]),
      mode: "recipe",
    });
  }

  if (errors.length > 0) {
    throw new UserRecipeAuthoringError(
      `Recipe source discovery failed: ${errors.join("; ")}`,
      errors,
    );
  }

  return deepFreeze(files.sort((left, right) => left.path.localeCompare(right.path)));
}

export function discoverExecutableRevisionFiles(roots, options = {}) {
  const sourceRoots = normalizeSourceRoots(roots);
  const files = [];
  const errors = [];
  // Optional store budgets. Absent options preserve historical unbounded behavior.
  const scanBudget = normalizeOptionalScanBudget(options.scan_budget ?? options.scanBudget);

  for (const sourceRoot of sourceRoots) {
    if (!sourceRoot.exists) continue;
    walkRecipeSourceRoot({
      sourceRoot,
      currentPath: sourceRoot.real_root,
      relativePath: "",
      files,
      errors,
      visitedDirectories: new Set([sourceRoot.real_root]),
      mode: "executable_revision",
      scanBudget,
    });
  }

  if (errors.length > 0) {
    throw new UserRecipeAuthoringError(
      `Executable revision discovery failed: ${errors.join("; ")}`,
      errors,
    );
  }

  return deepFreeze(files.sort((left, right) => left.path.localeCompare(right.path)));
}

function normalizeOptionalScanBudget(input) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== "object") {
    throw new UserRecipeAuthoringError("scan_budget must be an object when provided.");
  }
  const maxFiles = input.max_files ?? input.maxFiles;
  const maxBytes = input.max_bytes ?? input.maxBytes;
  if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles < 1)) {
    throw new UserRecipeAuthoringError("scan_budget.max_files must be a positive integer.");
  }
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1)) {
    throw new UserRecipeAuthoringError("scan_budget.max_bytes must be a positive integer.");
  }
  return {
    max_files: maxFiles,
    max_bytes: maxBytes,
    scanned_bytes: 0,
    visited_entries: 0,
  };
}

export function parseRecipeSourceFile(file) {
  if (!isPlainObject(file) || typeof file.path !== "string") {
    throw new UserRecipeAuthoringError("Recipe source file metadata must include path.");
  }
  if (!file.path.endsWith(USER_RECIPE_FILE_SUFFIX)) {
    throw new UserRecipeAuthoringError(`Recipe source files must end with ${USER_RECIPE_FILE_SUFFIX}.`);
  }

  const source = readFileSync(file.path, "utf8");
  if (Buffer.byteLength(source, "utf8") > RECIPE_BUDGETS.recipe_max_bytes) {
    throw new UserRecipeAuthoringError(`Recipe source exceeds ${RECIPE_BUDGETS.recipe_max_bytes} bytes.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new UserRecipeAuthoringError(`Recipe source must be strict JSON: ${error.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new UserRecipeAuthoringError("Recipe source must be a single JSON object.");
  }
  return parsed;
}

export function parseExecutableRevisionSourceFile(file) {
  if (!isPlainObject(file) || typeof file.path !== "string") {
    throw new UserRecipeAuthoringError("Executable revision source file metadata must include path.");
  }
  if (!file.path.endsWith(USER_EXECUTABLE_RECIPE_REVISION_SUFFIX)) {
    throw new UserRecipeAuthoringError(
      `Executable revision source files must end with ${USER_EXECUTABLE_RECIPE_REVISION_SUFFIX}.`,
    );
  }

  const source = readFileSync(file.path, "utf8");
  if (Buffer.byteLength(source, "utf8") > RECIPE_BUDGETS.recipe_max_bytes * 3) {
    throw new UserRecipeAuthoringError("Executable revision source exceeds bounded payload size.");
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new UserRecipeAuthoringError(`Executable revision source must be strict JSON: ${error.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new UserRecipeAuthoringError("Executable revision source must be a single JSON object.");
  }
  if (parsed.contract !== EXECUTABLE_RECIPE_REVISION_CONTRACT) {
    throw new UserRecipeAuthoringError(
      `Executable revision contract must be ${EXECUTABLE_RECIPE_REVISION_CONTRACT}.`,
    );
  }
  return parsed;
}

function normalizeSourceRoots(roots) {
  if (!Array.isArray(roots)) {
    throw new UserRecipeAuthoringError("Recipe source roots must be an array.");
  }

  const normalized = [];
  const seen = new Set();
  for (const [index, root] of roots.entries()) {
    if (!isPlainObject(root)) {
      throw new UserRecipeAuthoringError(`Recipe source roots[${index}] must be an object.`);
    }
    if (!SOURCE_TYPE_SET.has(root.source)) {
      throw new UserRecipeAuthoringError(`Recipe source roots[${index}].source is invalid: ${String(root.source)}.`);
    }
    if (typeof root.root !== "string" || root.root.trim() === "") {
      throw new UserRecipeAuthoringError(`Recipe source roots[${index}].root must be a non-empty path string.`);
    }

    const absoluteRoot = path.resolve(root.root);
    if (seen.has(`${root.source}:${absoluteRoot}`)) continue;
    seen.add(`${root.source}:${absoluteRoot}`);

    let exists = true;
    let realRoot = absoluteRoot;
    try {
      const stat = statSync(absoluteRoot);
      if (!stat.isDirectory()) {
        throw new UserRecipeAuthoringError(`Recipe source root is not a directory: ${absoluteRoot}.`);
      }
      realRoot = realpathSync(absoluteRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        exists = false;
      } else if (error instanceof UserRecipeAuthoringError) {
        throw error;
      } else {
        throw new UserRecipeAuthoringError(`Recipe source root cannot be read: ${absoluteRoot}.`);
      }
    }

    normalized.push({
      source: root.source,
      root: absoluteRoot,
      real_root: realRoot,
      exists,
    });
  }

  return deepFreeze(normalized);
}

function walkRecipeSourceRoot({
  sourceRoot,
  currentPath,
  relativePath,
  files,
  errors,
  visitedDirectories,
  mode = "recipe",
  scanBudget = null,
}) {
  // Bounded mode uses incremental opendirSync and counts every visited entry
  // (dirs, ignored files, symlinks, revisions) against max_files before lstat.
  // Unbounded legacy callers keep readdirSync materialization.
  forEachDirectoryEntry(currentPath, scanBudget, (entry) => {
    const entryRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
    const fullPath = path.join(currentPath, entry.name);

    if (scanBudget?.max_files !== undefined) {
      scanBudget.visited_entries += 1;
      if (scanBudget.visited_entries > scanBudget.max_files) {
        throw new UserRecipeAuthoringError(
          `Executable revision discovery exceeds max_files budget (${scanBudget.max_files}).`,
          [`max_files budget ${scanBudget.max_files} exceeded`],
          {
            code: "STORE_BUDGET_EXCEEDED",
            budget: "max_scan_files",
            limit: scanBudget.max_files,
            observed: scanBudget.visited_entries,
            path: fullPath,
            relative_path: entryRelativePath,
          },
        );
      }
    }

    let stats = lstatSync(fullPath);
    let realPath = fullPath;

    if (stats.isSymbolicLink()) {
      realPath = realpathSync(fullPath);
      if (!isInsideRoot(sourceRoot.real_root, realPath)) {
        errors.push(`${entryRelativePath}: symlink target escapes approved recipe root.`);
        return;
      }
      stats = statSync(realPath);
    } else {
      realPath = realpathSync(fullPath);
      if (!isInsideRoot(sourceRoot.real_root, realPath)) {
        errors.push(`${entryRelativePath}: path escapes approved recipe root.`);
        return;
      }
    }

    if (stats.isDirectory()) {
      if (visitedDirectories.has(realPath)) {
        errors.push(`${entryRelativePath}: directory cycle in recipe source root.`);
        return;
      }
      visitedDirectories.add(realPath);
      walkRecipeSourceRoot({
        sourceRoot,
        currentPath: realPath,
        relativePath: entryRelativePath,
        files,
        errors,
        visitedDirectories,
        mode,
        scanBudget,
      });
      return;
    }

    if (!stats.isFile()) {
      errors.push(`${entryRelativePath}: recipe source entry must be a file or directory.`);
      return;
    }

    if (IGNORED_RECIPE_ROOT_FILES.has(entry.name)) return;
    validateRecipeSourceFilename(entryRelativePath, errors, mode);
    const acceptedSuffix = mode === "executable_revision"
      ? USER_EXECUTABLE_RECIPE_REVISION_SUFFIX
      : USER_RECIPE_FILE_SUFFIX;
    if (!entryRelativePath.endsWith(acceptedSuffix)) return;

    if (scanBudget?.max_bytes !== undefined) {
      const nextBytes = scanBudget.scanned_bytes + stats.size;
      if (nextBytes > scanBudget.max_bytes) {
        throw new UserRecipeAuthoringError(
          `Executable revision discovery exceeds max_bytes budget (${scanBudget.max_bytes}).`,
          [`max_bytes budget ${scanBudget.max_bytes} exceeded`],
          {
            code: "STORE_BUDGET_EXCEEDED",
            budget: "max_scan_bytes",
            limit: scanBudget.max_bytes,
            observed: nextBytes,
            path: realPath,
            relative_path: entryRelativePath,
            size: stats.size,
          },
        );
      }
      scanBudget.scanned_bytes = nextBytes;
    }

    files.push({
      source: classifyRecipeSource(sourceRoot.source, entryRelativePath),
      root: sourceRoot.root,
      path: realPath,
      relative_path: entryRelativePath,
      size: stats.size,
    });
  });
}

function forEachDirectoryEntry(currentPath, scanBudget, onEntry) {
  if (!scanBudget) {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      onEntry(entry);
    }
    return;
  }

  // Genuinely incremental synchronous directory API for bounded store discovery.
  const dir = opendirSync(currentPath, { bufferSize: 1 });
  try {
    let entry = dir.readSync();
    while (entry !== null) {
      onEntry(entry);
      entry = dir.readSync();
    }
  } finally {
    dir.closeSync();
  }
}

function validateRecipeSourceFilename(relativePath, errors, mode = "recipe") {
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(basename);
  if (relativePath.endsWith(USER_RECIPE_FILE_SUFFIX)) return;
  if (relativePath.endsWith(USER_EXECUTABLE_RECIPE_REVISION_SUFFIX)) return;

  if (BLOCKED_RECIPE_SOURCE_EXTENSIONS.has(extension)) {
    errors.push(`${relativePath}: executable or ambiguous recipe source extension is forbidden.`);
    return;
  }
  if (extension === "") {
    errors.push(`${relativePath}: extensionless recipe source files are forbidden.`);
    return;
  }
  if (extension === ".json") {
    if (mode === "executable_revision") {
      errors.push(
        `${relativePath}: executable revision JSON files must use ${USER_EXECUTABLE_RECIPE_REVISION_SUFFIX}.`,
      );
      return;
    }
    errors.push(`${relativePath}: recipe JSON files must use ${USER_RECIPE_FILE_SUFFIX}.`);
    return;
  }
  errors.push(`${relativePath}: unsupported file in recipe source root.`);
}

function classifyRecipeSource(rootSource, relativePath) {
  if (rootSource === "user") {
    const firstSegment = relativePath.split("/")[0];
    if (firstSegment === "community") return "community";
  }
  return rootSource;
}

function validateRecipeSourcePolicy(recipe, source, relativePath) {
  const allowed = USER_RECIPE_SOURCE_LIFECYCLES[source] ?? [];
  const errors = [];
  if (!allowed.includes(recipe.lifecycle)) {
    errors.push(`${source} recipes may not claim lifecycle ${recipe.lifecycle}.`);
  }
  if (source !== "official" && recipe.lifecycle === "deprecated") {
    errors.push(`${source} recipes may not claim deprecated lifecycle in narrow Layer 6.`);
  }
  if (source !== "official" && /^official(?:\/|$)/.test(relativePath)) {
    errors.push("user/community recipes must not be placed under an official-looking path.");
  }
  if (errors.length > 0) {
    throw new UserRecipeAuthoringError(
      `Recipe source policy failed: ${errors.join("; ")}`,
      errors,
    );
  }
}

function validateRecipeSourceIdentity(records, reservedOfficialIds) {
  const errors = [];
  const byId = new Map();
  const officialIds = new Set(reservedOfficialIds);

  for (const record of records) {
    if (record.source === "official") officialIds.add(record.recipe.id);
  }

  for (const record of records) {
    const previous = byId.get(record.recipe.id);
    if (previous) {
      errors.push(
        `Duplicate recipe id ${record.recipe.id} in ${previous.relative_path} and ${record.relative_path}.`,
      );
    } else {
      byId.set(record.recipe.id, record);
    }
    if (record.source !== "official" && officialIds.has(record.recipe.id)) {
      errors.push(`${record.relative_path}: user/community recipe shadows official recipe id ${record.recipe.id}.`);
    }
  }

  return errors;
}

function validateExecutableRevisionIdentity(records, reservedOfficialIds = []) {
  const errors = [];
  const byExactKey = new Map();
  const byRecipeAndRevision = new Map();
  const byRecipeId = new Map();
  const officialExecutableIds = new Set(
    records.filter((record) => record.source === "official").map((record) => record.revision.recipe_id),
  );
  const reservedIds = new Set(reservedOfficialIds);

  for (const record of records) {
    if (record.revision.immutable !== true) {
      errors.push(`${record.relative_path}: saved executable revision must be immutable.`);
    }

    const recipeId = record.revision.recipe_id;
    const version = record.revision.version;
    const revisionNumber = record.revision.revision;
    const exactKey = `${recipeId}@${version}#${revisionNumber}`;
    const previousExact = byExactKey.get(exactKey);
    if (previousExact) {
      errors.push(
        `Duplicate executable revision ${exactKey} in ${previousExact.relative_path} and ${record.relative_path}.`,
      );
    } else {
      byExactKey.set(exactKey, record);
    }

    const revisionKey = `${recipeId}#${revisionNumber}`;
    const previousRevision = byRecipeAndRevision.get(revisionKey);
    if (previousRevision) {
      errors.push(
        `Duplicate revision number ${revisionNumber} for recipe_id ${recipeId} in ${previousRevision.relative_path} and ${record.relative_path}.`,
      );
    } else {
      byRecipeAndRevision.set(revisionKey, record);
    }

    if (!byRecipeId.has(recipeId)) byRecipeId.set(recipeId, []);
    byRecipeId.get(recipeId).push(record);

    if (record.source !== "official") {
      if (officialExecutableIds.has(recipeId)) {
        errors.push(
          `${record.relative_path}: non-official executable revision shadows official executable recipe id ${recipeId}.`,
        );
      }
      if (reservedIds.has(recipeId)) {
        errors.push(
          `${record.relative_path}: non-official executable revision shadows reserved official recipe id ${recipeId}.`,
        );
      }
    }
  }

  for (const [recipeId, group] of byRecipeId.entries()) {
    const sources = new Set(group.map((record) => record.source));
    if (sources.size > 1) {
      errors.push(
        `Executable revisions for recipe_id ${recipeId} must share one consistent source ownership.`,
      );
    }

    const ordered = [...group].sort((left, right) => left.revision.revision - right.revision.revision);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (compareBoundedSemver(previous.revision.version, current.revision.version) > 0) {
        errors.push(
          `Executable revision version for recipe_id ${recipeId} decreases from ${previous.revision.version} (r${previous.revision.revision}) to ${current.revision.version} (r${current.revision.revision}).`,
        );
      }
    }
  }

  return errors;
}

function validateCrossFormatRecipeOwnership(historicalRecords, executableRecords, reservedOfficialIds = []) {
  const errors = [];
  const officialHistoricalIds = new Set(
    historicalRecords
      .filter((record) => record.source === "official")
      .map((record) => record.recipe.id),
  );
  const officialExecutableIds = new Set(
    executableRecords
      .filter((record) => record.source === "official")
      .map((record) => record.revision.recipe_id),
  );
  for (const id of reservedOfficialIds) {
    officialHistoricalIds.add(id);
    officialExecutableIds.add(id);
  }

  for (const record of historicalRecords) {
    if (record.source === "official") continue;
    if (officialExecutableIds.has(record.recipe.id)) {
      errors.push(
        `${record.relative_path}: non-official historical recipe shadows official executable recipe id ${record.recipe.id}.`,
      );
    }
  }

  for (const record of executableRecords) {
    if (record.source === "official") continue;
    if (officialHistoricalIds.has(record.revision.recipe_id)) {
      errors.push(
        `${record.relative_path}: non-official executable revision shadows official historical recipe id ${record.revision.recipe_id}.`,
      );
    }
  }

  return [...new Set(errors)];
}

function compareBoundedSemver(left, right) {
  const leftParts = parseBoundedSemver(left);
  const rightParts = parseBoundedSemver(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function parseBoundedSemver(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [
    BigInt(match[1]),
    BigInt(match[2]),
    BigInt(match[3]),
  ];
}

function validateRecipeAuthoringGraph(recipe) {
  const errors = [];
  const priorSteps = new Map();
  const expectedArtifacts = new Set();

  for (const assertion of recipe.assertions) {
    if (assertion.kind !== "expected_output") continue;
    for (const artifact of assertion.outputs.artifacts) {
      if (!TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(artifact)) {
        errors.push(`Expected artifact output label must use lower snake-case: ${artifact}.`);
      }
      expectedArtifacts.add(artifact);
    }
  }

  for (const step of recipe.steps) {
    if (step.uses === "get_state") {
      validateGetStateArtifactBindings(step, expectedArtifacts, errors);
      priorSteps.set(step.id, { step, descriptor: null });
      continue;
    }

    const descriptor = ACCEPTED_TEMPLATE_BY_ID.get(step.call_template.id);
    if (!descriptor) {
      priorSteps.set(step.id, { step, descriptor: null });
      continue;
    }

    validateCallTemplateRefBindings({
      step,
      descriptor,
      priorSteps,
      errors,
    });
    priorSteps.set(step.id, { step, descriptor });
  }

  if (errors.length > 0) {
    throw new UserRecipeAuthoringError(
      `Recipe authoring graph validation failed: ${errors.join("; ")}`,
      errors,
    );
  }
}

function validateCallTemplateRefBindings({
  step,
  descriptor,
  priorSteps,
  errors,
}) {
  const refs = step.call_template.refs;
  const declarations = new Map(descriptor.refs.input.map((entry) => [entry.name, entry]));

  for (const key of Object.keys(refs)) {
    if (!declarations.has(key)) {
      errors.push(`Step ${step.id} refs.${key} is not declared by ${descriptor.id}.`);
    }
  }

  for (const declaration of descriptor.refs.input) {
    if (!Object.hasOwn(refs, declaration.name)) {
      if (declaration.required) {
        errors.push(`Step ${step.id} refs.${declaration.name} is required by ${descriptor.id}.`);
      }
      continue;
    }
    validateRefBindingValue({
      step,
      refName: declaration.name,
      declaration,
      value: refs[declaration.name],
      priorSteps,
      errors,
    });
  }
}

function validateRefBindingValue({
  step,
  refName,
  declaration,
  value,
  priorSteps,
  errors,
}) {
  if (!isPlainObject(value)) {
    errors.push(`Step ${step.id} refs.${refName} must be a literal ref object or $from_step binding.`);
    return;
  }
  if (Object.hasOwn(value, "$from_step")) {
    validateSymbolicRefBinding({
      step,
      refName,
      declaration,
      value,
      priorSteps,
      errors,
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) {
      errors.push(`Step ${step.id} refs.${refName} contains unsupported binding operator: ${key}.`);
    }
  }
  validateLiteralRefObject(value, `Step ${step.id} refs.${refName}`, declaration.kind, errors);
}

function validateSymbolicRefBinding({
  step,
  refName,
  declaration,
  value,
  priorSteps,
  errors,
}) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== "$from_step" && key !== "output") {
      errors.push(`Step ${step.id} refs.${refName} symbolic binding has unsupported field: ${key}.`);
    }
  }
  if (typeof value.$from_step !== "string" || !TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(value.$from_step)) {
    errors.push(`Step ${step.id} refs.${refName}.$from_step must name an earlier lower-snake step id.`);
    return;
  }
  if (typeof value.output !== "string" || !TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(value.output)) {
    errors.push(`Step ${step.id} refs.${refName}.output must be a lower-snake output name.`);
    return;
  }
  const source = priorSteps.get(value.$from_step);
  if (!source) {
    errors.push(`Step ${step.id} refs.${refName} references non-earlier step: ${value.$from_step}.`);
    return;
  }
  if (source.step.uses !== "call_template" || !source.descriptor) {
    errors.push(`Step ${step.id} refs.${refName} must bind from an earlier call_template step.`);
    return;
  }

  const descriptorOutput = source.descriptor.refs.output.find((entry) => entry.name === value.output);
  if (!descriptorOutput) {
    errors.push(
      `Step ${step.id} refs.${refName} output ${value.output} is not declared by ${source.descriptor.id} refs.output.`,
    );
    return;
  }
  if (descriptorOutput && descriptorOutput.kind !== declaration.kind) {
    errors.push(
      `Step ${step.id} refs.${refName} requires ${declaration.kind}, but ${source.step.id}.${value.output} is ${descriptorOutput.kind}.`,
    );
  }
}

function validateLiteralRefObject(value, label, expectedKind, errors) {
  if (typeof value.kind !== "string" || !REF_KIND_SET.has(value.kind)) {
    errors.push(`${label}.kind must be a frozen ref kind.`);
  } else if (value.kind !== expectedKind) {
    errors.push(`${label}.kind must be ${expectedKind}.`);
  }
  if (typeof value.ref !== "string" || value.ref.trim() === "") {
    errors.push(`${label}.ref must be a non-empty string.`);
  } else {
    validateLiteralRefString(value.ref, label, expectedKind, errors);
  }
  if (!isPlainObject(value.identity)) {
    errors.push(`${label}.identity must be an object.`);
  } else {
    if (typeof value.identity.scheme !== "string" || value.identity.scheme.trim() === "") {
      errors.push(`${label}.identity.scheme must be a non-empty string.`);
    }
    if (typeof value.identity.value !== "string" || value.identity.value.trim() === "") {
      errors.push(`${label}.identity.value must be a non-empty string.`);
    }
  }
  if (value.kind === "artifact") validateCanonicalArtifactRef(value.ref, label, errors);
}

function validateLiteralRefString(ref, label, expectedKind, errors) {
  if (BLOCKED_LITERAL_REF_PATTERNS.some((pattern) => pattern.test(ref))) {
    errors.push(`${label}.ref must not be raw execution, bridge-looking, path, traversal, shell expansion, or file URL.`);
    return;
  }
  if (!ref.startsWith(`${expectedKind}:`)) {
    errors.push(`${label}.ref must start with ${expectedKind}:.`);
  }
}

function validateGetStateArtifactBindings(step, expectedArtifacts, errors) {
  if (!step.get_state.projection.startsWith("artifact.")) {
    for (const ref of step.get_state.refs) rejectForbiddenArtifactRefAlias(ref, `Step ${step.id} get_state.refs`, errors);
    return;
  }

  if (!["artifact.summary", "artifact.payload"].includes(step.get_state.projection)) {
    errors.push(`Step ${step.id} get_state artifact projection must be artifact.summary or artifact.payload.`);
  }
  if (step.get_state.refs.length !== 1) {
    errors.push(`Step ${step.id} get_state artifact projection must name exactly one artifact ref.`);
    return;
  }
  const [ref] = step.get_state.refs;
  rejectForbiddenArtifactRefAlias(ref, `Step ${step.id} get_state.refs`, errors);
  if (typeof ref !== "string") return;
  if (!expectedArtifacts.has(ref)) {
    errors.push(`Step ${step.id} get_state artifact ref must be a declared artifact output label.`);
  }
}

function rejectForbiddenArtifactRefAlias(ref, label, errors) {
  if (typeof ref !== "string") return;
  if (ref === ARTIFACT_LAST_RESULT_POLICY.forbidden_public_ref_pattern || /^last_result:artifact:[0-9]+$/.test(ref)) {
    errors.push(`${label} must not use public last_result artifact refs.`);
  }
  if (BLOCKED_ARTIFACT_REF_PATTERNS.some((pattern) => pattern.test(ref))) {
    errors.push(`${label} must not use raw paths, traversal, shell expansion, or file URLs.`);
  }
}

function validateCanonicalArtifactRef(ref, label, errors) {
  try {
    parseArtifactRef(ref);
  } catch (error) {
    errors.push(`${label} must be a canonical artifact ref: ${error.message}`);
  }
}

function isInsideRoot(root, candidatePath) {
  const relative = path.relative(root, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
