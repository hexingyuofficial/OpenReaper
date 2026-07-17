import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ALPHA34_TASK_PACKET_CONTRACT,
  inspectAlpha34TaskScope,
  validateAlpha34TaskPacket,
} from "../../scripts/lib/alpha3-4-task-packet-v1.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI_PATH = path.join(REPO_ROOT, "scripts/check-alpha3-4-task-packet.mjs");
const REQUIRED_RETURN_FIELDS = [
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
];

test("accepts a complete task-packet v1 contract", () => {
  const packet = validPacket("a".repeat(40));
  const result = validateAlpha34TaskPacket(packet);
  assert.equal(ALPHA34_TASK_PACKET_CONTRACT, "openreaper.alpha3.4.task_packet.v1");
  assert.deepEqual(result, {
    contract: "openreaper.alpha3.4.task_packet_validation.v1",
    type: "alpha3.4_task_packet_validation",
    valid: true,
    errors: [],
    errors_truncated: false,
  });
});

test("rejects missing fields, unknown fields, wrong types, empty arrays, duplicates, and incomplete returns", () => {
  const base = validPacket("a".repeat(40));
  const cases = [
    [{ ...base, goal: undefined }, "FIELD_TYPE_INVALID"],
    [withoutField(base, "goal"), "REQUIRED_FIELD_MISSING"],
    [{ ...base, unexpected: true }, "UNKNOWN_FIELD"],
    [{ ...base, work_items: "edit" }, "FIELD_TYPE_INVALID"],
    [{ ...base, acceptance_commands: [] }, "ARRAY_EMPTY"],
    [{ ...base, stop_conditions: ["stop", "stop"] }, "ARRAY_ITEM_DUPLICATE"],
    [{ ...base, return_fields: ["task_id"] }, "RETURN_FIELD_MISSING"],
    [{ ...base, contract: "task-packet.v0" }, "CONTRACT_INVALID"],
    [{ ...base, base_commit: "abc123" }, "BASE_COMMIT_INVALID"],
    [{ ...base, unlisted_path_policy: "writable" }, "UNLISTED_PATH_POLICY_INVALID"],
  ];
  for (const [packet, expectedCode] of cases) {
    const result = validateAlpha34TaskPacket(packet);
    assert.equal(result.valid, false, expectedCode);
    assert.ok(result.errors.some((error) => error.code === expectedCode), JSON.stringify(result.errors));
  }
});

test("rejects absolute, traversal, backslash, NUL, boundary-slash, and unsafe glob paths", () => {
  const invalidPaths = [
    ["/absolute/file.mjs", "PATH_ABSOLUTE"],
    ["C:/absolute/file.mjs", "PATH_ABSOLUTE"],
    ["../escape.mjs", "PATH_TRAVERSAL"],
    ["safe/../escape.mjs", "PATH_TRAVERSAL"],
    ["safe\\file.mjs", "PATH_BACKSLASH"],
    ["safe/nu\0ll.mjs", "PATH_NUL"],
    ["./safe/file.mjs", "PATH_BOUNDARY_SLASH"],
    ["safe/file.mjs/", "PATH_BOUNDARY_SLASH"],
    ["safe/*", "PATH_GLOB_UNSAFE"],
    ["safe/**/file.mjs", "PATH_GLOB_UNSAFE"],
    ["safe/file?.mjs", "PATH_GLOB_UNSAFE"],
    ["safe/[ab].mjs", "PATH_GLOB_UNSAFE"],
    [".", "PATH_TRAVERSAL"],
    ["..", "PATH_TRAVERSAL"],
  ];
  for (const [candidate, expectedCode] of invalidPaths) {
    const packet = { ...validPacket("a".repeat(40)), write_paths: [candidate] };
    const result = validateAlpha34TaskPacket(packet);
    assert.equal(result.valid, false, candidate);
    assert.ok(result.errors.some((error) => error.code === expectedCode), `${candidate}: ${JSON.stringify(result.errors)}`);
  }
});

test("requires required reads to be read-only and rejects semantic scope overlap", () => {
  const notReadOnly = validateAlpha34TaskPacket({
    ...validPacket("a".repeat(40)),
    required_reads: ["other/file.md"],
  });
  assert.ok(notReadOnly.errors.some((error) => error.code === "REQUIRED_READ_NOT_READ_ONLY"));

  for (const changes of [
    { write_paths: ["work/**"], read_only_paths: ["work/file.mjs", "docs/**"] },
    { write_paths: ["work/file.mjs"], forbidden_paths: ["work/**", "forbidden/**"] },
    { read_only_paths: ["docs/**"], forbidden_paths: ["docs/private/**", "forbidden/**"] },
  ]) {
    const result = validateAlpha34TaskPacket({ ...validPacket("a".repeat(40)), ...changes });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === "SCOPE_OVERLAP"), JSON.stringify(result.errors));
  }
});

