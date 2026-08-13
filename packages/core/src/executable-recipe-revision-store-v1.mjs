import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  EXECUTABLE_RECIPE_BUDGETS,
  EXECUTABLE_RECIPE_REVISION_CONTRACT,
  createExecutableDependencyCatalog,
  evaluateExecutableRecipeTrust,
  normalizeExecutableRecipeRevision,
  sealExecutableRecipeRevision,
  validateExecutableRecipeDraft,
  validateExecutableRecipeRevision,
} from "./executable-recipe-contract-v1.mjs";
import {
  USER_EXECUTABLE_RECIPE_REVISION_SUFFIX,
  discoverExecutableRevisionFiles,
  loadUserRecipeAuthoringCatalog,
  parseExecutableRevisionSourceFile,
} from "./user-recipe-authoring-v1.mjs";

export const EXECUTABLE_RECIPE_STORE_CONTRACT = "recipe.executable.store.v1";
export const EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX = USER_EXECUTABLE_RECIPE_REVISION_SUFFIX;

export const EXECUTABLE_RECIPE_STORE_ERROR_CODES = Object.freeze([
  "PARAMS_INVALID",
  "REVISION_INVALID",
  "REVISION_NOT_FOUND",
  "REVISION_CONFLICT",
  "REVISION_OWNERSHIP_CONFLICT",
  "REVISION_REGRESSION",
  "REVISION_STALE",
  "PATH_ESCAPE",
  "SYMLINK_ESCAPE",
  "CROSS_FORMAT_SHADOW",
  "DELETE_CONFIRMATION_REQUIRED",
  "DELETE_IDENTITY_MISMATCH",
  "STORE_CORRUPT",
  "STORE_BUDGET_EXCEEDED",
  "ZERO_WRITE_FAILURE",
  "ZERO_DELETE_FAILURE",
]);

export const EXECUTABLE_RECIPE_STORE_BUDGETS = Object.freeze({
  max_scan_files: 512,
  max_list_items: 256,
  max_scan_bytes: 8 * 1024 * 1024,
});

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ALLOWED_SOURCES = Object.freeze(["user", "community", "official"]);
const PLATFORM_ALIAS_NAMES = Object.freeze(["tmp", "var"]);
const STALE_DIAGNOSTIC_MAX_ITEMS = 8;
const STALE_DIAGNOSTIC_MAX_DRIFT = 8;

export class ExecutableRecipeRevisionStoreError extends Error {
  constructor(message, code = "PARAMS_INVALID", details = {}) {
    super(message);
    this.name = "ExecutableRecipeRevisionStoreError";
    this.code = code;
    this.details = details;
  }
}

export function createExecutableRecipeRevisionStore(options = {}) {
  const root = normalizeStoreRoot(options.root ?? options.recipeRoot);
  const source = normalizeStoreSource(options.source ?? "user");
  const catalog = requireCatalog(options.catalog ?? options.executableDependencyCatalog);
  const reservedRecipeIds = collectReservedRecipeIds(options);
  const boundReserved = Object.freeze([...reservedRecipeIds]);

  return deepFreeze({
    contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
    root,
    source,
    validate(input, validateOptions = {}) {
      // Bound catalog always wins; callers may only pass draft/revision validation knobs.
      return validateExecutableRecipeRevisionStoreInput(input, {
        ...pickCallerOptions(validateOptions, []),
        catalog,
      });
    },
    save(input, saveOptions = {}) {
      // Bound root/source/catalog/reserved ownership always win over caller options.
      return saveExecutableRecipeRevision(input, {
        ...pickCallerOptions(saveOptions, [
          "relative_path",
          "relativePath",
          "version",
          "revision",
          "saved_at",
        ]),
        root,
        source,
        catalog,
        reservedRecipeIds: [...boundReserved],
        officialRecipeIds: [...boundReserved],
      });
    },
    list(listOptions = {}) {
      return listExecutableRecipeRevisions({
        ...pickCallerOptions(listOptions, ["filter"]),
        root,
        source,
        catalog,
        reservedRecipeIds: [...boundReserved],
        officialRecipeIds: [...boundReserved],
      });
    },
    get(identity, getOptions = {}) {
      return getExecutableRecipeRevision(identity, {
        ...pickCallerOptions(getOptions, []),
        root,
        source,
        catalog,
        reservedRecipeIds: [...boundReserved],
        officialRecipeIds: [...boundReserved],
      });
    },
    delete(identity, deleteOptions = {}) {
      return deleteExecutableRecipeRevision(identity, {
        ...pickCallerOptions(deleteOptions, ["confirm", "confirmation"]),
        root,
        source,
        catalog,
        reservedRecipeIds: [...boundReserved],
        officialRecipeIds: [...boundReserved],
      });
    },
  });
}

function pickCallerOptions(options, allowedKeys) {
  if (!isPlainObject(options)) return {};
  const picked = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(options, key) && options[key] !== undefined) {
      picked[key] = options[key];
    }
  }
  return picked;
}

export function validateExecutableRecipeRevisionStoreInput(input, options = {}) {
  if (isPlainObject(input) && input.contract === EXECUTABLE_RECIPE_REVISION_CONTRACT) {
    return validateExecutableRecipeRevision(input, options);
  }
  return validateExecutableRecipeDraft(input, options);
}

export function saveExecutableRecipeRevision(input, options = {}) {
  const catalog = requireCatalog(options.catalog);
  const root = normalizeStoreRoot(options.root ?? options.recipeRoot);
  const source = normalizeStoreSource(options.source ?? "user");
  const reservedRecipeIds = collectReservedRecipeIds(options);

  let revision;
  try {
    revision = coerceSealedRevision(input, {
      catalog,
      version: options.version,
      revision: options.revision,
      saved_at: options.saved_at,
    });
  } catch (error) {
    throw toStoreError(error, "REVISION_INVALID");
  }

  assertImmutableRevision(revision);
  if (source !== "official" && reservedRecipeIds.has(revision.recipe_id)) {
    throw new ExecutableRecipeRevisionStoreError(
      `Save refused; recipe id ${revision.recipe_id} is reserved by official ownership.`,
      "REVISION_OWNERSHIP_CONFLICT",
      { recipe_id: revision.recipe_id, source },
    );
  }

  const relativePath = options.relative_path
    ?? options.relativePath
    ?? defaultRevisionRelativePath(revision);
  const target = resolveRootBoundedFilePath(root, relativePath, {
    requiredSuffix: EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX,
    createParents: false,
    allowMissingRoot: true,
  });

  const preflight = preflightSaveConflicts({
    root: target.root,
    source,
    catalog,
    reservedRecipeIds,
    revision,
    targetPath: target.path,
    relativePath: target.relative_path,
  });

  const body = serializeRevision(revision);

  if (preflight.exact_match) {
    return deepFreeze({
      contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
      ok: true,
      operation: "save",
      path: target.path,
      relative_path: target.relative_path,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
      dependency_lock: cloneJson(revision.dependency_lock),
      source_payload_identity: cloneJson(revision.source_payload_identity),
      immutable: true,
      bytes: Buffer.byteLength(body, "utf8"),
      idempotent: true,
      payload: cloneJson(revision),
    });
  }

  const publication = writeUtf8FileAtomicExclusive(target.path, body, target.root);

  return deepFreeze({
    contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
    ok: true,
    operation: "save",
    path: publication.path ?? target.path,
    relative_path: target.relative_path,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
    dependency_lock: cloneJson(revision.dependency_lock),
    source_payload_identity: cloneJson(revision.source_payload_identity),
    immutable: true,
    bytes: Buffer.byteLength(body, "utf8"),
    idempotent: publication?.idempotent === true,
    payload: cloneJson(revision),
  });
}

