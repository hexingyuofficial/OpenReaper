import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffLuaErrorCodeLiteralUsage,
  parseErrorCodesTs,
} from "../error-codes.mjs";

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

  it("loads packs through the Slice 20B pack loader and forbids non-core entity-kind expansion", async () => {
    const [bridge, loader] = await Promise.all([
      readRepoFile("reaper/streetlight_bridge.lua"),
      readRepoFile("reaper/packs/core/lib/pack_loader.lua"),
    ]);

    expect(bridge).toMatch(/packs\/core\/lib\/pack_loader\.lua/);
    expect(bridge).toMatch(/packs\.parse_enabled_packs/);
    expect(bridge).toMatch(/packs\.load_packs\(SCRIPT_DIR, ENABLED_PACKS/);
    expect(loader).toMatch(/Enabled packs must start with core/);
    expect(loader).toMatch(/declares new entity_kind/);
    expect(loader).toMatch(/non-core packs may only reuse core entity kinds/);
    expect(loader).toMatch(/Duplicate template name/);
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
    expect(bridge).toMatch(/code = ERRS\.VERIFY_FAILED/);
    expect(bridge).toMatch(/The mutation has been applied.+call get_state to inspect actual state/);

    expect(verify).toMatch(/function M\.snapshot\(\)/);
    expect(verify).toMatch(/function M\.diff\(before, after\)/);
    expect(verify).toMatch(/function M\.check\(expected, changed_ids, delta, entity_kind, changed_count_override\)/);
    expect(verify).toMatch(/changed_count = changed_count_override/);
    expect(verify).toMatch(/expected\.maybeCreates/);
    expect(verify).toMatch(/expected 0 or \+%d \(maybeCreates\)/);
  });

  it("uses a file-backed owner token so double-run launchers cannot split LAST_RESULT", async () => {
    const bridge = await readRepoFile("reaper/streetlight_bridge.lua");

    expect(bridge).toMatch(/local OWNER\s*=\s*QUEUE_DIR \.\. "\/bridge_owner"/);
    expect(bridge).toMatch(/local OWNER_TOKEN = nil/);
    expect(bridge).toMatch(/function write_owner_token\(\)/);
    expect(bridge).toMatch(/write_file_atomic\(OWNER, OWNER_TOKEN\)/);
    expect(bridge).toMatch(/function owner_token_matches\(\)/);
    expect(bridge).toMatch(/read_file\(OWNER\) == OWNER_TOKEN/);
    expect(bridge).toMatch(/write_owner_token\(\)/);
    expect(bridge).toMatch(/bridge owner token changed; self-exiting/);

    const tickIndex = bridge.indexOf("local function tick()");
    const ownerIndex = bridge.indexOf("if not owner_token_matches()", tickIndex);
    const generationIndex = bridge.indexOf("if MY_GENERATION ~= _G.STREETLIGHT_BRIDGE_GENERATION", tickIndex);
    const processIndex = bridge.indexOf("pcall(process_one)", tickIndex);
    expect(ownerIndex).toBeGreaterThan(tickIndex);
    expect(ownerIndex).toBeLessThan(generationIndex);
    expect(ownerIndex).toBeLessThan(processIndex);
  });

  it("wires Slice 15 idempotency through sync and deferred template paths without touching reads", async () => {
    const bridge = await readRepoFile("reaper/streetlight_bridge.lua");

    expect(bridge).toMatch(/local DEDUP_CAP = 256/);
    expect(bridge).toMatch(/local DEDUP = {}/);
    expect(bridge).toMatch(/local DEDUP_ORDER = {}/);
    expect(bridge).toMatch(/function dedup_get\(key\)/);
    expect(bridge).toMatch(/function dedup_put\(key, inner\)/);
    expect(bridge).toMatch(/function dedup_eligible\(cmd\)/);
    expect(bridge).not.toMatch(/cmd\.name ~= "render_region"/);
    expect(bridge).toMatch(/dedup_inner_is_internal_error/);
    expect(bridge).toMatch(/dedup replay key=/);

    const processIndex = bridge.indexOf("local function process_one()");
    const decodeIndex = bridge.indexOf("local cmd = cmd_or_err", processIndex);
    const getIndex = bridge.indexOf("dedup_get(cmd.idempotency_key)", decodeIndex);
    const dispatchIndex = bridge.indexOf("result = dispatch(cmd)", decodeIndex);
    const putIndex = bridge.indexOf("dedup_put(cmd.idempotency_key, inner)", dispatchIndex);
    expect(decodeIndex).toBeGreaterThan(processIndex);
    expect(getIndex).toBeGreaterThan(decodeIndex);
    expect(getIndex).toBeLessThan(dispatchIndex);
    expect(putIndex).toBeGreaterThan(dispatchIndex);

    const pingBody = bridge.slice(
      bridge.indexOf("function DISPATCH.ping"),
      bridge.indexOf("-- Scopes recognized by get_state"),
    );
    expect(pingBody).not.toMatch(/DEDUP|dedup_/);

    const getStateBody = bridge.slice(
      bridge.indexOf("function DISPATCH.get_state"),
      bridge.indexOf("local function template_error_envelope"),
    );
    expect(getStateBody).not.toMatch(/DEDUP|dedup_/);

    const deferredBody = bridge.slice(
      bridge.indexOf("local function tick_deferred()"),
      bridge.indexOf("function DISPATCH.template"),
    );
    expect(deferredBody).toMatch(/idempotency_key/);
    expect(deferredBody).toMatch(/dedup_inner_is_internal_error\(inner\)/);
    expect(deferredBody).toMatch(/dedup_put\(d\.idempotency_key, inner\)/);
  });

  it("wires Slice 06 field verification after count checks and before LAST_RESULT finalize", async () => {
    const [bridge, verify] = await Promise.all([
      readRepoFile("reaper/streetlight_bridge.lua"),
      readRepoFile("reaper/packs/core/verify.lua"),
    ]);

    expect(verify).toMatch(/function M\.check_fields\(expected, changed_ids, params, entity_kind, ctx\)/);
    expect(verify).toMatch(/FIELD_READERS\s*=\s*{/);
    expect(verify).toMatch(/item\s*=\s*{ entity_kind = "item"/);
    expect(verify).toMatch(/take\s*=\s*{ entity_kind = "item"/);
    expect(verify).toMatch(/track\s*=\s*{ entity_kind = "track"/);
    expect(verify).toMatch(/GetMediaItemInfo_Value/);
    expect(verify).toMatch(/GetMediaItemTakeInfo_Value/);
    expect(verify).toMatch(/GetSetMediaTrackInfo_String/);
    expect(verify).toMatch(/I_CUSTOMCOLOR_HEX/);
    expect(verify).toMatch(/GetMediaTrackInfo_Value\(handle, "I_CUSTOMCOLOR"\)/);
    expect(verify).toMatch(/ColorFromNative\(native & 0xFFFFFF\)/);
    expect(verify).toMatch(/#%02X%02X%02X/);
    expect(verify).toMatch(/field\.param_path or field\.paramPath/);
    expect(verify).toMatch(/raw_value == nil and field\.optional == true/);
    expect(verify).toMatch(/item_trim\.start_offset/);
    expect(verify).toMatch(/raw_value == ctx\.json\.null/);
    expect(verify).toMatch(/field\.nullable == true/);
    expect(verify).toMatch(/expected_value = 0/);

    const checkIndex = bridge.indexOf("verify.check(expected_delta");
    const fieldsIndex = bridge.indexOf("verify.check_fields(");
    const finalizeIndex = bridge.indexOf("return finalize_template(name, entry.entity_kind, raw_changed, entry)");
    expect(checkIndex).toBeGreaterThan(0);
    expect(fieldsIndex).toBeGreaterThan(checkIndex);
    expect(finalizeIndex).toBeGreaterThan(fieldsIndex);
    expect(bridge).toMatch(/verify\.check_fields\([^)]*ctx/s);
    expect(bridge).toMatch(/fields = json\.array\(field_details or {}\)/);
  });

  it("keeps Slice 19 track color using I_CUSTOMCOLOR with the enabled-color bit", async () => {
    const [track, manifest] = await Promise.all([
      readRepoFile("reaper/packs/core/templates/track.lua"),
      readRepoFile("reaper/packs/core/manifest.lua"),
    ]);

    expect(track).toMatch(/function M\.track_color\(params, ctx\)/);
    expect(track).toMatch(/ctx\.refs\.resolve_track\(params\.track_id, ctx\.last_result\)/);
    expect(track).toMatch(/params\.color ~= ctx\.json\.null/);
    expect(track).toMatch(/\^#\(\[0-9A-F\]\[0-9A-F\]\)/);
    expect(track).toMatch(/reaper\.ColorToNative\(r, g, b\) \| 0x1000000/);
    expect(track).toMatch(/SetMediaTrackInfo_Value\(track, "I_CUSTOMCOLOR", applied\)/);
    expect(track).toMatch(/TrackList_AdjustWindows\(false\)/);
    expect(track).toMatch(/get_track_guid_ref\(track, errs\)/);

    expect(manifest).toMatch(/track_color\s*=\s*{/);
    expect(manifest).toMatch(/handler\s*=\s*track_templates\.track_color/);
    expect(manifest).toMatch(/undo_flags\s*=\s*undo\.UNDO_STATE_TRACKCFG/);
    expect(manifest).toMatch(/entity_kind\s*=\s*"track"/);
  });

  it("keeps Slice 12/13 region field verification scope without touching refs.lua", async () => {
    const verify = await readRepoFile("reaper/packs/core/verify.lua");

    expect(verify).toMatch(/local function parse_region_ref\(ref\)/);
    expect(verify).toMatch(/\^region:\(\.\+\)\$/);
    expect(verify).toMatch(/local function find_region_by_name\(name\)/);
    expect(verify).toMatch(/EnumProjectMarkers3/);
    expect(verify).toMatch(/local function read_region_field\(handle, field\)/);
    expect(verify).toMatch(/if field == "name" then return true, handle\.name end/);
    expect(verify).toMatch(/if field == "pos" then return true, handle\.pos end/);
    expect(verify).toMatch(/if field == "rgnend" then return true, handle\.rgnend end/);
    expect(verify).toMatch(/region\s*=\s*{ entity_kind = "region"/);
    expect(verify).toMatch(/parse = parse_region_ref/);
    expect(verify).not.toMatch(/dofile\([^)]*refs\.lua/);
    expect(verify).not.toMatch(/resolve_item/);
    expect(verify).not.toMatch(/computed/i);
  });

  it("keeps Slice 11 and Slice 12 field verification on the first changed id only", async () => {
    const verify = await readRepoFile("reaper/packs/core/verify.lua");

    expect(verify).toMatch(/reader\.parse\(changed_ids\[1\]\)/);
    expect(verify).not.toMatch(/for\s+[^,\n]+,\s*[^,\n]+\s+in\s+ipairs\(changed_ids\)/);
    expect(verify).not.toMatch(/for\s+[^,\n]+\s+in\s+ipairs\(changed_ids\)/);
    expect(verify).not.toMatch(/for\s+[^=\n]+=\s*1,\s*#changed_ids/);
    expect(verify).not.toMatch(/per_item/i);
  });

  it("loads generated Lua error codes and passes them through the handler context", async () => {
    const [bridge, refs] = await Promise.all([
      readRepoFile("reaper/streetlight_bridge.lua"),
      readRepoFile("reaper/packs/core/refs.lua"),
    ]);

    expect(bridge).toMatch(/packs\/core\/error_codes\.lua/);
    expect(bridge).toMatch(/EXPECTED_ERROR_CODE_COUNT\s*=\s*24/);
    expect(bridge).toMatch(/validate_error_codes\(ERRS\)/);
    expect(bridge).toMatch(/refs\.attach_errs\(ERRS\)/);
    expect(bridge).toMatch(/log\("loaded error_codes \("/);
    expect(bridge).toMatch(/errs\s*=\s*ERRS/);

    expect(refs).toMatch(/local ERRS = nil/);
    expect(refs).toMatch(/function M\.attach_errs\(errs\)/);
    expect(refs).toMatch(/ERRS\.REF_INVALID/);
  });

  it("wires Slice 21 artifact storage without using raw changed_ids paths", async () => {
    const [bridge, artifacts, fixtureArtifact, fixtureManifest, coreManifest] = await Promise.all([
      readRepoFile("reaper/streetlight_bridge.lua"),
      readRepoFile("reaper/packs/core/lib/artifacts.lua"),
      readRepoFile("reaper/packs/pack_contract_fixture/templates/artifact.lua"),
      readRepoFile("reaper/packs/pack_contract_fixture/manifest.lua"),
      readRepoFile("reaper/packs/core/manifest.lua"),
    ]);

    expect(bridge).toMatch(/artifact_lib = dofile/);
    expect(bridge).toMatch(/artifact\s*=\s*true/);
    expect(bridge).toMatch(/scope == "artifact"/);
    expect(bridge).toMatch(/params\.artifact_ref ~= nil/);
    expect(bridge).toMatch(/artifact_ref is only valid with scope='artifact'/);
    expect(bridge).toMatch(/view is only valid with scope='artifact'/);
    expect(bridge).toMatch(/ARTIFACTS:read\(params\.artifact_ref, params\.view or "summary"\)/);
    expect(bridge).toMatch(/ARTIFACTS:sweep_old\(\)/);
    expect(bridge).toMatch(/artifacts\s*=\s*ARTIFACTS/);
    expect(bridge).toMatch(/command_id\s*=\s*cmd\.id/);
    expect(bridge).toMatch(/should_update_last_result\(entry\)/);
    expect(bridge).toMatch(/artifact\.kind == "json"/);
    expect(bridge).toMatch(/artifact\.updates_last_result == false/);

    expect(artifacts).toMatch(/state_root \.\. "\/artifacts\/v1"/);
    expect(artifacts).toMatch(/function M\.parse_ref\(ref\)/);
    expect(artifacts).toMatch(/function ArtifactStore:write_json\(opts\)/);
    expect(artifacts).toMatch(/write_file_atomic\(path, encoded_or_err\)/);
    expect(artifacts).toMatch(/function ArtifactStore:read\(ref, view\)/);
    expect(artifacts).toMatch(/function ArtifactStore:sweep_old\(\)/);
    expect(artifacts).toMatch(/type\(value\.payload\) == "table"/);
    expect(artifacts).toMatch(/out\.payload = artifact\.payload/);
    expect(artifacts).toMatch(/function file_mtime_seconds\(path\)/);
    expect(artifacts).toMatch(/mtime < cutoff/);
    expect(artifacts).toMatch(/errs\.ARTIFACT_NOT_FOUND/);
    expect(artifacts).toMatch(/errs\.ARTIFACT_INVALID/);
    expect(artifacts).toMatch(/errs\.RESPONSE_TOO_LARGE/);

    expect(fixtureArtifact).toMatch(/function M\.fixture_artifact_probe\(params, ctx\)/);
    expect(fixtureArtifact).toMatch(/ctx\.artifacts:write_json/);
    expect(fixtureArtifact).toMatch(/owner_pack = "pack_contract_fixture"/);
    expect(fixtureArtifact).toMatch(/scope = "probe"/);
    expect(fixtureArtifact).toMatch(/schema = "openreaper\.fixture\.probe\.v1"/);
    expect(fixtureArtifact).not.toMatch(/InsertTrack|SetMedia|Main_OnCommand/);

    expect(coreManifest).toMatch(/artifact\s*=\s*"artifacts"/);
    expect(coreManifest).toMatch(/render_region[\s\S]*kind = "external_file"/);
    expect(fixtureManifest).toMatch(/fixture_artifact_probe\s*=\s*{/);
    expect(fixtureManifest).toMatch(/entity_kind = "artifact"/);
    expect(fixtureManifest).toMatch(/updates_last_result = false/);
  });

  it("keeps Lua runtime code paths free of string-literal error codes", async () => {
    const files = [
      "reaper/streetlight_bridge.lua",
      "reaper/packs/core/refs.lua",
      "reaper/packs/core/templates/item.lua",
      "reaper/packs/core/templates/track.lua",
      "reaper/packs/core/templates/region.lua",
      "reaper/packs/core/templates/media.lua",
      "reaper/packs/core/templates/render.lua",
      "reaper/packs/core/lib/artifacts.lua",
    ];
    const [errorsTs, ...texts] = await Promise.all([
      readRepoFile("packages/core/src/errors.ts"),
      ...files.map((file) => readRepoFile(file)),
    ]);
    const codes = parseErrorCodesTs(errorsTs);
    const usage = diffLuaErrorCodeLiteralUsage(
      files.map((file, index) => ({ path: file, text: texts[index] })),
      codes,
    );

    expect(usage).toEqual([]);
  });
});
