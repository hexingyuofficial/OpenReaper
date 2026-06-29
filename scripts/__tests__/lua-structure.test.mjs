import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

async function readRepoFile(relPath) {
  return fs.readFile(path.join(repoRoot, relPath), "utf8");
}

function jsBuildEntityBucketMap(manifest, { strict = true, warnings = [] } = {}) {
  let declared = manifest.entity_buckets;
  if (!declared || typeof declared !== "object") {
    if (strict) {
      throw new Error("manifest.entity_buckets is required when STREETLIGHT_STRICT_MANIFEST is on");
    }
    warnings.push("WARNING: manifest.entity_buckets missing; using legacy item/track/region/render buckets");
    declared = {
      item: "items",
      track: "tracks",
      region: "regions",
      render: "renders",
    };
  }

  const buckets = {};
  for (const [kind, bucket] of Object.entries(declared)) {
    if (kind !== "" && typeof bucket === "string" && bucket !== "") {
      buckets[kind] = bucket;
    } else if (strict) {
      throw new Error("manifest.entity_buckets contains an invalid entry");
    } else {
      warnings.push(`WARNING: ignoring invalid entity_buckets entry '${kind}'`);
    }
  }

  for (const [name, entry] of Object.entries(manifest.templates ?? {})) {
    const kind = entry?.entity_kind;
    if (typeof kind !== "string" || kind === "" || buckets[kind] === undefined) {
      const msg = `template '${name}' declares unknown entity_kind '${String(kind)}'`;
      if (strict) throw new Error(msg);
      warnings.push(`WARNING: ${msg}; runtime fallback will use 'items'`);
    }
  }

  return buckets;
}

function jsMakeLastResult(entityBuckets) {
  return Object.fromEntries(Object.values(entityBuckets).map((bucket) => [bucket, []]));
}