export function listExecutableRecipeRevisions(options = {}) {
  const catalog = requireCatalog(options.catalog);
  const root = normalizeStoreRoot(options.root ?? options.recipeRoot);
  const source = normalizeStoreSource(options.source ?? "user");
  const reservedRecipeIds = [
    ...collectReservedRecipeIds(options),
  ];
  const filter = isPlainObject(options.filter) ? options.filter : {};
  // Fixed store budgets; never caller-overridable.
  const budgets = EXECUTABLE_RECIPE_STORE_BUDGETS;

  if (!pathExistsNoFollow(root)) {
    return deepFreeze({
      contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
      ok: true,
      operation: "list",
      root: path.resolve(root),
      source,
      count: 0,
      items: [],
      unavailable_count: 0,
      unavailable_items: [],
      unavailable_truncated: false,
    });
  }

  const rootReal = resolveExistingRootDirectory(root);

  // Fixed budgets enforced during discovery traversal (max_scan_files) and before
  // content reads (max_scan_bytes via pre-stat). Callers cannot override budgets.
  let files;
  try {
    files = discoverExecutableRevisionFiles([{ source, root: rootReal }], {
      scan_budget: {
        max_files: budgets.max_scan_files,
        max_bytes: budgets.max_scan_bytes,
      },
    });
  } catch (error) {
    if (error?.code === "STORE_BUDGET_EXCEEDED" || error?.details?.code === "STORE_BUDGET_EXCEEDED") {
      throw new ExecutableRecipeRevisionStoreError(
        error.message,
        "STORE_BUDGET_EXCEEDED",
        {
          budget: error.details?.budget,
          limit: error.details?.limit,
          observed: error.details?.observed,
          path: error.details?.path,
          relative_path: error.details?.relative_path,
        },
      );
    }
    throw toStoreError(error, "STORE_CORRUPT");
  }

  const items = [];
  const unavailableItems = [];
  for (const file of files) {
    // Byte budget already enforced by pre-stat during discovery; re-stat before read.
    let stats;
    try {
      stats = lstatSync(file.path);
    } catch (error) {
      throw new ExecutableRecipeRevisionStoreError(
        `Stored executable revision is unreadable: ${error.message}`,
        "STORE_CORRUPT",
        { path: file.path, relative_path: file.relative_path },
      );
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ExecutableRecipeRevisionStoreError(
        "Stored executable revision path is not a regular file.",
        "STORE_CORRUPT",
        { path: file.path, relative_path: file.relative_path },
      );
    }
    if (typeof file.size === "number" && stats.size !== file.size) {
      throw new ExecutableRecipeRevisionStoreError(
        "Stored executable revision size drifted between discovery and read.",
        "STORE_CORRUPT",
        { path: file.path, relative_path: file.relative_path },
      );
    }

    let parsed;
    try {
      parsed = parseExecutableRevisionSourceFile(file);
    } catch (error) {
      throw new ExecutableRecipeRevisionStoreError(
        `Stored executable revision is corrupt: ${error.message}`,
        "STORE_CORRUPT",
        { path: file.path, relative_path: file.relative_path },
      );
    }

    let revision;
    try {
      revision = normalizeExecutableRecipeRevision(parsed, { catalog });
    } catch (error) {
      const stale = classifyCatalogStaleRevision(parsed, catalog, error, file);
      if (stale) {
        if (filter.recipe_id && stale.recipe_id !== filter.recipe_id) continue;
        if (filter.version && stale.version !== filter.version) continue;
        if (Number.isInteger(filter.revision) && stale.revision !== filter.revision) continue;
        if (filter.content_hash && stale.content_hash !== filter.content_hash) continue;
        unavailableItems.push(stale);
        continue;
      }
      throw new ExecutableRecipeRevisionStoreError(
        `Stored executable revision failed validation: ${error.message}`,
        "STORE_CORRUPT",
        {
          path: file.path,
          relative_path: file.relative_path,
          errors: error.errors ?? [error.message],
        },
      );
    }

    if (filter.recipe_id && revision.recipe_id !== filter.recipe_id) continue;
    if (filter.version && revision.version !== filter.version) continue;
    if (Number.isInteger(filter.revision) && revision.revision !== filter.revision) continue;
    if (filter.content_hash && revision.content_hash !== filter.content_hash) continue;

    if (items.length >= budgets.max_list_items) {
      throw new ExecutableRecipeRevisionStoreError(
        `Store list exceeds max_list_items budget (${budgets.max_list_items}).`,
        "STORE_BUDGET_EXCEEDED",
        {
          budget: "max_list_items",
          limit: budgets.max_list_items,
          observed: items.length + 1,
        },
      );
    }

    items.push(deepFreeze({
      source: file.source,
      path: file.path,
      relative_path: file.relative_path,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
      dependency_lock: cloneJson(revision.dependency_lock),
      source_payload_identity: cloneJson(revision.source_payload_identity),
      immutable: revision.immutable,
      saved_at: revision.saved_at,
      payload: cloneJson(revision),
    }));
  }

  items.sort((left, right) => {
    if (left.recipe_id !== right.recipe_id) return left.recipe_id.localeCompare(right.recipe_id);
    if (left.revision !== right.revision) return left.revision - right.revision;
    return left.relative_path.localeCompare(right.relative_path);
  });
  unavailableItems.sort((left, right) => {
    if (left.recipe_id !== right.recipe_id) return left.recipe_id.localeCompare(right.recipe_id);
    if (left.revision !== right.revision) return left.revision - right.revision;
    return left.relative_path.localeCompare(right.relative_path);
  });

  if (items.length + unavailableItems.length > budgets.max_list_items) {
    throw new ExecutableRecipeRevisionStoreError(
      `Store list exceeds max_list_items budget (${budgets.max_list_items}).`,
      "STORE_BUDGET_EXCEEDED",
      {
        budget: "max_list_items",
        limit: budgets.max_list_items,
        observed: items.length + unavailableItems.length,
      },
    );
  }

  // Store list returns executable revisions only. Historical recipe.contract.v1
  // preservation remains owned by user recipe authoring; no second traversal here.
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
    ok: true,
    operation: "list",
    root: rootReal,
    source,
    count: items.length,
    items,
    unavailable_count: unavailableItems.length,
    unavailable_items: unavailableItems.slice(0, STALE_DIAGNOSTIC_MAX_ITEMS),
    unavailable_truncated: unavailableItems.length > STALE_DIAGNOSTIC_MAX_ITEMS,
  });
}

function classifyCatalogStaleRevision(parsed, catalog, currentError, file) {
  if (!isPlainObject(parsed?.draft) || !Array.isArray(parsed.draft.dependencies)) return null;
  let historicalCatalog;
  try {
    historicalCatalog = createExecutableDependencyCatalog({
      macros: parsed.draft.dependencies
        .filter((entry) => entry?.kind === "macro")
        .map((entry) => ({ ...entry, capabilities: [] })),
      templates: parsed.draft.dependencies
        .filter((entry) => entry?.kind === "template")
        .map((entry) => ({ ...entry, capabilities: [] })),
      capabilities: Array.isArray(parsed.draft.required_capabilities)
        ? parsed.draft.required_capabilities
        : [],
    });
  } catch {
    return null;
  }

  let revision;
  try {
    revision = normalizeExecutableRecipeRevision(parsed, { catalog: historicalCatalog });
  } catch {
    return null;
  }

  const drift = [];
  for (const dependency of revision.draft.dependencies) {
    const current = dependency.kind === "macro"
      ? catalog.getMacro(dependency.id)
      : catalog.getTemplate(dependency.id);
    if (!current) {
      drift.push({ kind: dependency.kind, id: dependency.id, reason: "dependency_unavailable" });
      continue;
    }
    for (const field of ["version", "descriptor_hash", "risk"]) {
      if (current[field] !== dependency[field]) {
        drift.push({ kind: dependency.kind, id: dependency.id, reason: `${field}_drift` });
      }
    }
  }
  for (const capability of revision.draft.required_capabilities) {
    if (!catalog.hasCapability(capability)) {
      drift.push({ kind: "capability", id: capability, reason: "capability_unavailable" });
    }
  }
  if (drift.length === 0) return null;

  return deepFreeze({
    source: file.source,
    path: file.path,
    relative_path: file.relative_path,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
    immutable: revision.immutable,
    lifecycle: "stale",
    executable: false,
    code: "REVISION_STALE",
    reason: "dependency_catalog_drift",
    drift_count: drift.length,
    drift: drift.slice(0, STALE_DIAGNOSTIC_MAX_DRIFT),
    errors: (currentError?.errors ?? [currentError?.message ?? "Current catalog validation failed."])
      .slice(0, 8)
      .map((message) => String(message).slice(0, 240)),
  });
}

export function getExecutableRecipeRevision(identityInput, options = {}) {
  const catalog = requireCatalog(options.catalog);
  const root = normalizeStoreRoot(options.root ?? options.recipeRoot);
  const source = normalizeStoreSource(options.source ?? "user");
  const identity = normalizeExactRevisionIdentity(identityInput, {
    requireContentHash: true,
    requireFullIdentity: false,
  });

  if (!pathExistsNoFollow(root)) {
    throw new ExecutableRecipeRevisionStoreError(
      `Executable revision not found for ${formatIdentity(identity)}.`,
      "REVISION_NOT_FOUND",
      { identity },
    );
  }

  // Prefer bounded exact lookup at the deterministic default path before a full scan.
  const exact = tryGetAtDefaultPath(identity, {
    root,
    source,
    catalog,
  });
  if (exact) {
    assertExactIdentityMatch(exact.payload, identity, { requireFullIdentity: false });
    return exact;
  }

  const listed = listExecutableRecipeRevisions({
    root,
    source,
    catalog,
    officialRecipeIds: options.officialRecipeIds,
    reservedRecipeIds: options.reservedRecipeIds,
    filter: {
      recipe_id: identity.recipe_id,
      version: identity.version,
      revision: identity.revision,
      content_hash: identity.content_hash,
    },
  });

  if (listed.items.length === 0) {
    const stale = listed.unavailable_items?.find((item) => (
      item.recipe_id === identity.recipe_id
      && item.version === identity.version
      && item.revision === identity.revision
      && item.content_hash === identity.content_hash
    ));
    if (stale) {
      throw new ExecutableRecipeRevisionStoreError(
        `Executable revision ${formatIdentity(identity)} is stale against the current dependency catalog.`,
        "REVISION_STALE",
        {
          identity: projectIdentity(identity),
          reason: stale.reason,
          drift: stale.drift,
          zero_write: true,
          revalidation_required: true,
        },
      );
    }
    throw new ExecutableRecipeRevisionStoreError(
      `Executable revision not found for ${formatIdentity(identity)}.`,
      "REVISION_NOT_FOUND",
      { identity },
    );
  }
  if (listed.items.length > 1) {
    throw new ExecutableRecipeRevisionStoreError(
      `Multiple stored revisions match identity ${formatIdentity(identity)}.`,
      "STORE_CORRUPT",
      { identity, count: listed.items.length },
    );
  }

  const item = listed.items[0];
  assertExactIdentityMatch(item.payload, identity, { requireFullIdentity: false });

  return deepFreeze({
    contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
    ok: true,
    operation: "get",
    path: item.path,
    relative_path: item.relative_path,
    recipe_id: item.recipe_id,
    version: item.version,
    revision: item.revision,
    content_hash: item.content_hash,
    validation_result_id: item.validation_result_id,
    dependency_lock: item.dependency_lock,
    source_payload_identity: item.source_payload_identity,
    immutable: true,
    payload: item.payload,
  });
}

