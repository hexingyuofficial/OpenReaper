import assert from "node:assert/strict";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import {
  createExecutableDependencyCatalog,
  evaluateExecutableRecipeTrust,
  sealExecutableRecipeRevision,
  validateExecutableRecipeRevision,
} from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import {
  EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX,
  EXECUTABLE_RECIPE_STORE_BUDGETS,
  EXECUTABLE_RECIPE_STORE_CONTRACT,
  ExecutableRecipeRevisionStoreError,
  buildExecutableRecipeRevisionIdentity,
  createExecutableRecipeRevisionStore,
  deleteExecutableRecipeRevision,
  getExecutableRecipeRevision,
  listExecutableRecipeRevisions,
  normalizeExactRevisionIdentity,
  saveExecutableRecipeRevision,
  sealAndSaveExecutableRecipeRevision,
  validateExecutableRecipeRevisionStoreInput,
} from "../../packages/core/src/executable-recipe-revision-store-v1.mjs";
import {
  USER_EXECUTABLE_RECIPE_REVISION_SUFFIX,
  USER_EXECUTABLE_RECIPE_STORE_CONTRACT,
  loadUserRecipeAuthoringCatalog,
} from "../../packages/core/src/user-recipe-authoring-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const require = createRequire(import.meta.url);
const STORE_MODULE_URL = pathToFileURL(
  path.resolve("packages/core/src/executable-recipe-revision-store-v1.mjs"),
).href;

