import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import { executeTemplate } from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  templateRefExample,
  templateRefExampleGuidance,
} from "../../packages/core/src/template-ref-guidance-v1.mjs";
import {
  WAVE1A_PROJECT_TEMPLATE_IDS,
  WAVE1A_PROJECT_TEMPLATES,
} from "../../packages/core/src/template-packs/wave1a-project-templates-v1.mjs";
import {
  WAVE1A_TRACKS_TEMPLATE_IDS,
  WAVE1A_TRACKS_TEMPLATES,
} from "../../packages/core/src/template-packs/wave1a-tracks-templates-v1.mjs";
import { WAVE2A_MIDI_TEMPLATES } from "../../packages/core/src/template-packs/wave2a-midi-templates-v1.mjs";
import { createCallTemplateRuntime } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { listTemplates } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const STDIO_SERVER = "packages/mcp-server/src/openreaper-mcp-stdio.mjs";
const REPO_BRIDGE_SCRIPT_PATH = path.resolve("reaper/bridge/openreaper-live-bridge.lua");
const EXACT_TOOLS = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];
const context = () => ({
  client_id: "alpha32-c2-test",
  session_id: "alpha32-c2-session",
  expected_owner: "openreaper-alpha",
  expected_generation: 1,
  created_at: "2026-07-11T06:00:00.000Z",
  request_sequence: 1,
});

function descriptor(id, catalog) {
  return catalog.find((entry) => entry.id === id);
}

