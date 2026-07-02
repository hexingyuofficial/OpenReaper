import { TEMPLATE_DESCRIPTOR_CONTRACT } from "./template-descriptor-v1.mjs";
import {
  WAVE1A_ANALYSIS_TEMPLATE_IDS,
  WAVE1A_ANALYSIS_TEMPLATES,
  createWave1AAnalysisTemplates,
} from "./template-packs/wave1a-analysis-templates-v1.mjs";
import {
  WAVE1A_ITEMS_TEMPLATE_IDS,
  WAVE1A_ITEMS_TEMPLATES,
  createWave1AItemsTemplates,
} from "./template-packs/wave1a-items-templates-v1.mjs";
import {
  WAVE1A_PROJECT_TEMPLATE_IDS,
  WAVE1A_PROJECT_TEMPLATES,
  createWave1aProjectTemplates,
} from "./template-packs/wave1a-project-templates-v1.mjs";
import {
  WAVE1A_RENDER_TEMPLATE_IDS,
  WAVE1A_RENDER_TEMPLATES,
  createWave1aRenderTemplates,
} from "./template-packs/wave1a-render-templates-v1.mjs";
import {
  WAVE1A_TRACKS_TEMPLATE_IDS,
  WAVE1A_TRACKS_TEMPLATES,
  createWave1ATracksTemplates,
} from "./template-packs/wave1a-tracks-templates-v1.mjs";
import {
  WAVE1A_TRANSPORT_TEMPLATE_IDS,
  WAVE1A_TRANSPORT_TEMPLATES,
  createWave1ATransportTemplates,
} from "./template-packs/wave1a-transport-templates-v1.mjs";

export const TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS = deepFreeze([
  ...Object.values(WAVE1A_PROJECT_TEMPLATE_IDS),
  ...Object.values(WAVE1A_TRACKS_TEMPLATE_IDS),
  ...WAVE1A_ITEMS_TEMPLATE_IDS,
  ...WAVE1A_TRANSPORT_TEMPLATE_IDS,
  ...WAVE1A_ANALYSIS_TEMPLATE_IDS,
  ...Object.values(WAVE1A_RENDER_TEMPLATE_IDS),
]);

export const TEMPLATE_CATALOG_WAVE1A_TEMPLATES = deepFreeze([
  ...WAVE1A_PROJECT_TEMPLATES,
  ...WAVE1A_TRACKS_TEMPLATES,
  ...WAVE1A_ITEMS_TEMPLATES,
  ...WAVE1A_TRANSPORT_TEMPLATES,
  ...WAVE1A_ANALYSIS_TEMPLATES,
  ...WAVE1A_RENDER_TEMPLATES,
]);

export const TEMPLATE_CATALOG_SEED_TEMPLATE_IDS = Object.freeze({
  readHealth: "template.core.read_health",
  createTrack: "template.tracks.create_track",
  renderRegionJob: "template.render.render_region_job",
  ensureNamedTrack: "template.tracks.ensure_named_track",
});

