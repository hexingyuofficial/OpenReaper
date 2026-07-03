import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_ACTIONS_TEMPLATE_IDS = Object.freeze([
  "template.actions.resolve_named_command",
  "template.actions.read_action_metadata",
  "template.actions.read_action_toggle_state",
  "template.actions.read_action_shortcuts",
  "template.actions.parse_marker_action_text",
  "template.actions.search_action_commands",
  "template.actions.read_custom_action_metadata",
  "template.actions.read_cycle_action_metadata",
]);

const ACTION_SECTION_ENUM = Object.freeze([
  "main",
  "midi_editor",
  "midi_event_list",
  "media_explorer",
  "crossfade_editor",
]);

export const WAVE2A_ACTIONS_TEMPLATES = deepFreeze([
  actionReadDescriptor({
    id: "template.actions.resolve_named_command",
    title: "Resolve named command",
    summary: "Resolve one named action command string to command-id metadata without executing the action.",
    entity_kind: "command_id",
    tags: ["actions", "command", "metadata"],
    operation_name: "actions.resolve_named_command",
    capability: "actions.resolve_named_command",
    inputProperties: {
      named_command: { type: "string" },
      section: { enum: ACTION_SECTION_ENUM },
    },
    requiredInput: ["named_command"],
    outputProperties: {
      named_command: { type: "string" },
      section: { type: "string" },
      resolved: { type: "boolean" },
      command_id: { type: "integer" },
      source: { enum: ["native", "custom", "extension", "unknown"] },
    },
    requiredOutput: ["named_command", "section", "resolved"],
    expectedSummary: "Reads named command resolution metadata without running an action.",
    expectedEntityKind: "command_id",
    expectedEntitySummary: "Named command metadata is resolved.",
    examples: [
      {
        name: "resolve_sws_command",
        summary: "Resolve an extension-style named command string.",
        input: { named_command: "_SWS_ABOUT", section: "main" },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.read_action_metadata",
    title: "Read action metadata",
    summary: "Read compact action metadata for one explicit section and command id without running it.",
    entity_kind: "action",
    tags: ["actions", "metadata", "read"],
    operation_name: "actions.read_action_metadata",
    capability: "actions.read_action_metadata",
    inputProperties: {
      section: { enum: ACTION_SECTION_ENUM },
      command_id: { type: "integer" },
      named_command: { type: "string" },
    },
    requiredInput: ["section", "command_id"],
    outputProperties: {
      section: { type: "string" },
      command_id: { type: "integer" },
      named_command: { type: "string" },
      display_name: { type: "string" },
      available: { type: "boolean" },
      source: { enum: ["native", "custom", "extension", "unknown"] },
    },
    requiredOutput: ["section", "available"],
    expectedSummary: "Reads one action metadata record without changing REAPER state.",
    expectedEntityKind: "action",
    expectedEntitySummary: "Action metadata is read.",
    examples: [
      {
        name: "read_main_action",
        summary: "Read metadata for a main-section command id.",
        input: { section: "main", command_id: 40044 },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.read_action_toggle_state",
    title: "Read action toggle state",
    summary: "Read section-aware action toggle state as metadata without toggling or executing the action.",
    entity_kind: "action",
    tags: ["actions", "toggle", "metadata"],
    operation_name: "actions.read_action_toggle_state",
    capability: "actions.read_action_toggle_state",
    inputProperties: {
      section: { enum: ACTION_SECTION_ENUM },
      command_id: { type: "integer" },
      named_command: { type: "string" },
    },
    requiredInput: ["section", "command_id"],
    outputProperties: {
      section: { type: "string" },
      command_id: { type: "integer" },
      state: { enum: ["on", "off", "not_applicable", "unknown"] },
      available: { type: "boolean" },
    },
    requiredOutput: ["section", "state", "available"],
    expectedSummary: "Reads action toggle metadata without mutating action state.",
    expectedEntityKind: "action",
    expectedEntitySummary: "Action toggle state metadata is read.",
    examples: [
      {
        name: "read_toggle_state",
        summary: "Read a main-section action toggle state.",
        input: { section: "main", command_id: 40364 },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.read_action_shortcuts",
    title: "Read action shortcuts",
    summary: "Read bounded shortcut descriptions for one section command without editing keymaps.",
    entity_kind: "action",
    tags: ["actions", "shortcut", "metadata"],
    operation_name: "actions.read_action_shortcuts",
    capability: "actions.read_action_shortcuts",
    inputProperties: {
      section: { enum: ACTION_SECTION_ENUM },
      command_id: { type: "integer" },
      max_shortcuts: { type: "integer" },
    },
    requiredInput: ["section", "command_id"],
    outputProperties: {
      section: { type: "string" },
      command_id: { type: "integer" },
      shortcut_count: { type: "integer" },
      shortcuts: { type: "array" },
      truncated: { type: "boolean" },
    },
    requiredOutput: ["section", "command_id", "shortcut_count", "shortcuts", "truncated"],
    expectedSummary: "Reads shortcut metadata without mutating global keymap state.",
    expectedEntityKind: "action",
    expectedEntitySummary: "Action shortcut metadata is read.",
    examples: [
      {
        name: "read_action_shortcuts",
        summary: "Read up to eight shortcuts for a main action.",
        input: { section: "main", command_id: 40044, max_shortcuts: 8 },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.parse_marker_action_text",
    title: "Parse marker action text",
    summary: "Parse SWS marker-action text into bounded token metadata without editing markers or executing actions.",
    entity_kind: "marker_action",
    tags: ["actions", "marker", "sws", "metadata"],
    operation_name: "actions.parse_marker_action_text",
    capability: "actions.parse_marker_action_text",
    inputProperties: {
      text: { type: "string" },
      section: { enum: ACTION_SECTION_ENUM },
      resolve_tokens: { type: "boolean" },
    },
    requiredInput: ["text"],
    outputProperties: {
      is_marker_action: { type: "boolean" },
      token_count: { type: "integer" },
      tokens: { type: "array" },
      macro_shaped: { type: "boolean" },
      unresolved_count: { type: "integer" },
    },
    requiredOutput: ["is_marker_action", "token_count", "tokens", "macro_shaped", "unresolved_count"],
    expectedSummary: "Reads marker-action text semantics without editing marker metadata.",
    expectedEntityKind: "marker_action",
    expectedEntitySummary: "Marker action text is parsed as metadata.",
    examples: [
      {
        name: "parse_single_marker_action",
        summary: "Parse one SWS marker-action token.",
        input: { text: "!_SWS_SNAPSHOT_GET1", section: "main", resolve_tokens: true },
      },
      {
        name: "parse_marker_action_macro",
        summary: "Classify multi-token marker action text as macro-shaped.",
        input: { text: "!1 2 3", section: "main" },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.search_action_commands",
    title: "Search action commands",
    summary: "Search one explicit action section and return bounded command metadata rows only.",
    entity_kind: "action",
    tags: ["actions", "search", "metadata"],
    operation_name: "actions.search_action_commands",
    capability: "actions.search_action_commands",
    inputProperties: {
      section: { enum: ACTION_SECTION_ENUM },
      query: { type: "string" },
      limit: { type: "integer" },
      cursor: { type: "string" },
    },
    requiredInput: ["section", "query"],
    outputProperties: {
      section: { type: "string" },
      items: { type: "array" },
      next_cursor: { type: "string" },
      truncated: { type: "boolean" },
    },
    requiredOutput: ["section", "items", "truncated"],
    expectedSummary: "Reads bounded action command search metadata without selecting an execution target.",
    expectedEntityKind: "action",
    expectedEntitySummary: "Action command metadata search results are read.",
    examples: [
      {
        name: "search_marker_actions",
        summary: "Search main-section action metadata by query text.",
        input: { section: "main", query: "marker", limit: 25 },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.read_custom_action_metadata",
    title: "Read custom action metadata",
    summary: "Read bounded custom action metadata without reading scripts, mutating keymaps, or executing it.",
    entity_kind: "custom_action",
    tags: ["actions", "custom_action", "metadata"],
    operation_name: "actions.read_custom_action_metadata",
    capability: "actions.read_custom_action_metadata",
    inputProperties: {
      section: { enum: ACTION_SECTION_ENUM },
      named_command: { type: "string" },
      command_id: { type: "integer" },
      include_step_summary: { type: "boolean" },
    },
    requiredInput: ["section", "named_command"],
    outputProperties: {
      section: { type: "string" },
      named_command: { type: "string" },
      command_id: { type: "integer" },
      display_name: { type: "string" },
      step_count: { type: "integer" },
      has_step_details: { type: "boolean" },
      steps_truncated: { type: "boolean" },
    },
    requiredOutput: ["section", "has_step_details", "steps_truncated"],
    expectedSummary: "Reads bounded custom action metadata without executing custom action steps.",
    expectedEntityKind: "custom_action",
    expectedEntitySummary: "Custom action metadata is read.",
    examples: [
      {
        name: "read_custom_action_metadata",
        summary: "Read metadata for a named custom action.",
        input: { section: "main", named_command: "_CUSTOM_ACTION_ID", include_step_summary: false },
      },
    ],
  }),
  actionReadDescriptor({
    id: "template.actions.read_cycle_action_metadata",
    title: "Read cycle action metadata",
    summary: "Read bounded SWS cycle action metadata without executing cycle steps or requiring SWS as a pack.",
    entity_kind: "cycle_action",
    tags: ["actions", "cycle_action", "sws", "metadata"],
    operation_name: "actions.read_cycle_action_metadata",
    capability: "actions.read_cycle_action_metadata",
    inputProperties: {
      section: { enum: ACTION_SECTION_ENUM },
      named_command: { type: "string" },
      command_id: { type: "integer" },
      include_step_summary: { type: "boolean" },
    },
    requiredInput: ["section", "named_command"],
    outputProperties: {
      section: { type: "string" },
      named_command: { type: "string" },
      command_id: { type: "integer" },
      sws_available: { type: "boolean" },
      step_count: { type: "integer" },
      conditional: { type: "boolean" },
      steps_truncated: { type: "boolean" },
    },
    requiredOutput: ["section", "sws_available", "steps_truncated"],
    expectedSummary: "Reads SWS cycle action metadata without executing cycle action steps.",
    expectedEntityKind: "cycle_action",
    expectedEntitySummary: "Cycle action metadata is read.",
    examples: [
      {
        name: "read_cycle_action_metadata",
        summary: "Read metadata for a named SWS cycle action.",
        input: { section: "main", named_command: "_SWS_CYCLE_ACTION_ID", include_step_summary: false },
      },
    ],
  }),
]);

export function createWave2AActionsTemplates() {
  return cloneJson(WAVE2A_ACTIONS_TEMPLATES);
}

function actionReadDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: "actions",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: {
      operation_family: "query_state",
      operation_name: options.operation_name,
      capability: options.capability,
      idempotency: "none",
      timeout_ms: options.timeout_ms ?? 5_000,
    },
    inputSchema: objectSchema(options.inputProperties, options.requiredInput),
    outputSchema: objectSchema(options.outputProperties, options.requiredOutput),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: {
      kind: "read",
      summary: options.expectedSummary,
      entities: [
        {
          entity_kind: options.expectedEntityKind,
          action: "read",
          summary: options.expectedEntitySummary,
        },
      ],
      idempotent: true,
    },
    verification: {
      mode: "none",
      checks: [],
    },
    examples: options.examples,
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

function refs() {
  return {
    input: [],
    output: [],
  };
}

function artifacts() {
  return {
    mode: "none",
    input: [],
    output: [],
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
