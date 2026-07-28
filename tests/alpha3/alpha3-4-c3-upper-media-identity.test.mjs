import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
  executeAlpha3_3MediaPlaceAssetsMacro,
} from "../../packages/mcp-server/src/alpha3-2e-media-place-assets-v1.mjs";
import {
  projectMediaExplorerSearchPage,
  searchMediaExplorerDatabases,
} from "../../packages/mcp-server/src/media-explorer-database-search-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
import { OPENREAPER_PUBLIC_TOOL_IDS } from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const TRACK_A = "track:guid:{MEDIA-TRACK-A}";
const TAKE_A = "take:guid:{MEDIA-TAKE-A}";
const FILE_REF_PREFIX = "file:path:";
const LONG_SEGMENT = "path segment with spaces and 中文音频素材_abcdefghijklmnopqrstuvwxyz_0123456789_padding_segment_for_identity_roundtrip_extra_bytes";
const LONG_PATH = [
  "/Users/Shared/OpenReaper",
  "library session 演示资料",
  "nested folder 层级",
  "deep",
  "more nested 路径段",
  LONG_SEGMENT,
  LONG_SEGMENT,
  "clip 源文件 final.wav",
].join("/");
const WIN_PATH = "C:\\Users\\Shared\\OpenReaper\\session 演示\\clip.wav";
const UNC_PATH = "\\\\server\\share\\session 演示\\clip.wav";
const RELATIVE_PATH = "relative/session 演示/clip.wav";
const TAB_PATH = "/Users/Shared/OpenReaper/session\t演示/clip.wav";
const NEWLINE_PATH = "/Users/Shared/OpenReaper/session\n演示/clip.wav";
const NUL_PATH = "/Users/Shared/OpenReaper/session\0演示/clip.wav";
const POSIX_BACKSLASH_PATH = "/library/clip\\variant.wav";
const HUGE_SEARCH_PATH = `/${"深".repeat(900)}/clip response oversized.wav`;
const OVER_4096_SEARCH_PATH = `/library/${"深".repeat(1_400)}/clip identity beyond mutation ceiling.wav`;
const REGISTRY = JSON.parse(
  readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url), "utf8"),
);

