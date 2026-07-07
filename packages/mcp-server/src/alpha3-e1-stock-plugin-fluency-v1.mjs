import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";

export const ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT = "alpha3.e1.stock_plugin_fluency.v1";
export const ALPHA3_E1_STOCK_PLUGIN_MACRO_ID = "macro.set_stock_plugin_controls";
export const ALPHA3_E1_OFFICIAL_MACRO_ENTRY_KIND = "official_macro";

export const ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
  mode: "plan_only_stock_plugin_semantic_maps",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  menu_group: "act",
  action_kind: "macro",
  execution_shape: "stock_plugin_semantic_control_plan",
  macro_ids: [ALPHA3_E1_STOCK_PLUGIN_MACRO_ID],
  plugin_ids: [
    "reaeq",
    "reacomp",
    "reagate",
    "readelay",
    "reasynth",
    "rs5k",
    "reatune",
    "reapitch",
    "reaxcomp",
    "realimit",
  ],
  rule: "Stock plugin fluency maps human controls to plan-only parameter requests. Parameter indexes must come from fresh FX parameter metadata before any write request is emitted.",
});

const REQUIRED_TEMPLATE_IDS = Object.freeze([
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.set_fx_parameter_normalized",
]);

const STOCK_PLUGIN_MAPS = deepFreeze([
  plugin("reaeq", "ReaEQ", ["ReaEQ (Cockos)", "VST: ReaEQ (Cockos)", "eq", "stock eq"], "eq", [
    parameter("high_pass_frequency_hz", "High-pass frequency", "hz", 20, 250, "log", ["cut rumble", "remove low end", "high pass"], "High-pass around {value} Hz."),
    parameter("low_mid_gain_db", "Low-mid gain", "db", -12, 6, "linear", ["reduce mud", "add body"], "{sign}{value} dB low-mid move."),
    parameter("presence_gain_db", "Presence gain", "db", -6, 9, "linear", ["add clarity", "vocal presence"], "{sign}{value} dB presence move."),
    parameter("air_gain_db", "Air gain", "db", -6, 9, "linear", ["add air", "top end"], "{sign}{value} dB air move."),
  ]),
  plugin("reacomp", "ReaComp", ["ReaComp (Cockos)", "VST: ReaComp (Cockos)", "stock compressor"], "dynamics", [
    parameter("threshold_db", "Threshold", "db", -60, 0, "linear", ["compress harder", "set threshold"], "Threshold at {value} dB."),
    parameter("ratio", "Ratio", "ratio", 1, 20, "linear", ["compression ratio", "gentle compression"], "{value}:1 ratio."),
    parameter("attack_ms", "Attack", "ms", 0, 250, "linear", ["fast attack", "slow attack"], "{value} ms attack."),
    parameter("release_ms", "Release", "ms", 5, 1000, "log", ["release time", "smooth compression"], "{value} ms release."),
    parameter("wet_mix_percent", "Wet mix", "percent", 0, 100, "linear", ["parallel compression", "blend compression"], "{value}% wet compression blend."),
  ]),
  plugin("reagate", "ReaGate", ["ReaGate (Cockos)", "VST: ReaGate (Cockos)", "stock gate"], "dynamics", [
    parameter("threshold_db", "Threshold", "db", -80, 0, "linear", ["gate threshold", "remove bleed"], "Gate threshold at {value} dB."),
    parameter("hysteresis_db", "Hysteresis", "db", 0, 24, "linear", ["gate hysteresis", "avoid chatter"], "{value} dB hysteresis."),
    parameter("attack_ms", "Attack", "ms", 0, 100, "linear", ["gate attack"], "{value} ms gate attack."),
    parameter("hold_ms", "Hold", "ms", 0, 500, "linear", ["gate hold"], "{value} ms hold."),
    parameter("release_ms", "Release", "ms", 5, 1000, "log", ["gate release"], "{value} ms gate release."),
  ]),
  plugin("readelay", "ReaDelay", ["ReaDelay (Cockos)", "VST: ReaDelay (Cockos)", "stock delay"], "delay", [
    parameter("delay_ms", "Delay time", "ms", 1, 2000, "log", ["delay time", "echo time"], "{value} ms delay."),
    parameter("feedback_percent", "Feedback", "percent", 0, 95, "linear", ["delay feedback", "more echoes"], "{value}% feedback."),
    parameter("wet_mix_percent", "Wet mix", "percent", 0, 100, "linear", ["delay wet", "delay blend"], "{value}% wet delay."),
    parameter("low_pass_hz", "Low-pass", "hz", 1000, 20000, "log", ["dark delay", "filter repeats"], "Delay low-pass around {value} Hz."),
  ]),
  plugin("reasynth", "ReaSynth", ["ReaSynth (Cockos)", "VSTi: ReaSynth (Cockos)", "stock synth"], "instrument", [
    parameter("volume_db", "Volume", "db", -60, 12, "linear", ["synth level", "instrument volume"], "Synth volume at {value} dB."),
    parameter("attack_ms", "Attack", "ms", 0, 2000, "log", ["soft attack", "pluck attack"], "{value} ms synth attack."),
    parameter("decay_ms", "Decay", "ms", 1, 4000, "log", ["decay"], "{value} ms synth decay."),
    parameter("sustain_percent", "Sustain", "percent", 0, 100, "linear", ["sustain"], "{value}% sustain."),
    parameter("release_ms", "Release", "ms", 1, 5000, "log", ["release tail"], "{value} ms synth release."),
  ]),
  plugin("rs5k", "ReaSamplOmatic5000", ["ReaSamplOmatic5000", "VSTi: ReaSamplOmatic5000 (Cockos)", "RS5k", "rs5k"], "sampler", [
    parameter("volume_db", "Volume", "db", -60, 12, "linear", ["sample volume", "pad level"], "Sample volume at {value} dB."),
    parameter("pitch_semitones", "Pitch", "semitones", -24, 24, "linear", ["sample pitch", "tune sample"], "{sign}{value} semitone sample pitch."),
    parameter("attack_ms", "Attack", "ms", 0, 1000, "log", ["sample attack"], "{value} ms sample attack."),
    parameter("release_ms", "Release", "ms", 1, 5000, "log", ["sample release"], "{value} ms sample release."),
  ]),
  plugin("reatune", "ReaTune", ["ReaTune (Cockos)", "VST: ReaTune (Cockos)", "stock tuner"], "pitch", [
    parameter("correction_amount_percent", "Correction amount", "percent", 0, 100, "linear", ["pitch correction amount"], "{value}% pitch correction."),
    parameter("attack_ms", "Correction speed", "ms", 1, 500, "log", ["tune speed", "pitch correction speed"], "{value} ms correction speed."),
    parameter("formant_shift", "Formant shift", "unitless", -12, 12, "linear", ["formant"], "{sign}{value} formant shift."),
  ]),
  plugin("reapitch", "ReaPitch", ["ReaPitch (Cockos)", "VST: ReaPitch (Cockos)", "stock pitch shifter"], "pitch", [
    parameter("shift_semitones", "Pitch shift", "semitones", -24, 24, "linear", ["pitch shift", "transpose"], "{sign}{value} semitone pitch shift."),
    parameter("fine_cents", "Fine tune", "cents", -100, 100, "linear", ["fine tune", "detune"], "{sign}{value} cent fine tune."),
    parameter("formant_shift", "Formant shift", "unitless", -12, 12, "linear", ["formant shift"], "{sign}{value} formant shift."),
    parameter("wet_mix_percent", "Wet mix", "percent", 0, 100, "linear", ["pitch wet", "pitch blend"], "{value}% wet pitch blend."),
  ]),
  plugin("reaxcomp", "ReaXcomp", ["ReaXcomp (Cockos)", "VST: ReaXcomp (Cockos)", "stock multiband compressor"], "dynamics", [
    parameter("band_threshold_db", "Band threshold", "db", -60, 0, "linear", ["multiband threshold"], "Band threshold at {value} dB."),
    parameter("band_ratio", "Band ratio", "ratio", 1, 20, "linear", ["multiband ratio"], "{value}:1 band ratio."),
    parameter("band_attack_ms", "Band attack", "ms", 0, 250, "linear", ["multiband attack"], "{value} ms band attack."),
    parameter("band_release_ms", "Band release", "ms", 5, 1000, "log", ["multiband release"], "{value} ms band release."),
    parameter("band_gain_db", "Band gain", "db", -12, 12, "linear", ["multiband gain"], "{sign}{value} dB band gain."),
  ]),
  plugin("realimit", "ReaLimit", ["ReaLimit (Cockos)", "VST: ReaLimit (Cockos)", "stock limiter"], "dynamics", [
    parameter("threshold_db", "Threshold", "db", -24, 0, "linear", ["limiter threshold", "limit harder"], "Limiter threshold at {value} dB."),
    parameter("ceiling_db", "Ceiling", "db", -12, 0, "linear", ["limiter ceiling", "output ceiling"], "Limiter ceiling at {value} dB."),
    parameter("release_ms", "Release", "ms", 1, 1000, "log", ["limiter release"], "{value} ms limiter release."),
    parameter("lookahead_ms", "Lookahead", "ms", 0, 20, "linear", ["limiter lookahead"], "{value} ms lookahead."),
  ]),
]);