function tryGetAtDefaultPath(identity, { root, catalog }) {
  const relativePath = defaultRevisionRelativePath({
    recipe_id: identity.recipe_id,
    version: identity.version,
    revision: identity.revision,
  });
  let target;
  try {
    target = resolveRootBoundedFilePath(root, relativePath, {
      requiredSuffix: EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX,
      allowMissingRoot: false,
    });
  } catch {
    return null;
  }
  if (!pathExistsNoFollow(target.path)) return null;
  const stats = lstatSync(target.path);
  if (stats.isSymbolicLink() || !stats.isFile()) return null;
  if (stats.size > EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_bytes) {
    throw new ExecutableRecipeRevisionStoreError(
      `Store scan exceeds max_scan_bytes budget (${EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_bytes}).`,
      "STORE_BUDGET_EXCEEDED",
      {
        budget: "max_scan_bytes",
        limit: EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_bytes,
        observed: stats.size,
      },
    );
  }

  let revision;
  try {
    revision = normalizeExecutableRecipeRevision(
      parseExecutableRevisionSourceFile({ path: target.path }),
      { catalog },
    );
  } catch {
    return null;
  }

  if (
    revision.recipe_id !== identity.recipe_id
    || revision.version !== identity.version
    || revision.revision !== identity.revision
    || revision.content_hash !== identity.content_hash
  ) {
    return null;
  }

  return deepFreeze({
    contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
    ok: true,
    operation: "get",
    path: target.path,
    relative_path: target.relative_path,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
    dependency_lock: cloneJson(revision.dependency_lock),
    source_payload_identity: cloneJson(revision.source_payload_identity),
    immutable: true,
    payload: cloneJson(revision),
  });
}

export function deleteExecutableRecipeRevision(identityInput, options = {}) {
  const catalog = requireCatalog(options.catalog);
  const root = normalizeStoreRoot(options.root ?? options.recipeRoot);
  const source = normalizeStoreSource(options.source ?? "user");
  const confirm = options.confirm === true || options.confirmation === true;
  if (!confirm) {
    throw new ExecutableRecipeRevisionStoreError(
      "Exact delete requires confirm: true with the complete revision identity.",
      "DELETE_CONFIRMATION_REQUIRED",
    );
  }

  const identity = normalizeExactRevisionIdentity(identityInput, {
    requireContentHash: true,
    requireFullIdentity: true,
  });

  if (!pathExistsNoFollow(root)) {
    throw new ExecutableRecipeRevisionStoreError(
      `Executable revision not found for ${formatIdentity(identity)}.`,
      "REVISION_NOT_FOUND",
      { identity },
    );
  }

  let existing;
  try {
    existing = getExecutableRecipeRevision({
      recipe_id: identity.recipe_id,
      version: identity.version,
      revision: identity.revision,
      content_hash: identity.content_hash,
    }, {
      root,
      source,
      catalog,
      officialRecipeIds: options.officialRecipeIds,
      reservedRecipeIds: options.reservedRecipeIds,
    });
  } catch (error) {
    if (error instanceof ExecutableRecipeRevisionStoreError) {
      throw new ExecutableRecipeRevisionStoreError(
        error.message,
        error.code === "REVISION_NOT_FOUND" ? "REVISION_NOT_FOUND" : "ZERO_DELETE_FAILURE",
        error.details,
      );
    }
    throw error;
  }

  assertExactIdentityMatch(existing.payload, identity, { requireFullIdentity: true });

  const target = resolveExistingRootBoundedFilePath(root, existing.relative_path, {
    requiredSuffix: EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX,
  });

  const preReadFacts = captureFileIdentityFacts(target.path);
  let onDisk;
  try {
    onDisk = normalizeExecutableRecipeRevision(
      parseExecutableRevisionSourceFile({ path: target.path }),
      { catalog },
    );
  } catch (error) {
    throw new ExecutableRecipeRevisionStoreError(
      `Delete refused; on-disk revision is corrupt or invalid: ${error.message}`,
      "ZERO_DELETE_FAILURE",
      { path: target.path, errors: error.errors ?? [error.message] },
    );
  }

  assertExactIdentityMatch(onDisk, identity, { requireFullIdentity: true });
  if (stableStringify(onDisk) !== stableStringify(existing.payload)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Delete refused; on-disk revision content does not match loaded identity payload.",
      "DELETE_IDENTITY_MISMATCH",
      { identity: projectIdentity(identity), path: target.path },
    );
  }

  // Quarantine-then-unlink: remove the checked-target path replacement window under
  // cooperative FS semantics. Not a kernel guarantee against a malicious same-UID process.
  const deleteOutcome = quarantineAndUnlinkVerifiedFile({
    targetPath: target.path,
    root: target.root,
    expectedFacts: preReadFacts,
  });

  return deepFreeze({
    contract: EXECUTABLE_RECIPE_STORE_CONTRACT,
    ok: true,
    operation: "delete",
    deleted: deleteOutcome.deleted === true,
    outcome: deleteOutcome.outcome,
    path: target.path,
    relative_path: target.relative_path,
    recipe_id: identity.recipe_id,
    version: identity.version,
    revision: identity.revision,
    content_hash: identity.content_hash,
    validation_result_id: identity.validation_result_id,
  });
}

function quarantineAndUnlinkVerifiedFile({ targetPath, root, expectedFacts }) {
  const absoluteTarget = path.resolve(targetPath);
  const parent = path.dirname(absoluteTarget);
  assertNoSymlinkComponent(parent, root);
  const parentReal = realpathSync(parent);
  if (!isInsideRoot(root, parentReal)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Delete refused; target parent escaped store root.",
      "PATH_ESCAPE",
      { path: absoluteTarget },
    );
  }

  // Exclusive mode-0700 quarantine directory inside verified parent / same FS.
  // Cooperative filesystem semantics only; not a kernel guarantee against a
  // malicious same-UID process.
  let quarantineDir = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = path.join(
      parentReal,
      `.or-quarantine-${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`,
    );
    try {
      mkdirSync(candidate, { recursive: false, mode: 0o700 });
      const dirStats = lstatSync(candidate);
      if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
        throw new Error("quarantine directory is not a plain directory");
      }
      if (!isInsideRoot(root, candidate)) {
        throw new Error("quarantine directory escaped store root");
      }
      quarantineDir = candidate;
      break;
    } catch (error) {
      if (error && error.code === "EEXIST") continue;
      throw new ExecutableRecipeRevisionStoreError(
        `Delete refused; could not create quarantine directory: ${error.message}`,
        "ZERO_DELETE_FAILURE",
        { path: absoluteTarget, outcome: "zero_delete" },
      );
    }
  }
  if (!quarantineDir) {
    throw new ExecutableRecipeRevisionStoreError(
      "Delete refused; could not allocate exclusive quarantine directory.",
      "ZERO_DELETE_FAILURE",
      { path: absoluteTarget, outcome: "zero_delete" },
    );
  }

  const quarantineFile = path.join(quarantineDir, path.basename(absoluteTarget));
  let renamed = false;
  try {
    // Capture facts immediately before rename; then move target into quarantine.
    const preRenameFacts = captureFileIdentityFacts(absoluteTarget);
    if (!sameFileIdentityFacts(expectedFacts, preRenameFacts)) {
      tryRemoveEmptyQuarantineDir(quarantineDir);
      throw new ExecutableRecipeRevisionStoreError(
        "Delete refused; target file identity drifted before quarantine rename.",
        "ZERO_DELETE_FAILURE",
        {
          path: absoluteTarget,
          expected: expectedFacts,
          actual: preRenameFacts,
          outcome: "zero_delete",
        },
      );
    }

    try {
      renameSync(absoluteTarget, quarantineFile);
      renamed = true;
    } catch (error) {
      tryRemoveEmptyQuarantineDir(quarantineDir);
      if (error && error.code === "ENOENT") {
        throw new ExecutableRecipeRevisionStoreError(
          "Delete refused; target disappeared before quarantine rename.",
          "ZERO_DELETE_FAILURE",
          { path: absoluteTarget, outcome: "zero_delete" },
        );
      }
      throw new ExecutableRecipeRevisionStoreError(
        `Delete refused; quarantine rename failed: ${error.message}`,
        "ZERO_DELETE_FAILURE",
        { path: absoluteTarget, outcome: "zero_delete" },
      );
    }

    // After rename: every unexpected exception must preserve quarantine as unknown.
    let movedFacts;
    try {
      movedFacts = captureFileIdentityFacts(quarantineFile);
    } catch (error) {
      return failClosedPreserveQuarantine({
        quarantineDir,
        quarantineFile,
        absoluteTarget,
        reason: `quarantine file unreadable after rename: ${error.message}`,
      });
    }

    if (
      movedFacts.dev !== expectedFacts.dev
      || movedFacts.ino !== expectedFacts.ino
      || movedFacts.size !== expectedFacts.size
      || movedFacts.mtimeMs !== expectedFacts.mtimeMs
      || movedFacts.nlink !== expectedFacts.nlink
    ) {
      return restoreOrPreserveQuarantine({
        quarantineDir,
        quarantineFile,
        absoluteTarget,
        reason: "quarantine file identity mismatch after rename",
        expected: expectedFacts,
        actual: movedFacts,
      });
    }

    // Revalidate quarantine dir/file as non-symlinks and root-contained before unlink.
    try {
      const qDirStats = lstatSync(quarantineDir);
      if (qDirStats.isSymbolicLink() || !qDirStats.isDirectory()) {
        return failClosedPreserveQuarantine({
          quarantineDir,
          quarantineFile,
          absoluteTarget,
          reason: "quarantine directory became a symlink or non-directory",
        });
      }
      if (!isInsideRoot(root, path.resolve(quarantineDir))) {
        return failClosedPreserveQuarantine({
          quarantineDir,
          quarantineFile,
          absoluteTarget,
          reason: "quarantine directory escaped store root",
        });
      }
      const qFileStats = lstatSync(quarantineFile);
      if (qFileStats.isSymbolicLink() || !qFileStats.isFile()) {
        return failClosedPreserveQuarantine({
          quarantineDir,
          quarantineFile,
          absoluteTarget,
          reason: "quarantine file became a symlink or non-file",
        });
      }
      if (!isInsideRoot(root, path.resolve(quarantineFile))) {
        return failClosedPreserveQuarantine({
          quarantineDir,
          quarantineFile,
          absoluteTarget,
          reason: "quarantine file escaped store root",
        });
      }

      try {
        unlinkSync(quarantineFile);
      } catch (error) {
        return failClosedPreserveQuarantine({
          quarantineDir,
          quarantineFile,
          absoluteTarget,
          reason: `quarantine unlink failed: ${error.message}`,
        });
      }

      tryRemoveEmptyQuarantineDir(quarantineDir);

      return {
        deleted: true,
        outcome: "deleted",
      };
    } catch (error) {
      if (error instanceof ExecutableRecipeRevisionStoreError) throw error;
      return failClosedPreserveQuarantine({
        quarantineDir,
        quarantineFile,
        absoluteTarget,
        reason: `unexpected post-rename failure: ${error.message}`,
      });
    }
  } catch (error) {
    if (!renamed) {
      tryRemoveEmptyQuarantineDir(quarantineDir);
      if (error instanceof ExecutableRecipeRevisionStoreError) throw error;
      throw new ExecutableRecipeRevisionStoreError(
        `Delete failed: ${error.message}`,
        "ZERO_DELETE_FAILURE",
        { path: absoluteTarget, outcome: "zero_delete" },
      );
    }
    if (error instanceof ExecutableRecipeRevisionStoreError) throw error;
    return failClosedPreserveQuarantine({
      quarantineDir,
      quarantineFile,
      absoluteTarget,
      reason: `unexpected post-rename failure: ${error.message}`,
    });
  }
}