describe("Alpha3.4-C3B upper media canonical identity and budget", () => {
  it("keeps public counts at 6 tools / 15 macros / 239 templates / 91 handlers", () => {
    assert.equal(OPENREAPER_PUBLIC_TOOL_IDS.length, 6);
    assert.equal(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length, 15);
    assert.equal(new Set(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS).size, 15);
    assert.equal(REGISTRY.entries.length, 239);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.equal(registry.entries.length, 239);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.ok(Buffer.byteLength(LONG_PATH, "utf8") > 240);
  });

  it("accepts POSIX, Windows drive, UNC, tab, and newline identities and rejects relative/NUL paths without dispatch", async () => {
    for (const pathValue of [LONG_PATH, WIN_PATH, UNC_PATH, TAB_PATH, NEWLINE_PATH]) {
      const fixture = mediaFixture({ files: { [pathValue]: 1.5 }, tracks: { [TRACK_A]: [] } });
      const response = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: request({
          assets: [{ id: "one", path: pathValue, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: true,
        }),
        executeAtomic: fixture.execute,
      });
      assert.equal(response.ok, true, `${pathValue}: ${JSON.stringify(response)}`);
      assert.equal(response.result.data.selected_sources[0].path, pathValue);
      assert.equal(response.result.data.selected_sources[0].source_file_ref, `${FILE_REF_PREFIX}${pathValue}`);
      assert.equal(fixture.calls[0].id, "template.media.probe_file");
      assert.equal(fixture.calls[0].input.path, pathValue);
    }

    for (const pathValue of [RELATIVE_PATH, NUL_PATH]) {
      let calls = 0;
      const rejected = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: request({
          assets: [{ id: "rejected", path: pathValue, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        executeAtomic: async () => { calls += 1; },
      });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error.code, "MEDIA_SOURCE_PATH_UNSAFE");
      assert.equal(calls, 0);
    }
  });

  it("preserves a >240-byte multi-segment UTF-8 absolute path through probe, mutation refs, native readback, and public result", async () => {
    const fixture = mediaFixture({ files: { [LONG_PATH]: 2 }, tracks: { [TRACK_A]: [] } });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "long", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 1 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assert.equal(response.result.data.selected_sources[0].path, LONG_PATH);
    assert.equal(response.result.data.selected_sources[0].source_file_ref, `${FILE_REF_PREFIX}${LONG_PATH}`);
    assert.equal(response.result.changes[0].source_file_ref, `${FILE_REF_PREFIX}${LONG_PATH}`);
    assert.equal(response.result.changes[0].live_readback.source_file_ref, `${FILE_REF_PREFIX}${LONG_PATH}`);
    assert.equal(JSON.stringify(response).includes("..."), false);
    const probe = fixture.calls.find((call) => call.id === "template.media.probe_file");
    const importCall = fixture.calls.find((call) => call.id === "template.media.import_file_to_track");
    assert.equal(probe.input.path, LONG_PATH);
    assert.equal(importCall.refs.source_file_ref.ref, `${FILE_REF_PREFIX}${LONG_PATH}`);
    assert.equal(importCall.refs.source_file_ref.identity.value, LONG_PATH);
    assert.equal(importCall.refs.source_file_ref.identity.scheme, "path");
  });

  it("rejects contradictory probe file_ref or object identity before import or relink", async () => {
    const contradictoryRef = mediaFixture(
      { files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } },
      { probeFileRef: `${FILE_REF_PREFIX}${LONG_PATH.slice(0, 80)}` },
    );
    const refResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "bad-ref", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      }),
      executeAtomic: contradictoryRef.execute,
    });
    assert.equal(refResponse.ok, false);
    assert.equal(refResponse.error.code, "MEDIA_SOURCE_IDENTITY_MISMATCH");
    assert.equal(contradictoryRef.calls.some((call) => call.id.startsWith("template.media.import_")), false);

    const contradictoryIdentity = mediaFixture(
      { files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } },
      { probeIdentityValue: LONG_PATH.slice(0, 40) },
    );
    const identityResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "bad-identity", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      }),
      executeAtomic: contradictoryIdentity.execute,
    });
    assert.equal(identityResponse.ok, false);
    assert.equal(identityResponse.error.code, "MEDIA_SOURCE_IDENTITY_MISMATCH");
    assert.equal(contradictoryIdentity.calls.some((call) => call.id.startsWith("template.media.import_")), false);

    const relink = mediaFixture(
      { files: { [LONG_PATH]: 2 }, takes: { [TAKE_A]: "file:path:/old.wav" } },
      { probeIdentityValue: LONG_PATH.slice(0, 60) },
    );
    const relinkResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        mode: "relink_sources",
        assets: [{ id: "replacement", path: LONG_PATH, take_ref: TAKE_A }],
        dry_run: false,
      }),
      executeAtomic: relink.execute,
    });
    assert.equal(relinkResponse.ok, false);
    assert.equal(relinkResponse.error.code, "MEDIA_SOURCE_IDENTITY_MISMATCH");
    assert.equal(relink.calls.some((call) => call.id === "template.media.relink_take_source"), false);

    const missingObject = mediaFixture(
      { files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } },
      { omitProbeFileObject: true },
    );
    const missingObjectResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "missing-object", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      }),
      executeAtomic: missingObject.execute,
    });
    assert.equal(missingObjectResponse.ok, false);
    assert.equal(missingObjectResponse.error.code, "MEDIA_SOURCE_IDENTITY_MISMATCH");
    assert.equal(missingObject.calls.some((call) => call.id.startsWith("template.media.import_")), false);
  });

  it("proves max_response_bytes and max_inline_value_bytes before the first mutation with exact-fit success and one-byte shortfall", async () => {
    const shortFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const blocked = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          assets: [{ id: "long", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        budget: { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: shortFixture.execute,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "MEDIA_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(shortFixture.calls.some((call) => call.id.startsWith("template.media.import_")), false);
    const projectedRequiredBytes = blocked.result.data.required_bytes;
    assert.ok(Number.isInteger(projectedRequiredBytes) && projectedRequiredBytes > 2_048);
    assert.equal(blocked.result.data.available_bytes, 2_048);

    const exactFitFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const exactFit = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          assets: [{ id: "long", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        budget: { max_response_bytes: projectedRequiredBytes, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: exactFitFixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(exactFit.ok, true, JSON.stringify(exactFit));
    assert.equal(exactFitFixture.calls.some((call) => call.id === "template.media.import_file_to_track"), true);
    assert.equal(exactFit.budget.max_bytes, projectedRequiredBytes);
    assert.ok(
      exactFit.budget.actual_bytes <= projectedRequiredBytes,
      "pre-mutation projection is a conservative upper bound; live success may be smaller",
    );

    const shortAgain = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const oneByteShort = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          assets: [{ id: "long", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        budget: { max_response_bytes: projectedRequiredBytes - 1, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: shortAgain.execute,
    });
    assert.equal(oneByteShort.ok, false);
    assert.equal(oneByteShort.error.code, "MEDIA_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(oneByteShort.result.data.required_bytes, projectedRequiredBytes);
    assert.equal(oneByteShort.result.data.available_bytes, projectedRequiredBytes - 1);
    assert.equal(shortAgain.calls.some((call) => call.id.startsWith("template.media.import_")), false);

    const refBytes = Buffer.byteLength(`${FILE_REF_PREFIX}${LONG_PATH}`, "utf8");
    const inlineFitFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const inlineFit = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          assets: [{ id: "long", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: refBytes },
      },
      executeAtomic: inlineFitFixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(inlineFit.ok, true, JSON.stringify(inlineFit));

    const inlineShortFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const inlineShort = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          assets: [{ id: "long", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: true,
        }),
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: refBytes - 1 },
      },
      executeAtomic: inlineShortFixture.execute,
    });
    assert.equal(inlineShort.ok, false);
    assert.equal(inlineShort.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(inlineShort.result.data.blocker, "exact_file_ref_exceeds_inline_budget");
    assert.equal(inlineShort.result.data.file_ref_bytes, refBytes);
    assert.equal(inlineShort.result.data.max_inline_value_bytes, refBytes - 1);
    assert.equal(inlineShort.request.dry_run, true);
    assert.equal(inlineShortFixture.calls.length, 0);

    const relinkInlineShortFixture = mediaFixture({
      files: { [LONG_PATH]: 1 },
      takes: { [TAKE_A]: `${FILE_REF_PREFIX}/old.wav` },
    });
    const relinkInlineShort = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          mode: "relink_sources",
          assets: [{ id: "replacement", path: LONG_PATH, take_ref: TAKE_A }],
          dry_run: false,
        }),
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: refBytes - 1 },
      },
      executeAtomic: relinkInlineShortFixture.execute,
    });
    assert.equal(relinkInlineShort.ok, false);
    assert.equal(relinkInlineShort.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(relinkInlineShortFixture.calls.length, 0);
  });

  it("bounds post-mutation SQLite and index failure evidence inside the preflight response proof", async () => {
    const input = {
      assets: [{ id: "bounded-index", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
      placement: { mode: "explicit" },
      track_policy: "explicit_per_asset",
      dry_run: false,
    };
    const preflightFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const preflight = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request(input),
        budget: { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: preflightFixture.execute,
    });
    assert.equal(preflight.ok, false);
    assert.equal(preflight.error.code, "MEDIA_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(preflightFixture.calls.some((call) => call.id.startsWith("template.media.import_")), false);
    const requiredBytes = preflight.result.data.required_bytes;

    const longNativeText = "索引证据".repeat(5_000);
    const successFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const success = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request(input),
        budget: { max_response_bytes: requiredBytes, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: successFixture.execute,
      projectIndexRuntime: {
        status: () => ({ snapshot_id: longNativeText, revision: longNativeText }),
        invalidateScopes: () => ({ ok: true }),
      },
    });
    assert.equal(success.ok, true, JSON.stringify(success));
    assert.equal(successFixture.calls.filter((call) => call.id === "template.media.import_file_to_track").length, 1);
    assert.ok(Buffer.byteLength(success.sqlite.snapshot_ref, "utf8") <= 160);
    assert.ok(Buffer.byteLength(success.sqlite.revision, "utf8") <= 160);
    assert.ok(success.budget.actual_bytes <= requiredBytes);
    assert.deepEqual(validateMacroExecutionEnvelope(success), { valid: true, errors: [] });

    const failureFixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    const failure = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request(input),
        budget: { max_response_bytes: requiredBytes, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: failureFixture.execute,
      projectIndexRuntime: {
        status: () => ({ snapshot_id: longNativeText, revision: longNativeText }),
        invalidateScopes: () => { throw new Error(longNativeText); },
      },
    });
    assert.equal(failure.ok, false, JSON.stringify(failure));
    assert.equal(failure.execution.status, "partial_failure");
    assert.equal(failure.error.code, "MEDIA_INDEX_MAINTENANCE_FAILED");
    assert.equal(failureFixture.calls.filter((call) => call.id === "template.media.import_file_to_track").length, 1);
    assert.ok(Buffer.byteLength(failure.error.message, "utf8") <= 512);
    assert.ok(Buffer.byteLength(failure.sqlite.snapshot_ref, "utf8") <= 160);
    assert.ok(Buffer.byteLength(failure.sqlite.revision, "utf8") <= 160);
    assert.ok(failure.budget.actual_bytes <= requiredBytes);
    assert.deepEqual(validateMacroExecutionEnvelope(failure), { valid: true, errors: [] });
  });

  it("bounds preflight and mutation child failures without losing typed codes or zero-write truth", async () => {
    const longNativeText = "外部执行失败".repeat(4_000);
    let preflightMutations = 0;
    const preflight = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "preflight", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      }),
      executeAtomic: async (call) => {
        if (call.id.startsWith("template.media.import_")) preflightMutations += 1;
        throw new Error(longNativeText);
      },
    });
    assert.equal(preflight.ok, false, JSON.stringify(preflight));
    assert.equal(preflight.error.code, "MEDIA_READ_DISPATCH_THROWN");
    assert.equal(preflightMutations, 0);
    assert.ok(Buffer.byteLength(preflight.error.message, "utf8") <= 512);
    assert.ok(preflight.budget.actual_bytes <= preflight.budget.max_bytes);
    assert.deepEqual(validateMacroExecutionEnvelope(preflight), { valid: true, errors: [] });

    const fixture = mediaFixture({ files: { [LONG_PATH]: 1 }, tracks: { [TRACK_A]: [] } });
    let mutationCalls = 0;
    const mutation = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "mutation", path: LONG_PATH, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      }),
      executeAtomic: async (call) => {
        if (call.id === "template.media.import_file_to_track") {
          mutationCalls += 1;
          return {
            ok: false,
            request: { id: call.id },
            template: { id: call.id },
            error: {
              code: "MEDIA_IMPORT_NATIVE_FAILED",
              message: longNativeText,
              recoverable: true,
              details: { blockers: [{ code: "MEDIA_IMPORT_NATIVE_FAILED", message: longNativeText, recoverable: false }] },
            },
          };
        }
        return fixture.execute(call);
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(mutation.ok, false, JSON.stringify(mutation));
    assert.equal(mutation.execution.status, "partial_failure");
    assert.equal(mutation.error.code, "MEDIA_IMPORT_NATIVE_FAILED");
    assert.equal(mutation.result.changes[0].mutation.blocker_code, "MEDIA_IMPORT_NATIVE_FAILED");
    assert.equal(mutationCalls, 1);
    assert.equal(fixture.calls.filter((call) => call.id === "template.media.import_file_to_track").length, 0);
    assert.ok(Buffer.byteLength(mutation.error.message, "utf8") <= 512);
    assert.ok(mutation.budget.actual_bytes <= mutation.budget.max_bytes);
    assert.deepEqual(validateMacroExecutionEnvelope(mutation), { valid: true, errors: [] });
  });

  it("bounds an untrusted oversized native identity mismatch after mutation", async () => {
    const sourcePath = "/short.wav";
    const observedFileRef = `${FILE_REF_PREFIX}/${"深".repeat(1_360)}`;
    assert.ok(Buffer.byteLength(observedFileRef, "utf8") < 4_096);
    const fixture = mediaFixture(
      { files: { [sourcePath]: 1 }, tracks: { [TRACK_A]: [] } },
      { readbackFileRef: observedFileRef },
    );
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          assets: [{ id: "mismatch", path: sourcePath, track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        budget: { max_response_bytes: 7_000, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "MEDIA_LIVE_READBACK_MISMATCH");
    assert.equal(fixture.calls.filter((call) => call.id === "template.media.import_file_to_track").length, 1);
    assert.deepEqual(response.result.changes[0].live_readback, {
      status: "failed",
      source: "independent_item_and_take_source_readback",
      blocker_code: "MEDIA_LIVE_READBACK_MISMATCH",
    });
    assert.equal(JSON.stringify(response).includes(observedFileRef), false);
    assert.ok(response.budget.actual_bytes <= response.budget.max_bytes);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });

    const relinkFixture = mediaFixture(
      { files: { [sourcePath]: 1 }, takes: { [TAKE_A]: `${FILE_REF_PREFIX}/old.wav` } },
      { readbackFileRef: observedFileRef },
    );
    const relink = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({
          mode: "relink_sources",
          assets: [{ id: "relink-mismatch", path: sourcePath, take_ref: TAKE_A }],
          dry_run: false,
        }),
        budget: { max_response_bytes: 7_000, max_items: 50, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: relinkFixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(relink.ok, false, JSON.stringify(relink));
    assert.equal(relink.execution.status, "partial_failure");
    assert.equal(relink.error.code, "MEDIA_LIVE_READBACK_MISMATCH");
    assert.equal(relinkFixture.calls.filter((call) => call.id === "template.media.relink_take_source").length, 1);
    assert.deepEqual(relink.result.changes[0].live_readback, {
      status: "failed",
      source: "independent_take_source_readback",
      blocker_code: "MEDIA_LIVE_READBACK_MISMATCH",
    });
    assert.equal(JSON.stringify(relink).includes(observedFileRef), false);
    assert.ok(relink.budget.actual_bytes <= relink.budget.max_bytes);
    assert.deepEqual(validateMacroExecutionEnvelope(relink), { valid: true, errors: [] });
  });

  it("bounds Media Explorer resource-read failures while preserving the original typed code", async () => {
    const longNativeText = "资源路径读取失败".repeat(4_000);
    let calls = 0;
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: {
        ...request({ mode: "search_library", query: "clip", page_size: 10, dry_run: false }),
        budget: { max_response_bytes: 2_048, max_items: 25, max_inline_value_bytes: 4_096 },
      },
      executeAtomic: async (call) => {
        calls += 1;
        return {
          ok: false,
          request: { id: call.id },
          template: { id: call.id },
          error: {
            code: "RESOURCE_READ_FAILED",
            message: longNativeText,
            recoverable: true,
            details: { blockers: [{ code: "RESOURCE_READ_FAILED", message: longNativeText, recoverable: true }] },
          },
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.request.dry_run, true);
    assert.equal(response.error.code, "RESOURCE_READ_FAILED");
    assert.ok(Buffer.byteLength(response.error.message, "utf8") <= 512);
    assert.ok(response.budget.actual_bytes <= response.budget.max_bytes);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("Media Explorer search preserves full canonical identity and fails closed on a single oversized row", async () => {
    const fixture = await longLibraryFixture();
    try {
      const search = await searchMediaExplorerDatabases({
        resourcePath: fixture.root,
        query: "clip",
        pageSize: 10,
      });
      assert.equal(search.ok, true, JSON.stringify(search));
      assert.equal(search.total, 1);
      assert.equal(search.results[0].path, LONG_PATH);
      assert.equal(search.results[0].file_ref, `${FILE_REF_PREFIX}${LONG_PATH}`);
      assert.equal(search.results[0].filename.includes("..."), false);

      const page = projectMediaExplorerSearchPage(search, 1);
      assert.equal(page.results[0].file_ref, `${FILE_REF_PREFIX}${LONG_PATH}`);
      assert.equal(page.page.total, 1);
      assert.equal(page.page.returned, 1);

      const refBytes = Buffer.byteLength(`${FILE_REF_PREFIX}${LONG_PATH}`, "utf8");
      const response = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 10 }),
          budget: { max_response_bytes: 65_536, max_items: 25, max_inline_value_bytes: refBytes - 1 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "RESPONSE_TOO_LARGE");
      assert.equal(response.result.data.page.total, 1);
      assert.equal(response.result.data.page.returned, 0);
      assert.equal(response.result.data.results.length, 0);
      assert.equal(response.result.data.blocker, "exact_file_ref_exceeds_inline_budget");
      assert.equal(response.result.data.file_ref_bytes, refBytes);
      assert.equal(response.result.data.max_inline_value_bytes, refBytes - 1);
      assert.equal(response.result.data.page.next_cursor, null);
      assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("derives POSIX, Windows, and UNC basenames without treating legal POSIX backslashes as separators", async () => {
    const fixture = await libraryFixture([POSIX_BACKSLASH_PATH, WIN_PATH, UNC_PATH]);
    try {
      const search = await searchMediaExplorerDatabases({ resourcePath: fixture.root, query: "clip", pageSize: 10 });
      assert.equal(search.ok, true, JSON.stringify(search));
      const rows = new Map(search.results.map((row) => [row.path, row]));
      assert.equal(rows.get(POSIX_BACKSLASH_PATH).filename, "clip\\variant.wav");
      assert.equal(rows.get(WIN_PATH).filename, "clip.wav");
      assert.equal(rows.get(UNC_PATH).filename, "clip.wav");
      for (const pathValue of [POSIX_BACKSLASH_PATH, WIN_PATH, UNC_PATH]) {
        assert.equal(rows.get(pathValue).file_ref, `${FILE_REF_PREFIX}${pathValue}`);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not silently filter read-only search identities beyond the 4096-byte mutation ceiling", async () => {
    assert.ok(Buffer.byteLength(OVER_4096_SEARCH_PATH, "utf8") > 4_096);
    const fixture = await libraryFixture([OVER_4096_SEARCH_PATH]);
    try {
      const search = await searchMediaExplorerDatabases({ resourcePath: fixture.root, query: "clip", pageSize: 10 });
      assert.equal(search.ok, true, JSON.stringify(search));
      assert.equal(search.total, 1);
      assert.equal(search.results[0].path, OVER_4096_SEARCH_PATH);
      assert.equal(search.results[0].file_ref, `${FILE_REF_PREFIX}${OVER_4096_SEARCH_PATH}`);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails RESPONSE_TOO_LARGE for one complete search row that cannot fit the response envelope", async () => {
    assert.ok(Buffer.byteLength(HUGE_SEARCH_PATH, "utf8") < 4_096);
    const fixture = await libraryFixture([HUGE_SEARCH_PATH]);
    try {
      const response = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 10 }),
          budget: { max_response_bytes: 2_048, max_items: 25, max_inline_value_bytes: 24_576 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "RESPONSE_TOO_LARGE");
      assert.equal(response.result.data.blocker, "single_identity_row_exceeds_budget");
      assert.equal(response.result.data.page.returned, 0);
      assert.equal(response.result.data.page.total, 1);
      assert.equal(response.result.data.page.has_more, true);
      assert.equal(response.result.data.page.next_cursor, null);
      assert.ok(response.result.data.required_response_bytes > 2_048);
      assert.equal(response.request.dry_run, true);
      assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });

      const required = response.result.data.required_response_bytes;
      const exactFit = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 10, dry_run: false }),
          budget: { max_response_bytes: required, max_items: 25, max_inline_value_bytes: 24_576 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(exactFit.ok, true, JSON.stringify(exactFit));
      assert.equal(exactFit.execution.status, "dry_run_completed");
      assert.equal(exactFit.request.dry_run, true);
      assert.equal(exactFit.budget.max_bytes, required);
      assert.equal(exactFit.budget.actual_bytes, required);
      assert.equal(exactFit.result.data.page.returned, 1);
      assert.equal(exactFit.result.data.results[0].path, HUGE_SEARCH_PATH);

      const oneByteShort = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 10, dry_run: false }),
          budget: { max_response_bytes: required - 1, max_items: 25, max_inline_value_bytes: 24_576 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(oneByteShort.ok, false, JSON.stringify(oneByteShort));
      assert.equal(oneByteShort.error.code, "RESPONSE_TOO_LARGE");
      assert.equal(oneByteShort.result.data.blocker, "single_identity_row_exceeds_budget");
      assert.equal(oneByteShort.result.data.required_response_bytes, required);
      assert.equal(oneByteShort.request.dry_run, true);
      assert.equal(oneByteShort.result.data.page.returned, 0);
      assert.equal(oneByteShort.result.data.page.next_cursor, null);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("forces search_library request.dry_run=true on success and failure even when the caller passes dry_run:false", async () => {
    const fixture = await libraryFixture([`/library/clip-dry-run.wav`]);
    try {
      const success = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 10, dry_run: false }),
          budget: { max_response_bytes: 65_536, max_items: 25, max_inline_value_bytes: 4_096 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(success.ok, true, JSON.stringify(success));
      assert.equal(success.execution.status, "dry_run_completed");
      assert.equal(success.request.dry_run, true);

      const failure = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 10, dry_run: false }),
          budget: { max_response_bytes: 65_536, max_items: 25, max_inline_value_bytes: 4_096 },
        },
        executeAtomic: async () => ({
          ok: false,
          request: { id: "template.system.read_resource_paths" },
          template: { id: "template.system.read_resource_paths" },
          error: { code: "RESOURCE_PATH_UNAVAILABLE", message: "resource path unavailable", recoverable: true },
        }),
      });
      assert.equal(failure.ok, false, JSON.stringify(failure));
      assert.equal(failure.request.dry_run, true);
      assert.notEqual(failure.error?.code, "MEDIA_EXECUTION_FAILED");
      assert.deepEqual(validateMacroExecutionEnvelope(failure), { valid: true, errors: [] });

      const placeDryFalse = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: request({
          assets: [{ id: "one", path: "/library/clip-dry-run.wav", track_ref: TRACK_A, position_seconds: 0 }],
          placement: { mode: "explicit" },
          track_policy: "explicit_per_asset",
          dry_run: false,
        }),
        executeAtomic: mediaFixture({ files: { "/library/clip-dry-run.wav": 1 }, tracks: { [TRACK_A]: [] } }).execute,
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(placeDryFalse.ok, true, JSON.stringify(placeDryFalse));
      assert.equal(placeDryFalse.request.dry_run, false);
      assert.equal(placeDryFalse.execution.status, "completed");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("shrinks search pages to a stable fitting prefix and advances by exactly the returned row count", async () => {
    const paths = [1, 2, 3, 4].map((index) => `/library/${String(index).repeat(180)}/clip-${index}.wav`);
    const fixture = await libraryFixture(paths);
    try {
      const first = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 4 }),
          budget: { max_response_bytes: 2_048, max_items: 25, max_inline_value_bytes: 24_576 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.ok(first.result.data.page.returned >= 1);
      assert.ok(first.result.data.page.returned < paths.length);
      assert.equal(first.result.data.page.has_more, true);
      assert.equal(typeof first.result.data.page.next_cursor, "string");
      assert.deepEqual(first.result.data.results.map((row) => row.path), paths.slice(0, first.result.data.page.returned));

      const second = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 4, cursor: first.result.data.page.next_cursor }),
          budget: { max_response_bytes: 2_048, max_items: 25, max_inline_value_bytes: 24_576 },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.result.data.page.offset, first.result.data.page.returned);
      assert.equal(second.result.data.results[0].path, paths[first.result.data.page.returned]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not skip an inline-oversized first search row to return a later fitting row", async () => {
    const shortPath = "/library/clip-short.wav";
    const fixture = await libraryFixture([LONG_PATH, shortPath]);
    const inlineBytes = Buffer.byteLength(`${FILE_REF_PREFIX}${LONG_PATH}`, "utf8") - 1;
    try {
      const response = await executeAlpha3_3MediaPlaceAssetsMacro({
        request: {
          ...request({ mode: "search_library", query: "clip", page_size: 2 }),
          budget: { max_response_bytes: 65_536, max_items: 25, max_inline_value_bytes: inlineBytes },
        },
        executeAtomic: fixture.execute,
      });
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "RESPONSE_TOO_LARGE");
      assert.equal(response.result.data.blocker, "exact_file_ref_exceeds_inline_budget");
      assert.equal(response.result.data.page.offset, 0);
      assert.equal(response.result.data.page.returned, 0);
      assert.equal(response.result.data.page.total, 2);
      assert.equal(response.result.data.page.has_more, true);
      assert.equal(response.result.data.page.next_cursor, null);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("aligns the upper mutation path ceiling with the lower 4096 UTF-8 byte ceiling", async () => {
    const over = `/${"a".repeat(4_097)}.wav`;
    let calls = 0;
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "over", path: over, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
      }),
      executeAtomic: async () => { calls += 1; },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "MEDIA_SOURCE_PATH_UNSAFE");
    assert.equal(calls, 0);

    const maxOk = `/${"b".repeat(4_090)}.wav`;
    assert.equal(Buffer.byteLength(maxOk, "utf8") <= 4_096, true);
    const fixture = mediaFixture({ files: { [maxOk]: 1 }, tracks: { [TRACK_A]: [] } });
    const ok = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({
        assets: [{ id: "max", path: maxOk, track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: true,
      }),
      executeAtomic: fixture.execute,
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.data.selected_sources[0].path, maxOk);
  });
});