export function listAlpha3E1StockPluginMaps(options = {}) {
  const catalog = options.catalog ?? createAlpha3E1AcceptedCatalog();
  const missingTemplates = REQUIRED_TEMPLATE_IDS.filter((id) => !catalog.get(id));
  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
    mode: "plan_only_stock_plugin_semantic_maps",
    tool_surface: ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY.tool_surface,
    plugin_count: STOCK_PLUGIN_MAPS.length,
    required_templates: REQUIRED_TEMPLATE_IDS,
    coverage: {
      status: missingTemplates.length === 0 ? "covered_by_existing_templates" : "missing_template",
      missing_templates: missingTemplates,
    },
    plugins: STOCK_PLUGIN_MAPS,
    safety: stockPluginSafety(),
  });
}

export function createAlpha3E1OfficialMacroDiscoveryItems(options = {}) {
  const maps = listAlpha3E1StockPluginMaps(options);
  return [officialStockPluginMacroDiscoveryItem(maps)];
}

export function isAlpha3E1OfficialMacroId(id) {
  return id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID;
}

export function getAlpha3E1StockPluginMap(pluginIdOrName) {
  return resolvePluginMap(pluginIdOrName);
}

export function planAlpha3E1StockPluginMacro(id, request = {}, options = {}) {
  if (!isAlpha3E1OfficialMacroId(id)) {
    return blockedPlan(id, [blocker("macro", "MACRO_UNKNOWN", "Stock plugin macro is not registered.")]);
  }

  const catalog = options.catalog ?? createAlpha3E1AcceptedCatalog();
  const missingTemplates = REQUIRED_TEMPLATE_IDS.filter((templateId) => !catalog.get(templateId));
  const plugin = resolvePluginMap(request.plugin ?? request.plugin_id ?? request.plugin_name);
  const controls = isPlainObject(request.controls) ? request.controls : {};
  const refs = isPlainObject(request.refs) ? request.refs : {};
  const metadata = normalizeParameterMetadata(request.parameter_metadata ?? request.parameterMetadata);
  const blockers = [];

  if (missingTemplates.length > 0) {
    blockers.push(...missingTemplates.map((templateId) =>
      blocker("template", "MISSING_ACCEPTED_TEMPLATE", `Required template ${templateId} is not accepted.`)
    ));
  }
  if (!plugin) {
    blockers.push(blocker("plugin", "PLUGIN_NOT_SUPPORTED", "Supply one supported stock plugin id or name."));
  }
  if (!refs.fx_ref) {
    blockers.push(blocker("fx_ref", "REQUIRED_REF_MISSING", "Stock plugin controls require a resolved owner-scoped fx_ref."));
  }
  if (Object.keys(controls).length === 0) {
    blockers.push(blocker("controls", "CONTROL_FIELDS_REQUIRED", "Supply one or more semantic stock plugin controls."));
  }

  const fieldPlans = [];
  if (plugin) {
    for (const [field, value] of Object.entries(controls)) {
      const parameterDef = resolveParameter(plugin, field);
      if (!parameterDef) {
        blockers.push(blocker(field, "FIELD_NOT_SUPPORTED", `${plugin.display_name} does not expose semantic control ${field}.`));
        continue;
      }
      const valueResult = normalizeControlValue(parameterDef, value);
      if (!valueResult.ok) {
        blockers.push(blocker(field, valueResult.code, valueResult.message));
        continue;
      }
      const resolution = metadata.get(parameterDef.id) ?? metadata.get(field);
      if (!resolution) {
        blockers.push(blocker(
          field,
          "PARAMETER_METADATA_REQUIRED",
          `${plugin.display_name} ${parameterDef.label} needs a fresh parameter metadata match before writing.`,
        ));
        continue;
      }
      if (resolution.freshness_status !== "fresh") {
        blockers.push(blocker(
          field,
          "PARAMETER_METADATA_NOT_FRESH",
          `${plugin.display_name} ${parameterDef.label} needs parameter metadata marked fresh before writing.`,
        ));
        continue;
      }
      if (!Number.isInteger(resolution.param_index) || resolution.param_index < 0) {
        blockers.push(blocker(field, "PARAMETER_INDEX_REQUIRED", `${plugin.display_name} ${parameterDef.label} needs a non-negative param_index from fresh metadata.`));
        continue;
      }
      fieldPlans.push({
        field,
        parameter: parameterDef,
        value,
        normalized_value: valueResult.normalized_value,
        resolution,
      });
    }
  }

  const requests = blockers.length === 0
    ? fieldPlans.map((plan) => setParameterRequest(plan, refs))
    : [];
  const readback = blockers.length === 0
    ? fieldPlans.map((plan) => readParameterRequest(plan, refs))
    : [];

  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
    ok: blockers.length === 0,
    id,
    mode: "plan_only_call_template_macro",
    action_kind: "macro",
    menu_group: "act",
    execution_shape: "stock_plugin_semantic_control_plan",
    risk_domain: "fx_parameter_control",
    plugin: plugin ? pluginSummary(plugin) : null,
    freshness_requires: [
      "fx_ref",
      "fx_owner_identity",
      "plugin_identity",
      "fresh_fx_parameter_metadata",
    ],
    resolution_requests: plugin && refs.fx_ref
      ? [
          {
            tool: "call_template",
            id: "template.fx.read_fx_summary",
            refs: { fx_ref: refs.fx_ref },
            input: {},
            purpose: "verify plugin identity before semantic parameter writes",
          },
          {
            tool: "call_template",
            id: "template.fx.list_fx_parameters",
            refs: { fx_ref: refs.fx_ref },
            input: { limit: 128 },
            purpose: "resolve semantic controls to fresh param_index values",
          },
        ]
      : [],
    requests,
    readback,
    human_readback: blockers.length === 0 ? fieldPlans.map(humanReadbackItem) : [],
    blockers: uniqueBlockers(blockers),
    safety: stockPluginSafety(),
    policy: "Resolve plugin identity and parameter metadata from REAPER first, emit only accepted set_fx_parameter_normalized child requests, then read back every touched parameter.",
  });
}