describe("Lua bridge structure", () => {
  it("keeps entity buckets in the manifest instead of hard-coding the dispatcher", async () => {
    const [manifest, bridge] = await Promise.all([
      readRepoFile("reaper/packs/core/manifest.lua"),
      readRepoFile("reaper/streetlight_bridge.lua"),
    ]);

    expect(manifest).toMatch(/entity_buckets\s*=\s*{/);
    expect(manifest).toMatch(/item\s*=\s*"items"/);
    expect(manifest).toMatch(/track\s*=\s*"tracks"/);
    expect(manifest).toMatch(/region\s*=\s*"regions"/);
    expect(manifest).toMatch(/render\s*=\s*"renders"/);

    expect(bridge).toMatch(/packs\/core\/lib\/entity_buckets\.lua/);
    expect(bridge).toMatch(/buckets\.build_entity_bucket_map\(MANIFEST/);
    expect(bridge).toMatch(/buckets\.make_last_result\(ENTITY_BUCKET\)/);
    expect(bridge).not.toMatch(/local\s+ENTITY_BUCKET\s*=\s*{/);
  });

  it("keeps strict manifest validation default-on and runtime fallback loud", async () => {
    const helper = await readRepoFile("reaper/packs/core/lib/entity_buckets.lua");

    expect(helper).toMatch(/function M\.strict_manifest_enabled\(env_value\)/);
    expect(helper).toMatch(/return not env_truthy_off\(env_value\)/);
    expect(helper).toMatch(/template '.*declares unknown entity_kind/);
    expect(helper).toMatch(/runtime fallback will use 'items'/);
  });

  it("proves fake entity families need no dispatcher hard-code", async () => {
    const helper = await readRepoFile("reaper/packs/core/lib/entity_buckets.lua");
    expect(helper).toMatch(/function M\.build_entity_bucket_map\(manifest, opts\)/);
    expect(helper).toMatch(/function M\.make_last_result\(entity_buckets\)/);

    const entityBuckets = jsBuildEntityBucketMap({
      entity_buckets: {
        item: "items",
        track: "tracks",
        widget: "widgets",
      },
      templates: {
        item_pitch: { entity_kind: "item" },
        widget_create: { entity_kind: "widget" },
      },
    });

    expect(entityBuckets).toEqual({
      item: "items",
      track: "tracks",
      widget: "widgets",
    });
    expect(jsMakeLastResult(entityBuckets)).toEqual({
      items: [],
      tracks: [],
      widgets: [],
    });
  });

  it("rejects unknown entity kinds in strict mode and logs fallback in non-strict mode", async () => {
    const manifest = {
      entity_buckets: { item: "items" },
      templates: {
        mystery_create: { entity_kind: "mystery" },
      },
    };

    expect(() => jsBuildEntityBucketMap(manifest)).toThrow(
      "template 'mystery_create' declares unknown entity_kind 'mystery'",
    );

    const warnings = [];
    const buckets = jsBuildEntityBucketMap(manifest, { strict: false, warnings });
    expect(buckets).toEqual({ item: "items" });
    expect(warnings).toEqual([
      "WARNING: template 'mystery_create' declares unknown entity_kind 'mystery'; runtime fallback will use 'items'",
    ]);
  });

  it("exposes a data-driven resolver table while preserving named resolvers", async () => {
    const refs = await readRepoFile("reaper/packs/core/refs.lua");

    expect(refs).toMatch(/function M\.resolve_item\(ref, last_result\)/);
    expect(refs).toMatch(/function M\.resolve_track\(ref, last_result\)/);
    expect(refs).toMatch(/function M\.resolve_region\(ref, last_result\)/);
    expect(refs).toMatch(/M\.RESOLVERS\s*=\s*{/);
    expect(refs).toMatch(/item\s*=\s*M\.resolve_item/);
    expect(refs).toMatch(/track\s*=\s*M\.resolve_track/);
    expect(refs).toMatch(/region\s*=\s*M\.resolve_region/);
    expect(refs).toMatch(/function M\.resolve\(entity_kind, ref, last_result\)/);
  });

  it("keeps Slice 02 track FX include guarded on the Lua bridge side", async () => {
    const bridge = await readRepoFile("reaper/streetlight_bridge.lua");

    expect(bridge).toMatch(/function validate_get_state_include\(params, scope\)/);
    expect(bridge).toMatch(/function is_array_like\(t\)/);
    expect(bridge).toMatch(/rawget\(t, "__streetlight_array"\)\s*~=\s*true then return false/);
    expect(bridge).toMatch(/Unknown get_state include value/);
    expect(bridge).toMatch(/include is only valid with scope='tracks'/);
    expect(bridge).toMatch(/TrackFX_GetNamedConfigParm[^"]+"fx_ident"/s);
    expect(bridge).toMatch(/json\.array\(fx\)/);
    expect(bridge).not.toMatch(/rawget\(t, "__streetlight_array"\)\s*==\s*true\s*then return true/);
    expect(bridge).not.toMatch(/TrackFX_GetFXIdent/);
  });

  it("wires Slice 04 expected_delta structural verification before finalizing templates", async () => {
    const [bridge, verify] = await Promise.all([
      readRepoFile("reaper/streetlight_bridge.lua"),
      readRepoFile("reaper/packs/core/verify.lua"),
    ]);

    expect(bridge).toMatch(/packs\/core\/verify\.lua/);
    expect(bridge).toMatch(/local expected_delta = cmd\.expected_delta/);
    expect(bridge).toMatch(/snap_before = verify\.snapshot\(\)/);
    expect(bridge).toMatch(/local changed_for_verify, changed_total = normalize_changed_ids\(raw_changed\)/);
    expect(bridge).toMatch(/verify\.check\(expected_delta, changed_for_verify, delta, entry\.entity_kind, changed_total\)/);
    expect(bridge).toMatch(/changed_count = changed_total/);
    expect(bridge).toMatch(/code = "VERIFY_FAILED"/);
    expect(bridge).toMatch(/The mutation has been applied.+call get_state to inspect actual state/);

    expect(verify).toMatch(/function M\.snapshot\(\)/);
    expect(verify).toMatch(/function M\.diff\(before, after\)/);
    expect(verify).toMatch(/function M\.check\(expected, changed_ids, delta, entity_kind, changed_count_override\)/);
    expect(verify).toMatch(/changed_count = changed_count_override/);
    expect(verify).toMatch(/expected\.maybeCreates/);
    expect(verify).toMatch(/expected 0 or \+%d \(maybeCreates\)/);
  });
});