function request(input) {
  return {
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    input,
    context: {
      request_id: "media-c3b-test",
      session_id: "media-c3b-test",
      request_sequence: 1,
      created_at: "2026-07-14T00:00:00.000Z",
    },
  };
}

function mediaFixture(seed = {}, options = {}) {
  const files = { ...(seed.files ?? {}) };
  const tracks = structuredClone(seed.tracks ?? {});
  const takes = { ...(seed.takes ?? {}) };
  const items = [];
  const calls = [];
  let itemSerial = 0;
  return {
    files,
    tracks,
    takes,
    items,
    calls,
    execute: async (call) => {
      calls.push(structuredClone(call));
      if (call.id === "template.media.probe_file") {
        const length = files[call.input.path];
        if (!Number.isFinite(length)) return fail(call.id, "FILE_NOT_FOUND");
        const fileRef = options.probeFileRef ?? `${FILE_REF_PREFIX}${call.input.path}`;
        const identityValue = options.probeIdentityValue ?? call.input.path;
        return ok(call.id, {
          file_ref: fileRef,
          length_seconds: length,
          length_is_quarter_notes: false,
          decodable: true,
        }, options.omitProbeFileObject ? [] : [{
          kind: "file",
          ref: fileRef,
          identity: { scheme: "path", value: identityValue },
        }]);
      }
      if (call.id === "template.tracks.resolve_track_ref") {
        const ref = call.input.track_ref;
        if (!Object.hasOwn(tracks, ref)) return fail(call.id, "TRACK_NOT_FOUND");
        return ok(call.id, { track_ref: ref }, [objectRef("track", ref)]);
      }
      if (["template.media.import_file_to_track", "template.media.import_file_section_to_track"].includes(call.id)) {
        const trackRef = call.refs.track_ref.ref;
        const pathValue = call.refs.source_file_ref.identity.value;
        const fullLength = files[pathValue];
        const length = call.id.endsWith("section_to_track")
          ? fullLength * (call.input.end_percent - call.input.start_percent)
          : fullLength;
        const itemRef = `item:guid:{MEDIA-ITEM-${++itemSerial}}`;
        const takeRef = `take:guid:{MEDIA-TAKE-${itemSerial}}`;
        const row = {
          item_ref: itemRef,
          take_ref: takeRef,
          track_ref: trackRef,
          position_seconds: call.input.position_seconds,
          length_seconds: length,
          file_ref: `${FILE_REF_PREFIX}${pathValue}`,
          path: pathValue,
        };
        items.push(row);
        tracks[trackRef].push(row);
        takes[takeRef] = row.file_ref;
        return ok(call.id, {
          imported_item_refs: [itemRef],
          item_count: 1,
          source_file_ref: row.file_ref,
          track_ref: trackRef,
          position_seconds: row.position_seconds,
        }, [objectRef("item", itemRef), fileRef(pathValue)]);
      }
      if (call.id === "template.items.read_item_summary") {
        const ref = call.refs.item_ref.ref;
        const item = items.find((row) => row.item_ref === ref);
        if (!item) return fail(call.id, "ITEM_NOT_FOUND");
        return ok(call.id, {
          item_ref: item.item_ref,
          track_ref: item.track_ref,
          position_seconds: item.position_seconds,
          length_seconds: item.length_seconds,
          active_take_ref: item.take_ref,
          take_count: 1,
        }, [objectRef("item", item.item_ref), objectRef("take", item.take_ref)]);
      }
      if (call.id === "template.media.read_take_source") {
        const ref = call.refs.take_ref.ref;
        const fileRefValue = options.readbackFileRef ?? takes[ref];
        const pathValue = fileRefValue.startsWith(FILE_REF_PREFIX)
          ? fileRefValue.slice(FILE_REF_PREFIX.length)
          : fileRefValue;
        return ok(call.id, {
          take_ref: ref,
          file_ref: fileRefValue,
          filename: pathValue,
          source_type: "audio",
        }, [objectRef("take", ref), fileRef(pathValue)]);
      }
      if (call.id === "template.media.relink_take_source") {
        const takeRef = call.refs.take_ref.ref;
        takes[takeRef] = call.refs.source_file_ref.ref;
        return ok(call.id, {
          take_ref: takeRef,
          source_file_ref: takes[takeRef],
          relinked: true,
        }, [objectRef("take", takeRef), call.refs.source_file_ref]);
      }
      throw new Error(`Unexpected ${call.id}`);
    },
  };
}

