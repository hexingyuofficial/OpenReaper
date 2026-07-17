import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export const ALPHA34_TASK_PACKET_CONTRACT = "openreaper.alpha3.4.task_packet.v1";

const VALIDATION_CONTRACT = "openreaper.alpha3.4.task_packet_validation.v1";
const INSPECTION_CONTRACT = "openreaper.alpha3.4.task_scope_inspection.v1";
const REQUIRED_FIELDS = Object.freeze([
  "contract",
  "task_id",
  "base_commit",
  "goal",
  "required_reads",
  "write_paths",
  "read_only_paths",
  "forbidden_paths",
  "unlisted_path_policy",
  "work_items",
  "allowed_reconnaissance",
  "acceptance_commands",
  "stop_conditions",
  "return_fields",
]);
const PATH_FIELDS = Object.freeze([
  "required_reads",
  "write_paths",
  "read_only_paths",
  "forbidden_paths",
]);
const STRING_ARRAY_FIELDS = Object.freeze([
  ...PATH_FIELDS,
  "work_items",
  "allowed_reconnaissance",
  "acceptance_commands",
  "stop_conditions",
  "return_fields",
]);
const REQUIRED_RETURN_FIELDS = Object.freeze([
  "task_id",
  "status",
  "changed_files",
  "reconnaissance",
  "checks",
  "evidence",
  "blockers",
  "risks",
  "prohibited_actions_confirmed",
  "commit_created",
]);
const CHANGE_TYPE_ORDER = Object.freeze([
  "staged_added",
  "staged_modified",
  "staged_deleted",
  "staged_renamed",
  "staged_copied",
  "staged_type_changed",
  "staged_unmerged",
  "unstaged_added",
  "unstaged_modified",
  "unstaged_deleted",
  "unstaged_renamed",
  "unstaged_copied",
  "unstaged_type_changed",
  "unstaged_unmerged",
  "untracked",
  "rename_source",
  "rename_destination",
  "copy_destination",
]);
const CHANGE_TYPE_RANK = new Map(CHANGE_TYPE_ORDER.map((value, index) => [value, index]));
const GIT_STATUS_KIND = Object.freeze({
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type_changed",
  U: "unmerged",
});
const MAX_VALIDATION_ERRORS = 128;