export function createAlpha3E1StockPluginRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3E1StockPluginMacro(request.id, request);
  const completedAt = safeNowIso(now);
  const envelope = {
    contract: "template.execution.v1",
    ok: Boolean(normalizedPlan.ok),
    template: {
      id: normalizedPlan.id,
      pack: "macro",
      risk: "write",
      action_kind: "macro",
    },
    request: {
      id: null,
      client: {
        id: "openreaper-mcp",
      },
      macro: {
        id: normalizedPlan.id,
        contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
        mode: "plan_only_call_template_macro",
      },
      input: cloneJson(request.input ?? {}),
      refs: cloneJson(request.refs ?? {}),
    },
    completed_at: completedAt,
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
      action_kind: "macro",
      mode: "plan_only_call_template_macro",
      execution_shape: "stock_plugin_semantic_control_plan",
      plan: normalizedPlan,
      execution: {
        executed: false,
        reason: "E1.1 binds stock plugin semantic planning only; child template requests remain agent-executed through call_template after freshness checks.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_execution: false,
        alias_execution: false,
        live_reaper: false,
      },
      child_requests: normalizedPlan.requests,
      readback: normalizedPlan.readback,
      blockers: normalizedPlan.blockers,
    },
    budget: {
      max_response_bytes: 65_536,
      response_bytes: 0,
      truncated: false,
    },
  };
  envelope.budget.response_bytes = byteLength(envelope);
  return deepFreeze(envelope);
}