function ok(id, readback, refs = []) {
  return {
    ok: true,
    request: { id },
    template: { id },
    verification: { status: "passed" },
    result: { readback, refs },
  };
}
function fail(id, code) {
  return { ok: false, request: { id }, template: { id }, error: { code, message: code, recoverable: true } };
}
function objectRef(kind, ref) {
  return { kind, ref, identity: { scheme: ref.split(":")[1], value: ref.split(":").slice(2).join(":") } };
}
function fileRef(pathValue) {
  return { kind: "file", ref: `${FILE_REF_PREFIX}${pathValue}`, identity: { scheme: "path", value: pathValue } };
}
function fakeIndex() {
  return {
    scopes: null,
    status: () => ({ snapshot_id: "snapshot:media-c3b", revision: "revision:media-c3b" }),
    invalidateScopes({ scopes }) { this.scopes = scopes; return { ok: true, scopes }; },
  };
}

async function longLibraryFixture() {
  return libraryFixture([LONG_PATH]);
}

async function libraryFixture(paths) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-media-c3b-"));
  const mediaDb = path.join(root, "MediaDB");
  await mkdir(mediaDb, { recursive: true });
  await writeFile(path.join(root, "reaper.ini"), "Shortcut1=00.ReaperFileList\nShortcutT1=library\n", "utf8");
  const databaseSource = [
    `PATH "${root}"`,
    ...paths.flatMap((pathValue) => [
      `FILE "${pathValue}" 12000 0 0 0`,
      "DATA s:48000 n:2 l:0:00.250 i:24",
    ]),
    "",
  ].join("\n");
  await writeFile(path.join(mediaDb, "00.ReaperFileList"), databaseSource, "utf8");
  return {
    root,
    execute: async (call) => {
      if (call.id !== "template.system.read_resource_paths") throw new Error(`Unexpected ${call.id}`);
      return ok(call.id, { resource_path: root });
    },
  };
}