export function validateAlpha34TaskPacket(packet) {
  const errors = [];
  let errorsTruncated = false;
  const addError = (code, field, message) => {
    if (errors.length < MAX_VALIDATION_ERRORS) errors.push({ code, field, message });
    else errorsTruncated = true;
  };

  if (!isPlainObject(packet)) {
    addError("PACKET_TYPE_INVALID", null, "Task packet must be a plain JSON object.");
    return validationResult(errors, errorsTruncated);
  }

  const knownFields = new Set(REQUIRED_FIELDS);
  for (const field of Object.keys(packet).sort()) {
    if (!knownFields.has(field)) addError("UNKNOWN_FIELD", field, `Unknown task packet field: ${field}.`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(packet, field)) addError("REQUIRED_FIELD_MISSING", field, `Missing required field: ${field}.`);
  }

  if (Object.hasOwn(packet, "contract") && packet.contract !== ALPHA34_TASK_PACKET_CONTRACT) {
    addError("CONTRACT_INVALID", "contract", `contract must equal ${ALPHA34_TASK_PACKET_CONTRACT}.`);
  }
  validateNonEmptyString(packet, "task_id", addError);
  validateNonEmptyString(packet, "goal", addError);
  if (Object.hasOwn(packet, "base_commit") && (typeof packet.base_commit !== "string" || !/^[0-9a-f]{40}$/u.test(packet.base_commit))) {
    addError("BASE_COMMIT_INVALID", "base_commit", "base_commit must be a complete 40-character lowercase Git commit id.");
  }
  if (Object.hasOwn(packet, "unlisted_path_policy") && packet.unlisted_path_policy !== "read_only") {
    addError("UNLISTED_PATH_POLICY_INVALID", "unlisted_path_policy", "unlisted_path_policy must equal read_only.");
  }

  const validArrays = new Set();
  for (const field of STRING_ARRAY_FIELDS) {
    if (!Object.hasOwn(packet, field)) continue;
    if (validateStringArray(packet[field], field, addError)) validArrays.add(field);
  }

  const validPathPatterns = new Map();
  for (const field of PATH_FIELDS) {
    if (!validArrays.has(field)) continue;
    const parsed = [];
    let valid = true;
    for (const [index, value] of packet[field].entries()) {
      const result = parsePathPattern(value);
      if (!result.valid) {
        valid = false;
        addError(result.code, `${field}[${index}]`, result.message);
      } else {
        parsed.push(result.pattern);
      }
    }
    if (valid) validPathPatterns.set(field, parsed);
  }

  const requiredReads = validPathPatterns.get("required_reads");
  const readOnlyPaths = validPathPatterns.get("read_only_paths");
  if (requiredReads && readOnlyPaths) {
    for (const [index, required] of requiredReads.entries()) {
      if (!readOnlyPaths.some((readOnly) => patternIsSubset(required, readOnly))) {
        addError(
          "REQUIRED_READ_NOT_READ_ONLY",
          `required_reads[${index}]`,
          "Every required_reads entry must be fully covered by read_only_paths.",
        );
      }
    }
  }

  for (const [leftField, rightField] of [
    ["write_paths", "read_only_paths"],
    ["write_paths", "forbidden_paths"],
    ["read_only_paths", "forbidden_paths"],
  ]) {
    const leftPatterns = validPathPatterns.get(leftField);
    const rightPatterns = validPathPatterns.get(rightField);
    if (!leftPatterns || !rightPatterns) continue;
    for (const [leftIndex, left] of leftPatterns.entries()) {
      for (const [rightIndex, right] of rightPatterns.entries()) {
        if (patternsOverlap(left, right)) {
          addError(
            "SCOPE_OVERLAP",
            `${leftField}[${leftIndex}]`,
            `${leftField}[${leftIndex}] overlaps ${rightField}[${rightIndex}].`,
          );
        }
      }
    }
  }

  if (validArrays.has("return_fields")) {
    for (const required of REQUIRED_RETURN_FIELDS) {
      if (!packet.return_fields.includes(required)) {
        addError("RETURN_FIELD_MISSING", "return_fields", `return_fields must include ${required}.`);
      }
    }
  }

  return validationResult(errors, errorsTruncated);
}