function tryRemoveEmptyQuarantineDir(quarantineDir) {
  // Empty-directory-only cleanup. Never recursive rmSync.
  try {
    rmdirSync(quarantineDir);
  } catch {
    // leave non-empty or busy directory in place
  }
}

function restoreOrPreserveQuarantine({
  quarantineDir,
  quarantineFile,
  absoluteTarget,
  reason,
  expected,
  actual,
}) {
  // Never restore via overwriting rename. Exclusive restore only when original path is absent.
  if (pathExistsNoFollow(absoluteTarget)) {
    return failClosedPreserveQuarantine({
      quarantineDir,
      quarantineFile,
      absoluteTarget,
      reason: `${reason}; original path reappeared (left untouched)`,
      expected,
      actual,
    });
  }

  try {
    // Exclusive: linkSync into absent destination.
    linkSync(quarantineFile, absoluteTarget);
  } catch (error) {
    return failClosedPreserveQuarantine({
      quarantineDir,
      quarantineFile,
      absoluteTarget,
      reason: `${reason}; exclusive restore link failed: ${error.message}`,
      expected,
      actual,
    });
  }

  // Restore is complete only if quarantine unlink also succeeds.
  try {
    unlinkSync(quarantineFile);
  } catch (error) {
    // Keep both hard links; do not remove quarantine directory.
    return failClosedPreserveQuarantine({
      quarantineDir,
      quarantineFile,
      absoluteTarget,
      reason: `${reason}; exclusive restore link succeeded but quarantine unlink failed: ${error.message}`,
      expected,
      actual,
    });
  }

  tryRemoveEmptyQuarantineDir(quarantineDir);
  throw new ExecutableRecipeRevisionStoreError(
    `Delete refused; ${reason}. Restored original path exclusively.`,
    "ZERO_DELETE_FAILURE",
    {
      path: absoluteTarget,
      outcome: "restored",
      expected,
      actual,
      product_deleted: false,
    },
  );
}

function failClosedPreserveQuarantine({
  quarantineDir,
  quarantineFile,
  absoluteTarget,
  reason,
  expected,
  actual,
}) {
  throw new ExecutableRecipeRevisionStoreError(
    `Delete outcome unknown; ${reason}. Quarantine preserved.`,
    "ZERO_DELETE_FAILURE",
    {
      path: absoluteTarget,
      outcome: "unknown",
      quarantine_dir: quarantineDir,
      quarantine_file: quarantineFile,
      expected,
      actual,
      product_deleted: false,
    },
  );
}

export function sealAndSaveExecutableRecipeRevision(draftInput, options = {}) {
  const catalog = requireCatalog(options.catalog);
  const sealed = sealExecutableRecipeRevision(draftInput, {
    catalog,
    version: options.version,
    revision: options.revision,
    saved_at: options.saved_at,
  });
  return saveExecutableRecipeRevision(sealed, {
    ...options,
    catalog,
  });
}

export function evaluateStoredExecutableRecipeTrust(identity, facts = {}, options = {}) {
  const loaded = getExecutableRecipeRevision(identity, options);
  return evaluateExecutableRecipeTrust(loaded.payload, facts, {
    catalog: options.catalog,
  });
}

export function buildExecutableRecipeRevisionIdentity(revision) {
  if (!isPlainObject(revision)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Revision identity helper requires a revision object.",
      "PARAMS_INVALID",
    );
  }
  return deepFreeze({
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
    dependency_lock: cloneJson(revision.dependency_lock),
    dependency_lock_identity: dependencyLockIdentity(revision.dependency_lock),
    source_payload_identity: cloneJson(revision.source_payload_identity),
  });
}

function coerceSealedRevision(input, options) {
  if (!isPlainObject(input)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Executable recipe save input must be an object.",
      "REVISION_INVALID",
    );
  }

  if (input.contract === EXECUTABLE_RECIPE_REVISION_CONTRACT) {
    return normalizeExecutableRecipeRevision(input, { catalog: options.catalog });
  }

  return sealExecutableRecipeRevision(input, {
    catalog: options.catalog,
    version: options.version ?? "1.0.0",
    revision: options.revision ?? 1,
    saved_at: options.saved_at,
  });
}

function preflightSaveConflicts({
  root,
  source,
  catalog,
  reservedRecipeIds,
  revision,
  targetPath,
  relativePath,
}) {
  if (pathExistsNoFollow(targetPath)) {
    const existingStat = lstatSync(targetPath);
    if (existingStat.isSymbolicLink()) {
      throw new ExecutableRecipeRevisionStoreError(
        "Save refused; target path is a symlink.",
        "SYMLINK_ESCAPE",
        { path: targetPath },
      );
    }
    if (!existingStat.isFile()) {
      throw new ExecutableRecipeRevisionStoreError(
        "Save refused; target path exists and is not a file.",
        "REVISION_CONFLICT",
        { path: targetPath },
      );
    }

    let existingBody;
    let existing;
    try {
      existingBody = readFileSync(targetPath, "utf8");
      existing = normalizeExecutableRecipeRevision(
        parseExecutableRevisionSourceFile({ path: targetPath }),
        { catalog },
      );
    } catch (error) {
      throw new ExecutableRecipeRevisionStoreError(
        `Save refused; existing target is corrupt or invalid: ${error.message}`,
        "REVISION_CONFLICT",
        { path: targetPath, errors: error.errors ?? [error.message] },
      );
    }

    const expectedBody = serializeRevision(revision);
    if (
      existing.recipe_id === revision.recipe_id
      && existing.version === revision.version
      && existing.revision === revision.revision
      && existing.content_hash === revision.content_hash
      && existing.validation_result_id === revision.validation_result_id
      && stableStringify(existing) === stableStringify(revision)
      && existingBody === expectedBody
    ) {
      return { exact_match: true };
    }

    throw new ExecutableRecipeRevisionStoreError(
      `Save refused; existing different payload at ${relativePath}.`,
      "REVISION_CONFLICT",
      {
        path: targetPath,
        existing: {
          recipe_id: existing.recipe_id,
          version: existing.version,
          revision: existing.revision,
          content_hash: existing.content_hash,
        },
        incoming: {
          recipe_id: revision.recipe_id,
          version: revision.version,
          revision: revision.revision,
          content_hash: revision.content_hash,
        },
      },
    );
  }

  if (!pathExistsNoFollow(root)) {
    return { exact_match: false };
  }

  let listed;
  try {
    listed = listExecutableRecipeRevisions({
      root,
      source,
      catalog,
      officialRecipeIds: [...reservedRecipeIds],
      filter: { recipe_id: revision.recipe_id },
    });
  } catch (error) {
    if (error instanceof ExecutableRecipeRevisionStoreError) throw error;
    throw toStoreError(error, "STORE_CORRUPT");
  }

  for (const item of listed.items) {
    if (
      item.version === revision.version
      && item.revision === revision.revision
      && item.content_hash === revision.content_hash
      && path.resolve(item.path) === path.resolve(targetPath)
    ) {
      continue;
    }

    if (item.revision === revision.revision && path.resolve(item.path) !== path.resolve(targetPath)) {
      throw new ExecutableRecipeRevisionStoreError(
        `Save refused; revision number ${revision.revision} already exists for ${revision.recipe_id}.`,
        "REVISION_CONFLICT",
        {
          recipe_id: revision.recipe_id,
          revision: revision.revision,
          existing_path: item.relative_path,
        },
      );
    }

    if (item.revision > revision.revision) {
      throw new ExecutableRecipeRevisionStoreError(
        `Save refused; revision ${revision.revision} regresses below existing revision ${item.revision}.`,
        "REVISION_REGRESSION",
        {
          recipe_id: revision.recipe_id,
          incoming_revision: revision.revision,
          existing_revision: item.revision,
        },
      );
    }

    if (
      item.revision < revision.revision
      && compareBoundedSemver(item.version, revision.version) > 0
    ) {
      throw new ExecutableRecipeRevisionStoreError(
        `Save refused; version ${revision.version} regresses below existing version ${item.version}.`,
        "REVISION_REGRESSION",
        {
          recipe_id: revision.recipe_id,
          incoming_version: revision.version,
          existing_version: item.version,
        },
      );
    }
  }

  if (source !== "official" && reservedRecipeIds.size > 0) {
    try {
      loadUserRecipeAuthoringCatalog({
        roots: [{ source, root }],
        executableDependencyCatalog: catalog,
        officialRecipeIds: [...reservedRecipeIds],
      });
    } catch (error) {
      const message = String(error?.message ?? error);
      if (
        message.includes(revision.recipe_id)
        && /shadows official|shadows reserved|consistent source ownership/i.test(message)
      ) {
        throw new ExecutableRecipeRevisionStoreError(
          message,
          /shadows/i.test(message) ? "CROSS_FORMAT_SHADOW" : "REVISION_OWNERSHIP_CONFLICT",
          { recipe_id: revision.recipe_id },
        );
      }
    }
  }

  return { exact_match: false };
}

