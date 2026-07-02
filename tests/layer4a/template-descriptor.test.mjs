import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
  FOUNDATION_BRIDGE_REF_KINDS,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_BUDGETS,
  TEMPLATE_DESCRIPTOR_CONTRACT,
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
  TEMPLATE_DESCRIPTOR_PRESSURE_FIXTURE_CATEGORIES,
  normalizeTemplateDescriptor,
  templateDescriptorDiscoverySummary,
  templateDescriptorOnDemandFields,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_DETAIL_FIELDS,
  TEMPLATE_SUMMARY_FIELDS,
} from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

describe("Layer 4A template descriptor contract", () => {
  it("valid descriptor passes", () => {
    const descriptor = makeDescriptor();
    const result = validateTemplateDescriptor(descriptor);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(normalizeTemplateDescriptor(descriptor).contract, TEMPLATE_DESCRIPTOR_CONTRACT);
  });

  it("invalid pack fails", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        id: "template.sws.snapshot_read",
        pack: "sws",
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Invalid pack: sws/);
  });

  it("workflow-shaped pack fails", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        id: "template.loop.find_candidates",
        pack: "loop",
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Workflow-shaped pack ids are forbidden: loop/);
  });

  it("invalid lifecycle fails", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        lifecycle: "shipping",
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Invalid lifecycle: shipping/);
  });

  it("invalid risk fails", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        risk: "danger",
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Invalid risk: danger/);
  });

  it("invalid entity_kind and tag fail", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        entity_kind: "Track",
        tags: ["track", "bad-tag"],
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /entity_kind must use lower snake-case/);
    assert.match(result.errors.join("\n"), /Invalid tag: bad-tag/);
  });

  it("missing schemas fail", () => {
    const descriptor = makeDescriptor();
    delete descriptor.inputSchema;

    const result = validateTemplateDescriptor(descriptor);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Missing required field: inputSchema/);
    assert.match(result.errors.join("\n"), /inputSchema must be a JSON object schema/);
  });

  it("schema additionalProperties must remain false", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        inputSchema: {
          ...objectSchema({
            name: { type: "string" },
          }, ["name"]),
          additionalProperties: true,
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /inputSchema\.additionalProperties must be false/);
  });

  it("read risk descriptors reject mutating expected delta actions", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        id: "template.project.read_then_delete_claim",
        pack: "project",
        risk: "read",
        entity_kind: "project",
        tags: ["project", "read"],
        bridge: bridge({
          operation_family: "query_state",
          operation_name: "project.summary",
          capability: "project.summary",
          idempotency: "none",
        }),
        expectedDelta: expectedDelta({
          kind: "read",
          summary: "Claims a read while declaring a delete action.",
          entities: [{ entity_kind: "project", action: "delete", summary: "This must fail." }],
          idempotent: true,
        }),
        verification: verification({ mode: "none", checks: [] }),
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /read risk descriptors must not declare mutating expectedDelta actions/);
  });

  it("oversized summary, example, and descriptor fail", () => {
    const summaryResult = validateTemplateDescriptor(
      makeDescriptor({
        summary: "x".repeat(TEMPLATE_DESCRIPTOR_BUDGETS.summary_max_chars + 1),
      }),
    );
    assert.equal(summaryResult.ok, false);
    assert.match(summaryResult.errors.join("\n"), /summary exceeds/);

    const exampleResult = validateTemplateDescriptor(
      makeDescriptor({
        examples: [
          {
            name: "oversized",
            summary: "Large example input.",
            input: { name: "x".repeat(TEMPLATE_DESCRIPTOR_BUDGETS.example_max_bytes) },
          },
        ],
      }),
    );
    assert.equal(exampleResult.ok, false);
    assert.match(exampleResult.errors.join("\n"), /example exceeds/);

    const descriptorResult = validateTemplateDescriptor(makeNearBudgetDescriptor());
    assert.equal(descriptorResult.ok, false);
    assert.match(descriptorResult.errors.join("\n"), /descriptor exceeds/);
  });

  it("oversized discovery summary fails descriptor validation", () => {
    const result = validateTemplateDescriptor(
      makeDescriptor({
        id: `template.hardware_control.${"a".repeat(70)}`,
        title: "T".repeat(TEMPLATE_DESCRIPTOR_BUDGETS.title_max_chars),
        summary: "s".repeat(TEMPLATE_DESCRIPTOR_BUDGETS.summary_max_chars),
        pack: "hardware_control",
        lifecycle: "experimental",
        risk: "destructive",
        entity_kind: `entity_${"a".repeat(73)}`,
        tags: Array.from({ length: TEMPLATE_DESCRIPTOR_BUDGETS.tag_max_count }, (_, index) =>
          `tag_${String(index).padStart(28, "0")}`,
        ),
      }),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /discovery summary exceeds/);
  });

  it("pressure fixture descriptors all validate", () => {
    const fixtures = pressureFixtureDescriptors();
    const covered = new Set();

    for (const fixture of fixtures) {
      const result = validateTemplateDescriptor(fixture);
      assert.deepEqual(result.errors, [], fixture.id);
      assert.equal(result.ok, true, fixture.id);
      for (const category of fixture.pressureFixture.categories) covered.add(category);
    }

    assert.deepEqual(
      [...covered].sort(),
      [...TEMPLATE_DESCRIPTOR_PRESSURE_FIXTURE_CATEGORIES].sort(),
    );
  });

  it("descriptor summary excludes full schema, examples, and expected delta by default", () => {
    const descriptor = makeDescriptor({
      inputSchema: objectSchema({
        hidden_payload: { type: "string", const: "large hidden input schema" },
      }),
      outputSchema: objectSchema({
        hidden_payload: { type: "string", const: "large hidden output schema" },
      }),
      expectedDelta: expectedDelta({
        summary: "Large hidden expected delta.",
        entities: [
          {
            entity_kind: "track",
            action: "update",
            summary: "large hidden expected delta entity",
          },
        ],
      }),
      examples: [
        {
          name: "hidden_example",
          summary: "Large hidden example.",
          input: { hidden_payload: "large hidden example" },
        },
      ],
    });

    const summary = templateDescriptorDiscoverySummary(descriptor);
    const payload = JSON.stringify(summary);

    assert.deepEqual(Object.keys(summary), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
    assert.doesNotMatch(payload, /inputSchema/);
    assert.doesNotMatch(payload, /outputSchema/);
    assert.doesNotMatch(payload, /examples/);
    assert.doesNotMatch(payload, /expectedDelta/);
    assert.doesNotMatch(payload, /large hidden/);
  });

  it("full descriptor remains on-demand conceptually, not dumped by default", () => {
    const descriptor = makeDescriptor();

    const summary = templateDescriptorDiscoverySummary(descriptor);
    const detail = templateDescriptorOnDemandFields(descriptor, [
      "inputSchema",
      "examples",
      "expectedDelta",
    ]);

    assert.equal("bridge" in summary, false);
    assert.equal("refs" in summary, false);
    assert.equal("artifacts" in summary, false);
    assert.deepEqual(Object.keys(detail).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
    ]);
  });

  it("lower-layer constants are not changed", () => {
    assert.deepEqual(FOUNDATION_BRIDGE_PACK_IDS, [
      "core",
      "project",
      "transport",
      "tracks",
      "items",
      "media",
      "analysis",
      "midi",
      "fx",
      "routing",
      "automation",
      "render",
      "actions",
      "ui",
      "system",
      "hardware_control",
    ]);
    assert.deepEqual(FOUNDATION_BRIDGE_OPERATION_FAMILIES, [
      "query_state",
      "run_command",
      "run_action",
      "run_job",
      "artifact_metadata",
    ]);
    assert.deepEqual(FOUNDATION_BRIDGE_REF_KINDS, [
      "project",
      "track",
      "item",
      "take",
      "fx",
      "send",
      "envelope",
      "marker",
      "region",
      "file",
      "job",
      "artifact",
    ]);
    assert.deepEqual(TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS, TEMPLATE_SUMMARY_FIELDS);
    assert.deepEqual(["inputSchema", "outputSchema", "examples", "expectedDelta"], TEMPLATE_DETAIL_FIELDS);
  });
});