export function inspectAlpha34TaskScope({ repoRoot, packet } = {}) {
  const validation = validateAlpha34TaskPacket(packet);
  const resolvedRepoRoot = typeof repoRoot === "string" && repoRoot.length > 0
    ? path.resolve(repoRoot)
    : null;
  const base = createInspectionResult({
    packet,
    repoRoot: resolvedRepoRoot,
    validation,
  });

  if (!validation.valid) {
    base.status = "packet_invalid";
    base.violations = validation.errors.map((error) => ({
      code: "TASK_PACKET_INVALID",
      path: null,
      field: error.field,
      reason: error.message,
      recovery: {
        automatic: false,
        guidance: "Correct the task packet and run the read-only scope inspection again.",
        suggested_commands: [],
      },
    }));
    return base;
  }

  if (!resolvedRepoRoot) {
    base.status = "git_invalid";
    base.violations = [simpleViolation(
      "REPO_ROOT_INVALID",
      "repoRoot must be a non-empty path to the Git worktree root.",
      "Provide the repository root and run the inspection again.",
    )];
    return base;
  }

  try {
    const observedRoot = runGit(resolvedRepoRoot, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
    if (realpathSync(observedRoot) !== realpathSync(resolvedRepoRoot)) {
      base.status = "git_invalid";
      base.violations = [simpleViolation(
        "REPO_ROOT_NOT_TOP_LEVEL",
        "repoRoot must name the exact top level of the Git worktree.",
        `Use the Git top level ${observedRoot} as repoRoot.`,
      )];
      return base;
    }

    const actualHead = runGit(resolvedRepoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("utf8").trim();
    base.head.actual = actualHead;
    base.head.matches = actualHead === packet.base_commit;
    if (!base.head.matches) {
      base.status = "head_mismatch";
      base.violations = [simpleViolation(
        "HEAD_MISMATCH",
        "Current HEAD does not equal the packet base_commit.",
        "Stop work and obtain a task packet for the current full commit, or have the control tower place the worktree at the approved base commit.",
      )];
      return base;
    }

    const rawStatus = runGit(resolvedRepoRoot, [
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
      "--renames",
    ]);
    const changed = parseGitStatus(rawStatus);
    base.changed_paths = changed.map((entry) => {
      const scope = classifyScope(entry.path, packet);
      return { ...entry, scope };
    });
    base.changed_files = base.changed_paths.map((entry) => entry.path);
    base.violations = base.changed_paths
      .filter((entry) => entry.scope !== "write")
      .map((entry) => scopeViolation(entry));
    base.ok = base.violations.length === 0;
    base.status = base.ok ? "passed" : "scope_violation";
    return base;
  } catch (error) {
    base.status = "git_invalid";
    base.violations = [simpleViolation(
      "GIT_INSPECTION_FAILED",
      `Read-only Git inspection failed: ${boundedErrorMessage(error)}`,
      "Confirm repoRoot is an accessible Git worktree and run the inspection again; no recovery was performed.",
    )];
    return base;
  }
}

function validationResult(errors, errorsTruncated) {
  return {
    contract: VALIDATION_CONTRACT,
    type: "alpha3.4_task_packet_validation",
    valid: errors.length === 0,
    errors,
    errors_truncated: errorsTruncated,
  };
}

function createInspectionResult({ packet, repoRoot, validation }) {
  return {
    contract: INSPECTION_CONTRACT,
    type: "alpha3.4_task_scope_inspection",
    ok: false,
    status: "not_inspected",
    task_id: typeof packet?.task_id === "string" ? packet.task_id : null,
    repo_root: repoRoot,
    packet_validation: validation,
    head: {
      expected: typeof packet?.base_commit === "string" ? packet.base_commit : null,
      actual: null,
      matches: false,
    },
    changed_files: [],
    changed_paths: [],
    violations: [],
    recovery_performed: false,
  };
}

function validateNonEmptyString(packet, field, addError) {
  if (!Object.hasOwn(packet, field)) return;
  if (typeof packet[field] !== "string" || packet[field].trim().length === 0) {
    addError("FIELD_TYPE_INVALID", field, `${field} must be a non-empty string.`);
  }
}

function validateStringArray(value, field, addError) {
  if (!Array.isArray(value)) {
    addError("FIELD_TYPE_INVALID", field, `${field} must be a non-empty array of strings.`);
    return false;
  }
  if (value.length === 0) {
    addError("ARRAY_EMPTY", field, `${field} must not be empty.`);
    return false;
  }
  let valid = true;
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      valid = false;
      addError("ARRAY_ITEM_TYPE_INVALID", `${field}[${index}]`, `${field} entries must be non-empty strings.`);
      continue;
    }
    if (seen.has(entry)) {
      valid = false;
      addError("ARRAY_ITEM_DUPLICATE", `${field}[${index}]`, `${field} must not contain duplicate entries.`);
    }
    seen.add(entry);
  }
  return valid;
}

function parsePathPattern(value) {
  const fail = (code, message) => ({ valid: false, code, message });
  if (value.length === 0 || value.trim().length === 0) return fail("PATH_EMPTY", "Path patterns must not be empty.");
  if (value.includes("\0")) return fail("PATH_NUL", "Path patterns must not contain NUL.");
  if (value.includes("\\")) return fail("PATH_BACKSLASH", "Path patterns must use POSIX separators, not backslashes.");
  if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) return fail("PATH_ABSOLUTE", "Path patterns must be repository-relative POSIX paths.");
  if (value.startsWith("./") || value.endsWith("/") || value.startsWith("/")) return fail("PATH_BOUNDARY_SLASH", "Path patterns must not have leading ./ or trailing slashes.");

  const recursive = value.endsWith("/**");
  const base = recursive ? value.slice(0, -3) : value;
  if (!base || /[*?\[\]{}!()]/u.test(base) || (!recursive && value.includes("*"))) {
    return fail("PATH_GLOB_UNSAFE", "Only exact paths or a safe terminal directory /** pattern are allowed.");
  }
  const segments = base.split("/");
  if (segments.some((segment) => segment.length === 0)) return fail("PATH_EMPTY_SEGMENT", "Path patterns must not contain empty segments.");
  if (segments.some((segment) => segment === "." || segment === "..")) return fail("PATH_TRAVERSAL", "Path patterns must not contain . or .. segments.");
  return { valid: true, pattern: { raw: value, base, recursive } };
}