function assertImmutableRevision(revision) {
  if (revision.immutable !== true) {
    throw new ExecutableRecipeRevisionStoreError(
      "Saved executable revision must be immutable.",
      "REVISION_INVALID",
    );
  }
  if (typeof revision.content_hash !== "string" || !CONTENT_HASH_PATTERN.test(revision.content_hash)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Saved executable revision content_hash is invalid.",
      "REVISION_INVALID",
    );
  }
  if (typeof revision.validation_result_id !== "string" || revision.validation_result_id.trim() === "") {
    throw new ExecutableRecipeRevisionStoreError(
      "Saved executable revision validation_result_id is incomplete.",
      "REVISION_INVALID",
    );
  }
  if (!isPlainObject(revision.dependency_lock) || !Array.isArray(revision.dependency_lock.entries)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Saved executable revision dependency_lock is incomplete.",
      "REVISION_INVALID",
    );
  }
  if (!isPlainObject(revision.source_payload_identity)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Saved executable revision source_payload_identity is incomplete.",
      "REVISION_INVALID",
    );
  }
  if (!Array.isArray(revision.draft?.checkpoints) || revision.draft.checkpoints.length === 0) {
    throw new ExecutableRecipeRevisionStoreError(
      "Saved executable revision checkpoint trust facts are incomplete.",
      "REVISION_INVALID",
    );
  }
}

export function normalizeExactRevisionIdentity(input, {
  requireContentHash = false,
  requireFullIdentity = false,
} = {}) {
  if (!isPlainObject(input)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Revision identity must be an object.",
      "PARAMS_INVALID",
    );
  }

  const recipeId = input.recipe_id ?? input.recipeId ?? input.id;
  const version = input.version;
  const revision = input.revision;
  const contentHash = input.content_hash ?? input.contentHash;
  const validationResultId = input.validation_result_id ?? input.validationResultId;
  const dependencyLock = input.dependency_lock ?? input.dependencyLock;
  const dependencyLockId = input.dependency_lock_identity ?? input.dependencyLockIdentity;
  const sourcePayloadIdentity = input.source_payload_identity ?? input.sourcePayloadIdentity;

  if (typeof recipeId !== "string" || recipeId.trim() === "") {
    throw new ExecutableRecipeRevisionStoreError("identity.recipe_id is required.", "PARAMS_INVALID");
  }
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.version must match semver MAJOR.MINOR.PATCH.",
      "PARAMS_INVALID",
    );
  }
  if (!Number.isInteger(revision) || revision < 1 || revision > EXECUTABLE_RECIPE_BUDGETS.revision_max) {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.revision must be a positive integer.",
      "PARAMS_INVALID",
    );
  }
  if (requireContentHash || requireFullIdentity) {
    if (typeof contentHash !== "string" || !CONTENT_HASH_PATTERN.test(contentHash)) {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.content_hash must be a 64-char lowercase hex sha256.",
        "PARAMS_INVALID",
      );
    }
  } else if (
    contentHash !== undefined
    && (typeof contentHash !== "string" || !CONTENT_HASH_PATTERN.test(contentHash))
  ) {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.content_hash must be a 64-char lowercase hex sha256 when provided.",
      "PARAMS_INVALID",
    );
  }

  const identity = {
    recipe_id: recipeId,
    version,
    revision,
    content_hash: contentHash,
  };

  if (requireFullIdentity) {
    if (typeof validationResultId !== "string" || validationResultId.trim() === "") {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.validation_result_id is required for exact delete.",
        "PARAMS_INVALID",
      );
    }
    if (dependencyLock === undefined && dependencyLockId === undefined) {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.dependency_lock or identity.dependency_lock_identity is required for exact delete.",
        "PARAMS_INVALID",
      );
    }
    if (sourcePayloadIdentity === undefined) {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.source_payload_identity is required for exact delete.",
        "PARAMS_INVALID",
      );
    }
  }

  if (validationResultId !== undefined) {
    if (typeof validationResultId !== "string" || validationResultId.trim() === "") {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.validation_result_id must be a non-empty string when provided.",
        "PARAMS_INVALID",
      );
    }
    identity.validation_result_id = validationResultId;
  }

  const normalizedLock = normalizeOptionalDependencyLockFacts(dependencyLock, dependencyLockId);
  if (normalizedLock.dependency_lock !== undefined) {
    identity.dependency_lock = normalizedLock.dependency_lock;
  }
  if (normalizedLock.dependency_lock_identity !== undefined) {
    identity.dependency_lock_identity = normalizedLock.dependency_lock_identity;
  }

  if (sourcePayloadIdentity !== undefined) {
    identity.source_payload_identity = normalizeOptionalSourcePayloadIdentity(sourcePayloadIdentity);
  }

  if (requireFullIdentity) {
    if (
      identity.validation_result_id === undefined
      || (identity.dependency_lock === undefined && identity.dependency_lock_identity === undefined)
      || identity.source_payload_identity === undefined
    ) {
      throw new ExecutableRecipeRevisionStoreError(
        "Complete exact revision identity is required.",
        "PARAMS_INVALID",
      );
    }
  }

  return deepFreeze(identity);
}

function normalizeOptionalDependencyLockFacts(dependencyLock, dependencyLockId) {
  if (dependencyLock === undefined && dependencyLockId === undefined) {
    return {};
  }

  let lockObject;
  if (dependencyLock !== undefined) {
    if (!isPlainObject(dependencyLock)) {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.dependency_lock must be an object when provided.",
        "PARAMS_INVALID",
      );
    }
    lockObject = cloneJson(dependencyLock);
  }

  let lockIdentity;
  if (dependencyLockId !== undefined) {
    if (typeof dependencyLockId !== "string" || !CONTENT_HASH_PATTERN.test(dependencyLockId)) {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.dependency_lock_identity must be a 64-char lowercase hex sha256 when provided.",
        "PARAMS_INVALID",
      );
    }
    lockIdentity = dependencyLockId;
  }

  if (lockObject !== undefined) {
    const computed = dependencyLockIdentity(lockObject);
    if (lockIdentity !== undefined && lockIdentity !== computed) {
      throw new ExecutableRecipeRevisionStoreError(
        "identity.dependency_lock and identity.dependency_lock_identity disagree.",
        "PARAMS_INVALID",
        {
          dependency_lock_identity: lockIdentity,
          computed_dependency_lock_identity: computed,
        },
      );
    }
    return {
      dependency_lock: lockObject,
      dependency_lock_identity: computed,
    };
  }

  return {
    dependency_lock_identity: lockIdentity,
  };
}

function normalizeOptionalSourcePayloadIdentity(sourcePayloadIdentity) {
  if (!isPlainObject(sourcePayloadIdentity)) {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.source_payload_identity must be an object when provided.",
      "PARAMS_INVALID",
    );
  }
  const scheme = sourcePayloadIdentity.scheme;
  const encoding = sourcePayloadIdentity.encoding;
  const payloadKind = sourcePayloadIdentity.payload_kind;
  const value = sourcePayloadIdentity.value;
  if (scheme !== "sha256") {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.source_payload_identity.scheme must be sha256.",
      "PARAMS_INVALID",
    );
  }
  if (encoding !== "hex") {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.source_payload_identity.encoding must be hex.",
      "PARAMS_INVALID",
    );
  }
  if (payloadKind !== "executable_recipe_draft") {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.source_payload_identity.payload_kind must be executable_recipe_draft.",
      "PARAMS_INVALID",
    );
  }
  if (typeof value !== "string" || !CONTENT_HASH_PATTERN.test(value)) {
    throw new ExecutableRecipeRevisionStoreError(
      "identity.source_payload_identity.value must be a 64-char lowercase hex sha256.",
      "PARAMS_INVALID",
    );
  }
  return deepFreeze({
    scheme: "sha256",
    encoding: "hex",
    payload_kind: "executable_recipe_draft",
    value,
  });
}

