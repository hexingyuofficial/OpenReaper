import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FOUNDATION_BRIDGE_PACK_IDS,
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_CONTRACT,
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TEMPLATE_CATALOG_SMOKE_CATEGORIES,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
  validateTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  TEMPLATE_CATALOG_SEED_TEMPLATE_IDS,
  createTemplateCatalogSeedTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import { executeTemplate } from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

describe("Layer 4C template catalog and smoke gate", () => {
  it("loads the seed catalog and validates every descriptor through 4A", () => {
    const templates = createTemplateCatalogSeedTemplates();
    const validation = validateTemplateCatalog({ templates });
    const catalog = createTemplateCatalog({ templates });

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(catalog.contract, TEMPLATE_CATALOG_CONTRACT);
    assert.equal(catalog.size, templates.length);
    assert.deepEqual(catalog.ids, templates.map((descriptor) => descriptor.id));

    for (const descriptor of catalog.list()) {
      const result = validateTemplateDescriptor(descriptor);
      assert.deepEqual(result.errors, [], descriptor.id);
      assert.equal(result.ok, true, descriptor.id);
      assert.equal(FOUNDATION_BRIDGE_PACK_IDS.includes(descriptor.pack), true, descriptor.id);
      assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], descriptor.pack);
    }
  });

  it("rejects duplicate template ids", () => {
    const first = createTemplateCatalogSeedTemplates()[0];
    const second = createTemplateCatalogSeedTemplates()[0];

    assert.throws(
      () => createTemplateCatalog({ templates: [first, second] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.core\.read_health/.test(error.errors.join("\n")),
    );
  });

  it("rejects workflow-shaped, non-fixed, and mismatched pack metadata", () => {
    const workflow = createTemplateCatalogSeedTemplates()[0];
    workflow.id = "template.loop.find_candidates";
    workflow.pack = "loop";

    assert.throws(
      () => createTemplateCatalog({ templates: [workflow] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /workflow-shaped pack metadata is forbidden: loop/.test(error.errors.join("\n")),
    );

    const nonFixed = createTemplateCatalogSeedTemplates()[0];
    nonFixed.id = "template.sws.snapshot";
    nonFixed.pack = "sws";

    assert.throws(
      () => createTemplateCatalog({ templates: [nonFixed] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /pack must be one of the fixed 16 packs: sws/.test(error.errors.join("\n")),
    );

    const mismatched = createTemplateCatalogSeedTemplates()[1];
    mismatched.id = "template.items.create_track";

    assert.throws(
      () => createTemplateCatalog({ templates: [mismatched] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /id pack segment must match pack \(tracks\)/.test(error.errors.join("\n")),
    );
  });

  it("rejects recipes as catalog input", () => {
    assert.throws(
      () => createTemplateCatalog({ templates: createTemplateCatalogSeedTemplates(), recipes: [] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Template catalog must not include recipes/.test(error.errors.join("\n")),
    );
  });

  it("connects to Layer 1.5 discovery and keeps default listing bounded", () => {
    const responseA = createTemplateCatalogDiscovery(
      createTemplateCatalog({ templates: syntheticTemplates(100) }),
      createDiscoveryCatalog,
    ).list_templates();
    const responseB = createTemplateCatalogDiscovery(
      createTemplateCatalog({ templates: syntheticTemplates(1_000) }),
      createDiscoveryCatalog,
    ).list_templates();

    assert.equal(JSON.stringify(responseA), JSON.stringify(responseB));
    assert.equal(responseA.contract, "discovery.menu.v1");
    assert.equal(responseA.kind, "template_menu");
    assert.equal(responseA.mode, "menu");
    assert.equal(responseA.items.length, 25);
    assert.equal(responseA.page.limit, 25);
    assert.equal(responseA.page.has_more, true);
    assert.equal("total" in responseA.page, false);

    const payload = JSON.stringify(responseA);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
  });

  it("expands exact ids with Layer 1.5 field selection only", () => {
    const catalog = createTemplateCatalog({ templates: createTemplateCatalogSeedTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: [TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.renderRegionJob, "template.render.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.render.missing"]);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "summary",
    ]);
    assert.equal("bridge" in response.items[0], false);
    assert.equal("refs" in response.items[0], false);
    assert.equal("artifacts" in response.items[0], false);
    assert.equal("verification" in response.items[0], false);
  });

  it("runs fake execution smoke for read, write, job, artifact, idempotent, and error cases", async () => {
    const catalog = createTemplateCatalog({ templates: createTemplateCatalogSeedTemplates() });
    const bridge = new FakeFoundationBridge();

    const read = await executeTemplate({
      descriptor: catalog.require(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.readHealth),
      input: {},
      context: context({ request_sequence: 1 }),
      executor: bridge,
    });
    assert.equal(read.ok, true);
    assert.equal(read.template.id, TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.readHealth);
    assert.equal(read.undo.mode, "none");

    const track = createObjectRef("track", { scheme: "guid", value: "{TRACK-CREATE}" });
    const write = await executeTemplate({
      descriptor: catalog.require(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.createTrack),
      input: { name: "Dialog", emits: { refs: [track] } },
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });
    assert.equal(write.ok, true);
    assert.equal(write.undo.mode, "required");
    assert.deepEqual(write.result.refs, [track]);

    const region = createObjectRef("region", { scheme: "name", value: "Chorus" });
    const job = createObjectRef("job", { scheme: "job_id", value: "render.region.1" });
    const artifact = createArtifactRef({
      owner_pack: "render",
      scope: "manifest",
      id: "art_20260702000000000_001_abcdef",
      schema: "render.manifest.v1",
      summary: { files: 1 },
    });
    const render = await executeTemplate({
      descriptor: catalog.require(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.renderRegionJob),
      input: { output_name: "Chorus", emits: { jobs: [job], artifacts: [artifact] } },
      refs: { region_ref: region },
      context: context({ request_sequence: 3 }),
      executor: bridge,
    });
    assert.equal(render.ok, true);
    assert.equal(render.result.jobs[0].kind, "job");
    assert.equal(render.result.artifacts[0].kind, "artifact");
    assert.doesNotMatch(JSON.stringify(render), /payload/);

    const idempotentBridge = new FakeFoundationBridge();
    const ensuredTrack = createObjectRef("track", { scheme: "guid", value: "{TRACK-IDEMPOTENT}" });
    const firstEnsure = await executeTemplate({
      descriptor: catalog.require(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.ensureNamedTrack),
      input: { name: "Dialog", emits: { refs: [ensuredTrack] } },
      context: context({ request_sequence: 4 }),
      executor: idempotentBridge,
    });
    const replayEnsure = await executeTemplate({
      descriptor: catalog.require(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.ensureNamedTrack),
      input: { name: "Dialog", emits: { refs: [ensuredTrack] } },
      context: context({ request_sequence: 5 }),
      executor: idempotentBridge,
    });
    assert.equal(firstEnsure.ok, true);
    assert.equal(replayEnsure.ok, true);
    assert.equal(firstEnsure.request.idempotency_key, replayEnsure.request.idempotency_key);
    assert.equal(replayEnsure.idempotency.replayed, true);
    assert.equal(idempotentBridge.seen.length, 1);

    const errorBridge = new FakeFoundationBridge();
    const error = await executeTemplate({
      descriptor: catalog.require(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.readHealth),
      input: {},
      context: context({ request_sequence: 6 }),
      executor: (request) =>
        errorBridge.errorEnvelope(request, "PACK_DISABLED", "Forced catalog smoke error.", {
          recoverable: true,
        }),
    });
    assert.equal(error.ok, false);
    assert.equal(error.error.source, "bridge");
    assert.equal(error.error.code, "PACK_DISABLED");
  });

  it("keeps the 4C smoke static: no live REAPER startup, legacy migration, or recipes", () => {
    const catalogSource = readFileSync(
      new URL("../../packages/core/src/template-catalog-v1.mjs", import.meta.url),
      "utf8",
    );
    const fixtureSource = readFileSync(
      new URL("../../packages/core/src/template-catalog-fixtures-v1.mjs", import.meta.url),
      "utf8",
    );
    const source = `${catalogSource}\n${fixtureSource}`;

    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /\blegacy\b/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.throws(
      () => createTemplateCatalog({ templates: [], recipes: [] }),
      TemplateCatalogValidationError,
    );
    assert.deepEqual(
      [...TEMPLATE_CATALOG_SMOKE_CATEGORIES].sort(),
      [
        "catalog_load",
        "default_discovery_bounded",
        "descriptor_validation",
        "exact_ids_expansion",
        "fake_execution_artifact",
        "fake_execution_error",
        "fake_execution_idempotent",
        "fake_execution_job",
        "fake_execution_read",
        "fake_execution_write",
        "no_legacy_migration",
        "no_live_reaper_startup",
        "no_recipes",
      ].sort(),
    );
  });
});

function syntheticTemplates(count) {
  const base = createTemplateCatalogSeedTemplates().find(
    (descriptor) => descriptor.id === TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.createTrack,
  );
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `template.tracks.synthetic_${String(index).padStart(4, "0")}`,
    title: `Synthetic track ${index}`,
    summary: `Synthetic catalog pressure template ${index}.`,
    examples: [
      {
        name: `synthetic_${String(index).padStart(4, "0")}`,
        summary: `Create synthetic track ${index}.`,
        input: { name: `Track ${index}` },
      },
    ],
  }));
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-02T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
