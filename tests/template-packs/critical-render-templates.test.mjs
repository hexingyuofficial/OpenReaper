import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_BUDGETS,
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
  validateTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
  createTemplateCatalogCriticalFillTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  CRITICAL_RENDER_TEMPLATE_IDS,
  createCriticalRenderTemplates,
} from "../../packages/core/src/template-packs/critical-render-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = CRITICAL_RENDER_TEMPLATE_IDS;

const BLOCKED_RENDER_IDS = Object.freeze([
  "template.render.render_region_job",
  "template.render.render_anything",
  "template.render.render_full_project_wav",
  "template.render.render_region_video",
  "template.render.render_stems",
  "template.render.execute_raw_render",
]);

describe("Critical render template descriptors", () => {
  it("exports exactly the critical render and Alpha2 render/export closure allowlist", () => {
    const templates = createCriticalRenderTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(CRITICAL_RENDER_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_RENDER_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("validates the descriptor through the frozen 4A descriptor ABI", () => {
    for (const descriptor of createCriticalRenderTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "render", descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );
    }

    const descriptor = createCriticalRenderTemplates()[0];
    assert.equal(descriptor.risk, "write");
    assert.equal(descriptor.bridge.operation_family, "run_job");
    assert.equal(descriptor.bridge.operation_name, "render.region_wav");
    assert.equal(descriptor.bridge.capability, "render.region_wav");
    assert.equal(descriptor.bridge.idempotency, "required");
    assert.equal(descriptor.expectedDelta.kind, "job");
    assert.equal(descriptor.expectedDelta.idempotent, true);
    assert.equal(descriptor.verification.mode, "required");
    assert.equal(descriptor.artifacts.mode, "produces");
  });

  it("covers Alpha2 render scopes, formats, settings, and output path metadata as static descriptors", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalRenderTemplates() });
    const boundedTargets = catalog.require("template.render.render_targets");
    assert.equal(boundedTargets.bridge.idempotency, "none");
    assert.equal(boundedTargets.expectedDelta.idempotent, false);

    const renderJobs = [
      "template.render.render_item",
      "template.render.render_selected_item",
      "template.render.render_track_item",
      "template.render.render_selected_tracks",
      "template.render.render_ogg",
      "template.render.render_mp3",
      "template.render.render_flac",
      "template.render.render_aiff",
      "template.render.render_m4a",
      "template.render.render_opus",
      "template.render.render_region_with_track_filter",
    ].map((id) => catalog.require(id));
    const settingIds = [
      "template.render.set_render_format",
      "template.render.set_render_sample_rate",
      "template.render.set_ogg_quality_or_compression",
      "template.render.set_mp3_bitrate_or_quality",
      "template.render.set_flac_compression",
      "template.render.set_aiff_bit_depth",
    ];

    assert.equal(renderJobs.every((descriptor) => descriptor.bridge.operation_family === "run_job"), true);
    assert.equal(renderJobs.every((descriptor) => descriptor.bridge.idempotency === "required"), true);
    assert.equal(renderJobs.every((descriptor) => descriptor.artifacts.mode === "produces"), true);
    assert.equal(renderJobs.every((descriptor) => descriptor.inputSchema.properties.output_policy.enum[0] === "openreaper_managed_render_root"), true);
    assert.deepEqual(catalog.require("template.render.render_item").refs.input.map((entry) => entry.kind), ["item"]);
    assert.deepEqual(catalog.require("template.render.render_track_item").refs.input.map((entry) => entry.kind), ["track", "item"]);
    assert.deepEqual(catalog.require("template.render.render_region_with_track_filter").refs.input.map((entry) => entry.kind), ["region", "track"]);
    assert.equal(catalog.require("template.render.render_selected_item").inputSchema.properties.selection_policy.const, "exactly_one_selected_item");
    assert.equal(catalog.require("template.render.render_selected_tracks").inputSchema.properties.selection_policy.const, "one_or_more_selected_tracks");
    assert.deepEqual(catalog.require("template.render.render_ogg").inputSchema.properties.format, { const: "ogg" });
    assert.deepEqual(catalog.require("template.render.render_mp3").inputSchema.properties.mp3_bitrate_kbps.enum, [128, 192, 256, 320]);
    assert.deepEqual(catalog.require("template.render.render_flac").inputSchema.properties.flac_compression.enum, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(catalog.require("template.render.render_aiff").inputSchema.properties.aiff_bit_depth.enum, [16, 24, 32]);

    for (const id of settingIds) {
      const descriptor = catalog.require(id);
      assert.equal(descriptor.bridge.operation_family, "run_command", id);
      assert.equal(descriptor.bridge.idempotency, "supported", id);
      assert.equal(descriptor.expectedDelta.kind, "mutation", id);
      assert.equal(descriptor.expectedDelta.entities[0].action, "update", id);
      assert.equal(descriptor.verification.mode, "required", id);
      assert.equal(descriptor.artifacts.mode, "none", id);
    }

    const path = catalog.require("template.render.output_absolute_path");
    assert.equal(path.bridge.operation_family, "artifact_metadata");
    assert.equal(path.risk, "read");
    assert.equal(path.refs.input[0].kind, "artifact");
    assert.equal(path.outputSchema.properties.absolute_path.type, "string");
    assert.equal(path.artifacts.mode, "metadata");
  });

  it("describes a bounded project-render target job without a generic render surface", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderTemplates() }).require(
      "template.render.render_targets",
    );

    assert.equal(descriptor.bridge.operation_family, "run_job");
    assert.equal(descriptor.bridge.operation_name, "render.targets");
    assert.equal(descriptor.bridge.capability, "render.targets");
    assert.equal(descriptor.bridge.idempotency, "none");
    assert.equal(descriptor.expectedDelta.idempotent, false);
    assert.equal(descriptor.risk, "write");
    assert.deepEqual(descriptor.inputSchema.properties.target_kind.enum, [
      "whole_project",
      "time_selection",
      "regions",
      "selected_items",
      "explicit_items",
      "selected_tracks",
      "explicit_tracks",
    ]);
    assert.deepEqual(descriptor.inputSchema.properties.format.enum, ["wav", "ogg"]);
    assert.deepEqual(descriptor.inputSchema.properties.output_policy, { const: "openreaper_managed_render_root" });
    assert.deepEqual(descriptor.inputSchema.properties.collision_policy, { const: "fail_if_exists" });
    assert.deepEqual(descriptor.inputSchema.properties.sample_rate_hz.enum, [44100, 48000]);
    assert.deepEqual(descriptor.inputSchema.properties.channel_count.enum, [1, 2]);
    assert.deepEqual(descriptor.inputSchema.properties.wav_bit_depth.enum, [16, 24]);
    assert.deepEqual(descriptor.inputSchema.properties.ogg_quality.enum, [0.3, 0.5, 0.6, 0.8, 1.0]);
    assert.deepEqual(descriptor.refs.input.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["region_refs", "region", false],
      ["item_refs", "item", false],
      ["track_refs", "track", false],
    ]);
    assert.deepEqual(descriptor.artifacts.output.map((entry) => entry.schema), [
      "render.targets_manifest.v1",
      "render.targets_evidence.v1",
    ]);
    assert.equal(JSON.stringify(descriptor).includes("output_path"), false);
    assert.equal(JSON.stringify(descriptor).includes("output_directory"), false);
  });

  it("keeps render scope bounded to region WAV output with artifact refs", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalRenderTemplates() });
    const descriptor = catalog.require("template.render.render_region_wav");

    assert.deepEqual(descriptor.refs.input.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["region_ref", "region", true],
    ]);
    assert.deepEqual(descriptor.refs.output.map((entry) => entry.kind), ["job", "artifact", "artifact"]);
    assert.deepEqual(Object.keys(descriptor.inputSchema.properties), [
      "format",
      "output_policy",
      "collision_policy",
      "sample_rate_hz",
      "bit_depth",
      "channel_count",
      "include_sidecar_manifest",
    ]);
    assert.deepEqual(descriptor.inputSchema.properties.format, { const: "wav" });
    assert.deepEqual(descriptor.inputSchema.properties.output_policy.enum, ["openreaper_managed_render_root"]);
    assert.deepEqual(descriptor.inputSchema.properties.collision_policy.enum, [
      "fail_if_exists",
      "reuse_idempotent_match",
    ]);
    assert.deepEqual(descriptor.artifacts.output.map((entry) => entry.schema), [
      "render.region_wav_output.v1",
      "render.render_job_evidence.v1",
    ]);
    assert.equal(JSON.stringify(descriptor.inputSchema).includes("output_path"), false);
    assert.equal(JSON.stringify(descriptor.inputSchema).includes("output_directory"), false);
  });

  it("loads as a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createCriticalRenderTemplates();
    const validation = validateTemplateCatalog({ templates });
    const catalog = createTemplateCatalog({ templates });

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);

    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.render\.render_region_wav/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "render" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal(Buffer.byteLength(JSON.stringify(menu), "utf8") < 8192, true);

    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
        assert.equal(Object.hasOwn(item, field), false, `${item.id} ${field}`);
      }
    }
  });

  it("supports exact id lookup with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalRenderTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.render.render_region_wav", "template.render.render_anything"],
      fields: ["summary", "inputSchema", "outputSchema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.render.render_anything"]);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "outputSchema",
      "summary",
    ]);
    assert.equal("bridge" in response.items[0], false);
    assert.equal("refs" in response.items[0], false);
    assert.equal("artifacts" in response.items[0], false);
    assert.equal("verification" in response.items[0], false);
  });

  it("builds a legal 4B render job request with undo, verification, and idempotency", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderTemplates() }).require(
      "template.render.render_region_wav",
    );
    const region = regionRef();
    const first = buildTemplateBridgeRequest({
      descriptor,
      input: renderInput(),
      refs: { region_ref: region },
      context: context({ request_sequence: 1 }),
    });
    const replay = buildTemplateBridgeRequest({
      descriptor,
      input: renderInput(),
      refs: { region_ref: region },
      context: context({ request_sequence: 2 }),
    });

    assert.equal(first.operation.family, "run_job");
    assert.equal(first.operation.name, "render.region_wav");
    assert.equal(first.pack.id, "render");
    assert.equal(first.pack.risk, "write");
    assert.equal(first.pack.capability, "render.region_wav");
    assert.equal(first.undo.mode, "required");
    assert.equal(first.undo.label, "OpenReaper: render.region_wav");
    assert.deepEqual(first.undo.flags, ["render_job", "output_file", "render_artifact"]);
    assert.equal(first.verification.mode, "required");
    assert.equal(first.artifacts.allow, true);
    assert.equal(first.idempotency_key.startsWith("template:"), true);
    assert.equal(first.idempotency_key, replay.idempotency_key);
    assert.deepEqual(first.refs, [region]);
    assert.equal(Object.hasOwn(first.params, "output_path"), false);
    assert.equal(Object.hasOwn(first.params, "output_directory"), false);
  });

  it("fake-smokes the render job and returns only job and artifact evidence refs", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderTemplates() }).require(
      "template.render.render_region_wav",
    );
    const bridge = new FakeRenderJobBridge();
    const first = await executeTemplate({
      descriptor,
      input: renderInput(),
      refs: { region_ref: regionRef() },
      context: context({ request_sequence: 1 }),
      executor: bridge,
    });
    const replay = await executeTemplate({
      descriptor,
      input: renderInput(),
      refs: { region_ref: regionRef() },
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });

    assert.equal(first.ok, true);
    assert.equal(first.template.id, "template.render.render_region_wav");
    assert.equal(first.result.jobs.length, 1);
    assert.equal(first.result.jobs[0].kind, "job");
    assert.equal(first.result.artifacts.length, 2);
    assert.deepEqual(first.result.artifacts.map((entry) => entry.kind), ["artifact", "artifact"]);
    assert.equal(first.result.artifacts[0].summary.schema, "render.region_wav_output.v1");
    assert.equal(first.result.artifacts[1].summary.schema, "render.render_job_evidence.v1");
    assert.equal(first.result.refs.length, 0);
    assert.equal(first.result.last_result.updated, true);
    assert.equal(first.verification.status, "passed");
    assert.equal(first.undo.closed, true);
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotency.replayed, true);
    assert.equal(bridge.seen.length, 1);
    assert.doesNotMatch(JSON.stringify(first), /payload|audio_data|pcm|samples|base64|file_contents/);
  });

  it("rejects generic render inputs and missing region refs before fake dispatch", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderTemplates() }).require(
      "template.render.render_region_wav",
    );
    const bridge = new FakeRenderJobBridge();
    const invalidInput = await executeTemplate({
      descriptor,
      input: {
        ...renderInput(),
        render_scope: "entire_project",
      },
      refs: { region_ref: regionRef() },
      context: context(),
      executor: bridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor,
      input: renderInput(),
      refs: {},
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("is present in the shared catalog after the control-tower merge", () => {
    const sharedIds = [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
    ].map((descriptor) => descriptor.id);

    assert.equal(sharedIds.includes("template.render.render_region_wav"), true);
  });

  it("keeps pack-local source static: no runtime, recipes, raw execution, or old repo migration", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/critical-render-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /run_action|template\.execute/);
    assert.doesNotMatch(source, /raw_lua|raw_action|shell|process\./);
    assert.doesNotMatch(source, /output_directory|relative_path|file:\/\//);
    assert.doesNotMatch(source, /render_anything|render_full_project|render_region_video|render_stems/);
    assert.doesNotMatch(source, /template\.render\.render_region_job/);
  });
});