function assertExactIdentityMatch(revision, identity, { requireFullIdentity = false } = {}) {
  if (
    revision.recipe_id !== identity.recipe_id
    || revision.version !== identity.version
    || revision.revision !== identity.revision
    || revision.content_hash !== identity.content_hash
  ) {
    throw new ExecutableRecipeRevisionStoreError(
      `Revision identity mismatch for ${formatIdentity(identity)}.`,
      "DELETE_IDENTITY_MISMATCH",
      {
        expected: projectIdentity(identity),
        actual: projectIdentity(buildExecutableRecipeRevisionIdentity(revision)),
      },
    );
  }

  const hasOptionalFacts = identity.validation_result_id !== undefined
    || identity.dependency_lock !== undefined
    || identity.dependency_lock_identity !== undefined
    || identity.source_payload_identity !== undefined;

  // Skip optional checks only when every optional identity fact is absent.
  if (!requireFullIdentity && !hasOptionalFacts) {
    return;
  }

  if (
    identity.validation_result_id !== undefined
    && revision.validation_result_id !== identity.validation_result_id
  ) {
    throw new ExecutableRecipeRevisionStoreError(
      `Revision validation_result_id mismatch for ${formatIdentity(identity)}.`,
      "DELETE_IDENTITY_MISMATCH",
      {
        expected: projectIdentity(identity),
        actual: projectIdentity(buildExecutableRecipeRevisionIdentity(revision)),
      },
    );
  }

  if (identity.dependency_lock !== undefined) {
    if (stableStringify(revision.dependency_lock) !== stableStringify(identity.dependency_lock)) {
      throw new ExecutableRecipeRevisionStoreError(
        `Revision dependency_lock mismatch for ${formatIdentity(identity)}.`,
        "DELETE_IDENTITY_MISMATCH",
        {
          expected: projectIdentity(identity),
          actual: projectIdentity(buildExecutableRecipeRevisionIdentity(revision)),
        },
      );
    }
  }
  if (identity.dependency_lock_identity !== undefined) {
    if (dependencyLockIdentity(revision.dependency_lock) !== identity.dependency_lock_identity) {
      throw new ExecutableRecipeRevisionStoreError(
        `Revision dependency_lock_identity mismatch for ${formatIdentity(identity)}.`,
        "DELETE_IDENTITY_MISMATCH",
        {
          expected: projectIdentity(identity),
          actual: projectIdentity(buildExecutableRecipeRevisionIdentity(revision)),
        },
      );
    }
  }

  if (identity.source_payload_identity !== undefined) {
    if (
      stableStringify(revision.source_payload_identity)
      !== stableStringify(identity.source_payload_identity)
    ) {
      throw new ExecutableRecipeRevisionStoreError(
        `Revision source_payload_identity mismatch for ${formatIdentity(identity)}.`,
        "DELETE_IDENTITY_MISMATCH",
        {
          expected: projectIdentity(identity),
          actual: projectIdentity(buildExecutableRecipeRevisionIdentity(revision)),
        },
      );
    }
  }

  if (requireFullIdentity) {
    if (
      identity.validation_result_id === undefined
      || (identity.dependency_lock === undefined && identity.dependency_lock_identity === undefined)
      || identity.source_payload_identity === undefined
    ) {
      throw new ExecutableRecipeRevisionStoreError(
        "Complete exact revision identity is required.",
        "PARAMS_INVALID",
      );
    }
  }
}

function defaultRevisionRelativePath(revision) {
  const withoutPrefix = revision.recipe_id.replace(/^recipe\./, "");
  const [pack, ...segments] = withoutPrefix.split(".");
  const baseName = segments.length > 0 ? segments.join("_") : withoutPrefix;
  return path.posix.join(
    pack,
    `${baseName}.r${revision.revision}.v${revision.version}${EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX}`,
  );
}

function serializeRevision(revision) {
  return `${JSON.stringify(revision, null, 2)}\n`;
}