function patternIsSubset(candidate, container) {
  if (!candidate.recursive) return patternMatches(container, candidate.base);
  return container.recursive && isSameOrDescendant(candidate.base, container.base);
}

function patternsOverlap(left, right) {
  if (!left.recursive && !right.recursive) return left.base === right.base;
  if (left.recursive && right.recursive) {
    return isSameOrDescendant(left.base, right.base) || isSameOrDescendant(right.base, left.base);
  }
  return left.recursive ? patternMatches(left, right.base) : patternMatches(right, left.base);
}

function patternMatches(pattern, candidatePath) {
  return pattern.recursive
    ? isSameOrDescendant(candidatePath, pattern.base)
    : candidatePath === pattern.base;
}

function isSameOrDescendant(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

function classifyScope(candidatePath, packet) {
  if (packet.forbidden_paths.some((pattern) => patternMatches(parsePathPattern(pattern).pattern, candidatePath))) return "forbidden";
  if (packet.read_only_paths.some((pattern) => patternMatches(parsePathPattern(pattern).pattern, candidatePath))) return "read_only";
  if (packet.write_paths.some((pattern) => patternMatches(parsePathPattern(pattern).pattern, candidatePath))) return "write";
  return "unlisted";
}

function runGit(repoRoot, args) {
  return execFileSync("git", ["--no-optional-locks", "-C", repoRoot, ...args], {
    encoding: "buffer",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseGitStatus(buffer) {
  const records = buffer.toString("utf8").split("\0");
  if (records.at(-1) === "") records.pop();
  const entries = new Map();
  const ensure = (candidatePath) => {
    if (!entries.has(candidatePath)) {
      entries.set(candidatePath, { path: candidatePath, changeTypes: new Set(), relations: [] });
    }
    return entries.get(candidatePath);
  };
  const addXY = (entry, xy) => {
    addStatusCode(entry, "staged", xy[0]);
    addStatusCode(entry, "unstaged", xy[1]);
  };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith("1 ")) {
      const { fields, candidatePath } = splitStatusRecord(record, 8);
      addXY(ensure(candidatePath), fields[1]);
      continue;
    }
    if (record.startsWith("2 ")) {
      const { fields, candidatePath } = splitStatusRecord(record, 9);
      const originalPath = records[++index];
      if (typeof originalPath !== "string") throw new Error("Git rename record is missing its original path.");
      const destination = ensure(candidatePath);
      addXY(destination, fields[1]);
      const relationKind = fields[8][0] === "C" ? "copy" : "rename";
      destination.changeTypes.add(relationKind === "copy" ? "copy_destination" : "rename_destination");
      destination.relations.push({ kind: relationKind, role: "destination", other_path: originalPath });
      if (relationKind === "rename") {
        const source = ensure(originalPath);
        if (fields[1][0] === "R") source.changeTypes.add("staged_renamed");
        if (fields[1][1] === "R") source.changeTypes.add("unstaged_renamed");
        source.changeTypes.add("rename_source");
        source.relations.push({ kind: "rename", role: "source", other_path: candidatePath });
      }
      continue;
    }
    if (record.startsWith("u ")) {
      const { fields, candidatePath } = splitStatusRecord(record, 10);
      addXY(ensure(candidatePath), fields[1]);
      continue;
    }
    if (record.startsWith("? ")) {
      ensure(record.slice(2)).changeTypes.add("untracked");
      continue;
    }
    if (!record.startsWith("! ")) throw new Error("Git returned an unsupported porcelain v2 status record.");
  }

  return [...entries.values()]
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
    .map((entry) => ({
      path: entry.path,
      change_types: [...entry.changeTypes].sort(compareChangeTypes),
      relations: entry.relations.sort((left, right) => (
        left.kind.localeCompare(right.kind, "en")
        || left.role.localeCompare(right.role, "en")
        || left.other_path.localeCompare(right.other_path, "en")
      )),
    }));
}

function splitStatusRecord(record, prefixFieldCount) {
  const fields = [];
  let cursor = 0;
  for (let index = 0; index < prefixFieldCount; index += 1) {
    const boundary = record.indexOf(" ", cursor);
    if (boundary < 0) throw new Error("Git returned a malformed porcelain v2 status record.");
    fields.push(record.slice(cursor, boundary));
    cursor = boundary + 1;
  }
  const candidatePath = record.slice(cursor);
  if (!candidatePath) throw new Error("Git returned an empty changed path.");
  return { fields, candidatePath };
}

function addStatusCode(entry, area, code) {
  if (code === ".") return;
  const kind = GIT_STATUS_KIND[code] ?? "unmerged";
  entry.changeTypes.add(`${area}_${kind}`);
}

function compareChangeTypes(left, right) {
  return (CHANGE_TYPE_RANK.get(left) ?? Number.MAX_SAFE_INTEGER) - (CHANGE_TYPE_RANK.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right, "en");
}

function scopeViolation(entry) {
  const definitions = {
    forbidden: {
      code: "FORBIDDEN_PATH_CHANGED",
      reason: "Changed path matches forbidden_paths.",
    },
    read_only: {
      code: "READ_ONLY_PATH_CHANGED",
      reason: "Changed path matches read_only_paths.",
    },
    unlisted: {
      code: "UNLISTED_PATH_CHANGED",
      reason: "Changed path is not covered by write_paths; unlisted paths are read-only.",
    },
  };
  const definition = definitions[entry.scope];
  return {
    code: definition.code,
    path: entry.path,
    field: null,
    reason: definition.reason,
    change_types: entry.change_types,
    recovery: recoveryFor(entry),
  };
}

function recoveryFor(entry) {
  const hasStaged = entry.change_types.some((value) => value.startsWith("staged_"));
  const hasTrackedWorktree = entry.change_types.some((value) => value.startsWith("unstaged_"));
  const untracked = entry.change_types.includes("untracked");
  const rename = entry.relations.find((relation) => relation.kind === "rename");
  const affectedPaths = rename
    ? [entry.path, rename.other_path].sort((left, right) => left.localeCompare(right, "en"))
    : [entry.path];
  const suggestedCommands = [{
    command: "git",
    args: ["status", "--short", "--", ...affectedPaths],
    purpose: "Inspect the scoped paths without modifying the index or worktree.",
    read_only: true,
  }];
  if (hasStaged) {
    suggestedCommands.push({
      command: "git",
      args: ["diff", "--cached", "--", ...affectedPaths],
      purpose: "Inspect staged content without changing the index.",
      read_only: true,
    });
  }
  if (hasTrackedWorktree || rename) {
    suggestedCommands.push({
      command: "git",
      args: ["diff", "--", ...affectedPaths],
      purpose: "Inspect unstaged tracked content without changing the worktree.",
      read_only: true,
    });
  }
  const guidance = `${untracked || rename ? "Preserve all untracked and rename content. " : ""}Stop and report the scope violation to the control tower; do not restore, reset, clean, move, or delete anything. The listed commands are read-only inspection only.`;
  return { automatic: false, guidance, suggested_commands: suggestedCommands };
}

function simpleViolation(code, reason, guidance) {
  return {
    code,
    path: null,
    field: null,
    reason,
    recovery: { automatic: false, guidance, suggested_commands: [] },
  };
}

function boundedErrorMessage(error) {
  const raw = error?.stderr?.toString?.("utf8") || error?.message || String(error);
  return raw.replace(/[\r\n\t]+/gu, " ").trim().slice(0, 512) || "unknown Git error";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