export const TEMPLATE_CATALOG_SEED_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.readHealth,
    title: "Read bridge health",
    summary: "Read compact bridge health and owner state.",
    pack: "core",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "bridge_health",
    tags: ["health", "state", "smoke"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "bridge.health",
      capability: "bridge.health",
      idempotency: "none",
    }),
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      owner: { type: "string" },
      generation: { type: "integer" },
    }, []),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads compact bridge health without mutating state.",
      entities: [
        {
          entity_kind: "bridge_health",
          action: "read",
          summary: "Bridge health is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_health",
        summary: "Read bridge health.",
        input: {},
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.createTrack,
    title: "Create track",
    summary: "Create one new track and return its compact track ref.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "create", "smoke"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "track.create",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      name: { type: "string" },
      emits: { type: "object" },
    }, ["name"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
    }, ["track_ref"]),
    refs: refs({
      output: [ref("track_ref", "track", true)],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Creates one track and returns a compact track ref.",
      entities: [
        {
          entity_kind: "track",
          action: "create",
          summary: "One track is created.",
        },
      ],
      idempotent: false,
    }),
    verification: verification({
      checks: [
        {
          name: "track_exists",
          kind: "state_delta",
          summary: "A track ref exists after the mutation.",
        },
      ],
    }),
    examples: [
      {
        name: "create_named_track",
        summary: "Create a track named Dialog.",
        input: { name: "Dialog" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.renderRegionJob,
    title: "Render region job",
    summary: "Start a region render job and return job and artifact refs.",
    pack: "render",
    lifecycle: "experimental",
    risk: "destructive",
    entity_kind: "render_job",
    tags: ["render", "job", "artifact", "smoke"],
    bridge: bridge({
      operation_family: "run_job",
      operation_name: "render.region",
      capability: "render.region",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      output_name: { type: "string" },
      emits: { type: "object" },
    }, ["output_name"]),
    outputSchema: objectSchema({
      job_ref: { type: "string" },
      manifest_ref: { type: "string" },
    }, ["job_ref", "manifest_ref"]),
    refs: refs({
      input: [ref("region_ref", "region", true)],
      output: [ref("job_ref", "job", true), ref("manifest_ref", "artifact", true)],
    }),
    artifacts: artifacts({
      mode: "produces",
      output: [artifact("render_manifest", "render.manifest.v1", "render")],
    }),
    expectedDelta: expectedDelta({
      kind: "job",
      summary: "Starts render output work and returns compact refs.",
      entities: [
        {
          entity_kind: "render_job",
          action: "start_job",
          summary: "Render job starts.",
        },
      ],
      idempotent: false,
    }),
    verification: verification({
      checks: [
        {
          name: "render_job_queued",
          kind: "state_delta",
          summary: "A render job ref is returned.",
        },
      ],
    }),
    examples: [
      {
        name: "render_chorus",
        summary: "Render the Chorus region.",
        input: { output_name: "Chorus" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: TEMPLATE_CATALOG_SEED_TEMPLATE_IDS.ensureNamedTrack,
    title: "Ensure named track",
    summary: "Create or reuse a track by name with idempotency.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "idempotent", "smoke"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "track.ensure_named",
      idempotency: "required",
    }),
    inputSchema: objectSchema({
      name: { type: "string" },
      emits: { type: "object" },
    }, ["name"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
    }, ["track_ref"]),
    refs: refs({
      output: [ref("track_ref", "track", true)],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "A named track exists exactly once.",
      entities: [
        {
          entity_kind: "track",
          action: "create",
          summary: "Track is created only when missing.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_exists_once",
          kind: "state_delta",
          summary: "Exactly one matching track ref exists.",
        },
      ],
    }),
    examples: [
      {
        name: "ensure_dialog_track",
        summary: "Ensure a track named Dialog exists.",
        input: { name: "Dialog" },
      },
    ],
  },
]);

export function createTemplateCatalogSeedTemplates() {
  return cloneJson(TEMPLATE_CATALOG_SEED_TEMPLATES);
}

export function createTemplateCatalogWave1aTemplates() {
  return [
    ...createWave1aProjectTemplates(),
    ...createWave1ATracksTemplates(),
    ...createWave1AItemsTemplates(),
    ...createWave1ATransportTemplates(),
    ...createWave1AAnalysisTemplates(),
    ...createWave1aRenderTemplates(),
  ];
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "track.create",
    idempotency: "supported",
    timeout_ms: 5_000,
    ...overrides,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function refs(overrides = {}) {
  return {
    input: [],
    output: [],
    ...overrides,
  };
}

function ref(name, kind, required, summary = `${kind} ref.`) {
  return {
    name,
    kind,
    required,
    summary,
  };
}

function artifacts(overrides = {}) {
  return {
    mode: "none",
    input: [],
    output: [],
    ...overrides,
  };
}

function artifact(name, schema, owner_pack, summary = `${schema} artifact.`) {
  return {
    name,
    schema,
    owner_pack,
    summary,
  };
}

function expectedDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Template expected delta.",
    entities: [],
    idempotent: false,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    mode: "required",
    checks: [],
    ...overrides,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
