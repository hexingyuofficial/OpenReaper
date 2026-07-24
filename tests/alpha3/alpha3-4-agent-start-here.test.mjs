import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  createAlpha3_3B1ExactMacroExpansion,
} from "../../packages/mcp-server/src/alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  OPENREAPER_AGENT_FIRST_ROUND_FLOW,
  OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN,
  OPENREAPER_AGENT_START_HERE_COMPACT_END,
  OPENREAPER_AGENT_START_HERE_DOCUMENT,
  OPENREAPER_AGENT_START_HERE_MAX_UTF8_BYTES,
  OPENREAPER_FLAT_FIFTEEN_MACRO_IDS,
  OPENREAPER_PUBLIC_TOOL_IDS,
  createOpenReaperMcpInitializationInstructions,
  extractOpenReaperAgentStartHereCompactSection,
  loadOpenReaperAgentStartHereProjection,
} from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import {
  createOpenReaperAgentStartupGuidance,
} from "../../packages/mcp-server/src/openreaper-agent-startup-guidance-v1.mjs";
import {
  INSTALLED_CANARY_REQUIRED_MACROS,
  captureInstalledCanaryInstructions,
} from "../../scripts/smoke-alpha3-4-harness-installed-canary.mjs";
import {
  planAlpha3_2EProjectInspectMacro,
} from "../../packages/mcp-server/src/alpha3-2e-small-macro-spine-v1.mjs";
import {
  adaptAlpha3_3B1CanonicalExecutionRequest,
  alpha3_3B1ExecutorSourceId,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  validateMacroProgramRequest,
} from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
import {
  ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY,
} from "../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
import {
  ALPHA3_2_5_D_NATIVE_FX_REGISTRY,
} from "../../packages/mcp-server/src/alpha3-2-5-d-fx-macro-v1.mjs";
import {
  ALPHA3_2_5_C_PROJECT_FILE_REGISTRY,
} from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import {
  ALPHA3_2_5_D_MIDI_MACRO_REGISTRY,
} from "../../packages/mcp-server/src/alpha3-2-5-d-midi-macro-v1.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC_PATH = path.join(REPO, "docs/AGENT_START_HERE.md");
const STDIO_PATH = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const PACKAGE_BUILDER = path.join(REPO, "scripts/package-openreaper-alpha.mjs");
const CANARY_PATH = path.join(REPO, "scripts/smoke-alpha3-4-harness-installed-canary.mjs");

const APPROVED_EXAMPLES = Object.freeze([
  { tool: "ping", args: {} },
  { tool: "list_templates", args: { query: "create a MIDI clip and add a compressor", limit: 25 } },
  { tool: "list_templates", args: { ids: ["macro.midi.apply"], fields: ["id", "inputSchema"] } },
  {
    tool: "call_template",
    args: {
      id: "macro.project.inspect",
      input: {
        include: ["project_path", "dirty_state", "markers_regions"],
        fields_by_scope: { markers_regions: ["ref", "name", "position_seconds"] },
        limit: 25,
        compact_response: true,
        ref_policy: "canonical_only",
      },
    },
  },
  {
    tool: "call_template",
    args: {
      id: "macro.midi.apply",
      input: {
        mode: "create_clips",
        start_seconds: 0,
        duration_quarter_notes: 4,
        notes: [
          { start_offset_quarter_notes: 0, end_offset_quarter_notes: 1, pitch: 60, velocity: 96, channel: 0 },
          { start_offset_quarter_notes: 1, end_offset_quarter_notes: 2, pitch: 62, velocity: 96, channel: 0 },
          { start_offset_quarter_notes: 2, end_offset_quarter_notes: 3, pitch: 64, velocity: 96, channel: 0 },
          { start_offset_quarter_notes: 3, end_offset_quarter_notes: 4, pitch: 65, velocity: 96, channel: 0 },
        ],
        selector: { name: "Instrument" },
        dry_run: false,
      },
    },
  },
  {
    tool: "call_template",
    args: {
      id: "macro.items.apply",
      input: {
        mode: "set_properties",
        target: "selected",
        properties: { volume_db: -3 },
        dry_run: false,
      },
    },
  },
  {
    tool: "call_template",
    args: {
      id: "macro.fx.apply_chain",
      input: {
        plugin: "reacomp",
        controls: { threshold_db: -18, ratio: 3 },
        selector: { name: "Lead Vocal" },
        dry_run: false,
      },
    },
  },
  {
    tool: "call_template",
    args: {
      id: "macro.project.file",
      input: { operation: "save_current" },
    },
  },
]);