test("collects staged, unstaged, untracked, deletion, and both rename paths inside writable scope without changing Git state", async () => {
  const fixture = await createGitFixture({
    "docs/guide.md": "guide\n",
    "work/staged.txt": "base staged\n",
    "work/unstaged.txt": "base unstaged\n",
    "work/delete.txt": "base delete\n",
    "work/rename-old.txt": "base rename\n",
  });
  try {
    await writeFile(path.join(fixture.root, "work/staged.txt"), "changed staged\n");
    git(fixture.root, ["add", "--", "work/staged.txt"]);
    git(fixture.root, ["mv", "--", "work/rename-old.txt", "work/rename-new.txt"]);
    await writeFile(path.join(fixture.root, "work/unstaged.txt"), "changed unstaged\n");
    await rm(path.join(fixture.root, "work/delete.txt"));
    await writeFile(path.join(fixture.root, "work/untracked.txt"), "untracked\n");

    const statusBefore = gitStatus(fixture.root);
    const indexBefore = await fileSha256(path.join(fixture.root, ".git/index"));
    const result = inspectAlpha34TaskScope({
      repoRoot: fixture.root,
      packet: validPacket(fixture.head, { write_paths: ["work/**"] }),
    });
    const statusAfter = gitStatus(fixture.root);
    const indexAfter = await fileSha256(path.join(fixture.root, ".git/index"));

    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.equal(result.status, "passed");
    assert.equal(result.head.matches, true);
    assert.equal(result.recovery_performed, false);
    assert.deepEqual(statusAfter, statusBefore);
    assert.equal(indexAfter, indexBefore);

    const changes = new Map(result.changed_paths.map((entry) => [entry.path, entry]));
    assert.ok(changes.get("work/staged.txt").change_types.includes("staged_modified"));
    assert.ok(changes.get("work/unstaged.txt").change_types.includes("unstaged_modified"));
    assert.ok(changes.get("work/untracked.txt").change_types.includes("untracked"));
    assert.ok(changes.get("work/delete.txt").change_types.includes("unstaged_deleted"));
    assert.deepEqual(changes.get("work/rename-old.txt").relations, [{
      kind: "rename",
      role: "source",
      other_path: "work/rename-new.txt",
    }]);
    assert.ok(changes.get("work/rename-old.txt").change_types.includes("rename_source"));
    assert.deepEqual(changes.get("work/rename-new.txt").relations, [{
      kind: "rename",
      role: "destination",
      other_path: "work/rename-old.txt",
    }]);
    assert.ok(changes.get("work/rename-new.txt").change_types.includes("rename_destination"));
    assert.ok(result.changed_paths.every((entry) => entry.scope === "write"));

    const sourceExcluded = inspectAlpha34TaskScope({
      repoRoot: fixture.root,
      packet: validPacket(fixture.head, {
        write_paths: result.changed_files.filter((candidate) => candidate !== "work/rename-old.txt"),
      }),
    });
    assert.equal(sourceExcluded.ok, false);
    assert.ok(sourceExcluded.violations.some((violation) => (
      violation.code === "UNLISTED_PATH_CHANGED" && violation.path === "work/rename-old.txt"
    )));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects read-only, forbidden, and unlisted changes while allowing listed writes", async () => {
  const fixture = await createGitFixture({
    "docs/guide.md": "guide\n",
    "docs/read-only.txt": "read only\n",
    "forbidden/secret.txt": "secret\n",
    "work/allowed.txt": "allowed\n",
    "other/unlisted.txt": "unlisted\n",
  });
  try {
    await writeFile(path.join(fixture.root, "docs/read-only.txt"), "changed\n");
    await writeFile(path.join(fixture.root, "forbidden/secret.txt"), "changed\n");
    git(fixture.root, ["add", "--", "forbidden/secret.txt"]);
    await writeFile(path.join(fixture.root, "work/allowed.txt"), "changed\n");
    await writeFile(path.join(fixture.root, "other/new.txt"), "new\n");

    const result = inspectAlpha34TaskScope({ repoRoot: fixture.root, packet: validPacket(fixture.head) });
    assert.equal(result.ok, false);
    assert.equal(result.status, "scope_violation");
    assert.deepEqual(result.violations.map(({ code, path: violationPath }) => [code, violationPath]), [
      ["READ_ONLY_PATH_CHANGED", "docs/read-only.txt"],
      ["FORBIDDEN_PATH_CHANGED", "forbidden/secret.txt"],
      ["UNLISTED_PATH_CHANGED", "other/new.txt"],
    ]);
    assert.equal(result.changed_paths.find((entry) => entry.path === "work/allowed.txt").scope, "write");
    assert.ok(result.violations.every((violation) => violation.recovery.automatic === false));
    const stagedRecovery = result.violations.find((violation) => violation.path === "forbidden/secret.txt").recovery;
    assert.ok(stagedRecovery.suggested_commands.length >= 2);
    assert.ok(stagedRecovery.suggested_commands.every((command) => command.read_only === true));
    assert.ok(stagedRecovery.suggested_commands.every((command) => (
      !command.args.some((argument) => ["restore", "reset", "clean"].includes(argument))
    )));
    assert.match(stagedRecovery.guidance, /do not restore, reset, clean/u);
    const untrackedRecovery = result.violations.find((violation) => violation.path === "other/new.txt").recovery;
    assert.deepEqual(untrackedRecovery.suggested_commands, [{
      command: "git",
      args: ["status", "--short", "--", "other/new.txt"],
      purpose: "Inspect the scoped paths without modifying the index or worktree.",
      read_only: true,
    }]);
    assert.match(untrackedRecovery.guidance, /Stop and report/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a full but non-matching base commit before scope inspection", async () => {
  const fixture = await createGitFixture({ "docs/guide.md": "guide\n" });
  try {
    const result = inspectAlpha34TaskScope({
      repoRoot: fixture.root,
      packet: validPacket("0".repeat(40)),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "head_mismatch");
    assert.equal(result.head.actual, fixture.head);
    assert.equal(result.head.matches, false);
    assert.deepEqual(result.changed_paths, []);
    assert.equal(result.violations[0].code, "HEAD_MISMATCH");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI returns one compact typed JSON object for success and failure", async () => {
  const fixture = await createGitFixture({ "docs/guide.md": "guide\n" });
  const packetRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-packets-"));
  try {
    const goodPacketPath = path.join(packetRoot, "good.json");
    const badPacketPath = path.join(packetRoot, "bad.json");
    await writeFile(goodPacketPath, JSON.stringify(validPacket(fixture.head)));
    await writeFile(badPacketPath, JSON.stringify(validPacket("0".repeat(40))));

    const success = spawnSync(process.execPath, [CLI_PATH, "--packet", goodPacketPath, "--repo-root", fixture.root], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stderr, "");
    assert.equal(success.stdout.trim().split(/\r?\n/u).length, 1);
    const successJson = JSON.parse(success.stdout);
    assert.equal(successJson.contract, "openreaper.alpha3.4.task_scope_inspection.v1");
    assert.equal(successJson.type, "alpha3.4_task_scope_inspection");
    assert.equal(successJson.status, "passed");
    assert.equal(successJson.ok, true);

    const failure = spawnSync(process.execPath, [CLI_PATH, "--packet", badPacketPath, "--repo-root", fixture.root], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.notEqual(failure.status, 0);
    assert.equal(failure.stderr, "");
    assert.equal(failure.stdout.trim().split(/\r?\n/u).length, 1);
    const failureJson = JSON.parse(failure.stdout);
    assert.equal(failureJson.contract, "openreaper.alpha3.4.task_scope_inspection.v1");
    assert.equal(failureJson.type, "alpha3.4_task_scope_inspection");
    assert.equal(failureJson.status, "head_mismatch");
    assert.equal(failureJson.violations[0].code, "HEAD_MISMATCH");
    assert.equal(failureJson.recovery_performed, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(packetRoot, { recursive: true, force: true });
  }
});

function validPacket(baseCommit, overrides = {}) {
  return {
    contract: ALPHA34_TASK_PACKET_CONTRACT,
    task_id: "alpha3.4-test",
    base_commit: baseCommit,
    goal: "Exercise a bounded task packet.",
    required_reads: ["docs/guide.md"],
    write_paths: ["work/**"],
    read_only_paths: ["docs/**"],
    forbidden_paths: ["forbidden/**"],
    unlisted_path_policy: "read_only",
    work_items: ["Make the bounded change."],
    allowed_reconnaissance: ["Read the required guide."],
    acceptance_commands: ["node --test focused.test.mjs"],
    stop_conditions: ["Stop on a scope violation."],
    return_fields: REQUIRED_RETURN_FIELDS,
    ...overrides,
  };
}

function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

async function createGitFixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-git-"));
  try {
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.name", "OpenReaper Test"]);
    git(root, ["config", "user.email", "openreaper-test@example.invalid"]);
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contents);
    }
    git(root, ["add", "--all"]);
    git(root, ["commit", "--quiet", "-m", "fixture base"]);
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    return { root, head };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function git(root, args, options = {}) {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitStatus(root) {
  return execFileSync("git", [
    "--no-optional-locks",
    "-C",
    root,
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--renames",
  ], {
    encoding: "buffer",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function fileSha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