function officialStockPluginMacroDiscoveryItem(maps) {
  return deepFreeze({
    id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
    title: "Set stock plugin controls",
    summary: "Set REAPER stock plugin controls by musical names after fresh FX parameter metadata has resolved the real parameter indexes.",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.fx",
    tags: [
      "macro",
      "stock_plugin",
      "fx",
      "semantic_control",
      "alpha3_e1",
      "reaeq",
      "reacomp",
      "reagate",
      "readelay",
      "reasynth",
      "rs5k",
      "reatune",
      "reapitch",
      "reaxcomp",
      "realimit",
    ],
    kind: ALPHA3_E1_OFFICIAL_MACRO_ENTRY_KIND,
    action_kind: "macro",
    macro_kind: "stock_plugin_control",
    menu_group: "act",
    execution_shape: "stock_plugin_semantic_control_plan",
    user_label: "Set stock plugin controls",
    task_intents: [
      "adjust stock plugin",
      "set reaeq musically",
      "set reacomp musically",
      "set reagate musically",
      "set readelay musically",
      "set reasynth musically",
      "set rs5k musically",
      "set reatune musically",
      "set reapitch musically",
      "set reaxcomp musically",
      "set realimit musically",
    ],
    support_status: "plan_only_runtime_bound",
    risk_domain: "fx_parameter_control",
    plugin_ids: maps.plugins.map((pluginMap) => pluginMap.id),
    inputSchema: {
      type: "object",
      required: ["plugin", "controls"],
      properties: {
        plugin: { type: "string" },
        controls: { type: "object", additionalProperties: true },
        parameter_metadata: { type: "object", additionalProperties: true },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "action_kind", "mode", "plan", "execution"],
      properties: {
        contract: { const: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT },
        action_kind: { const: "macro" },
        mode: { const: "plan_only_call_template_macro" },
        plan: { type: "object" },
        execution: { type: "object" },
      },
    },
    refs: {
      input: [{ name: "fx_ref", kind: "fx", required: true, summary: "Resolved owner-scoped stock plugin FX ref." }],
      output: [],
    },
    expectedDelta: {
      kind: "read",
      action: "read",
      entities: ["macro_plan"],
      summary: "Returns a plan-only stock-plugin macro envelope. It does not mutate REAPER directly.",
    },
    examples: [
      {
        input: {
          plugin: "reacomp",
          controls: {
            threshold_db: -18,
            ratio: 4,
          },
        },
        refs: {
          fx_ref: "fx:track:guid:{TRACK}:1",
        },
      },
    ],
    live_runnable_now: true,
    exists_in_catalog: true,
    evidence_level: "runtime_bound_static_fake",
    support_state: maps.coverage.status === "covered_by_existing_templates" ? "supported" : "blocked",
    known_blocker: maps.coverage.missing_templates.length === 0 ? null : "missing_required_fx_template",
    allowed_live_group: null,
  });
}

