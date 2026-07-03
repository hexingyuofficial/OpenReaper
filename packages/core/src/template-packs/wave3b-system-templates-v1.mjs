import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE3B_SYSTEM_TEMPLATE_IDS = Object.freeze([
  "template.system.read_runtime_environment",
  "template.system.read_resource_paths",
  "template.system.check_api_symbols",
]);

export const WAVE3B_SYSTEM_TEMPLATES = deepFreeze([
  systemReadDescriptor({
    id: "template.system.read_runtime_environment",
    title: "Read runtime environment",
    summary:
      "Read bounded REAPER process and OpenReaper runtime facts without dumping environment variables.",
    entity_kind: "system_state",
    tags: ["system", "runtime", "environment", "read"],
    operation_name: "system.runtime_environment.read",
    capability: "system.runtime_environment.read",
    inputProperties: {
      include_bridge_runtime: { type: "boolean" },
      include_runtime_flags: { type: "boolean" },
    },
    requiredInput: [],
    outputProperties: {
      reaper_version: { type: "string" },
      os: { type: "string" },
      executable_path: { type: "string" },
      bridge_runtime: { type: "string" },
      queue_override_present: { type: "boolean" },
      runtime_flags: { type: "object" },
    },
    requiredOutput: ["reaper_version", "os"],
    expectedSummary:
      "Reads bounded runtime environment facts without mutating REAPER or system state.",
    expectedEntityKind: "system_state",
    expectedEntitySummary: "Runtime environment facts are read.",
    examples: [
      {
        name: "read_basic_runtime",
        summary: "Read the compact runtime environment summary.",
        input: {
          include_bridge_runtime: true,
          include_runtime_flags: true,
        },
      },
    ],
  }),
  systemReadDescriptor({
    id: "template.system.read_resource_paths",
    title: "Read resource paths",
    summary:
      "Read bounded global REAPER resource, install, script, and queue paths without listing directories.",
    entity_kind: "resource_path",
    tags: ["system", "paths", "resource_path", "read"],
    operation_name: "system.resource_paths.read",
    capability: "system.resource_paths.read",
    inputProperties: {
      include_queue_paths: { type: "boolean" },
      include_script_path: { type: "boolean" },
    },
    requiredInput: [],
    outputProperties: {
      resource_path: { type: "string" },
      executable_path: { type: "string" },
      bridge_script_dir: { type: "string" },
      queue_dir: { type: "string" },
      pending_dir: { type: "string" },
      running_dir: { type: "string" },
      done_dir: { type: "string" },
      queue_override_present: { type: "boolean" },
    },
    requiredOutput: ["resource_path"],
    expectedSummary:
      "Reads global resource and runtime paths without probing, listing, or mutating files.",
    expectedEntityKind: "resource_path",
    expectedEntitySummary: "Resource path facts are read.",
    examples: [
      {
        name: "read_resource_paths",
        summary: "Read REAPER resource and bridge queue path facts.",
        input: {
          include_queue_paths: true,
          include_script_path: true,
        },
      },
    ],
  }),
  systemReadDescriptor({
    id: "template.system.check_api_symbols",
    title: "Check API symbols",
    summary:
      "Check bounded REAPER API symbol availability by name without invoking the named functions.",
    entity_kind: "api_symbol",
    tags: ["system", "api_symbol", "introspection", "read"],
    operation_name: "system.api_symbols.check",
    capability: "system.api_symbols.check",
    inputProperties: {
      symbols: { type: "array" },
      profile: { enum: ["core_runtime", "extension_probe", "custom"] },
      max_symbols: { type: "integer" },
    },
    requiredInput: [],
    outputProperties: {
      profile: { type: "string" },
      symbol_count: { type: "integer" },
      symbols: { type: "array" },
      unavailable_count: { type: "integer" },
      truncated: { type: "boolean" },
    },
    requiredOutput: ["symbol_count", "symbols", "truncated"],
    expectedSummary:
      "Reads API symbol availability metadata without executing actions, commands, or arbitrary APIs.",
    expectedEntityKind: "api_symbol",
    expectedEntitySummary: "API symbol visibility metadata is read.",
    examples: [
      {
        name: "check_core_runtime_symbols",
        summary: "Check a bounded set of core runtime API symbol names.",
        input: {
          profile: "core_runtime",
          symbols: ["GetAppVersion", "GetOS", "GetResourcePath", "APIExists"],
          max_symbols: 16,
        },
      },
    ],
  }),
]);

export function createWave3BSystemTemplates() {
  return cloneJson(WAVE3B_SYSTEM_TEMPLATES);
}

function systemReadDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: "system",
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