function writeUtf8FileAtomicExclusive(filePath, body, root) {
  const rootAbsolute = path.resolve(root);
  const absoluteTargetLexical = path.resolve(filePath);
  if (!isInsideRoot(rootAbsolute, absoluteTargetLexical)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write target escaped store root.",
      "PATH_ESCAPE",
      { path: absoluteTargetLexical },
    );
  }

  // Symlink/component and canonical-parent preflight must run before any mkdir.
  // Returns canonical root/parent/target so /tmp vs /private/tmp aliases stay consistent.
  const materialization = ensureRootBoundedParentDirectory(absoluteTargetLexical, rootAbsolute);
  const { parentReal, rootReal, absoluteTarget } = materialization;

  if (pathExistsNoFollow(absoluteTarget)) {
    return {
      ...handleConcurrentDestination(absoluteTarget, body, rootReal),
      path: absoluteTarget,
    };
  }

  const tempPath = path.join(
    parentReal,
    `.${path.basename(absoluteTarget)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  if (!isInsideRoot(rootReal, tempPath)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write temp path escaped store root.",
      "PATH_ESCAPE",
      { path: tempPath },
    );
  }

  let tempFd = null;
  try {
    tempFd = openSync(tempPath, "wx", 0o600);
    // writeFileSync on the exclusive fd writes the complete UTF-8 sequence.
    writeFileSync(tempFd, body, "utf8");
    closeSync(tempFd);
    tempFd = null;

    try {
      linkSync(tempPath, absoluteTarget);
    } catch (error) {
      if (error && error.code === "EEXIST") {
        return {
          ...handleConcurrentDestination(absoluteTarget, body, rootReal),
          path: absoluteTarget,
        };
      }
      throw error;
    }
    return { idempotent: false, path: absoluteTarget };
  } catch (error) {
    if (error instanceof ExecutableRecipeRevisionStoreError) throw error;
    throw new ExecutableRecipeRevisionStoreError(
      `Atomic revision write failed: ${error.message}`,
      "ZERO_WRITE_FAILURE",
      { path: absoluteTarget },
    );
  } finally {
    if (tempFd !== null) {
      try {
        closeSync(tempFd);
      } catch {
        // best-effort
      }
    }
    try {
      if (pathExistsNoFollow(tempPath)) unlinkSync(tempPath);
    } catch {
      // best-effort temp cleanup
    }
  }
}

function ensureRootBoundedParentDirectory(absoluteTarget, root) {
  const rootAbsolute = path.resolve(root);
  const targetAbsolute = path.resolve(absoluteTarget);
  const parentAbsolute = path.dirname(targetAbsolute);

  if (!isInsideRoot(rootAbsolute, parentAbsolute) && parentAbsolute !== rootAbsolute) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write parent escaped store root.",
      "PATH_ESCAPE",
      { path: targetAbsolute },
    );
  }
  if (!isInsideRoot(rootAbsolute, targetAbsolute)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write target escaped store root.",
      "PATH_ESCAPE",
      { path: targetAbsolute },
    );
  }

  // Canonicalize the nearest existing ancestor and carry the unresolved suffix
  // before any mkdir so macOS /tmp -> /private/tmp aliases do not fail containment.
  const rootReal = materializeCanonicalDirectory(rootAbsolute, { role: "store root" });
  const relativeParent = path.relative(rootAbsolute, parentAbsolute);
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write parent escaped store root.",
      "PATH_ESCAPE",
      { path: targetAbsolute },
    );
  }
  const relativeTarget = path.relative(rootAbsolute, targetAbsolute);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write target escaped store root.",
      "PATH_ESCAPE",
      { path: targetAbsolute },
    );
  }

  let current = rootReal;
  const parentSegments = relativeParent === "" ? [] : relativeParent.split(path.sep).filter(Boolean);
  for (const segment of parentSegments) {
    const next = path.join(current, segment);
    if (pathExistsNoFollow(next)) {
      const stats = lstatSync(next);
      if (stats.isSymbolicLink()) {
        throw new ExecutableRecipeRevisionStoreError(
          "path contains a symlink component.",
          "SYMLINK_ESCAPE",
          { path: next },
        );
      }
      if (!stats.isDirectory()) {
        throw new ExecutableRecipeRevisionStoreError(
          "Atomic write parent component is not a directory.",
          "PATH_ESCAPE",
          { path: next },
        );
      }
      const nextReal = realpathSync(next);
      if (!isInsideRoot(rootReal, nextReal)) {
        throw new ExecutableRecipeRevisionStoreError(
          "Atomic write parent resolved outside approved store root.",
          "PATH_ESCAPE",
          { path: next },
        );
      }
      current = nextReal;
      continue;
    }

    // Create only after every existing ancestor has been proven non-symlink and root-bounded.
    mkdirSync(next, { recursive: false });
    const createdStats = lstatSync(next);
    if (createdStats.isSymbolicLink() || !createdStats.isDirectory()) {
      throw new ExecutableRecipeRevisionStoreError(
        "Atomic write parent creation produced a non-directory path.",
        "ZERO_WRITE_FAILURE",
        { path: next },
      );
    }
    current = next;
  }

  assertNoSymlinkComponent(current, rootReal);
  if (!isInsideRoot(rootReal, current)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write parent escaped store root.",
      "PATH_ESCAPE",
      { path: targetAbsolute },
    );
  }

  const absoluteTargetCanonical = path.join(rootReal, relativeTarget);
  if (!isInsideRoot(rootReal, absoluteTargetCanonical)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write target escaped store root.",
      "PATH_ESCAPE",
      { path: absoluteTargetCanonical },
    );
  }

  return {
    rootReal,
    parentReal: current,
    absoluteTarget: absoluteTargetCanonical,
  };
}

function materializeCanonicalDirectory(absolutePath, { role }) {
  // Platform aliases (/tmp, /var) are rewritten first so ordinary symlink ancestors remain rejectable.
  const absolute = assertStorePathHasNoOrdinarySymlinkAncestors(
    canonicalizeLeadingPlatformAliases(path.resolve(absolutePath)),
  );
  if (pathExistsNoFollow(absolute)) {
    assertRootNotSymlink(absolute);
    if (!lstatSync(absolute).isDirectory()) {
      throw new ExecutableRecipeRevisionStoreError(
        `${role} must be a directory.`,
        "PARAMS_INVALID",
        { root: absolute },
      );
    }
    return realpathSync(absolute);
  }

  const plan = planMissingPath(absolute);
  let current = plan.existingAncestorReal;
  for (const segment of plan.missingSegments) {
    const next = path.join(current, segment);
    if (pathExistsNoFollow(next)) {
      const stats = lstatSync(next);
      if (stats.isSymbolicLink()) {
        throw new ExecutableRecipeRevisionStoreError(
          `${role} path contains a symlink component.`,
          "SYMLINK_ESCAPE",
          { path: next },
        );
      }
      if (!stats.isDirectory()) {
        throw new ExecutableRecipeRevisionStoreError(
          `${role} must be a directory.`,
          "PARAMS_INVALID",
          { path: next },
        );
      }
      current = realpathSync(next);
      continue;
    }
    mkdirSync(next, { recursive: false });
    const created = lstatSync(next);
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw new ExecutableRecipeRevisionStoreError(
        `${role} creation produced a non-directory path.`,
        "ZERO_WRITE_FAILURE",
        { path: next },
      );
    }
    current = next;
  }

  if (lstatSync(current).isSymbolicLink()) {
    throw new ExecutableRecipeRevisionStoreError(
      `${role} must not be a symlink.`,
      "SYMLINK_ESCAPE",
      { root: current },
    );
  }
  return current;
}

function planMissingPath(absolutePath) {
  const absolute = assertStorePathHasNoOrdinarySymlinkAncestors(
    canonicalizeLeadingPlatformAliases(path.resolve(absolutePath)),
  );
  const missingSegments = [];
  let current = absolute;
  while (!pathExistsNoFollow(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ExecutableRecipeRevisionStoreError(
        "Unable to resolve an existing ancestor for store path.",
        "PATH_ESCAPE",
        { path: absolute },
      );
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  // After platform-alias rewrite, any remaining symlink ancestor is ordinary and rejected.
  assertStorePathHasNoOrdinarySymlinkAncestors(current);

  const existingStats = lstatSync(current);
  if (existingStats.isSymbolicLink()) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root path contains a symlink ancestor.",
      "SYMLINK_ESCAPE",
      { path: current },
    );
  }
  if (!existingStats.isDirectory()) {
    throw new ExecutableRecipeRevisionStoreError(
      "path ancestor must be a directory.",
      "PATH_ESCAPE",
      { path: current },
    );
  }

  let existingReal;
  try {
    existingReal = realpathSync(current);
  } catch (error) {
    throw new ExecutableRecipeRevisionStoreError(
      `Unable to resolve path ancestor: ${error.message}`,
      "PATH_ESCAPE",
      { path: current },
    );
  }
  if (!lstatSync(existingReal).isDirectory()) {
    throw new ExecutableRecipeRevisionStoreError(
      "path ancestor must be a directory.",
      "PATH_ESCAPE",
      { path: current },
    );
  }

  return {
    existingAncestor: current,
    existingAncestorReal: existingReal,
    missingSegments,
  };
}

function captureFileIdentityFacts(filePath) {
  const absolute = path.resolve(filePath);
  if (!pathExistsNoFollow(absolute)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Target file disappeared before identity capture.",
      "ZERO_DELETE_FAILURE",
      { path: absolute },
    );
  }
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink()) {
    throw new ExecutableRecipeRevisionStoreError(
      "Target path is a symlink.",
      "SYMLINK_ESCAPE",
      { path: absolute },
    );
  }
  if (!stats.isFile()) {
    throw new ExecutableRecipeRevisionStoreError(
      "Target path is not a regular file.",
      "ZERO_DELETE_FAILURE",
      { path: absolute },
    );
  }
  return deepFreeze({
    path: absolute,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    nlink: stats.nlink,
  });
}

function sameFileIdentityFacts(left, right) {
  return left
    && right
    && left.path === right.path
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.nlink === right.nlink;
}

function handleConcurrentDestination(absoluteTarget, body, root) {
  if (!isInsideRoot(root, absoluteTarget)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Atomic write target escaped store root.",
      "PATH_ESCAPE",
      { path: absoluteTarget },
    );
  }
  const stats = lstatSync(absoluteTarget);
  if (stats.isSymbolicLink()) {
    throw new ExecutableRecipeRevisionStoreError(
      "Save refused; destination is a symlink.",
      "SYMLINK_ESCAPE",
      { path: absoluteTarget },
    );
  }
  if (!stats.isFile()) {
    throw new ExecutableRecipeRevisionStoreError(
      "Save refused; destination exists and is not a file.",
      "REVISION_CONFLICT",
      { path: absoluteTarget },
    );
  }
  let existingBody;
  try {
    existingBody = readFileSync(absoluteTarget, "utf8");
  } catch (error) {
    throw new ExecutableRecipeRevisionStoreError(
      `Atomic write could not re-read concurrent destination: ${error.message}`,
      "ZERO_WRITE_FAILURE",
      { path: absoluteTarget },
    );
  }
  if (existingBody === body) {
    return { idempotent: true };
  }
  throw new ExecutableRecipeRevisionStoreError(
    "Save refused; destination appeared concurrently with a different payload.",
    "REVISION_CONFLICT",
    { path: absoluteTarget },
  );
}

function resolveRootBoundedFilePath(root, relativePath, {
  requiredSuffix,
  createParents = false,
  allowMissingRoot = false,
} = {}) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new ExecutableRecipeRevisionStoreError(
      "relative_path must be a non-empty relative path string.",
      "PARAMS_INVALID",
    );
  }
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new ExecutableRecipeRevisionStoreError(
      "relative_path must be a root-relative path without absolute or NUL segments.",
      "PATH_ESCAPE",
      { relative_path: relativePath },
    );
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized !== relativePath) {
    throw new ExecutableRecipeRevisionStoreError(
      "relative_path must use POSIX separators.",
      "PATH_ESCAPE",
      { relative_path: relativePath },
    );
  }
  if (
    normalized.startsWith("/")
    || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new ExecutableRecipeRevisionStoreError(
      "relative_path must not contain empty, dot, or parent segments.",
      "PATH_ESCAPE",
      { relative_path: relativePath },
    );
  }
  if (!normalized.endsWith(requiredSuffix)) {
    throw new ExecutableRecipeRevisionStoreError(
      `relative_path must end with ${requiredSuffix}.`,
      "PARAMS_INVALID",
      { relative_path: relativePath },
    );
  }

  const rootResolved = path.resolve(root);
  if (pathExistsNoFollow(rootResolved)) {
    assertRootNotSymlink(rootResolved);
  } else if (!allowMissingRoot) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root does not exist.",
      "PARAMS_INVALID",
      { root: rootResolved },
    );
  }

  const rootBase = pathExistsNoFollow(rootResolved)
    ? resolveExistingRootDirectory(rootResolved)
    : rootResolved;
  const targetPath = path.resolve(rootBase, normalized);
  if (!isInsideRoot(rootBase, targetPath)) {
    throw new ExecutableRecipeRevisionStoreError(
      "relative_path escaped approved store root.",
      "PATH_ESCAPE",
      { relative_path: relativePath },
    );
  }

  // Walk every existing relative-path component before any mkdir or discovery.
  assertRelativePathComponentsNotSymlinks(rootBase, normalized);

  if (createParents) {
    // Parent creation is only for callers that opt in; save uses publication preflight instead.
    ensureRootBoundedParentDirectory(targetPath, rootBase);
  }

  const parent = path.dirname(targetPath);
  if (pathExistsNoFollow(parent)) {
    assertNoSymlinkComponent(parent, rootBase);
    const parentReal = realpathSync(parent);
    if (!isInsideRoot(rootBase, parentReal)) {
      throw new ExecutableRecipeRevisionStoreError(
        "relative_path parent resolved outside approved store root.",
        "PATH_ESCAPE",
        { relative_path: relativePath },
      );
    }
  }

  if (pathExistsNoFollow(targetPath)) {
    const stats = lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      throw new ExecutableRecipeRevisionStoreError(
        "Target path is a symlink.",
        "SYMLINK_ESCAPE",
        { relative_path: relativePath },
      );
    }
    const realTarget = realpathSync(targetPath);
    if (!isInsideRoot(rootBase, realTarget)) {
      throw new ExecutableRecipeRevisionStoreError(
        "Target path realpath escaped approved store root.",
        "PATH_ESCAPE",
        { relative_path: relativePath },
      );
    }
  }

  return {
    root: rootBase,
    path: targetPath,
    relative_path: normalized,
  };
}

function assertRelativePathComponentsNotSymlinks(rootBase, normalizedRelativePath) {
  const rootAbsolute = path.resolve(rootBase);
  if (!pathExistsNoFollow(rootAbsolute)) return;

  let current = rootAbsolute;
  const segments = normalizedRelativePath.split("/").filter(Boolean);
  for (const segment of segments) {
    const next = path.join(current, segment);
    if (!pathExistsNoFollow(next)) {
      // Remaining segments are absent; stop without creating anything.
      return;
    }
    const stats = lstatSync(next);
    if (stats.isSymbolicLink()) {
      throw new ExecutableRecipeRevisionStoreError(
        "path contains a symlink component.",
        "SYMLINK_ESCAPE",
        { path: next, relative_path: normalizedRelativePath },
      );
    }
    if (stats.isDirectory()) {
      const nextReal = realpathSync(next);
      if (!isInsideRoot(rootAbsolute, nextReal)) {
        throw new ExecutableRecipeRevisionStoreError(
          "relative_path component resolved outside approved store root.",
          "PATH_ESCAPE",
          { path: next, relative_path: normalizedRelativePath },
        );
      }
      current = nextReal;
      continue;
    }
    // File component mid-path is invalid for further descent; final segment handled by caller.
    current = next;
  }
}

function resolveExistingRootBoundedFilePath(root, relativePath, { requiredSuffix } = {}) {
  const resolved = resolveRootBoundedFilePath(root, relativePath, {
    requiredSuffix,
    allowMissingRoot: false,
  });
  if (!pathExistsNoFollow(resolved.path)) {
    throw new ExecutableRecipeRevisionStoreError(
      `Revision file not found at ${relativePath}.`,
      "REVISION_NOT_FOUND",
      { relative_path: relativePath },
    );
  }
  const stats = lstatSync(resolved.path);
  if (stats.isSymbolicLink()) {
    throw new ExecutableRecipeRevisionStoreError(
      "Delete refused; target path is a symlink.",
      "SYMLINK_ESCAPE",
      { relative_path: relativePath },
    );
  }
  const realTarget = realpathSync(resolved.path);
  if (!isInsideRoot(resolved.root, realTarget)) {
    throw new ExecutableRecipeRevisionStoreError(
      "Delete refused; target realpath escaped store root.",
      "PATH_ESCAPE",
      { relative_path: relativePath },
    );
  }
  return {
    ...resolved,
    path: realTarget,
  };
}

function resolveExistingRootDirectory(root) {
  const absolute = assertStorePathHasNoOrdinarySymlinkAncestors(
    canonicalizeLeadingPlatformAliases(path.resolve(root)),
  );
  if (!pathExistsNoFollow(absolute)) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root does not exist.",
      "PARAMS_INVALID",
      { root: absolute },
    );
  }
  assertRootNotSymlink(absolute);
  const stats = lstatSync(absolute);
  if (!stats.isDirectory()) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root must be a directory.",
      "PARAMS_INVALID",
      { root: absolute },
    );
  }
  return realpathSync(absolute);
}

function assertRootNotSymlink(root) {
  const absolute = path.resolve(root);
  if (!pathExistsNoFollow(absolute)) return;
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink()) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root must not be a symlink.",
      "SYMLINK_ESCAPE",
      { root: absolute },
    );
  }
}

function assertStorePathHasNoOrdinarySymlinkAncestors(absolutePath) {
  const absolute = path.resolve(absolutePath);
  const volumeRoot = path.parse(absolute).root;
  let current = volumeRoot;
  const segments = absolute.slice(volumeRoot.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!pathExistsNoFollow(current)) break;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new ExecutableRecipeRevisionStoreError(
        "store path contains an ordinary symlink ancestor.",
        "SYMLINK_ESCAPE",
        { path: current },
      );
    }
  }
  return absolute;
}

function assertNoSymlinkComponent(candidatePath, root) {
  const absolute = path.resolve(candidatePath);
  const rootAbsolute = path.resolve(root);
  if (!isInsideRoot(rootAbsolute, absolute) && absolute !== rootAbsolute) {
    throw new ExecutableRecipeRevisionStoreError(
      "path component escaped approved store root.",
      "PATH_ESCAPE",
      { path: absolute },
    );
  }

  let current = absolute;
  const parts = [];
  while (true) {
    parts.unshift(current);
    if (current === rootAbsolute || path.dirname(current) === current) break;
    if (!isInsideRoot(rootAbsolute, current) && current !== rootAbsolute) break;
    current = path.dirname(current);
  }

  for (const part of parts) {
    if (!pathExistsNoFollow(part)) continue;
    const stats = lstatSync(part);
    if (stats.isSymbolicLink()) {
      throw new ExecutableRecipeRevisionStoreError(
        "path contains a symlink component.",
        "SYMLINK_ESCAPE",
        { path: part },
      );
    }
  }
}

function normalizeStoreRoot(root) {
  if (typeof root !== "string" || root.trim() === "") {
    throw new ExecutableRecipeRevisionStoreError(
      "store root must be a non-empty path string.",
      "PARAMS_INVALID",
    );
  }
  if (root.startsWith("file://")) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root must be a filesystem path, not a file:// URL.",
      "PARAMS_INVALID",
    );
  }
  if (!path.isAbsolute(root)) {
    throw new ExecutableRecipeRevisionStoreError(
      "store root must be an absolute path.",
      "PATH_ESCAPE",
      { root },
    );
  }
  // Rewrite only the narrow macOS platform aliases (/tmp, /var), then reject every
  // remaining ordinary symlink ancestor for both existing and missing roots.
  const absolute = assertStorePathHasNoOrdinarySymlinkAncestors(
    canonicalizeLeadingPlatformAliases(path.resolve(root)),
  );
  if (pathExistsNoFollow(absolute)) {
    assertRootNotSymlink(absolute);
  }
  return absolute;
}

function canonicalizeLeadingPlatformAliases(absoluteInput) {
  let absolute = path.resolve(absoluteInput);
  const volumeRoot = path.parse(absolute).root;
  for (const name of PLATFORM_ALIAS_NAMES) {
    const alias = path.join(volumeRoot, name);
    if (absolute !== alias && !isInsideRoot(alias, absolute)) continue;
    if (!pathExistsNoFollow(alias) || !lstatSync(alias).isSymbolicLink()) continue;
    let canonical;
    try {
      canonical = realpathSync(alias);
    } catch {
      continue;
    }
    if (!pathExistsNoFollow(canonical) || !lstatSync(canonical).isDirectory()) continue;
    // Only accept the known macOS private/* remaps; do not allow arbitrary alias targets.
    const expectedPrivate = path.join(volumeRoot, "private", name);
    if (path.resolve(canonical) !== path.resolve(expectedPrivate)) continue;
    absolute = path.resolve(canonical, path.relative(alias, absolute));
  }
  return absolute;
}

function normalizeStoreSource(source) {
  if (typeof source !== "string" || !ALLOWED_SOURCES.includes(source)) {
    throw new ExecutableRecipeRevisionStoreError(
      `store source must be exactly one of: ${ALLOWED_SOURCES.join(", ")}.`,
      "PARAMS_INVALID",
      { source },
    );
  }
  return source;
}

function collectReservedRecipeIds(options = {}) {
  return new Set([
    ...normalizeStringArray(options.officialRecipeIds, "officialRecipeIds"),
    ...normalizeStringArray(options.reservedRecipeIds, "reservedRecipeIds"),
  ]);
}

function requireCatalog(catalog) {
  if (!catalog || typeof catalog.getMacro !== "function" || typeof catalog.getTemplate !== "function") {
    throw new ExecutableRecipeRevisionStoreError(
      "executable recipe revision store requires an injected dependency catalog.",
      "PARAMS_INVALID",
    );
  }
  return catalog;
}

function toStoreError(error, code = "PARAMS_INVALID") {
  if (error instanceof ExecutableRecipeRevisionStoreError) return error;
  return new ExecutableRecipeRevisionStoreError(
    error?.message ?? String(error),
    code,
    { errors: error?.errors ?? [error?.message ?? String(error)] },
  );
}

function formatIdentity(identity) {
  const hash = identity.content_hash ?? "?";
  return `${identity.recipe_id}@${identity.version}#${identity.revision}:${hash}`;
}

