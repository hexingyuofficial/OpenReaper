import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ENGINE_BUNDLE_CONTRACT,
  studioEngineBundleManifestPath,
  writeEngineBundleManifest,
} from "../lib/face/bundle-engine.mjs";
import { repoRootFromStudio } from "../lib/paths.mjs";

describe("engine bundle manifest", () => {
  it("writes install root manifest for packaged OpenReaper slot", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-bundle-"));
    const home = path.join(tmp, "home");
    const installRoot = path.join(tmp, "current");
    try {
      const result = await writeEngineBundleManifest({
        homeDir: home,
        installRoot,
        repoRoot: repoRootFromStudio(),
      });
      expect(result.written).toBe(true);
      const raw = await readFile(studioEngineBundleManifestPath(home), "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.contract).toBe(ENGINE_BUNDLE_CONTRACT);
      expect(parsed.installRoot).toBe(installRoot);
      expect(parsed.bundledLayout).toBe("openreaper-alpha");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