function parseToolJson(response) {
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

async function respondToNextBridgeRequest(transportDir, bridge) {
  const requestsDir = path.join(transportDir, "requests");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const files = (await readdir(requestsDir)).filter((file) => file.endsWith(".json"));
    if (files.length > 0) {
      const request = JSON.parse(await readFile(path.join(requestsDir, files[0]), "utf8"));
      const result = bridge.dispatch(request);
      await writeFile(path.join(transportDir, "results", files[0]), `${JSON.stringify(result)}\n`, "utf8");
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for C2 stdio bridge request");
}

describe("Alpha3.2-C2 repairable refs", () => {
  it("provides bounded handler-truth examples for common ref kinds", () => {
    assert.deepEqual(templateRefExample("project"), {
      kind: "project", ref: "project:current", identity: { scheme: "current", value: "current" },
    });
    assert.equal(templateRefExample("track").identity.scheme, "guid");
    assert.equal(templateRefExample("track", { fallback: true }).ref, "track:index:0");
    assert.equal(templateRefExample("item").ref, "item:guid:{ITEM-GUID}");
    assert.equal(templateRefExample("take").ref, "take:guid:{TAKE-GUID}");
    assert.deepEqual(templateRefExample("fx"), {
      kind: "fx",
      ref: "fx:track:guid:{TRACK-GUID}:0",
      identity: { scheme: "track_fx", value: "track:guid:{TRACK-GUID}:0" },
    });
    assert.equal(templateRefExample("marker").ref, "marker:index:1");
    assert.equal(templateRefExample("region").ref, "region:index:1");
    assert.equal(templateRefExample("file").identity.value, "/absolute/path/to/audio.wav");
    for (const kind of ["track", "item", "take"]) {
      const replacement = templateRefExampleGuidance(kind).replacement;
      assert.match(replacement, /current-view positional selector only/u);
      assert.match(replacement, /re-resolve/u);
      assert.match(replacement, /GUID for stable operations/u);
    }
  });

  it("keeps legacy errors and adds bounded repair data for keyed and malformed refs", async () => {
    const rename = descriptor(WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack, WAVE1A_TRACKS_TEMPLATES);
    const missing = await executeTemplate({
      descriptor: rename,
      input: { name: "Renamed" },
      refs: {},
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "TEMPLATE_REFS_INVALID");
    assert.deepEqual(missing.error.details.errors, ["refs.track_ref is required."]);
    assert.deepEqual(missing.error.details.missing_refs, ["track_ref"]);
    assert.deepEqual(missing.error.details.accepted_input_forms, ["object_ref_array", "descriptor_keyed_object"]);
    assert.equal(missing.error.details.expected_refs.length, 1);
    assert.equal(missing.error.details.expected_refs[0].name, "track_ref");
    assert.equal(missing.error.details.expected_refs[0].example_status, "structural_placeholder_not_live_resolved");
    assert.match(missing.error.details.expected_refs[0].replacement, /resolver or query/u);
    assert.match(missing.error.details.next_action, /retry/u);
    assert.ok(JSON.stringify(missing.error.details).length < 4_096);

    const malformed = await executeTemplate({
      descriptor: rename,
      input: { name: "Renamed" },
      refs: "track:index:0",
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.deepEqual(malformed.error.details.errors, [
      "refs must be an array of object refs or an object keyed by descriptor ref name.",
    ]);
    assert.deepEqual(malformed.error.details.missing_refs, ["track_ref"]);

    const wrongKind = await executeTemplate({
      descriptor: rename,
      input: { name: "Renamed" },
      refs: { track_ref: templateRefExample("project") },
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(wrongKind.error.details.errors.includes("refs.track_ref must be a track ref."), true);
    assert.deepEqual(wrongKind.error.details.missing_refs, ["track_ref"]);

    const unknownName = await executeTemplate({
      descriptor: rename,
      input: { name: "Renamed" },
      refs: {
        track_ref: templateRefExample("track", { fallback: true }),
        unexpected_ref: templateRefExample("track", { fallback: true }),
      },
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.deepEqual(unknownName.error.details.errors, [
      "refs.unexpected_ref is not declared by descriptor.refs.input.",
    ]);
    assert.deepEqual(unknownName.error.details.missing_refs, []);
  });

  it("rejects an item GUID wrapped as a take ref before the MIDI bridge dispatch", async () => {
    const midiRead = descriptor("template.midi.read_take_event_counts", WAVE2A_MIDI_TEMPLATES);
    const bridge = new FakeFoundationBridge();
    const result = await executeTemplate({
      descriptor: midiRead,
      input: {},
      refs: {
        take_ref: {
          kind: "take",
          ref: "item:guid:{ITEM-GUID}",
          identity: { scheme: "guid", value: "{ITEM-GUID}" },
        },
      },
      context: context(),
      executor: bridge,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(result.error.details.errors.includes("refs.take_ref.ref must start with take:."), true);
    assert.equal(bridge.seen.length, 0);
  });

  it("bounds unknown-key error floods and overlong UTF-8 keys without changing rejection", async () => {
    const rename = descriptor(WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack, WAVE1A_TRACKS_TEMPLATES);
    const validTrack = templateRefExample("track", { fallback: true });
    const floodedRefs = { track_ref: validTrack };
    for (let index = 0; index < 5_000; index += 1) {
      floodedRefs[`unknown_${String(index).padStart(4, "0")}`] = validTrack;
    }
    const flooded = await executeTemplate({
      descriptor: rename,
      input: { name: "Renamed" },
      refs: floodedRefs,
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(flooded.ok, false);
    assert.equal(flooded.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(flooded.error.details.errors.length, 16);
    assert.equal(
      flooded.error.details.errors[0],
      "refs.unknown_0000 is not declared by descriptor.refs.input.",
    );
    assert.equal(flooded.error.details.guidance_budget.max_errors, 16);
    assert.equal(flooded.error.details.guidance_budget.max_error_length, 512);
    assert.equal(flooded.error.details.guidance_budget.max_error_utf8_bytes, 512);
    assert.equal(flooded.error.details.guidance_budget.errors_truncated, true);
    assert.equal(flooded.error.details.guidance_budget.omitted_errors, 4_984);
    assert.equal(flooded.error.details.guidance_budget.truncated_error_strings, 0);
    assert.equal(flooded.error.details.expected_refs[0].name, "track_ref");
    assert.match(flooded.error.details.next_action, /retry/u);
    assert.ok(Buffer.byteLength(JSON.stringify(flooded), "utf8") < 16_384);

    const longKey = `unknown_${"界".repeat(20_000)}`;
    const overlong = await executeTemplate({
      descriptor: rename,
      input: { name: "Renamed" },
      refs: { track_ref: validTrack, [longKey]: validTrack },
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    const [boundedError] = overlong.error.details.errors;
    assert.equal(overlong.ok, false);
    assert.equal(overlong.error.code, "TEMPLATE_REFS_INVALID");
    assert.match(boundedError, /^refs\.unknown_/u);
    assert.match(boundedError, /…$/u);
    assert.ok([...boundedError].length <= 512);
    assert.ok(Buffer.byteLength(boundedError, "utf8") <= 512);
    assert.equal(overlong.error.details.guidance_budget.errors_truncated, true);
    assert.equal(overlong.error.details.guidance_budget.omitted_errors, 0);
    assert.equal(overlong.error.details.guidance_budget.truncated_error_strings, 1);
    assert.equal(overlong.error.details.expected_refs[0].name, "track_ref");
    assert.ok(Buffer.byteLength(JSON.stringify(overlong), "utf8") < 8_192);
  });

  it("preserves same-kind role names and array failure compatibility", async () => {
    const twoRoleDescriptor = structuredClone(
      descriptor(WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack, WAVE1A_TRACKS_TEMPLATES),
    );
    twoRoleDescriptor.id = "template.tracks.move_between_tracks";
    twoRoleDescriptor.refs.input = [
      { name: "source_track_ref", kind: "track", required: true, summary: "Source." },
      { name: "destination_track_ref", kind: "track", required: true, summary: "Destination." },
    ];
    const result = await executeTemplate({
      descriptor: twoRoleDescriptor,
      input: { name: "Renamed" },
      refs: [templateRefExample("track", { fallback: true })],
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.deepEqual(result.error.details.errors, ["refs must include at least 2 required track ref(s)."]);
    assert.deepEqual(result.error.details.expected_refs.map((entry) => entry.name), [
      "source_track_ref", "destination_track_ref",
    ]);
    assert.deepEqual(result.error.details.missing_refs, ["destination_track_ref"]);

    for (const [label, malformedRef, expectedError] of [
      ["empty ref", { kind: "track", ref: "", identity: { scheme: "index", value: "0" } }, "refs[0].ref must be a non-empty string."],
      ["empty scheme", { kind: "track", ref: "track:index:0", identity: { scheme: "", value: "0" } }, "refs[0].identity.scheme must be a non-empty string."],
      ["empty value", { kind: "track", ref: "track:index:0", identity: { scheme: "index", value: "" } }, "refs[0].identity.value must be a non-empty string."],
    ]) {
      const malformed = await executeTemplate({
        descriptor: descriptor(WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack, WAVE1A_TRACKS_TEMPLATES),
        input: { name: label },
        refs: [malformedRef],
        context: context(),
        executor: new FakeFoundationBridge(),
      });
      assert.equal(malformed.error.details.errors.includes(expectedError), true, label);
      assert.deepEqual(malformed.error.details.missing_refs, ["track_ref"], label);
    }

    const validTrack = templateRefExample("track", { fallback: true });
    const oneMalformed = await executeTemplate({
      descriptor: twoRoleDescriptor,
      input: { name: "Renamed" },
      refs: [
        validTrack,
        { kind: "track", ref: "", identity: { scheme: "index", value: "1" } },
      ],
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.deepEqual(oneMalformed.error.details.missing_refs, ["destination_track_ref"]);

    const validArray = await executeTemplate({
      descriptor: twoRoleDescriptor,
      input: { name: "Renamed" },
      refs: [validTrack, { kind: "track", ref: "track:index:1", identity: { scheme: "index", value: "1" } }],
      context: context(),
      executor: new FakeFoundationBridge({ owner: "openreaper-alpha", generation: 1 }),
    });
    assert.notEqual(validArray.error?.code, "TEMPLATE_REFS_INVALID");
  });

  it("emits descriptor-keyed discovery examples that pass unchanged harness validation", async () => {
    const runtime = createCallTemplateRuntime({ executor: new FakeFoundationBridge() });
    const exact = runtime.list_templates({
      ids: [WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack],
      fields: ["id"],
    });
    const refs = exact.items[0].capability_truth.example_call_shape.request.refs;
    assert.deepEqual(Object.keys(refs), ["track_ref"]);
    assert.equal(refs.track_ref.kind, "track");
    assert.equal("name" in refs.track_ref, false);
    const result = await executeTemplate({
      descriptor: descriptor(WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack, WAVE1A_TRACKS_TEMPLATES),
      input: { name: "Renamed" },
      refs,
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(result.error?.code === "TEMPLATE_REFS_INVALID", false);
  });

  it("publishes bounded sibling placeholder truth for track, fx, file, and project discovery", () => {
    const runtime = createCallTemplateRuntime({ executor: new FakeFoundationBridge() });
    const exact = runtime.list_templates({
      ids: [
        WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack,
        "template.fx.read_fx_parameter",
        "template.media.import_file_to_track",
      ],
      fields: ["id"],
    });
    const byId = new Map(exact.items.map((item) => [item.id, item]));

    const trackShape = byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack)
      .capability_truth.example_call_shape;
    assert.equal(Object.hasOwn(trackShape.request.refs.track_ref, "example_status"), false);
    assert.equal(trackShape.ref_example_guidance.track_ref.status, "structural_placeholder_not_live_resolved");
    assert.deepEqual(trackShape.ref_example_guidance.track_ref.replace_fields, ["ref", "identity.value"]);
    assert.equal(trackShape.ref_example_guidance.track_ref.recommended_sources.includes("resolver_template_result"), true);
    assert.match(trackShape.ref_example_guidance.track_ref.replacement, /ref and identity\.value/u);

    const fxShape = byId.get("template.fx.read_fx_parameter").capability_truth.example_call_shape;
    assert.equal(fxShape.request.refs.fx_ref.ref, "fx:track:guid:{TRACK-GUID}:0");
    assert.equal(fxShape.ref_example_guidance.fx_ref.status, "structural_placeholder_not_live_resolved");
    assert.deepEqual(fxShape.ref_example_guidance.fx_ref.replace_fields, ["ref", "identity.value"]);
    assert.equal(fxShape.ref_example_guidance.fx_ref.recommended_sources.includes("query_template_result"), true);

    const fileShape = byId.get("template.media.import_file_to_track").capability_truth.example_call_shape;
    assert.equal(fileShape.request.refs.source_file_ref.ref, "file:path:/absolute/path/to/audio.wav");
    assert.equal(fileShape.ref_example_guidance.source_file_ref.status, "structural_placeholder_not_live_resolved");
    assert.deepEqual(fileShape.ref_example_guidance.source_file_ref.replace_fields, ["ref", "identity.value"]);
    assert.equal(fileShape.ref_example_guidance.source_file_ref.recommended_sources.includes("real_absolute_path"), true);

    const projectDescriptor = structuredClone(
      descriptor(WAVE1A_PROJECT_TEMPLATE_IDS.readSummary, WAVE1A_PROJECT_TEMPLATES),
    );
    projectDescriptor.refs.input = [
      { name: "project_ref", kind: "project", required: true, summary: "Current project." },
    ];
    const projectShape = listTemplates(
      { ids: [projectDescriptor.id], fields: ["id", "capability_truth"] },
      [projectDescriptor],
    ).items[0].capability_truth.example_call_shape;
    assert.deepEqual(projectShape.request.refs.project_ref, templateRefExample("project"));
    assert.equal(projectShape.ref_example_guidance.project_ref.status, "current_project_literal_no_replacement_needed");
    assert.deepEqual(projectShape.ref_example_guidance.project_ref.replace_fields, []);
    assert.deepEqual(projectShape.ref_example_guidance.project_ref.recommended_sources, ["current_project_literal"]);
    assert.match(projectShape.ref_example_guidance.project_ref.replacement, /No replacement is needed/u);
    assert.ok(Buffer.byteLength(JSON.stringify(projectShape.ref_example_guidance), "utf8") < 4_096);
  });

  it("normalizes only project:current inference to scheme current and corrects marker/region wording", async () => {
    const projectRead = descriptor(WAVE1A_PROJECT_TEMPLATE_IDS.readSummary, WAVE1A_PROJECT_TEMPLATES);
    const bridge = new FakeFoundationBridge({ owner: "openreaper-alpha", generation: 1 });
    const result = await executeTemplate({
      descriptor: projectRead,
      input: {},
      context: context(),
      executor: (request) => {
        const response = structuredClone(bridge.dispatch(request));
        response.result.summary = { project_ref: "project:current", custom_ref: "project:alias:other" };
        return response;
      },
    });
    assert.equal(result.result.refs.find((entry) => entry.ref === "project:current")?.identity.scheme, "current");
    assert.equal(result.result.refs.find((entry) => entry.ref === "project:alias:other")?.identity.scheme, "alias");

    const markerRegion = descriptor(WAVE1A_PROJECT_TEMPLATE_IDS.listMarkersRegions, WAVE1A_PROJECT_TEMPLATES);
    assert.match(JSON.stringify(markerRegion), /index-number/u);
    assert.doesNotMatch(JSON.stringify(markerRegion.refs.output), /GUID/u);
    const createMarker = descriptor(WAVE1A_PROJECT_TEMPLATE_IDS.createMarker, WAVE1A_PROJECT_TEMPLATES);
    const createRegion = descriptor(WAVE1A_PROJECT_TEMPLATE_IDS.createRegion, WAVE1A_PROJECT_TEMPLATES);
    assert.doesNotMatch(JSON.stringify([createMarker, createRegion]), /GUID-backed/u);
    assert.match(JSON.stringify([createMarker, createRegion]), /index-number/u);
  });

  it("accepts keyed refs through actual stdio while preserving the exact six-tool surface", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openreaper-alpha32c2-stdio-"));
    const transportDir = path.join(root, "transport");
    await mkdir(path.join(transportDir, "requests"), { recursive: true });
    await mkdir(path.join(transportDir, "results"), { recursive: true });
    await writeFile(
      path.join(transportDir, "openreaper-bridge-liveness-v1.json"),
      `${JSON.stringify({
        contract: "openreaper.bridge_liveness.v1",
        active_owner: "openreaper-alpha",
        active_generation: 1,
        sequence: 1,
        refreshed_at_unix_s: Math.floor(Date.now() / 1000),
        interval_ms: 500,
      })}\n`,
      "utf8",
    );
    const client = new Client({ name: "alpha32-c2-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      env: {
        ...process.env,
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
        OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: REPO_BRIDGE_SCRIPT_PATH,
        OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual((tools.tools ?? []).map((entry) => entry.name).sort(), EXACT_TOOLS);
      const schema = tools.tools.find((entry) => entry.name === "call_template")?.inputSchema?.properties?.refs;
      assert.equal(Array.isArray(schema?.anyOf), true);
      assert.equal(schema.anyOf.length, 2);
      const bridge = new FakeFoundationBridge({ owner: "openreaper-alpha", generation: 1 });
      const call = client.callTool({
        name: "call_template",
        arguments: {
          id: WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack,
          input: { name: "Renamed" },
          refs: { track_ref: templateRefExample("track", { fallback: true }) },
        },
      });
      const observed = respondToNextBridgeRequest(transportDir, bridge);
      const [response, request] = await Promise.all([call, observed]);
      assert.equal(parseToolJson(response).ok, true);
      assert.equal(request.refs[0].ref, "track:index:0");

      const repair = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack, input: { name: "Renamed" }, refs: {} },
      }));
      assert.equal(repair.error.code, "TEMPLATE_REFS_INVALID");
      assert.deepEqual(repair.error.details.missing_refs, ["track_ref"]);
    } finally {
      await client.close?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});
