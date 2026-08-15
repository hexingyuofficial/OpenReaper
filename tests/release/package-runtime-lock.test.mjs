import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createOpenReaperRuntimePackageMetadata,
  validateOpenReaperRuntimeDependencyLock,
} from "../../scripts/package-openreaper-alpha.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageBuilderPath = path.join(repoRoot, "scripts/package-openreaper-alpha.mjs");
const runtimeLockPath = path.join(
  repoRoot,
  "scripts/openreaper-alpha-package/runtime-package-lock.json",
);

test("release runtime dependency graph is checked in and npm-ci locked", async () => {
  const [builderSource, lockBytes] = await Promise.all([
    readFile(packageBuilderPath, "utf8"),
    readFile(runtimeLockPath),
  ]);
  const packageMetadata = createOpenReaperRuntimePackageMetadata("0.1.0");
  const lock = JSON.parse(lockBytes.toString("utf8"));

  assert.equal(validateOpenReaperRuntimeDependencyLock(lock, packageMetadata), lock);
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/sdk"].version, "1.30.0");
  assert.equal(lock.packages["node_modules/jose"].version, "6.2.9");
  assert.equal(lock.packages["node_modules/zod"].version, "3.25.76");
  assert.match(createHash("sha256").update(lockBytes).digest("hex"), /^[a-f0-9]{64}$/u);

  const installStart = builderSource.indexOf("async function installPackageDependencies()");
  const installEnd = builderSource.indexOf("export function createOpenReaperRuntimePackageMetadata", installStart);
  assert.ok(installStart >= 0 && installEnd > installStart);
  const installSource = builderSource.slice(installStart, installEnd);
  assert.match(installSource, /run\("npm", \["ci", "--omit=dev"/u);
  assert.doesNotMatch(installSource, /run\("npm", \["install"/u);
  assert.match(builderSource, /dependency_source: "checked_in_runtime_lock_npm_ci"/u);
  assert.match(builderSource, /runtime_dependency_lock_sha256/u);
});

test("release runtime lock fails closed when root dependencies drift", async () => {
  const packageMetadata = createOpenReaperRuntimePackageMetadata("0.1.0");
  const lock = JSON.parse(await readFile(runtimeLockPath, "utf8"));
  lock.packages[""].dependencies.zod = "^4.0.0";
  assert.throws(
    () => validateOpenReaperRuntimeDependencyLock(lock, packageMetadata),
    /does not match the generated runtime package/u,
  );
});