describe("Alpha3.4-E1 executable recipe revision store", () => {
  it("validates without mutating and seals/saves deterministic immutable bytes", () => {
    const catalog = makeCatalog();
    const draft = makeDraft();
    const root = makeRoot();

    const before = listFiles(root);
    const validated = validateExecutableRecipeRevisionStoreInput(draft, { catalog });
    assert.equal(validated.ok, true);
    assert.deepEqual(listFiles(root), before);

    const sealed = sealExecutableRecipeRevision(draft, {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const saved = saveExecutableRecipeRevision(sealed, {
      root,
      catalog,
      source: "user",
    });

    assert.equal(saved.contract, EXECUTABLE_RECIPE_STORE_CONTRACT);
    assert.equal(saved.ok, true);
    assert.equal(saved.immutable, true);
    assert.equal(saved.recipe_id, sealed.recipe_id);
    assert.equal(saved.content_hash, sealed.content_hash);
    assert.equal(saved.validation_result_id, sealed.validation_result_id);
    assert.deepEqual(saved.dependency_lock, sealed.dependency_lock);
    assert.deepEqual(saved.source_payload_identity, sealed.source_payload_identity);
    assert.equal(EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX, USER_EXECUTABLE_RECIPE_REVISION_SUFFIX);
    assert.equal(saved.relative_path.endsWith(USER_EXECUTABLE_RECIPE_REVISION_SUFFIX), true);

    const onDisk = readFileSync(saved.path, "utf8");
    const again = saveExecutableRecipeRevision(sealed, {
      root,
      catalog,
      source: "user",
      relative_path: saved.relative_path,
    });
    assert.equal(readFileSync(again.path, "utf8"), onDisk);
    assert.equal(again.content_hash, sealed.content_hash);
    assert.equal(again.idempotent, true);

    const loaded = getExecutableRecipeRevision({
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    }, { root, catalog, source: "user" });
    assert.equal(loaded.content_hash, sealed.content_hash);
    assert.deepEqual(loaded.dependency_lock, sealed.dependency_lock);
    assert.deepEqual(loaded.payload.draft.checkpoints, sealed.draft.checkpoints);
    assert.equal(validateExecutableRecipeRevision(loaded.payload, { catalog }).ok, true);

    const authoring = loadUserRecipeAuthoringCatalog({
      roots: [{ source: "user", root }],
      executableDependencyCatalog: catalog,
    });
    assert.equal(authoring.executable_revisions.length, 1);
    assert.equal(authoring.executable_revisions[0].content_hash, sealed.content_hash);
    assert.deepEqual(Object.keys(authoring.executable_revisions[0].discovery).sort(), [
      "entity_kind",
      "id",
      "lifecycle",
      "pack",
      "risk",
      "summary",
      "tags",
      "title",
      "workflow_card",
    ].sort());
  });

  it("handles monotonic revisions, exact delete, and sibling isolation", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const first = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const secondDraft = makeDraft();
    secondDraft.summary = "Second revision content.";
    const second = sealExecutableRecipeRevision(secondDraft, {
      catalog,
      version: "1.1.0",
      revision: 2,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    const savedFirst = saveExecutableRecipeRevision(first, { root, catalog, source: "user" });
    const savedSecond = saveExecutableRecipeRevision(second, { root, catalog, source: "user" });
    assert.equal(listExecutableRecipeRevisions({ root, catalog, source: "user" }).count, 2);

    assert.throws(
      () => saveExecutableRecipeRevision(first, {
        root,
        catalog,
        source: "user",
        relative_path: "tracks/other.executable-revision.json",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_CONFLICT",
    );

    const regress = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "0.9.0",
      revision: 3,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.throws(
      () => saveExecutableRecipeRevision(regress, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_REGRESSION",
    );

    const firstIdentity = buildExecutableRecipeRevisionIdentity(first);
    assert.throws(
      () => deleteExecutableRecipeRevision(firstIdentity, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "DELETE_CONFIRMATION_REQUIRED",
    );
    assert.equal(existsSync(savedFirst.path), true);

    assert.throws(
      () => deleteExecutableRecipeRevision({
        ...firstIdentity,
        content_hash: "0".repeat(64),
      }, { root, catalog, source: "user", confirm: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && (error.code === "REVISION_NOT_FOUND" || error.code === "DELETE_IDENTITY_MISMATCH" || error.code === "ZERO_DELETE_FAILURE"),
    );
    assert.equal(existsSync(savedFirst.path), true);
    assert.equal(existsSync(savedSecond.path), true);

    const deleted = deleteExecutableRecipeRevision(firstIdentity, {
      root,
      catalog,
      source: "user",
      confirm: true,
    });
    assert.equal(deleted.deleted, true);
    assert.equal(existsSync(savedFirst.path), false);
    assert.equal(existsSync(savedSecond.path), true);
    assert.equal(listExecutableRecipeRevisions({ root, catalog, source: "user" }).count, 1);
  });

  it("preserves dependency lock and checkpoint trust round-trip", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
    const loaded = getExecutableRecipeRevision({
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    }, { root, catalog, source: "user" });

    assert.deepEqual(loaded.dependency_lock, sealed.dependency_lock);
    assert.deepEqual(loaded.payload.draft.checkpoints, sealed.draft.checkpoints);

    const trusted = evaluateExecutableRecipeTrust(loaded.payload, completeTrustFacts(sealed), { catalog });
    assert.equal(trusted.trusted, true);

    const drifted = evaluateExecutableRecipeTrust(loaded.payload, {
      ...completeTrustFacts(sealed),
      content_hash: "1".repeat(64),
    }, { catalog });
    assert.equal(drifted.trusted, false);
    assert.ok(drifted.invalidation_reasons.includes("recipe_content_hash_drift"));
  });

  it("fails closed on invalid schema, hash mismatch, path escape, and zero-write cases", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    const invalid = structuredClone(sealed);
    invalid.immutable = false;
    assert.throws(
      () => saveExecutableRecipeRevision(invalid, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError,
    );
    assert.deepEqual(listFiles(root), []);

    const hashMismatch = structuredClone(sealed);
    hashMismatch.content_hash = "a".repeat(64);
    assert.throws(
      () => saveExecutableRecipeRevision(hashMismatch, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError,
    );
    assert.deepEqual(listFiles(root), []);

    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root,
        catalog,
        source: "user",
        relative_path: "../escape.executable-revision.json",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PATH_ESCAPE",
    );
    assert.deepEqual(listFiles(root), []);

    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root,
        catalog,
        source: "user",
        relative_path: "/tmp/abs.executable-revision.json",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PATH_ESCAPE",
    );

    assert.throws(
      () => createExecutableRecipeRevisionStore({ root: "relative/path", catalog }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PATH_ESCAPE",
    );
  });

  it("fails closed on corruption, cross-format ownership, and symlink targets", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });

    writeFileSync(saved.path, "{not-json", "utf8");
    assert.throws(
      () => listExecutableRecipeRevisions({ root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "STORE_CORRUPT",
    );

    const cleanRoot = makeRoot();
    saveExecutableRecipeRevision(sealed, { root: cleanRoot, catalog, source: "user" });
    const outside = path.join(os.tmpdir(), `openreaper-e1-outside-${process.pid}`);
    mkdirSync(outside, { recursive: true });
    const outsideFile = path.join(outside, "shadow.executable-revision.json");
    writeFileSync(outsideFile, JSON.stringify(sealed, null, 2), "utf8");
    const linkPath = path.join(cleanRoot, "tracks", "link.executable-revision.json");
    mkdirSync(path.dirname(linkPath), { recursive: true });
    try {
      symlinkSync(outsideFile, linkPath);
      assert.throws(
        () => listExecutableRecipeRevisions({ root: cleanRoot, catalog, source: "user" }),
        (error) => (
          error instanceof ExecutableRecipeRevisionStoreError
          || /symlink target escapes|Executable revision discovery failed/i.test(String(error.message))
        ),
      );
    } catch (error) {
      if (error?.code === "EPERM") {
        // Some environments disallow symlink creation; skip that assertion only.
      } else {
        throw error;
      }
    }

    const reservedRoot = makeRoot();
    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root: reservedRoot,
        catalog,
        source: "user",
        officialRecipeIds: [sealed.recipe_id],
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && (error.code === "REVISION_OWNERSHIP_CONFLICT" || error.code === "CROSS_FORMAT_SHADOW"),
    );
    assert.deepEqual(listFiles(reservedRoot), []);
  });

  it("keeps collision/regression/reserved-id preflight zero-write", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const first = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    saveExecutableRecipeRevision(first, { root, catalog, source: "user" });
    const before = snapshotTree(root);

    assert.throws(
      () => saveExecutableRecipeRevision(first, {
        root,
        catalog,
        source: "user",
        relative_path: "tracks/other.executable-revision.json",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_CONFLICT",
    );
    assert.deepEqual(snapshotTree(root), before);

    const regress = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "0.9.0",
      revision: 3,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.throws(
      () => saveExecutableRecipeRevision(regress, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_REGRESSION",
    );
    assert.deepEqual(snapshotTree(root), before);

    const emptyRoot = makeRoot();
    assert.throws(
      () => saveExecutableRecipeRevision(first, {
        root: emptyRoot,
        catalog,
        source: "user",
        officialRecipeIds: [first.recipe_id],
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && (error.code === "REVISION_OWNERSHIP_CONFLICT" || error.code === "CROSS_FORMAT_SHADOW"),
    );
    assert.deepEqual(listFiles(emptyRoot), []);
    assert.equal(existsSync(emptyRoot), true);
    assert.deepEqual(readdirSync(emptyRoot), []);
  });

  it("does not create missing roots on list/get and rejects root symlinks", () => {
    const catalog = makeCatalog();
    const missingRoot = path.join(os.tmpdir(), `openreaper-e1-missing-${process.pid}-${Date.now()}`);
    assert.equal(existsSync(missingRoot), false);

    const listed = listExecutableRecipeRevisions({ root: missingRoot, catalog, source: "user" });
    assert.equal(listed.count, 0);
    assert.equal(existsSync(missingRoot), false);

    assert.throws(
      () => getExecutableRecipeRevision({
        recipe_id: "recipe.tracks.prepare_dialog_track_executable",
        version: "1.0.0",
        revision: 1,
        content_hash: "a".repeat(64),
      }, { root: missingRoot, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_NOT_FOUND",
    );
    assert.equal(existsSync(missingRoot), false);

    const realDir = makeRoot();
    const linkRoot = path.join(os.tmpdir(), `openreaper-e1-rootlink-${process.pid}-${Date.now()}`);
    try {
      symlinkSync(realDir, linkRoot);
      assert.throws(
        () => createExecutableRecipeRevisionStore({ root: linkRoot, catalog, source: "user" }),
        (error) => error instanceof ExecutableRecipeRevisionStoreError
          && error.code === "SYMLINK_ESCAPE",
      );
      assert.throws(
        () => listExecutableRecipeRevisions({ root: linkRoot, catalog, source: "user" }),
        (error) => error instanceof ExecutableRecipeRevisionStoreError
          && error.code === "SYMLINK_ESCAPE",
      );
    } catch (error) {
      if (error?.code === "EPERM") {
        // skip symlink-only assertion when OS blocks symlink creation
      } else {
        throw error;
      }
    }
  });

  it("keeps exact repeat save inode and mtime unchanged", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
    const before = statSync(saved.path);

    // ensure measurable wall-clock gap
    const waitUntil = Date.now() + 20;
    while (Date.now() < waitUntil) {
      // spin
    }

    const again = saveExecutableRecipeRevision(sealed, {
      root,
      catalog,
      source: "user",
      relative_path: saved.relative_path,
    });
    const after = statSync(again.path);
    assert.equal(again.idempotent, true);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  });

  it("refuses to overwrite a destination that appears concurrently", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const relativePath = "tracks/concurrent.executable-revision.json";
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify({ different: true }, null, 2)}\n`, "utf8");
    const before = readFileSync(destination, "utf8");
    const beforeStat = statSync(destination);

    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root,
        catalog,
        source: "user",
        relative_path: relativePath,
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_CONFLICT",
    );
    assert.equal(readFileSync(destination, "utf8"), before);
    assert.equal(statSync(destination).ino, beforeStat.ino);
  });

  it("handles EEXIST after preflight via fs.linkSync patch: different never overwrites; identical is idempotent", async () => {
    const catalog = makeCatalog();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const expectedBody = `${JSON.stringify(sealed, null, 2)}\n`;
    const originalLinkSync = fs.linkSync;
    const fsModule = require("node:fs");

    // Different concurrent payload: inject destination on first linkSync, then force EEXIST.
    {
      const root = makeRoot();
      const relativePath = "tracks/race-different.executable-revision.json";
      const destination = path.join(root, relativePath);
      const differentBody = `${JSON.stringify({ concurrent: "different" }, null, 2)}\n`;
      let injectedIno = null;
      fs.linkSync = (existingPath, newPath) => {
        mkdirSync(path.dirname(newPath), { recursive: true });
        writeFileSync(newPath, differentBody, "utf8");
        injectedIno = statSync(newPath).ino;
        const error = new Error("file already exists");
        error.code = "EEXIST";
        throw error;
      };
      fsModule.linkSync = fs.linkSync;
      if (typeof fsModule.syncBuiltinESMExports === "function") {
        fsModule.syncBuiltinESMExports();
      } else if (typeof require("node:module").syncBuiltinESMExports === "function") {
        require("node:module").syncBuiltinESMExports();
      }

      try {
        const storeModule = await import(`${STORE_MODULE_URL}?eexist-different=${Date.now()}`);
        assert.throws(
          () => storeModule.saveExecutableRecipeRevision(sealed, {
            root,
            catalog,
            source: "user",
            relative_path: relativePath,
          }),
          (error) => error instanceof storeModule.ExecutableRecipeRevisionStoreError
            && error.code === "REVISION_CONFLICT",
        );
        assert.equal(readFileSync(destination, "utf8"), differentBody);
        assert.notEqual(readFileSync(destination, "utf8"), expectedBody);
        assert.equal(statSync(destination).ino, injectedIno);
      } finally {
        fs.linkSync = originalLinkSync;
        fsModule.linkSync = originalLinkSync;
        if (typeof require("node:module").syncBuiltinESMExports === "function") {
          require("node:module").syncBuiltinESMExports();
        }
      }
    }

    // Identical concurrent payload: EEXIST re-read returns idempotent:true.
    {
      const root = makeRoot();
      const relativePath = "tracks/race-identical.executable-revision.json";
      const destination = path.join(root, relativePath);
      let injectedIno = null;
      fs.linkSync = (existingPath, newPath) => {
        mkdirSync(path.dirname(newPath), { recursive: true });
        writeFileSync(newPath, expectedBody, "utf8");
        injectedIno = statSync(newPath).ino;
        const error = new Error("file already exists");
        error.code = "EEXIST";
        throw error;
      };
      fsModule.linkSync = fs.linkSync;
      if (typeof require("node:module").syncBuiltinESMExports === "function") {
        require("node:module").syncBuiltinESMExports();
      }

      try {
        const storeModule = await import(`${STORE_MODULE_URL}?eexist-identical=${Date.now()}`);
        const result = storeModule.saveExecutableRecipeRevision(sealed, {
          root,
          catalog,
          source: "user",
          relative_path: relativePath,
        });
        assert.equal(result.idempotent, true);
        assert.equal(readFileSync(destination, "utf8"), expectedBody);
        assert.equal(statSync(destination).ino, injectedIno);
      } finally {
        fs.linkSync = originalLinkSync;
        fsModule.linkSync = originalLinkSync;
        if (typeof require("node:module").syncBuiltinESMExports === "function") {
          require("node:module").syncBuiltinESMExports();
        }
      }
    }

    const productSource = readFileSync(
      new URL("../../packages/core/src/executable-recipe-revision-store-v1.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(productSource, /__testOnlyBeforeAtomicLink/);
  });

  it("rejects symlink path components before mkdir and leaves outside tree unchanged", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const outside = path.join(os.tmpdir(), `openreaper-e1-outside-tree-${process.pid}-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    const markerPath = path.join(outside, "marker.txt");
    writeFileSync(markerPath, "outside-marker\n", "utf8");
    const outsideBefore = snapshotTree(outside);

    const linkName = "link_to_outside";
    const linkPath = path.join(root, linkName);
    try {
      symlinkSync(outside, linkPath);
    } catch (error) {
      if (error?.code === "EPERM") return;
      throw error;
    }

    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    // new/ is absent under the symlink component; failure must not mkdir outside.
    const relativePath = `${linkName}/new/target.executable-revision.json`;

    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root,
        catalog,
        source: "user",
        relative_path: relativePath,
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "SYMLINK_ESCAPE",
    );

    assert.deepEqual(snapshotTree(outside), outsideBefore);
    assert.equal(existsSync(path.join(outside, "new")), false);
    assert.equal(readFileSync(markerPath, "utf8"), "outside-marker\n");
    assert.equal(existsSync(path.join(root, linkName, "new")), false);
  });

  it("keeps bound store root/source/catalog/reserved ownership non-overridable", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const escapeRoot = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const store = createExecutableRecipeRevisionStore({
      root,
      catalog,
      source: "user",
      officialRecipeIds: ["recipe.official.reserved"],
    });

    const saved = store.save(sealed, {
      root: escapeRoot,
      source: "official",
      catalog: createExecutableDependencyCatalog({
        macros: [],
        templates: [],
        capabilities: [],
      }),
      officialRecipeIds: [],
      reservedRecipeIds: [],
    });
    assert.equal(saved.ok, true);
    assert.equal(pathIsInside(root, saved.path), true);
    assert.equal(existsSync(path.join(escapeRoot, saved.relative_path)), false);
    assert.deepEqual(listFiles(escapeRoot), []);
    assert.equal(listExecutableRecipeRevisions({ root, catalog, source: "user" }).count, 1);

    const listed = store.list({
      root: escapeRoot,
      source: "community",
      catalog: makeCatalog(),
    });
    assert.equal(pathIsInside(root, listed.root) || path.resolve(listed.root) === path.resolve(root), true);
    assert.equal(listed.source, "user");
    assert.equal(listed.count, 1);

    const loaded = store.get({
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    }, {
      root: escapeRoot,
      source: "community",
    });
    assert.equal(pathIsInside(root, loaded.path), true);

    // Bound reserved ownership still wins even if caller tries to clear it.
    assert.throws(
      () => store.save(sealExecutableRecipeRevision({
        ...makeDraft(),
        id: "recipe.official.reserved",
        title: "Reserved",
      }, {
        catalog,
        version: "1.0.0",
        revision: 1,
        saved_at: "1970-01-01T00:00:00.000Z",
      }), {
        source: "official",
        officialRecipeIds: [],
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "REVISION_OWNERSHIP_CONFLICT",
    );
  });

  it("fails closed on contradictory optional get identity facts and lock/hash disagreement", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
    const baseIdentity = {
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    };

    assert.throws(
      () => getExecutableRecipeRevision({
        ...baseIdentity,
        dependency_lock_identity: "f".repeat(64),
      }, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "DELETE_IDENTITY_MISMATCH",
    );

    assert.throws(
      () => getExecutableRecipeRevision({
        ...baseIdentity,
        source_payload_identity: {
          scheme: "sha256",
          encoding: "hex",
          payload_kind: "executable_recipe_draft",
          value: "e".repeat(64),
        },
      }, { root, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "DELETE_IDENTITY_MISMATCH",
    );

    assert.throws(
      () => normalizeExactRevisionIdentity({
        ...baseIdentity,
        dependency_lock: sealed.dependency_lock,
        dependency_lock_identity: "0".repeat(64),
      }, { requireContentHash: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID"
        && /disagree/i.test(error.message),
    );

    assert.throws(
      () => normalizeExactRevisionIdentity({
        ...baseIdentity,
        dependency_lock_identity: "not-a-hash",
      }, { requireContentHash: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );

    assert.throws(
      () => normalizeExactRevisionIdentity({
        ...baseIdentity,
        source_payload_identity: { scheme: "md5", value: "x" },
      }, { requireContentHash: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );

    assert.throws(
      () => normalizeExactRevisionIdentity({
        ...baseIdentity,
        validation_result_id: "   ",
      }, { requireContentHash: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );

    const ok = getExecutableRecipeRevision({
      ...baseIdentity,
      dependency_lock: sealed.dependency_lock,
      dependency_lock_identity: buildExecutableRecipeRevisionIdentity(sealed).dependency_lock_identity,
      source_payload_identity: sealed.source_payload_identity,
      validation_result_id: sealed.validation_result_id,
    }, { root, catalog, source: "user" });
    assert.equal(ok.content_hash, sealed.content_hash);
  });

  it("saves into a missing root including platform temp aliases", () => {
    const catalog = makeCatalog();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    const missingRoot = path.join(os.tmpdir(), `openreaper-e1-missing-root-${process.pid}-${Date.now()}`);
    assert.equal(existsSync(missingRoot), false);
    const saved = saveExecutableRecipeRevision(sealed, {
      root: missingRoot,
      catalog,
      source: "user",
    });
    assert.equal(saved.ok, true);
    assert.equal(existsSync(saved.path), true);
    assert.equal(existsSync(missingRoot), true);

    // Explicit /tmp alias path (macOS often maps /tmp -> /private/tmp).
    const tmpAliasRoot = path.join("/tmp", `openreaper-e1-tmp-alias-${process.pid}-${Date.now()}`);
    assert.equal(existsSync(tmpAliasRoot), false);
    const aliasSaved = saveExecutableRecipeRevision(sealed, {
      root: tmpAliasRoot,
      catalog,
      source: "user",
    });
    assert.equal(aliasSaved.ok, true);
    assert.equal(existsSync(aliasSaved.path), true);
  });

  it("rejects a missing root below a caller-controlled symlink before creating outside directories", () => {
    const catalog = makeCatalog();
    const parent = makeRoot();
    const outside = makeRoot();
    const link = path.join(parent, "store-link");
    try {
      symlinkSync(outside, link);
    } catch (error) {
      if (error?.code === "EPERM") return;
      throw error;
    }
    const missingRoot = path.join(link, "missing-store");
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root: missingRoot,
        catalog,
        source: "user",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "SYMLINK_ESCAPE",
    );
    assert.equal(existsSync(path.join(outside, "missing-store")), false);
    assert.deepEqual(listFiles(outside), []);
  });

  it("rejects invalid direct source and malformed reserved arrays", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    assert.throws(
      () => createExecutableRecipeRevisionStore({ root, catalog, source: "agent" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );
    assert.throws(
      () => saveExecutableRecipeRevision(sealed, { root, catalog, source: "system" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );
    assert.throws(
      () => listExecutableRecipeRevisions({ root, catalog, source: "legacy" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );

    assert.throws(
      () => createExecutableRecipeRevisionStore({
        root,
        catalog,
        source: "user",
        officialRecipeIds: "recipe.tracks.prepare_dialog_track_executable",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );
    assert.throws(
      () => createExecutableRecipeRevisionStore({
        root,
        catalog,
        source: "user",
        reservedRecipeIds: [123, "ok"],
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );
    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root,
        catalog,
        source: "user",
        officialRecipeIds: [null, sealed.recipe_id],
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );
    assert.deepEqual(listFiles(root), []);
  });

  it("requires complete exact delete identity and leaves siblings untouched", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const first = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const secondDraft = makeDraft();
    secondDraft.summary = "Sibling revision.";
    const second = sealExecutableRecipeRevision(secondDraft, {
      catalog,
      version: "1.1.0",
      revision: 2,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const savedFirst = saveExecutableRecipeRevision(first, { root, catalog, source: "user" });
    const savedSecond = saveExecutableRecipeRevision(second, { root, catalog, source: "user" });
    const fullIdentity = buildExecutableRecipeRevisionIdentity(first);

    assert.throws(
      () => deleteExecutableRecipeRevision({
        recipe_id: first.recipe_id,
        version: first.version,
        revision: first.revision,
        content_hash: first.content_hash,
      }, { root, catalog, source: "user", confirm: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "PARAMS_INVALID",
    );
    assert.equal(existsSync(savedFirst.path), true);
    assert.equal(existsSync(savedSecond.path), true);

    assert.throws(
      () => deleteExecutableRecipeRevision({
        ...fullIdentity,
        validation_result_id: "validation.tampered",
      }, { root, catalog, source: "user", confirm: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && (error.code === "DELETE_IDENTITY_MISMATCH" || error.code === "ZERO_DELETE_FAILURE"),
    );
    assert.equal(existsSync(savedFirst.path), true);
    assert.equal(existsSync(savedSecond.path), true);

    assert.throws(
      () => deleteExecutableRecipeRevision({
        ...fullIdentity,
        source_payload_identity: {
          ...fullIdentity.source_payload_identity,
          value: "f".repeat(64),
        },
      }, { root, catalog, source: "user", confirm: true }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && (error.code === "DELETE_IDENTITY_MISMATCH" || error.code === "ZERO_DELETE_FAILURE"),
    );
    assert.equal(existsSync(savedFirst.path), true);
    assert.equal(existsSync(savedSecond.path), true);

    const deleted = deleteExecutableRecipeRevision(fullIdentity, {
      root,
      catalog,
      source: "user",
      confirm: true,
    });
    assert.equal(deleted.deleted, true);
    assert.equal(existsSync(savedFirst.path), false);
    assert.equal(existsSync(savedSecond.path), true);
  });

  it("rejects ordinary symlink ancestors for existing and missing roots without outside writes", () => {
    const catalog = makeCatalog();
    const outside = path.join(os.tmpdir(), `openreaper-e1-anc-out-${process.pid}-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    const marker = path.join(outside, "marker.txt");
    writeFileSync(marker, "outside-ancestor\n", "utf8");

    const base = makeRoot();
    const linkName = "caller_symlink_ancestor";
    const linkPath = path.join(base, linkName);
    try {
      symlinkSync(outside, linkPath);
    } catch (error) {
      if (error?.code === "EPERM") return;
      throw error;
    }

    // Existing root lives under a caller-controlled symlink ancestor.
    const existingRoot = path.join(linkPath, "existing_store");
    mkdirSync(existingRoot, { recursive: true });
    const outsideBefore = snapshotTree(outside);
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });

    assert.throws(
      () => createExecutableRecipeRevisionStore({
        root: existingRoot,
        catalog,
        source: "user",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "SYMLINK_ESCAPE",
    );
    assert.throws(
      () => listExecutableRecipeRevisions({
        root: existingRoot,
        catalog,
        source: "user",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "SYMLINK_ESCAPE",
    );
    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root: existingRoot,
        catalog,
        source: "user",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "SYMLINK_ESCAPE",
    );

    const missingRoot = path.join(linkPath, "missing_store");
    assert.equal(existsSync(missingRoot), false);
    assert.throws(
      () => saveExecutableRecipeRevision(sealed, {
        root: missingRoot,
        catalog,
        source: "user",
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "SYMLINK_ESCAPE",
    );
    assert.equal(existsSync(missingRoot), false);
    // Outside tree must not gain revision files or the missing root suffix.
    assert.deepEqual(snapshotTree(outside), outsideBefore);
    assert.equal(existsSync(path.join(outside, "missing_store")), false);
    assert.equal(listFiles(outside).some((name) => name.endsWith(".executable-revision.json")), false);
    assert.equal(readFileSync(marker, "utf8"), "outside-ancestor\n");
  });

  it("fails closed when delete target identity drifts after verification", async () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
    const fullIdentity = buildExecutableRecipeRevisionIdentity(sealed);
    const originalRead = fs.readFileSync;
    const originalUnlink = fs.unlinkSync;
    const fsModule = require("node:fs");
    let unlinkCalled = false;

    // After verification content is read, mutate mtime so pre-rename identity fails closed.
    fs.readFileSync = (candidate, options) => {
      const body = originalRead(candidate, options);
      if (path.resolve(String(candidate)) === path.resolve(saved.path)) {
        const future = (Date.now() / 1000) + 30;
        fs.utimesSync(saved.path, future, future);
      }
      return body;
    };
    fs.unlinkSync = (...args) => {
      unlinkCalled = true;
      return originalUnlink(...args);
    };
    fsModule.readFileSync = fs.readFileSync;
    fsModule.unlinkSync = fs.unlinkSync;
    if (typeof require("node:module").syncBuiltinESMExports === "function") {
      require("node:module").syncBuiltinESMExports();
    }

    try {
      const storeModule = await import(`${STORE_MODULE_URL}?delete-drift=${Date.now()}`);
      assert.throws(
        () => storeModule.deleteExecutableRecipeRevision(fullIdentity, {
          root,
          catalog,
          source: "user",
          confirm: true,
        }),
        (error) => error instanceof storeModule.ExecutableRecipeRevisionStoreError
          && (error.code === "ZERO_DELETE_FAILURE" || error.code === "DELETE_IDENTITY_MISMATCH"),
      );
      assert.equal(unlinkCalled, false);
      assert.equal(existsSync(saved.path), true);
    } finally {
      fs.readFileSync = originalRead;
      fs.unlinkSync = originalUnlink;
      fsModule.readFileSync = originalRead;
      fsModule.unlinkSync = originalUnlink;
      if (typeof require("node:module").syncBuiltinESMExports === "function") {
        require("node:module").syncBuiltinESMExports();
      }
    }
  });

  it("quarantine delete: replacement before rename / mismatch after / recreate / restore collision / success", async () => {
    const catalog = makeCatalog();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    const fullIdentity = buildExecutableRecipeRevisionIdentity(sealed);
    const originalRename = fs.renameSync;
    const originalLink = fs.linkSync;
    const fsModule = require("node:fs");
    const syncExports = () => {
      if (typeof require("node:module").syncBuiltinESMExports === "function") {
        require("node:module").syncBuiltinESMExports();
      }
    };

    // 1) True replacement-before-rename: inside product rename, displace checked original,
    //    place replacement at original path, then let actual rename move the replacement
    //    into quarantine (mismatched facts → exclusive restore of replacement).
    {
      const root = makeRoot();
      const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
      const originalBody = readFileSync(saved.path, "utf8");
      const replacementBody = `${JSON.stringify({ replaced: true }, null, 2)}\n`;
      const displacedPath = path.join(path.dirname(saved.path), "displaced-checked-original.json");
      fs.renameSync = (from, to) => {
        if (path.resolve(from) === path.resolve(saved.path) && String(to).includes(".or-quarantine-")) {
          // Before product target→quarantine rename: move checked original aside, plant replacement.
          originalRename(from, displacedPath);
          writeFileSync(from, replacementBody, "utf8");
          // Actual product rename now moves the replacement into quarantine.
          return originalRename(from, to);
        }
        return originalRename(from, to);
      };
      fsModule.renameSync = fs.renameSync;
      syncExports();
      try {
        const storeModule = await import(`${STORE_MODULE_URL}?q-replace=${Date.now()}`);
        let caught;
        try {
          storeModule.deleteExecutableRecipeRevision(fullIdentity, {
            root, catalog, source: "user", confirm: true,
          });
        } catch (error) {
          caught = error;
        }
        assert.ok(caught instanceof storeModule.ExecutableRecipeRevisionStoreError);
        assert.equal(caught.code, "ZERO_DELETE_FAILURE");
        assert.equal(caught.details?.outcome, "restored");
        // Exclusive restore puts the mismatched replacement back at original path.
        assert.equal(existsSync(saved.path), true);
        assert.equal(readFileSync(saved.path, "utf8"), replacementBody);
        // Displaced checked original remains at its separate path.
        assert.equal(existsSync(displacedPath), true);
        assert.equal(readFileSync(displacedPath, "utf8"), originalBody);
        // Quarantine cleaned after successful exclusive restore.
        const parentEntries = readdirSync(path.dirname(saved.path));
        assert.equal(parentEntries.some((name) => name.startsWith(".or-quarantine-")), false);
      } finally {
        fs.renameSync = originalRename;
        fsModule.renameSync = originalRename;
        syncExports();
      }
    }

    // 2) Mismatch after rename with absent original → exclusive restore.
    {
      const root = makeRoot();
      const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
      const originalBody = readFileSync(saved.path, "utf8");
      fs.renameSync = (from, to) => {
        originalRename(from, to);
        if (String(to).includes(".or-quarantine-")) {
          const future = (Date.now() / 1000) + 60;
          fs.utimesSync(to, future, future);
        }
      };
      fsModule.renameSync = fs.renameSync;
      syncExports();
      try {
        const storeModule = await import(`${STORE_MODULE_URL}?q-mismatch=${Date.now()}`);
        let caught;
        try {
          storeModule.deleteExecutableRecipeRevision(fullIdentity, {
            root, catalog, source: "user", confirm: true,
          });
        } catch (error) {
          caught = error;
        }
        assert.ok(caught instanceof storeModule.ExecutableRecipeRevisionStoreError);
        assert.equal(caught.code, "ZERO_DELETE_FAILURE");
        assert.equal(caught.details?.outcome, "restored");
        assert.equal(existsSync(saved.path), true);
        assert.equal(readFileSync(saved.path, "utf8"), originalBody);
        assert.equal(caught.details?.quarantine_file, undefined);
        const parentEntries = readdirSync(path.dirname(saved.path));
        assert.equal(parentEntries.some((name) => name.startsWith(".or-quarantine-")), false);
      } finally {
        fs.renameSync = originalRename;
        fsModule.renameSync = originalRename;
        syncExports();
      }
    }

    // 3) Original path recreated after rename: leave recreated bytes untouched; quarantine preserved.
    {
      const root = makeRoot();
      const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
      const recreatedBody = `${JSON.stringify({ recreated: true }, null, 2)}\n`;
      fs.renameSync = (from, to) => {
        originalRename(from, to);
        if (String(to).includes(".or-quarantine-")) {
          writeFileSync(from, recreatedBody, "utf8");
          const future = (Date.now() / 1000) + 90;
          fs.utimesSync(to, future, future);
        }
      };
      fsModule.renameSync = fs.renameSync;
      syncExports();
      try {
        const storeModule = await import(`${STORE_MODULE_URL}?q-recreate=${Date.now()}`);
        let caught;
        try {
          storeModule.deleteExecutableRecipeRevision(fullIdentity, {
            root, catalog, source: "user", confirm: true,
          });
        } catch (error) {
          caught = error;
        }
        assert.ok(caught instanceof storeModule.ExecutableRecipeRevisionStoreError);
        assert.equal(caught.code, "ZERO_DELETE_FAILURE");
        assert.equal(caught.details?.outcome, "unknown");
        assert.equal(existsSync(saved.path), true);
        assert.equal(readFileSync(saved.path, "utf8"), recreatedBody);
        assert.ok(caught.details?.quarantine_file);
        assert.equal(existsSync(caught.details.quarantine_file), true);
      } finally {
        fs.renameSync = originalRename;
        fsModule.renameSync = originalRename;
        syncExports();
      }
    }

    // 4) True restore collision: exclusive linkSync fails after absent-path check.
    {
      const root = makeRoot();
      const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
      fs.renameSync = (from, to) => {
        originalRename(from, to);
        if (String(to).includes(".or-quarantine-")) {
          const future = (Date.now() / 1000) + 120;
          fs.utimesSync(to, future, future);
        }
      };
      fs.linkSync = (existingPath, newPath) => {
        if (path.resolve(newPath) === path.resolve(saved.path)) {
          const error = new Error("file already exists");
          error.code = "EEXIST";
          throw error;
        }
        return originalLink(existingPath, newPath);
      };
      fsModule.renameSync = fs.renameSync;
      fsModule.linkSync = fs.linkSync;
      syncExports();
      try {
        const storeModule = await import(`${STORE_MODULE_URL}?q-collision=${Date.now()}`);
        let caught;
        try {
          storeModule.deleteExecutableRecipeRevision(fullIdentity, {
            root, catalog, source: "user", confirm: true,
          });
        } catch (error) {
          caught = error;
        }
        assert.ok(caught instanceof storeModule.ExecutableRecipeRevisionStoreError);
        assert.equal(caught.code, "ZERO_DELETE_FAILURE");
        assert.equal(caught.details?.outcome, "unknown");
        assert.ok(caught.details?.quarantine_file);
        assert.equal(existsSync(caught.details.quarantine_file), true);
        // Original path still absent after failed exclusive restore (link never succeeded).
        assert.equal(existsSync(saved.path), false);
      } finally {
        fs.renameSync = originalRename;
        fs.linkSync = originalLink;
        fsModule.renameSync = originalRename;
        fsModule.linkSync = originalLink;
        syncExports();
      }
    }

    // 5) Exact success through quarantine path.
    {
      const root = makeRoot();
      const saved = saveExecutableRecipeRevision(sealed, { root, catalog, source: "user" });
      const deleted = deleteExecutableRecipeRevision(fullIdentity, {
        root, catalog, source: "user", confirm: true,
      });
      assert.equal(deleted.deleted, true);
      assert.equal(deleted.outcome, "deleted");
      assert.equal(existsSync(saved.path), false);
    }
  });

  it("enforces fixed store scan/item/byte budgets during traversal before content reads", async () => {
    const catalog = makeCatalog();
    assert.equal(EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_files, 512);
    assert.equal(EXECUTABLE_RECIPE_STORE_BUDGETS.max_list_items, 256);
    assert.equal(EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_bytes, 8 * 1024 * 1024);
    const fsModule = require("node:fs");
    const syncExports = () => {
      if (typeof require("node:module").syncBuiltinESMExports === "function") {
        require("node:module").syncBuiltinESMExports();
      }
    };
    const originalRead = fs.readFileSync;

    // max_scan_files counts every visited entry (dirs/ignored/symlinks/revisions).
    // Root-level files: N entries => N visits (no extra parent dir under root).
    const scanRoot = makeRoot();
    for (let index = 0; index < EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_files + 1; index += 1) {
      writeFileSync(
        path.join(scanRoot, `overflow_${index}.executable-revision.json`),
        "{}\n",
        "utf8",
      );
    }
    let revisionBodyReads = 0;
    fs.readFileSync = (candidate, options) => {
      if (String(candidate).endsWith(".executable-revision.json")) revisionBodyReads += 1;
      return originalRead(candidate, options);
    };
    fsModule.readFileSync = fs.readFileSync;
    syncExports();
    try {
      const storeModule = await import(`${STORE_MODULE_URL}?budget-files=${Date.now()}`);
      assert.throws(
        () => storeModule.listExecutableRecipeRevisions({ root: scanRoot, catalog, source: "user" }),
        (error) => error instanceof storeModule.ExecutableRecipeRevisionStoreError
          && error.code === "STORE_BUDGET_EXCEEDED"
          && error.details?.budget === "max_scan_files",
      );
      assert.equal(revisionBodyReads, 0);
    } finally {
      fs.readFileSync = originalRead;
      fsModule.readFileSync = originalRead;
      syncExports();
    }

    // Exact scan_files boundary (512 root-level entries) proceeds into parse.
    const boundaryRoot = makeRoot();
    for (let index = 0; index < EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_files; index += 1) {
      writeFileSync(
        path.join(boundaryRoot, `boundary_${index}.executable-revision.json`),
        "{}\n",
        "utf8",
      );
    }
    assert.throws(
      () => listExecutableRecipeRevisions({ root: boundaryRoot, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "STORE_CORRUPT",
    );

    // Deterministic ignored-entry overflow: 513 irrelevant entries fail before completing.
    const ignoredRoot = makeRoot();
    for (let index = 0; index < EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_files + 1; index += 1) {
      writeFileSync(path.join(ignoredRoot, `noise_${index}.txt`), "noise\n", "utf8");
    }
    assert.throws(
      () => listExecutableRecipeRevisions({ root: ignoredRoot, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "STORE_BUDGET_EXCEEDED"
        && error.details?.budget === "max_scan_files"
        && error.details?.observed === EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_files + 1,
    );

    // Containing-directory accounting: tracks/ + 512 files => 513 visits => overflow.
    const nestedRoot = makeRoot();
    mkdirSync(path.join(nestedRoot, "tracks"), { recursive: true });
    for (let index = 0; index < EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_files; index += 1) {
      writeFileSync(
        path.join(nestedRoot, "tracks", `nested_${index}.executable-revision.json`),
        "{}\n",
        "utf8",
      );
    }
    assert.throws(
      () => listExecutableRecipeRevisions({ root: nestedRoot, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "STORE_BUDGET_EXCEEDED"
        && error.details?.budget === "max_scan_files",
    );

    // Exact max_scan_bytes boundary: one body read is allowed; corrupt parse is fine.
    {
      const exactByteRoot = makeRoot();
      mkdirSync(path.join(exactByteRoot, "tracks"), { recursive: true });
      const exactPath = path.join(exactByteRoot, "tracks", "exact.executable-revision.json");
      writeFileSync(exactPath, "x".repeat(EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_bytes), "utf8");
      let exactReads = 0;
      fs.readFileSync = (candidate, options) => {
        if (String(candidate).includes("exact.executable-revision.json")) exactReads += 1;
        return originalRead(candidate, options);
      };
      fsModule.readFileSync = fs.readFileSync;
      syncExports();
      try {
        const storeModule = await import(`${STORE_MODULE_URL}?budget-exact-bytes=${Date.now()}`);
        assert.throws(
          () => storeModule.listExecutableRecipeRevisions({
            root: exactByteRoot, catalog, source: "user",
          }),
          (error) => error instanceof storeModule.ExecutableRecipeRevisionStoreError
            && error.code === "STORE_CORRUPT",
        );
        assert.ok(exactReads >= 1);
      } finally {
        fs.readFileSync = originalRead;
        fsModule.readFileSync = originalRead;
        syncExports();
      }
    }

    // scan_bytes one-byte overflow: zero body reads.
    {
      const byteRoot = makeRoot();
      mkdirSync(path.join(byteRoot, "tracks"), { recursive: true });
      const hugePath = path.join(byteRoot, "tracks", "huge.executable-revision.json");
      writeFileSync(
        hugePath,
        "x".repeat(EXECUTABLE_RECIPE_STORE_BUDGETS.max_scan_bytes + 1),
        "utf8",
      );
      let hugeReads = 0;
      fs.readFileSync = (candidate, options) => {
        if (String(candidate).includes("huge.executable-revision.json")) hugeReads += 1;
        return originalRead(candidate, options);
      };
      fsModule.readFileSync = fs.readFileSync;
      syncExports();
      try {
        const storeModule = await import(`${STORE_MODULE_URL}?budget-huge-bytes=${Date.now()}`);
        assert.throws(
          () => storeModule.listExecutableRecipeRevisions({
            root: byteRoot, catalog, source: "user",
          }),
          (error) => error instanceof storeModule.ExecutableRecipeRevisionStoreError
            && error.code === "STORE_BUDGET_EXCEEDED"
            && error.details?.budget === "max_scan_bytes",
        );
        assert.equal(hugeReads, 0);
      } finally {
        fs.readFileSync = originalRead;
        fsModule.readFileSync = originalRead;
        syncExports();
      }
    }

    // max_list_items overflow with valid distinct recipe ids (under max_scan_files).
    const itemRoot = makeRoot();
    const limit = EXECUTABLE_RECIPE_STORE_BUDGETS.max_list_items;
    const itemDirectory = path.join(itemRoot, "tracks");
    mkdirSync(itemDirectory, { recursive: true });
    for (let index = 0; index < limit + 1; index += 1) {
      const draft = makeDraft();
      const suffix = String(index).padStart(3, "0");
      draft.id = `recipe.tracks.budget_item_${suffix}`;
      draft.title = `Budget item ${index}`;
      const sealed = sealExecutableRecipeRevision(draft, {
        catalog,
        version: "1.0.0",
        revision: 1,
        saved_at: "1970-01-01T00:00:00.000Z",
      });
      writeFileSync(
        path.join(itemDirectory, `budget_item_${suffix}.r1.v1.0.0.executable-revision.json`),
        `${JSON.stringify(sealed, null, 2)}\n`,
        "utf8",
      );
    }
    assert.throws(
      () => listExecutableRecipeRevisions({ root: itemRoot, catalog, source: "user" }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "STORE_BUDGET_EXCEEDED"
        && error.details?.budget === "max_list_items",
    );

    // Bound factory cannot override budgets per call.
    const store = createExecutableRecipeRevisionStore({ root: scanRoot, catalog, source: "user" });
    assert.throws(
      () => store.list({
        max_scan_files: 10_000,
        budgets: { max_scan_files: 10_000 },
      }),
      (error) => error instanceof ExecutableRecipeRevisionStoreError
        && error.code === "STORE_BUDGET_EXCEEDED",
    );
  });

  it("keeps unbounded discoverExecutableRevisionFiles callers compatible without store budgets", async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "tracks"), { recursive: true });
    writeFileSync(
      path.join(root, "tracks", "compat.executable-revision.json"),
      "{}\n",
      "utf8",
    );
    const authoring = await import("../../packages/core/src/user-recipe-authoring-v1.mjs");
    const files = authoring.discoverExecutableRevisionFiles([{ source: "user", root }]);
    assert.equal(files.length, 1);
    assert.equal(files[0].relative_path.endsWith(".executable-revision.json"), true);
  });

  it("exposes only bounded store operations and keeps public counts unchanged", () => {
    const catalog = makeCatalog();
    const root = makeRoot();
    const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
    assert.equal(store.contract, EXECUTABLE_RECIPE_STORE_CONTRACT);
    assert.equal(USER_EXECUTABLE_RECIPE_STORE_CONTRACT, EXECUTABLE_RECIPE_STORE_CONTRACT);
    assert.equal(typeof store.validate, "function");
    assert.equal(typeof store.save, "function");
    assert.equal(typeof store.list, "function");
    assert.equal(typeof store.get, "function");
    assert.equal(typeof store.delete, "function");
    assert.equal(typeof store.run, "undefined");
    assert.equal(typeof store.resume, "undefined");
    assert.equal(typeof store.call_recipe, "undefined");
    assert.equal(typeof store.execute, "undefined");

    const sealed = sealAndSaveExecutableRecipeRevision(makeDraft(), {
      root,
      catalog,
      source: "user",
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(sealed.ok, true);

    const source = readFileSync(
      new URL("../../packages/core/src/executable-recipe-revision-store-v1.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /packages\/mcp-server/);
    assert.doesNotMatch(source, /alpha3-d2-workflow-entrypoints/);
    assert.doesNotMatch(source, /function\s+(?:executeRecipe|runRecipe)|call_recipe\s*\(/);
    assert.match(source, /linkSync/);
    assert.match(source, /"wx"/);
    assert.match(source, /sealExecutableRecipeRevision/);

    // Alpha3.4-E2 adds public call_recipe; E1 store itself stays non-executing.
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 6);
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.includes("call_recipe"), true);
    assert.equal(typeof store.run, "undefined");
    assert.equal(typeof store.resume, "undefined");
    assert.equal(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length, 15);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 239);

    const packageSource = readFileSync(
      new URL("../../scripts/package-openreaper-alpha.mjs", import.meta.url),
      "utf8",
    );
    assert.match(packageSource, /bridge_handler_count:\s*91/);
  });
});

function makeCatalog() {
  return createExecutableDependencyCatalog({
    macros: [{
      id: "macro.project.inspect",
      version: "1.0.0",
      risk: "read",
      descriptor_hash: "a".repeat(64),
      capabilities: ["project.index"],
    }],
    templates: [{
      id: "template.tracks.create_track",
      version: "1.0.0",
      risk: "write",
      descriptor_hash: "b".repeat(64),
      capabilities: ["tracks.write"],
    }],
    capabilities: ["project.index", "tracks.write"],
  });
}

function makeDraft() {
  return {
    contract: "recipe.executable.draft.v1",
    id: "recipe.tracks.prepare_dialog_track_executable",
    title: "Executable prepare dialog track",
    summary: "Macro-first executable draft with typed template fallback.",
    pack: "tracks",
    risk: "write",
    inputs: [{ id: "track_name", type: "string", required: true }],
    outputs: [{ id: "track_ref", type: "ref.track", required: true }],
    stages: [
      {
        id: "run_macro",
        kind: "macro",
        dependency: {
          kind: "macro",
          id: "macro.project.inspect",
          version: "1.0.0",
          fallback_reason: null,
        },
        inputs: ["track_name"],
        outputs: ["project_summary"],
        risk: "read",
        checkpoint: "checkpoint_run_macro",
      },
      {
        id: "create_track",
        kind: "template",
        dependency: {
          kind: "template",
          id: "template.tracks.create_track",
          version: "1.0.0",
          fallback_reason: "official_template_atom_required",
        },
        inputs: ["project_summary", "track_name"],
        outputs: ["track_ref"],
        risk: "write",
        checkpoint: "checkpoint_create_track",
      },
    ],
    bindings: [
      {
        from: { scope: "recipe_input", id: null, port: "track_name" },
        to: { scope: "stage", id: "run_macro", port: "track_name" },
      },
      {
        from: { scope: "stage", id: "run_macro", port: "project_summary" },
        to: { scope: "stage", id: "create_track", port: "project_summary" },
      },
      {
        from: { scope: "recipe_input", id: null, port: "track_name" },
        to: { scope: "stage", id: "create_track", port: "track_name" },
      },
      {
        from: { scope: "stage", id: "create_track", port: "track_ref" },
        to: { scope: "recipe_output", id: null, port: "track_ref" },
      },
    ],
    dependencies: [
      {
        kind: "macro",
        id: "macro.project.inspect",
        version: "1.0.0",
        risk: "read",
        fallback_reason: null,
        descriptor_hash: "a".repeat(64),
      },
      {
        kind: "template",
        id: "template.tracks.create_track",
        version: "1.0.0",
        risk: "write",
        fallback_reason: "official_template_atom_required",
        descriptor_hash: "b".repeat(64),
      },
    ],
    required_capabilities: ["project.index", "tracks.write"],
    risk_grants: ["read", "write"],
    checkpoints: [
      {
        id: "checkpoint_run_macro",
        after_stage: "run_macro",
        evidence_id: "evidence_run_macro",
        resume_identity: "resume.run_macro",
        summary: "Macro complete.",
      },
      {
        id: "checkpoint_create_track",
        after_stage: "create_track",
        evidence_id: "evidence_create_track",
        resume_identity: "resume.create_track",
        summary: "Template complete.",
      },
    ],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 2,
      dependency_count: 2,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: {
      project_identity: "project:fixture-a",
      bridge_owner: "owner:fixture",
      bridge_generation: "generation:1",
      platform: "darwin",
    },
  };
}

function completeTrustFacts(sealed) {
  return {
    content_hash: sealed.content_hash,
    risk_grants: sealed.draft.risk_grants,
    project_identity: sealed.draft.portability.project_identity,
    bridge_owner: sealed.draft.portability.bridge_owner,
    bridge_generation: sealed.draft.portability.bridge_generation,
    available_capabilities: sealed.draft.required_capabilities,
    checkpoint_evidence: sealed.draft.checkpoints.map((item) => ({
      checkpoint_id: item.id,
      evidence_id: item.evidence_id,
      resume_identity: item.resume_identity,
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    })),
    dependency_versions: sealed.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
    })),
    dependency_descriptors: sealed.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      descriptor_hash: entry.descriptor_hash,
    })),
  };
}

function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "openreaper-e1-store-"));
}

function pathIsInside(root, candidate) {
  const rootAbs = fs.realpathSync(path.resolve(root));
  const candidateAbs = fs.realpathSync(path.resolve(candidate));
  const relative = path.relative(rootAbs, candidateAbs);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function listFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  walk(root, "", files);
  return files.sort();
}

function snapshotTree(root) {
  const entries = [];
  if (!existsSync(root)) return entries;
  walkSnapshot(root, "", entries);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function walk(current, relative, files) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const nextRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walk(full, nextRelative, files);
    else files.push(nextRelative);
  }
}

function walkSnapshot(current, relative, entries) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const nextRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      entries.push({ path: `${nextRelative}/`, kind: "dir" });
      walkSnapshot(full, nextRelative, entries);
    } else {
      const stats = statSync(full);
      entries.push({
        path: nextRelative,
        kind: "file",
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ino: stats.ino,
      });
    }
  }
}