function projectIdentity(identity) {
  return {
    recipe_id: identity.recipe_id,
    version: identity.version,
    revision: identity.revision,
    content_hash: identity.content_hash,
    validation_result_id: identity.validation_result_id,
    dependency_lock_identity: identity.dependency_lock_identity
      ?? (identity.dependency_lock ? dependencyLockIdentity(identity.dependency_lock) : undefined),
    source_payload_identity: identity.source_payload_identity,
  };
}

function dependencyLockIdentity(dependencyLock) {
  return sha256Hex(stableStringify(dependencyLock));
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
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

function normalizeStringArray(values, fieldName = "id list") {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw new ExecutableRecipeRevisionStoreError(
      `${fieldName} must be an array of non-empty strings.`,
      "PARAMS_INVALID",
      { field: fieldName },
    );
  }
  const normalized = [];
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ExecutableRecipeRevisionStoreError(
        `${fieldName}[${index}] must be a non-empty string.`,
        "PARAMS_INVALID",
        { field: fieldName, index, value },
      );
    }
    normalized.push(value);
  }
  return normalized;
}

function pathExistsNoFollow(candidatePath) {
  try {
    lstatSync(candidatePath);
    return true;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
}

function isInsideRoot(root, candidatePath) {
  const relative = path.relative(root, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