test("canonical AGENT_START_HERE markers project under 16 KiB with exact 15 Macros", async () => {
  const document = await readFile(DOC_PATH, "utf8");
  assert.match(document, new RegExp(OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(document, new RegExp(OPENREAPER_AGENT_START_HERE_COMPACT_END.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  const projection = loadOpenReaperAgentStartHereProjection({ document_path: DOC_PATH });
  assert.equal(projection.utf8_bytes <= OPENREAPER_AGENT_START_HERE_MAX_UTF8_BYTES, true);
  assert.deepEqual(projection.macro_ids, OPENREAPER_FLAT_FIFTEEN_MACRO_IDS);
  assert.deepEqual(projection.macro_ids, ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS);
  assert.deepEqual(projection.tool_ids, OPENREAPER_PUBLIC_TOOL_IDS);
  const instructions = createOpenReaperMcpInitializationInstructions({ document_path: DOC_PATH });
  assert.equal(instructions, projection.compact_text);
  assert.match(instructions, new RegExp(OPENREAPER_AGENT_FIRST_ROUND_FLOW.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  for (const macroId of OPENREAPER_FLAT_FIFTEEN_MACRO_IDS) assert.match(instructions, new RegExp(macroId.replace(/\./gu, "\\.")));
  const mentionedMacros = [...new Set(instructions.match(/\bmacro\.[a-z0-9_.]+\b/gu) ?? [])].sort();
  assert.deepEqual(mentionedMacros, [...OPENREAPER_FLAT_FIFTEEN_MACRO_IDS].sort());
  assert.match(instructions, /ping -> search the user's original words/u);
  assert.match(instructions, /Macro-first/u);
  assert.match(instructions, /cursor/u);
  assert.match(instructions, /get_state/u);
  assert.match(instructions, /openreaper-start/u);
  assert.match(instructions, /macro_recommendations/u);
  assert.match(instructions, /first_try_execution_guide/u);
  assert.match(instructions, /not a `fields` value/u);
  assert.match(instructions, /product_surface\.agent_context_macro_guide\.requested_expansions\.items/u);
  assert.match(instructions, /user-facing REAPER facts first/u);
  assert.match(instructions, /next_call/u);
  assert.doesNotMatch(instructions, /\{TRACK\}|\{TAKE\}|\{ITEM\}/u);
  assert.match(instructions, /call_recipe/u);
  assert.match(instructions, /validate -> save/u);
  assert.match(instructions, /temporary one-off/u);
  assert.match(instructions, /rediscovered after reconnect/u);
  assert.match(instructions, /one public `call_recipe` call/u);
  assert.match(instructions, /list_recipes/u);
  assert.match(instructions, /steps`, `assertions`, and `recovery/u);
  assert.match(instructions, /same general Recipe system/u);
  assert.match(instructions, /same validate\/save\/list\/get\/run\/reconnect, trust, evidence, and whole-Recipe/u);
  for (const id of [
    "recipe.mix.create_bus_processing",
    "recipe.midi.create_instrument_part",
    "recipe.media.create_layered_sound_effect_variants",
    "recipe.items.create_sound_variations",
  ]) assert.match(instructions, new RegExp(id.replaceAll(".", "\\.")));
  assert.match(instructions, /direct Template/u);
  assert.match(instructions, /inputSchema/u);
  assert.match(instructions, /expectedDelta/u);
  assert.match(instructions, /Exactly six tools/u);
  assert.match(instructions, /Raw Lua/u);
});

test("marker parser fails closed on missing, duplicate, order, and budget errors", () => {
  assert.throws(
    () => extractOpenReaperAgentStartHereCompactSection("no markers"),
    (error) => error.code === "AGENT_START_HERE_MARKER_MISSING",
  );
  assert.throws(
    () => extractOpenReaperAgentStartHereCompactSection(`${OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN}\nok\n${OPENREAPER_AGENT_START_HERE_COMPACT_END}\n${OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN}\nok2\n${OPENREAPER_AGENT_START_HERE_COMPACT_END}`),
    (error) => error.code === "AGENT_START_HERE_MARKER_DUPLICATE",
  );
  assert.throws(
    () => extractOpenReaperAgentStartHereCompactSection(`${OPENREAPER_AGENT_START_HERE_COMPACT_END}\nok\n${OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN}`),
    (error) => error.code === "AGENT_START_HERE_MARKER_ORDER_INVALID",
  );
  const huge = `${OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN}\n${"x".repeat(20_000)}\n${OPENREAPER_AGENT_START_HERE_COMPACT_END}`;
  assert.throws(
    () => extractOpenReaperAgentStartHereCompactSection(huge),
    (error) => error.code === "AGENT_START_HERE_COMPACT_BUDGET_EXCEEDED",
  );
});

test("startup guidance and installed canary use the canonical Start Here anchors", () => {
  const instructions = createOpenReaperMcpInitializationInstructions({ document_path: DOC_PATH });
  const guidance = createOpenReaperAgentStartupGuidance();
  assert.equal(guidance.agent_start_here, OPENREAPER_AGENT_START_HERE_DOCUMENT);
  assert.equal(guidance.first_round_flow, OPENREAPER_AGENT_FIRST_ROUND_FLOW);
  assert.equal(instructions.includes(guidance.first_round_flow), true);

  const captured = captureInstalledCanaryInstructions({ getInstructions: () => instructions });
  assert.equal(captured.macro_ids.length, 15);
  assert.deepEqual(captured.macro_ids, [...INSTALLED_CANARY_REQUIRED_MACROS]);
  assert.equal(captured.utf8_bytes <= 16_384, true);
  assert.throws(
    () => captureInstalledCanaryInstructions({}),
    (error) => error.code === "CANARY_INSTRUCTIONS_API_MISSING",
  );
  assert.throws(
    () => captureInstalledCanaryInstructions({ getInstructions: () => "" }),
    (error) => error.code === "CANARY_INSTRUCTIONS_MISSING",
  );
});

test("MIDI create_clips manual truth keeps mode after spread and examples include mode", () => {
  const expansion = createAlpha3_3B1ExactMacroExpansion("macro.midi.apply");
  assert.match(expansion.action_manual.input_shape.mode, /create_clips/u);
  assert.match(expansion.action_manual.input_shape.mode, /edit_notes/u);
  assert.equal(Object.keys(expansion.action_manual.input_shape).includes("create_clips"), true);
  const createExample = expansion.action_manual.examples.find((entry) => entry?.input?.mode === "create_clips" || entry?.input?.notes);
  assert.ok(createExample);
  assert.equal(createExample.input.mode, "create_clips");
});

test("approved eight examples validate against current public schemas", () => {
  const runtime = createCallTemplateRuntime();
  const listed = runtime.list_templates({ query: "create a MIDI clip and add a compressor", limit: 25 });
  assert.equal(listed.ok !== false, true);
  assert.ok(Array.isArray(listed.items));

  const exact = runtime.list_templates({ ids: ["macro.midi.apply"], fields: ["id", "inputSchema"] });
  assert.equal(exact.items[0].id, "macro.midi.apply");
  assert.ok(exact.items[0].inputSchema);

  const inspect = APPROVED_EXAMPLES.find((entry) => entry.args.id === "macro.project.inspect");
  const inspectPlan = planAlpha3_2EProjectInspectMacro(inspect.args.input);
  assert.equal(inspectPlan.ok, true, JSON.stringify(inspectPlan.blockers ?? inspectPlan));

  const midi = APPROVED_EXAMPLES.find((entry) => entry.args.id === "macro.midi.apply");
  const adapted = adaptAlpha3_3B1CanonicalExecutionRequest(midi.args);
  assert.equal(adapted.ok, true, JSON.stringify(adapted));
  assert.equal(adapted.executor_id, "macro.midi.create_clip");
  const midiValidation = validateMacroProgramRequest({
    macro_id: adapted.executor_id,
    input: adapted.request.input,
    refs: {},
    dry_run: adapted.request.input.dry_run,
  }, { registry: ALPHA3_2_5_D_MIDI_MACRO_REGISTRY });
  assert.equal(midiValidation.valid, true, JSON.stringify(midiValidation));

  const items = APPROVED_EXAMPLES.find((entry) => entry.args.id === "macro.items.apply");
  const itemsValidation = validateMacroProgramRequest({
    macro_id: "macro.items.apply",
    input: items.args.input,
    refs: {},
    dry_run: items.args.input.dry_run,
  }, { registry: ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY });
  assert.equal(itemsValidation.valid, true, JSON.stringify(itemsValidation));

  const fx = APPROVED_EXAMPLES.find((entry) => entry.args.id === "macro.fx.apply_chain");
  const fxValidation = validateMacroProgramRequest({
    macro_id: alpha3_3B1ExecutorSourceId("macro.fx.apply_chain"),
    input: fx.args.input,
    refs: {},
    dry_run: fx.args.input.dry_run,
  }, { registry: ALPHA3_2_5_D_NATIVE_FX_REGISTRY });
  assert.equal(fxValidation.valid, true, JSON.stringify(fxValidation));

  const file = APPROVED_EXAMPLES.find((entry) => entry.args.id === "macro.project.file");
  const fileValidation = validateMacroProgramRequest({
    macro_id: "macro.project.file",
    input: file.args.input,
    refs: {},
    dry_run: false,
  }, { registry: ALPHA3_2_5_C_PROJECT_FILE_REGISTRY });
  assert.equal(fileValidation.valid, true, JSON.stringify(fileValidation));

  const document = loadOpenReaperAgentStartHereProjection({ document_path: DOC_PATH }).compact_text;
  for (const example of APPROVED_EXAMPLES) {
    if (example.tool === "ping") {
      assert.match(document, /ping \{\}/u);
      continue;
    }
    const serialized = JSON.stringify(example.args);
    assert.equal(document.includes(serialized), true, serialized);
  }
});

test("stdio wires exactly six tools and SDK instructions from the unique document", async () => {
  const stdio = await readFile(STDIO_PATH, "utf8");
  assert.match(stdio, /new McpServer\(\{\s*name: "openreaper",\s*version: VERSION,\s*\}, \{\s*instructions: initializationInstructions,\s*\}\)/su);
  assert.match(stdio, /createOpenReaperMcpInitializationInstructions/u);
  assert.match(stdio, /docs\/AGENT_START_HERE\.md/u);
  for (const tool of OPENREAPER_PUBLIC_TOOL_IDS) {
    assert.match(stdio, new RegExp(`"${tool}"`));
  }
  assert.equal((stdio.match(/server\.tool\(/gu) ?? []).length, 6);
  assert.match(stdio, /call_recipe/u);

  const instructions = createOpenReaperMcpInitializationInstructions({ document_path: DOC_PATH });
  const server = new McpServer({ name: "openreaper", version: "0.3.0-alpha" }, { instructions });
  for (const tool of OPENREAPER_PUBLIC_TOOL_IDS) {
    server.tool(tool, `test ${tool}`, {}, async () => ({ content: [{ type: "text", text: "{}" }] }));
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "alpha34-start-here", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((entry) => entry.name).sort(), [...OPENREAPER_PUBLIC_TOOL_IDS].sort());
  assert.equal(client.getInstructions(), instructions);
  assert.equal(Buffer.byteLength(client.getInstructions(), "utf8") <= 16_384, true);
  await client.close();
  await server.close();
});

test("package builder copies the unique Agent entry and the user guide", async () => {
  const builder = await readFile(PACKAGE_BUILDER, "utf8");
  assert.match(builder, /copyAgentStartHereDocument/u);
  assert.match(builder, /vendor\/openreaper-kernel\/docs\/AGENT_START_HERE\.md/u);
  assert.match(builder, /docs\/AGENT_START_HERE\.md/u);
  assert.match(builder, /Agent entry \(unique\):/u);
  assert.match(builder, /MCP initialization instructions are projected from that document/u);
  assert.match(builder, /docs\/USER_GUIDE\.md/u);
  assert.match(builder, /User guide:/u);

  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-start-here-pkg-"));
  try {
    const source = await readFile(DOC_PATH);
    const kernelDocs = path.join(root, "vendor", "openreaper-kernel", "docs");
    const packageDocs = path.join(root, "docs");
    await mkdir(kernelDocs, { recursive: true });
    await mkdir(packageDocs, { recursive: true });
    await writeFile(path.join(kernelDocs, "AGENT_START_HERE.md"), source);
    await writeFile(path.join(packageDocs, "AGENT_START_HERE.md"), source);
    const a = await readFile(path.join(kernelDocs, "AGENT_START_HERE.md"));
    const b = await readFile(path.join(packageDocs, "AGENT_START_HERE.md"));
    assert.equal(Buffer.compare(a, b), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed canary captures getInstructions without counting it as a tool call", async () => {
  const canary = await readFile(CANARY_PATH, "utf8");
  assert.match(canary, /captureInstalledCanaryInstructions/u);
  assert.match(canary, /getInstructions/u);
  assert.match(canary, /report\.calls\.length === 2/u);
  assert.equal((canary.match(/tool: "ping"/gu) ?? []).length, 1);
  assert.equal((canary.match(/template\.project\.read_summary/gu) ?? []).length, 1);
});