function pressureFixtureDescriptors() {
  return [
    makeDescriptor({
      id: "template.core.read_health",
      title: "Read bridge health",
      summary: "Read compact bridge health and owner state.",
      pack: "core",
      risk: "read",
      entity_kind: "bridge_health",
      tags: ["health", "state"],
      bridge: bridge({
        operation_family: "query_state",
        operation_name: "bridge.health",
        capability: "bridge.health",
        idempotency: "none",
      }),
      refs: refs(),
      expectedDelta: expectedDelta({
        kind: "read",
        summary: "Reads compact bridge health without mutating state.",
        entities: [{ entity_kind: "bridge_health", action: "read", summary: "Health state is read." }],
        idempotent: true,
      }),
      verification: verification({ mode: "none", checks: [] }),
      pressureFixture: pressureFixture(["read_only_state"]),
    }),
    makeDescriptor({
      id: "template.tracks.rename_track",
      title: "Rename track",
      summary: "Set the name of one existing track.",
      pack: "tracks",
      risk: "write",
      entity_kind: "track",
      tags: ["track", "rename"],
      refs: refs({ input: [ref("track_ref", "track", true)] }),
      expectedDelta: expectedDelta({
        summary: "One track name is updated.",
        entities: [{ entity_kind: "track", action: "update", summary: "Track name changes." }],
      }),
      pressureFixture: pressureFixture(["simple_write"]),
    }),
    makeDescriptor({
      id: "template.items.delete_items",
      title: "Delete items",
      summary: "Delete selected media items through a verified mutation.",
      pack: "items",
      risk: "destructive",
      entity_kind: "item",
      tags: ["item", "delete"],
      refs: refs({ input: [ref("item_ref", "item", true)] }),
      expectedDelta: expectedDelta({
        summary: "One or more item refs are deleted.",
        entities: [{ entity_kind: "item", action: "delete", summary: "Item is removed from project state." }],
      }),
      pressureFixture: pressureFixture(["destructive_write"]),
    }),
    makeDescriptor({
      id: "template.analysis.write_loudness_artifact",
      title: "Write loudness artifact",
      summary: "Produce compact loudness metadata as an artifact ref.",
      pack: "analysis",
      risk: "read",
      entity_kind: "analysis_artifact",
      tags: ["analysis", "artifact"],
      bridge: bridge({ operation_family: "run_job", operation_name: "analysis.loudness", capability: "analysis.loudness" }),
      refs: refs({ input: [ref("item_ref", "item", true)], output: [ref("artifact_ref", "artifact", true)] }),
      artifacts: artifacts({
        mode: "produces",
        output: [artifact("loudness_report", "analysis.loudness_report.v1", "analysis")],
      }),
      expectedDelta: expectedDelta({
        kind: "artifact",
        summary: "Emits an analysis artifact ref without editing project data.",
        entities: [{ entity_kind: "analysis_artifact", action: "emit", summary: "Loudness artifact is produced." }],
        idempotent: true,
      }),
      verification: verification({ mode: "none", checks: [] }),
      pressureFixture: pressureFixture(["artifact_producing"]),
    }),
    makeDescriptor({
      id: "template.analysis.measure_loudness_job",
      title: "Measure loudness job",
      summary: "Start a bounded loudness analysis job.",
      pack: "analysis",
      risk: "read",
      entity_kind: "loudness",
      tags: ["analysis", "job"],
      bridge: bridge({ operation_family: "run_job", operation_name: "analysis.loudness", capability: "analysis.loudness" }),
      refs: refs({ input: [ref("item_ref", "item", true)], output: [ref("job_ref", "job", true)] }),
      expectedDelta: expectedDelta({
        kind: "job",
        summary: "Starts an analysis job and returns a job ref.",
        entities: [{ entity_kind: "loudness", action: "start_job", summary: "Analysis job is queued." }],
        idempotent: true,
      }),
      verification: verification({ mode: "none", checks: [] }),
      pressureFixture: pressureFixture(["analysis_job"]),
    }),
    makeDescriptor({
      id: "template.render.render_region_job",
      title: "Render region job",
      summary: "Start a region render job that may overwrite output.",
      pack: "render",
      risk: "destructive",
      entity_kind: "render_job",
      tags: ["render", "job"],
      bridge: bridge({ operation_family: "run_job", operation_name: "render.region", capability: "render.region" }),
      refs: refs({ input: [ref("region_ref", "region", true)], output: [ref("job_ref", "job", true)] }),
      artifacts: artifacts({
        mode: "produces",
        output: [artifact("render_manifest", "render.manifest.v1", "render")],
      }),
      expectedDelta: expectedDelta({
        kind: "job",
        summary: "Starts render output work and returns job metadata.",
        entities: [{ entity_kind: "render_job", action: "start_job", summary: "Render job starts." }],
      }),
      pressureFixture: pressureFixture(["render_job"]),
    }),
    makeDescriptor({
      id: "template.actions.run_guarded_action",
      title: "Run guarded action",
      summary: "Run one policy-approved REAPER action.",
      pack: "actions",
      risk: "write",
      entity_kind: "action",
      tags: ["action", "guarded"],
      bridge: bridge({ operation_family: "run_action", operation_name: "action.run", capability: "action.run" }),
      refs: refs({ input: [ref("action_ref", "marker", true)] }),
      expectedDelta: expectedDelta({
        summary: "Runs one action and reports compact refs.",
        entities: [{ entity_kind: "action", action: "update", summary: "Guarded action executes." }],
      }),
      pressureFixture: pressureFixture(["action_backed"]),
    }),
    makeDescriptor({
      id: "template.render.queue_stem_render",
      title: "Queue stem render",
      summary: "Use track refs to queue render-owned stem output.",
      pack: "render",
      risk: "write",
      entity_kind: "render_job",
      tags: ["render", "stems"],
      bridge: bridge({ operation_family: "run_job", operation_name: "render.stems", capability: "render.stems" }),
      refs: refs({ input: [ref("track_ref", "track", true)], output: [ref("job_ref", "job", true)] }),
      expectedDelta: expectedDelta({
        kind: "job",
        summary: "Render owns the output even though track refs are inputs.",
        entities: [{ entity_kind: "render_job", action: "start_job", summary: "Stem render job starts." }],
      }),
      pressureFixture: pressureFixture(["cross_domain_primary_owner"]),
    }),
    makeDescriptor({
      id: "template.automation.write_point_verified",
      title: "Write verified point",
      summary: "Insert one envelope point and verify the result.",
      pack: "automation",
      risk: "write",
      entity_kind: "automation_point",
      tags: ["automation", "verify"],
      refs: refs({ input: [ref("envelope_ref", "envelope", true)] }),
      expectedDelta: expectedDelta({
        summary: "One automation point is inserted.",
        entities: [{ entity_kind: "automation_point", action: "create", summary: "Point appears in envelope." }],
      }),
      verification: verification({
        checks: [{ name: "point_exists", kind: "state_delta", summary: "Envelope point count increases by one." }],
      }),
      pressureFixture: pressureFixture(["verification_required"]),
    }),
    makeDescriptor({
      id: "template.tracks.ensure_named_track",
      title: "Ensure named track",
      summary: "Create or reuse a track by name with idempotency.",
      pack: "tracks",
      risk: "write",
      entity_kind: "track",
      tags: ["track", "idempotent"],
      bridge: bridge({ idempotency: "required" }),
      refs: refs({ output: [ref("track_ref", "track", true)] }),
      expectedDelta: expectedDelta({
        summary: "A named track exists exactly once.",
        entities: [{ entity_kind: "track", action: "create", summary: "Track is created only when missing." }],
        idempotent: true,
      }),
      pressureFixture: pressureFixture(["idempotent_mutation"]),
    }),
    makeDescriptor({
      id: "template.routing.inspect_send_graph",
      title: "Inspect send graph",
      summary: "Read a compact send graph from many typed refs.",
      pack: "routing",
      risk: "read",
      entity_kind: "send",
      tags: ["routing", "refs"],
      bridge: bridge({
        operation_family: "query_state",
        operation_name: "routing.send_graph",
        capability: "routing.send_graph",
        idempotency: "none",
      }),
      refs: refs({
        input: [
          ref("project_ref", "project", true),
          ref("track_ref", "track", true),
          ref("send_ref", "send", false),
          ref("receive_ref", "send", false),
          ref("fx_ref", "fx", false),
          ref("envelope_ref", "envelope", false),
          ref("marker_ref", "marker", false),
          ref("region_ref", "region", false),
          ref("file_ref", "file", false),
          ref("artifact_ref", "artifact", false),
        ],
        output: [ref("send_graph_ref", "artifact", true)],
      }),
      expectedDelta: expectedDelta({
        kind: "read",
        summary: "Reads routing refs and returns compact metadata.",
        entities: [{ entity_kind: "send", action: "read", summary: "Send graph is inspected." }],
        idempotent: true,
      }),
      verification: verification({ mode: "none", checks: [] }),
      pressureFixture: pressureFixture(["ref_heavy"]),
    }),
    makeDescriptor({
      id: "template.project.describe_selection",
      title: "Describe selection",
      summary: "Expose compact discovery while keeping schemas on demand.",
      pack: "project",
      risk: "read",
      entity_kind: "project",
      tags: ["project", "discovery"],
      bridge: bridge({
        operation_family: "query_state",
        operation_name: "project.selection",
        capability: "project.selection",
        idempotency: "none",
      }),
      expectedDelta: expectedDelta({
        kind: "read",
        summary: "Reads selection state for discovery split pressure.",
        entities: [{ entity_kind: "project", action: "read", summary: "Project selection state is read." }],
        idempotent: true,
      }),
      verification: verification({ mode: "none", checks: [] }),
      examples: [
        {
          name: "compact_menu",
          summary: "The menu stays compact.",
          input: { include_schemas: false },
        },
      ],
      pressureFixture: pressureFixture(["compact_discovery_full_descriptor_split"]),
    }),
  ];
}

function makeDescriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.tracks.create_track",
    title: "Create track",
    summary: "Create one new track and return its compact track ref.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "create"],
    bridge: bridge(),
    inputSchema: objectSchema({
      name: { type: "string" },
    }, ["name"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
    }, ["track_ref"]),
    refs: refs({ output: [ref("track_ref", "track", true)] }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta(),
    verification: verification(),
    examples: [
      {
        name: "create_named_track",
        summary: "Create a track named Dialog.",
        input: { name: "Dialog" },
      },
    ],
    pressureFixture: pressureFixture(["simple_write"]),
    ...overrides,
  };
}

function makeNearBudgetDescriptor() {
  const descriptor = makeDescriptor({
    id: "template.analysis.large_descriptor_pressure",
    title: "Large descriptor pressure",
    summary: "Large descriptor pressure test.",
    pack: "analysis",
    risk: "read",
    entity_kind: "analysis_artifact",
    tags: ["analysis", "pressure"],
    bridge: bridge({ operation_family: "run_job", operation_name: "analysis.large", capability: "analysis.large" }),
    inputSchema: objectSchema({
      payload: { type: "string", const: "i".repeat(3_600) },
    }),
    outputSchema: objectSchema({
      payload: { type: "string", const: "o".repeat(3_600) },
    }),
    refs: refs({
      input: Array.from({ length: 8 }, (_, index) =>
        ref(`input_ref_${index}`, "item", index === 0, "i".repeat(150)),
      ),
      output: Array.from({ length: 8 }, (_, index) =>
        ref(`output_ref_${index}`, "artifact", index === 0, "o".repeat(150)),
      ),
    }),
    artifacts: artifacts({
      mode: "produces",
      output: Array.from({ length: 8 }, (_, index) =>
        artifact(`artifact_${index}`, "analysis.large.v1", "analysis", "a".repeat(150)),
      ),
    }),
    expectedDelta: expectedDelta({
      kind: "artifact",
      summary: "e".repeat(200),
      entities: Array.from({ length: 8 }, (_, index) => ({
        entity_kind: `analysis_artifact_${index}`,
        action: "emit",
        summary: "d".repeat(150),
      })),
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: Array.from({ length: 3 }, (_, index) => ({
      name: `example_${index}`,
      summary: "s".repeat(150),
      input: { payload: "x".repeat(650) },
    })),
    pressureFixture: pressureFixture(["compact_discovery_full_descriptor_split"], "p".repeat(220)),
  });

  return descriptor;
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
    summary: "Creates one track and returns a compact track ref.",
    entities: [
      {
        entity_kind: "track",
        action: "create",
        summary: "One track is created.",
      },
    ],
    idempotent: false,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    mode: "required",
    checks: [
      {
        name: "track_exists",
        kind: "state_delta",
        summary: "A track ref exists after the mutation.",
      },
    ],
    ...overrides,
  };
}

function pressureFixture(categories, notes = "ABI pressure fixture only; not an official template.") {
  return {
    categories,
    notes,
  };
}