class FakeRenderJobBridge extends FakeFoundationBridge {
  execute(request, startedAt) {
    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, "render.region_wav");
    assert.equal(request.params.format, "wav");
    assert.equal(request.params.output_policy, "openreaper_managed_render_root");
    assert.equal(Object.hasOwn(request.params, "output_path"), false);
    assert.equal(Object.hasOwn(request.params, "output_directory"), false);

    const job = createObjectRef("job", { scheme: "job_id", value: "render.region_wav.1" });
    const output = createArtifactRef({
      owner_pack: "render",
      scope: "region_wav_output",
      id: "art_20260703000000000_001_ab12cd",
      schema: "render.region_wav_output.v1",
      summary: {
        schema: "render.region_wav_output.v1",
        format: "wav",
        file_count: 1,
      },
    });
    const evidence = createArtifactRef({
      owner_pack: "render",
      scope: "render_job_evidence",
      id: "art_20260703000000000_002_ab12ce",
      schema: "render.render_job_evidence.v1",
      summary: {
        schema: "render.render_job_evidence.v1",
        job_state: "completed",
        verification: "passed",
      },
    });

    return this.okEnvelope(request, startedAt, {
      summary: {
        format: "wav",
        output_policy: request.params.output_policy,
        collision_policy: request.params.collision_policy,
        file_count: 1,
        reused_existing: false,
        truncated: false,
      },
      refs: [],
      artifacts: [output, evidence],
      jobs: [job],
      last_result: {
        updated: true,
        refs: [job, output, evidence],
        truncated: false,
      },
    });
  }
}

function renderInput(overrides = {}) {
  return {
    format: "wav",
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    sample_rate_hz: 48000,
    bit_depth: 24,
    channel_count: 2,
    include_sidecar_manifest: true,
    ...overrides,
  };
}

function regionRef() {
  return createObjectRef("region", { scheme: "guid", value: "{REGION-LOOP}" });
}

function context(overrides = {}) {
  return {
    session_id: "session-critical-render",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