function setParameterRequest(plan, refs) {
  return deepFreeze({
    tool: "call_template",
    id: "template.fx.set_fx_parameter_normalized",
    refs: { fx_ref: refs.fx_ref },
    input: pruneUndefined({
      param_index: plan.resolution.param_index,
      param_ident: plan.resolution.param_ident,
      normalized_value: round(plan.normalized_value),
      tolerance: plan.parameter.tolerance,
    }),
    semantic_control: {
      id: plan.parameter.id,
      label: plan.parameter.label,
      original_value: plan.value,
      unit: plan.parameter.unit,
    },
    expected_evidence: ["request_id", "undo_evidence", "canonical_refs", "readback_status", "typed_blockers"],
  });
}

function readParameterRequest(plan, refs) {
  return deepFreeze({
    tool: "call_template",
    id: "template.fx.read_fx_parameter",
    refs: { fx_ref: refs.fx_ref },
    input: pruneUndefined({
      param_index: plan.resolution.param_index,
      param_ident: plan.resolution.param_ident,
    }),
    semantic_control: {
      id: plan.parameter.id,
      label: plan.parameter.label,
    },
    expected_evidence: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
  });
}

function humanReadbackItem(plan) {
  return deepFreeze({
    control: plan.parameter.id,
    label: plan.parameter.label,
    requested_value: plan.value,
    unit: plan.parameter.unit,
    normalized_value: round(plan.normalized_value),
    phrase: formatReadback(plan.parameter.readback_template, plan.value),
  });
}

function normalizeControlValue(parameterDef, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      code: "CONTROL_VALUE_INVALID",
      message: `${parameterDef.label} expects a finite numeric value.`,
    };
  }
  if (value < parameterDef.safe_range.min || value > parameterDef.safe_range.max) {
    return {
      ok: false,
      code: "CONTROL_VALUE_OUT_OF_RANGE",
      message: `${parameterDef.label} must stay between ${parameterDef.safe_range.min} and ${parameterDef.safe_range.max} ${parameterDef.unit}.`,
    };
  }
  return {
    ok: true,
    normalized_value: normalizeToUnitInterval(parameterDef, value),
  };
}

function normalizeToUnitInterval(parameterDef, value) {
  const min = parameterDef.safe_range.min;
  const max = parameterDef.safe_range.max;
  if (parameterDef.normalized_mapping.kind === "log") {
    const safeMin = Math.max(min, 0.000001);
    const safeMax = Math.max(max, safeMin * 1.000001);
    return clamp01((Math.log(value) - Math.log(safeMin)) / (Math.log(safeMax) - Math.log(safeMin)));
  }
  return clamp01((value - min) / (max - min));
}

function normalizeParameterMetadata(value) {
  const map = new Map();
  if (!isPlainObject(value)) return map;
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) continue;
    map.set(key, {
      param_index: entry.param_index,
      param_ident: typeof entry.param_ident === "string" ? entry.param_ident : undefined,
      label: typeof entry.label === "string" ? entry.label : undefined,
      freshness_status: typeof entry.freshness_status === "string" ? entry.freshness_status : undefined,
      observed_at: typeof entry.observed_at === "string" ? entry.observed_at : undefined,
    });
  }
  return map;
}

function resolvePluginMap(pluginIdOrName) {
  if (typeof pluginIdOrName !== "string") return null;
  const normalized = normalizeToken(pluginIdOrName);
  return STOCK_PLUGIN_MAPS.find((pluginMap) =>
    normalizeToken(pluginMap.id) === normalized ||
    normalizeToken(pluginMap.display_name) === normalized ||
    pluginMap.aliases.some((alias) => normalizeToken(alias) === normalized)
  ) ?? null;
}

function resolveParameter(pluginMap, field) {
  const normalized = normalizeToken(field);
  return pluginMap.parameters.find((parameterDef) =>
    normalizeToken(parameterDef.id) === normalized ||
    normalizeToken(parameterDef.label) === normalized ||
    parameterDef.aliases.some((alias) => normalizeToken(alias) === normalized)
  ) ?? null;
}

function plugin(id, displayName, aliases, category, parameters) {
  return deepFreeze({
    id,
    display_name: displayName,
    aliases,
    category,
    parameters,
    resolution_policy: {
      source: "fresh_fx_parameter_metadata",
      accepted_templates: ["template.fx.read_fx_summary", "template.fx.list_fx_parameters"],
      write_template: "template.fx.set_fx_parameter_normalized",
      readback_template: "template.fx.read_fx_parameter",
      no_baked_param_indexes: true,
    },
  });
}

function parameter(id, label, unit, min, max, mapping, aliases, readbackTemplate) {
  return deepFreeze({
    id,
    label,
    aliases,
    unit,
    safe_range: { min, max },
    normalized_mapping: { kind: mapping },
    resolution: {
      source: "fresh_fx_parameter_metadata",
      match_hints: [id, label, ...aliases],
      accepts: ["param_index", "param_ident"],
    },
    tolerance: 0.0001,
    readback_template: readbackTemplate,
  });
}

function pluginSummary(pluginMap) {
  return {
    id: pluginMap.id,
    display_name: pluginMap.display_name,
    category: pluginMap.category,
    parameter_count: pluginMap.parameters.length,
  };
}

function stockPluginSafety() {
  return {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_lua_action_shell_or_ui: false,
    live_reaper: false,
    safe_write: false,
    direct_reaper_write: false,
    execution_path: ["list_templates", "call_template", "get_state"],
    parameter_truth: "fresh_fx_parameter_metadata_required_before_write",
  };
}

function blockedPlan(id, blockers) {
  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
    ok: false,
    id,
    mode: "plan_only_call_template_macro",
    action_kind: "macro",
    menu_group: "act",
    requests: [],
    readback: [],
    blockers: uniqueBlockers(blockers),
    safety: stockPluginSafety(),
  });
}

function macroRuntimeError(plan) {
  const firstBlocker = plan.blockers[0] ?? blocker("macro", "MACRO_BLOCKED", "Stock plugin macro plan returned a blocker.");
  return {
    source: "macro",
    code: firstBlocker.code,
    message: firstBlocker.message,
    recoverable: firstBlocker.recoverable !== false,
    details: {
      blockers: plan.blockers,
    },
  };
}

function blocker(field, code, message) {
  return deepFreeze({
    field,
    code,
    message,
    recoverable: true,
  });
}

function createAlpha3E1AcceptedCatalog() {
  return createTemplateCatalog({
    templates: [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
      ...createTemplateCatalogP1Templates(),
    ],
  });
}

function formatReadback(template, value) {
  const sign = value > 0 ? "+" : "";
  return template
    .replaceAll("{value}", String(value))
    .replaceAll("{sign}", sign);
}

function normalizeToken(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function pruneUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  const output = [];
  for (const entry of blockers) {
    const key = `${entry.field}:${entry.code}:${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
