import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogAlpha3C3Templates,
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";

export const ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT = "alpha3.e1.stock_plugin_fluency.v1";
export const ALPHA3_E1_STOCK_PLUGIN_CUSTOMER_READBACK_CONTRACT = "alpha3.e1.stock_plugin_customer_readback.v1";
export const ALPHA3_E1_STOCK_PLUGIN_EVIDENCE_PLAN_CONTRACT = "alpha3.e1.stock_plugin_evidence_plan.v1";
export const ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT = "alpha3.e1.stock_plugin_live_evidence_matrix.v1";
export const ALPHA3_E1_STOCK_PLUGIN_AGENT_EXECUTION_FLOW_CONTRACT = "alpha3.e1.stock_plugin_agent_execution_flow.v1";
export const ALPHA3_E1_STOCK_PLUGIN_MACRO_ID = "macro.set_stock_plugin_controls";
export const ALPHA3_E1_OFFICIAL_MACRO_ENTRY_KIND = "official_macro";

export const ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
  mode: "registered_executable_stock_plugin_program",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  menu_group: "act",
  action_kind: "macro",
  execution_shape: "registered_macro_program",
  live_evidence_contract: ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
  live_support_status: "bounded_single_plugin_evidence_only",
  broad_live_support: false,
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
  starter_action_ids: [
    "vocal_presence_eq",
    "gentle_vocal_compression",
    "bleed_cleanup_gate",
    "tempo_delay",
    "soft_synth_pad",
    "tight_sampler_pad",
    "natural_pitch_correction",
    "octave_down_pitch",
    "gentle_multiband_control",
    "safe_peak_limit",
  ],
  rule: "The registered stock-plugin Macro resolves live FX identity and parameter metadata, maps human controls to fresh parameter indexes, executes accepted writes, and verifies every normalized readback value.",
});

const REQUIRED_TEMPLATE_IDS = Object.freeze([
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.set_fx_parameter_normalized",
]);

export const ALPHA3_E1_STOCK_PLUGIN_SUMMARY_BUDGET = Object.freeze({
  max_response_bytes: 60_000,
  max_items: 200,
  max_inline_value_bytes: 6_000,
});

export const ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET = Object.freeze({
  max_response_bytes: 120_000,
  max_items: 1_000,
  max_inline_value_bytes: 12_000,
});

export const ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET = Object.freeze({
  max_response_bytes: 60_000,
  max_items: 200,
  max_inline_value_bytes: 6_000,
});

const DEFAULT_STOCK_PLUGIN_LIVE_EVIDENCE_BY_PLUGIN = deepFreeze({
  reacomp: {
    evidence_ref: "alpha3.e1.4.reacomp.bounded_live_write_readback",
    status: "bounded_fixture_accepted",
    scope: "single bounded ReaComp write/readback fixture",
    claim_allowed: "ReaComp passed one bounded stock-plugin live write/readback smoke.",
    claim_not_allowed: "Do not promote this to broad stock-plugin live support.",
  },
});

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

const STOCK_PLUGIN_STARTER_ACTIONS = deepFreeze([
  starterAction("vocal_presence_eq", "Vocal presence EQ", "reaeq", "Add a safe vocal EQ starting point: high-pass, reduce mud, add presence, and add a little air.", {
    high_pass_frequency_hz: 85,
    low_mid_gain_db: -3,
    presence_gain_db: 3,
    air_gain_db: 2,
  }, ["vocal cleanup eq", "make vocal clearer", "remove vocal mud"]),
  starterAction("gentle_vocal_compression", "Gentle vocal compression", "reacomp", "Set a reversible vocal compression starting point with moderate ratio and smooth release.", {
    threshold_db: -18,
    ratio: 3,
    attack_ms: 12,
    release_ms: 120,
    wet_mix_percent: 100,
  }, ["compress vocal", "gentle compressor", "vocal leveler"]),
  starterAction("bleed_cleanup_gate", "Bleed cleanup gate", "reagate", "Gate a noisy or bleed-heavy source with conservative attack, hold, and release values.", {
    threshold_db: -45,
    hysteresis_db: 6,
    attack_ms: 5,
    hold_ms: 80,
    release_ms: 160,
  }, ["clean bleed", "noise gate", "tighten drum mic"]),
  starterAction("tempo_delay", "Tempo delay", "readelay", "Create a tempo-derived delay starting point. Provide tempo_bpm and optionally division to calculate delay_ms.", {
    feedback_percent: 28,
    wet_mix_percent: 18,
    low_pass_hz: 7000,
  }, ["tempo delay", "quarter note delay", "echo in time"], {
    requires: ["tempo_bpm"],
    defaults: { division: "1/4" },
  }),
  starterAction("soft_synth_pad", "Soft synth pad", "reasynth", "Shape a soft ReaSynth pad envelope for a gentle sustained part.", {
    volume_db: -12,
    attack_ms: 250,
    decay_ms: 900,
    sustain_percent: 70,
    release_ms: 1200,
  }, ["soft synth pad", "slow attack synth", "pad envelope"]),
  starterAction("tight_sampler_pad", "Tight sampler pad", "rs5k", "Shape a tight RS5k one-shot pad after the sample is already loaded.", {
    volume_db: -9,
    pitch_semitones: 0,
    attack_ms: 2,
    release_ms: 350,
  }, ["tight rs5k", "sampler pad", "one shot sampler"]),
  starterAction("natural_pitch_correction", "Natural pitch correction", "reatune", "Set a moderate ReaTune correction starting point without extreme retuning.", {
    correction_amount_percent: 55,
    attack_ms: 80,
    formant_shift: 0,
  }, ["natural autotune", "pitch correction", "tune vocal gently"]),
  starterAction("octave_down_pitch", "Octave-down pitch utility", "reapitch", "Set a full-wet octave-down pitch starting point with a small formant move.", {
    shift_semitones: -12,
    fine_cents: 0,
    formant_shift: -2,
    wet_mix_percent: 100,
  }, ["octave down", "monster voice", "pitch down"]),
  starterAction("gentle_multiband_control", "Gentle multiband control", "reaxcomp", "Set a conservative ReaXcomp band-control starting point.", {
    band_threshold_db: -24,
    band_ratio: 2,
    band_attack_ms: 20,
    band_release_ms: 180,
    band_gain_db: 0,
  }, ["multiband control", "smooth harsh band", "reaxcomp starter"]),
  starterAction("safe_peak_limit", "Safe peak limit", "realimit", "Set a safe peak limiter starting point with modest threshold, ceiling, release, and lookahead.", {
    threshold_db: -3,
    ceiling_db: -1,
    release_ms: 80,
    lookahead_ms: 3,
  }, ["peak limit", "safe limiter", "catch peaks"]),
]);

export function listAlpha3E1StockPluginMaps(options = {}) {
  const catalog = options.catalog ?? createAlpha3E1AcceptedCatalog();
  const missingTemplates = REQUIRED_TEMPLATE_IDS.filter((id) => !catalog.get(id));
  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
    mode: "semantic_map_registry",
    tool_surface: ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY.tool_surface,
    plugin_count: STOCK_PLUGIN_MAPS.length,
    required_templates: REQUIRED_TEMPLATE_IDS,
    coverage: {
      status: missingTemplates.length === 0 ? "covered_by_existing_templates" : "missing_template",
      missing_templates: missingTemplates,
    },
    plugins: STOCK_PLUGIN_MAPS,
    starter_actions: STOCK_PLUGIN_STARTER_ACTIONS,
    safety: stockPluginSafety(),
  });
}

export function summarizeAlpha3E1StockPluginLiveEvidenceMatrix(options = {}) {
  const evidenceByPlugin = normalizeLiveEvidenceByPlugin(options.live_evidence_by_plugin)
    ?? DEFAULT_STOCK_PLUGIN_LIVE_EVIDENCE_BY_PLUGIN;
  const rows = STOCK_PLUGIN_MAPS.map((pluginMap) => stockPluginEvidenceRow(pluginMap, evidenceByPlugin[pluginMap.id]));
  const acceptedRows = rows.filter((row) => row.live_evidence_status === "bounded_fixture_accepted");
  const pendingRows = rows.filter((row) => row.live_evidence_status !== "bounded_fixture_accepted");

  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
    mode: "static_evidence_gate_for_bounded_live_smoke",
    generated_live_calls: false,
    live_reaper_called: false,
    safe_write_called: false,
    broad_live_support: false,
    customer_ready: false,
    reason: "The registered semantic-control Macro executes with live metadata and readback, but broad stock-plugin support still needs per-plugin bounded evidence.",
    plugin_count: rows.length,
    accepted_live_count: acceptedRows.length,
    pending_live_count: pendingRows.length,
    accepted_live_plugin_ids: acceptedRows.map((row) => row.plugin_id),
    pending_live_plugin_ids: pendingRows.map((row) => row.plugin_id),
    plugins: rows,
    bounded_live_smoke_plan: stockPluginBoundedLiveSmokePlan(rows),
    claim_policy: {
      allowed_now: [
        "The registered stock-plugin semantic-control Macro is executable through call_template.",
        "ReaComp has one bounded live write/readback fixture if the evidence record is cited.",
      ],
      not_allowed_yet: [
        "All ten stock plugins are live-supported.",
        "Stock-plugin changes are customer-ready without bounded readback evidence.",
        "An untested plugin row passed live write/readback.",
      ],
      promotion_gate: "Only turn a plugin row green after a bounded live window proves identity hydration, registered-program execution, readback, and mismatch handling for that plugin.",
    },
    safety: stockPluginSafety(),
  });
}

export function createAlpha3E1OfficialMacroDiscoveryItems(options = {}) {
  const maps = listAlpha3E1StockPluginMaps(options);
  return [officialStockPluginMacroDiscoveryItem(maps, options)];
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
  const starterInput = request.starter_action;
  const starter = resolveStarterAction(starterInput);
  const requestedPlugin = request.plugin ?? request.plugin_id ?? request.plugin_name;
  const requestedPluginMap = resolvePluginMap(requestedPlugin);
  const plugin = resolvePluginMap(starter?.plugin_id ?? requestedPlugin);
  const controlResolution = resolveRequestedControls({
    starter,
    requestedPluginMap,
    plugin,
    controls: request.controls,
    control_overrides: request.control_overrides ?? request.controlOverrides,
    action_parameters: request.action_parameters ?? request.actionParameters,
  });
  const controls = controlResolution.controls;
  const refs = isPlainObject(request.refs) ? request.refs : {};
  const metadata = normalizeParameterMetadata(request.parameter_metadata ?? request.parameterMetadata);
  const blockers = [];

  if (missingTemplates.length > 0) {
    blockers.push(...missingTemplates.map((templateId) =>
      blocker("template", "MISSING_ACCEPTED_TEMPLATE", `Required template ${templateId} is not accepted.`)
    ));
  }
  if (typeof starterInput === "string" && !starter) {
    blockers.push(blocker("starter_action", "STARTER_ACTION_NOT_SUPPORTED", "Supply one supported stock plugin starter_action id or omit starter_action and provide plugin plus controls."));
  }
  if (requestedPlugin && !requestedPluginMap) {
    blockers.push(blocker("plugin", "PLUGIN_NOT_SUPPORTED", "Supply one supported stock plugin id or name."));
  } else if (!plugin) {
    blockers.push(blocker("plugin", "PLUGIN_NOT_SUPPORTED", "Supply one supported stock plugin id or name."));
  }
  blockers.push(...controlResolution.blockers);
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
  const humanReadback = blockers.length === 0 ? fieldPlans.map(humanReadbackItem) : [];
  const resolutionRequests = plugin && refs.fx_ref
    ? [
        {
          tool: "call_template",
          id: "template.fx.read_fx_summary",
          refs: { fx_ref: refs.fx_ref },
          input: {},
          budget: ALPHA3_E1_STOCK_PLUGIN_SUMMARY_BUDGET,
          purpose: "verify plugin identity before semantic parameter writes",
        },
        {
          tool: "call_template",
          id: "template.fx.list_fx_parameters",
          refs: { fx_ref: refs.fx_ref },
          input: { limit: 128 },
          budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
          purpose: "resolve semantic controls to fresh param_index values",
        },
      ]
    : [];
  const hydrationFlow = createHydrationFlow({
    plugin,
    starter,
    controls,
    refs,
    blockers,
    requests,
    readback,
  });
  const evidencePlan = createEvidencePlan({
    plugin,
    starter,
    controls,
    refs,
    blockers,
    fieldPlans,
    requests,
    readback,
    hydrationFlow,
  });
  const customerReadback = createCustomerReadback({
    plugin,
    starter,
    controls,
    blockers,
    humanReadback,
    hydrationFlow,
    evidencePlan,
  });
  const agentExecutionFlow = createAgentExecutionFlow({
    plugin,
    starter,
    controls,
    refs,
    blockers,
    resolutionRequests,
    requests,
    readback,
    hydrationFlow,
    evidencePlan,
  });

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
    starter_action: starter ? starterSummary(starter, controls, controlResolution.action_parameters) : null,
    freshness_requires: [
      "fx_ref",
      "fx_owner_identity",
      "plugin_identity",
      "fresh_fx_parameter_metadata",
    ],
    resolution_requests: resolutionRequests,
    requests,
    readback,
    hydration_flow: hydrationFlow,
    evidence_plan: evidencePlan,
    customer_readback: customerReadback,
    agent_execution_flow: agentExecutionFlow,
    human_readback: humanReadback,
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
        reason: "E1.3 binds stock plugin semantic planning, starter actions, and customer readback evidence only; child template requests remain agent-executed through call_template after freshness checks.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_execution: false,
        alias_execution: false,
        live_reaper: false,
      },
      child_requests: normalizedPlan.requests,
      readback: normalizedPlan.readback,
      evidence_plan: normalizedPlan.evidence_plan ?? null,
      customer_readback: normalizedPlan.customer_readback ?? null,
      agent_execution_flow: normalizedPlan.agent_execution_flow ?? null,
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

function officialStockPluginMacroDiscoveryItem(maps, options = {}) {
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
      "stock plugin controls",
      "fx",
      "semantic_control",
      "exact_parameters",
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
      ...maps.starter_actions.map((action) => action.id),
    ],
    kind: ALPHA3_E1_OFFICIAL_MACRO_ENTRY_KIND,
    action_kind: "macro",
    macro_kind: "stock_plugin_control",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
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
      ...maps.starter_actions.flatMap((action) => [action.id, action.label, ...action.aliases]),
    ],
    support_status: "executable_runtime_bound",
    risk_domain: "fx_parameter_control",
    plugin_ids: maps.plugins.map((pluginMap) => pluginMap.id),
    starter_action_ids: maps.starter_actions.map((action) => action.id),
    inputSchema: stockPluginControlInputSchema(),
    outputSchema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "result"],
      properties: {
        contract: { const: "macro.execution.v1" },
        ok: { type: "boolean" },
        macro: { type: "object" },
        execution: { type: "object" },
        result: { type: "object" },
      },
    },
    refs: {
      input: [{ name: "fx_ref", kind: "fx", required: false, summary: "Optional resolved owner-scoped FX ref; a bounded selector may be used instead." }],
      output: [],
    },
    expectedDelta: {
      kind: "write",
      action: "set_stock_plugin_controls",
      entities: ["fx", "fx_parameter"],
      summary: "Executes the registered semantic parameter program and verifies every touched normalized parameter value.",
    },
    examples: [
      {
        input: {
          starter_action: "gentle_vocal_compression",
        },
        refs: {
          fx_ref: "fx:track:guid:{TRACK}:1",
        },
      },
    ],
    live_runnable_now: options.liveRunnableNow === true,
    exists_in_catalog: true,
    evidence_level: options.liveRunnableNow === true ? "runtime_bound_live_route_available" : "runtime_bound_executable",
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
    budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
    semantic_control: {
      id: plan.parameter.id,
      label: plan.parameter.label,
    },
    expected_evidence: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
  });
}

function createHydrationFlow({ plugin, starter, controls, refs, blockers, requests, readback }) {
  const hasFxRef = Boolean(refs.fx_ref);
  const controlIds = Object.keys(controls);
  const status = requests.length > 0
    ? "ready_for_child_requests"
    : blockers.some((entry) => entry.code === "PARAMETER_METADATA_REQUIRED" || entry.code === "PARAMETER_METADATA_NOT_FRESH")
      ? "needs_fresh_parameter_metadata"
      : "blocked";
  const steps = [];
  if (plugin && hasFxRef) {
    steps.push({
      id: "verify_fx_identity",
      tool: "call_template",
      template_id: "template.fx.read_fx_summary",
      refs: { fx_ref: refs.fx_ref },
      input: {},
      budget: ALPHA3_E1_STOCK_PLUGIN_SUMMARY_BUDGET,
      purpose: "Confirm the resolved FX is the intended stock plugin before planning parameter writes.",
    });
    steps.push({
      id: "hydrate_parameter_metadata",
      tool: "call_template",
      template_id: "template.fx.list_fx_parameters",
      refs: { fx_ref: refs.fx_ref },
      input: { limit: 128 },
      budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
      wanted_controls: controlIds,
      purpose: "Map semantic controls to fresh param_index and param_ident values.",
    });
  }
  if (requests.length > 0) {
    steps.push({
      id: "execute_stock_plugin_controls",
      tool: "call_template",
      request_source: "result.child_requests",
      child_request_ids: requests.map((request) => request.id),
      child_request_count: requests.length,
      purpose: "Run the accepted child parameter requests through call_template, then read back each touched parameter.",
    });
  }
  return deepFreeze({
    contract: "alpha3.e1.stock_plugin_hydration_flow.v1",
    status,
    starter_action_id: starter?.id ?? null,
    plugin_id: plugin?.id ?? null,
    wanted_controls: controlIds,
    next_step: hydrationNextStep(status),
    steps,
    readback_request_count: readback.length,
  });
}

function createEvidencePlan({ plugin, starter, controls, refs, blockers, fieldPlans, requests, readback, hydrationFlow }) {
  const status = hydrationFlow.status === "ready_for_child_requests"
    ? "ready_for_execution_and_readback"
    : hydrationFlow.status;
  const evidenceItems = blockers.length === 0 ? fieldPlans.map((plan, index) => deepFreeze({
    control: plan.parameter.id,
    label: plan.parameter.label,
    requested_value: plan.value,
    unit: plan.parameter.unit,
    tolerance: plan.parameter.tolerance,
    param_index: plan.resolution.param_index,
    param_ident: plan.resolution.param_ident,
    write_request_index: index,
    readback_request_index: index,
    pending: true,
  })) : [];
  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_EVIDENCE_PLAN_CONTRACT,
    status,
    source_of_truth: "REAPER readback through accepted call_template requests",
    plugin_id: plugin?.id ?? null,
    starter_action_id: starter?.id ?? null,
    fx_ref: refs.fx_ref ?? null,
    readback_status: "not_run",
    success_wording_allowed: false,
    safe_claim_now: status === "ready_for_execution_and_readback"
      ? "Plan is ready; do not claim the plugin changed until readback evidence exists."
      : "Plan is blocked or needs hydration; do not claim any plugin change.",
    required_sequence: [
      "verify_fx_identity",
      "hydrate_fresh_parameter_metadata",
      "execute_child_requests",
      "run_planned_readback",
      "compare_readback_to_requested_controls",
    ],
    required_after_execution: [
      "all child_requests returned ok",
      "all readback requests returned ok",
      "canonical fx_ref still matches the intended owner/plugin",
      "readback values match requested semantic controls within tolerance",
    ],
    mismatch_policy: "Return a typed blocker and recovery step; never report success on mismatched readback.",
    child_request_count: requests.length,
    readback_request_count: readback.length,
    blockers: uniqueBlockers(blockers),
    evidence_items: evidenceItems,
    requested_controls: summarizeRequestedControls(plugin, controls),
  });
}

function stockPluginEvidenceRow(pluginMap, evidence) {
  const starterActions = STOCK_PLUGIN_STARTER_ACTIONS
    .filter((action) => action.plugin_id === pluginMap.id)
    .map((action) => action.id);
  const accepted = isCompleteBoundedFixtureEvidence(evidence);
  return deepFreeze({
    plugin_id: pluginMap.id,
    display_name: pluginMap.display_name,
    category: pluginMap.category,
    semantic_control_count: pluginMap.parameters.length,
    starter_action_ids: starterActions,
    static_map_ready: true,
    registered_macro_ready: true,
    registered_macro_execution_ready: true,
    live_evidence_status: accepted ? "bounded_fixture_accepted" : "needs_bounded_live_window",
    evidence_ref: accepted ? evidence.evidence_ref : null,
    evidence_scope: accepted ? evidence.scope : null,
    limited_claim_allowed: accepted ? evidence.claim_allowed : null,
    claim_not_allowed: accepted ? evidence.claim_not_allowed : "Do not claim live support for this plugin until bounded write/readback evidence exists.",
    customer_claim_status: accepted ? "limited_fixture_claim_only" : "no_live_claim",
    next_gate: accepted
      ? "Repeat or broaden evidence before product-wide support wording."
      : "Open a bounded live REAPER/safe-write window and run registered Macro identity, parameter write, readback, and mismatch gates.",
  });
}

function stockPluginBoundedLiveSmokePlan(rows) {
  const recommendedBatches = createStockPluginRecommendedEvidenceBatches(rows);
  return deepFreeze({
    status: "blocked_until_user_opens_bounded_live_window",
    fixture: "Disposable REAPER project with one throwaway track per plugin under test.",
    allowed_actions: [
      "create disposable tracks and insert stock FX for the selected plugin rows",
      "call list_templates and call_template for macro.set_stock_plugin_controls",
      "let the registered program execute only its fixed accepted Template dependencies",
      "require normalized readback and compare evidence before success wording",
    ],
    hard_stops: [
      "destructive, export, hardware, privacy, or filesystem-write request",
      "unresolved or stale fx_ref/plugin identity",
      "parameter metadata missing or not fresh",
      "registered Macro stage blocker or readback mismatch",
      "request to promote support/live claims beyond the bounded evidence",
    ],
    required_sequence: [
      "call_registered_macro",
      "resolve_live_fx_identity_and_parameters",
      "execute_fixed_parameter_write_stages",
      "verify_normalized_readback",
      "record_plugin_row_result",
    ],
    recommended_batches: recommendedBatches,
    per_plugin_rows: rows.map((row) => deepFreeze({
      plugin_id: row.plugin_id,
      starter_action_ids: row.starter_action_ids,
      current_status: row.live_evidence_status,
      pass_updates_to: "live_evidence_status=bounded_fixture_accepted and customer_claim_status=limited_fixture_claim_only",
    })),
  });
}

function createStockPluginRecommendedEvidenceBatches(rows) {
  const pendingIds = new Set(rows
    .filter((row) => row.live_evidence_status !== "bounded_fixture_accepted")
    .map((row) => row.plugin_id));
  return [
    {
      id: "e1.6a_dynamics_and_eq",
      plugin_ids: ["reaeq", "reacomp", "reagate", "reaxcomp", "realimit"].filter((pluginId) => pendingIds.has(pluginId)),
    },
    {
      id: "e1.6b_time_pitch_instrument",
      plugin_ids: ["readelay", "reasynth", "rs5k", "reatune", "reapitch"].filter((pluginId) => pendingIds.has(pluginId)),
    },
  ].filter((batch) => batch.plugin_ids.length > 0);
}

function createCustomerReadback({ plugin, starter, controls, blockers, humanReadback, hydrationFlow, evidencePlan }) {
  const status = evidencePlan.status;
  const requestedControls = summarizeRequestedControls(plugin, controls);
  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_CUSTOMER_READBACK_CONTRACT,
    status,
    style: "compact_musical_readback",
    success_wording_allowed: false,
    headline: customerHeadline({ plugin, starter, status, requestedControls }),
    lines: customerLines({ plugin, starter, status, requestedControls, humanReadback, hydrationFlow }),
    requested_controls: requestedControls,
    verified_controls: [],
    pending_readback_controls: humanReadback.map((item) => deepFreeze({
      control: item.control,
      label: item.label,
      phrase: item.phrase,
    })),
    do_not_say_until_readback: [
      "Done",
      "Applied",
      "Changed in REAPER",
      "The plugin is set",
    ],
    recovery_hint: customerRecoveryHint(status, blockers),
  });
}

function createAgentExecutionFlow({
  plugin,
  starter,
  controls,
  refs,
  blockers,
  resolutionRequests,
  requests,
  readback,
  hydrationFlow,
  evidencePlan,
}) {
  const blockerList = uniqueBlockers(blockers);
  const metadataOnlyBlockers = blockerList.length > 0 && blockerList.every((entry) =>
    entry.code === "PARAMETER_METADATA_REQUIRED" || entry.code === "PARAMETER_METADATA_NOT_FRESH"
  );
  const status = requests.length > 0
    ? "ready_for_child_execution_and_readback"
    : metadataOnlyBlockers && resolutionRequests.length > 0
      ? "needs_hydration_then_resume"
      : "blocked_before_agent_execution";
  const steps = createAgentExecutionSteps({
    status,
    plugin,
    refs,
    blockers: blockerList,
    resolutionRequests,
    requests,
    readback,
    evidencePlan,
  });
  return deepFreeze({
    contract: ALPHA3_E1_STOCK_PLUGIN_AGENT_EXECUTION_FLOW_CONTRACT,
    mode: "agent_runs_existing_call_template_requests",
    status,
    plugin_id: plugin?.id ?? null,
    starter_action_id: starter?.id ?? null,
    fx_ref: refs.fx_ref ?? null,
    requested_controls: summarizeRequestedControls(plugin, controls),
    hydration_status: hydrationFlow.status,
    agent_can_continue_after_task_authorization: status !== "blocked_before_agent_execution",
    execution_authority: "agent_calls_existing_call_template_requests",
    tool_surface: {
      added_tools: 0,
      execution_tool: "call_template",
      discovery_tool: "list_templates",
      state_tool: "get_state",
    },
    safety: {
      plan_only_macro: true,
      hidden_executor: false,
      public_call_recipe: false,
      raw_lua_action_shell_or_ui: false,
      alias_execution: false,
      direct_live_write_from_macro: false,
      success_wording_allowed: false,
      user_prompt_policy: "After task authorization for fx_parameter_control, continue through this flow without extra prompts unless a hard stop is hit.",
      hard_stops: [
        "destructive_or_irreversible_request",
        "export_or_filesystem_write",
        "hardware_or_privacy_boundary",
        "unresolved_or_stale_fx_identity",
        "readback_mismatch",
        "typed_child_request_blocker",
      ],
    },
    friction_reduction: {
      previous_manual_loop: "fx_ref -> hydrate -> rerun macro -> execute child requests -> readback",
      current_agent_loop: "run the listed resolution requests, resume once with fresh parameter_metadata, execute child_requests, run readback, then compare evidence",
      expected_agent_round_trips: status === "needs_hydration_then_resume" ? 2 : status === "ready_for_child_execution_and_readback" ? 1 : 0,
    },
    steps,
    child_request_count: requests.length,
    readback_request_count: readback.length,
    blockers: blockerList,
  });
}

function createAgentExecutionSteps({
  status,
  plugin,
  refs,
  blockers,
  resolutionRequests,
  requests,
  readback,
  evidencePlan,
}) {
  if (status === "needs_hydration_then_resume") {
    return [
      deepFreeze({
        id: "run_resolution_requests",
        request_source: "result.plan.resolution_requests",
        request_count: resolutionRequests.length,
        requests: resolutionRequests,
        identity_gate: plugin
          ? {
              summary_request_id: "template.fx.read_fx_summary",
              expected_plugin_id: plugin.id,
              accepted_names: [plugin.display_name, ...plugin.aliases],
              must_match_before_metadata_fresh: true,
            }
          : null,
        expected_result: "Verified stock plugin identity plus fresh parameter metadata for the requested semantic controls.",
      }),
      deepFreeze({
        id: "resume_macro_with_fresh_parameter_metadata",
        tool: "call_template",
        template_id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
        refs: { fx_ref: refs.fx_ref },
        input_policy: {
          preserve_original_input: true,
          add_parameter_metadata: "Map each requested semantic control to fresh param_index and optional param_ident from template.fx.list_fx_parameters.",
          freshness_status: "fresh",
        },
        expected_result: "A ready_for_child_execution_and_readback agent_execution_flow with child_requests and readback requests.",
      }),
      deepFreeze({
        id: "continue_with_ready_flow",
        request_source: "next_result.agent_execution_flow",
        purpose: "Follow the resumed ready flow without asking the user again when the task authorization still covers fx_parameter_control.",
      }),
    ];
  }

  if (status === "ready_for_child_execution_and_readback") {
    return [
      deepFreeze({
        id: "execute_child_requests",
        request_source: "result.child_requests",
        request_count: requests.length,
        requests,
        stop_on_first_blocker: true,
      }),
      deepFreeze({
        id: "run_readback_requests",
        request_source: "result.readback",
        request_count: readback.length,
        requests: readback,
        stop_on_first_blocker: true,
      }),
      deepFreeze({
        id: "compare_readback_to_evidence_plan",
        source_of_truth: evidencePlan.source_of_truth,
        required_after_execution: evidencePlan.required_after_execution,
        mismatch_policy: evidencePlan.mismatch_policy,
      }),
      deepFreeze({
        id: "customer_readback_gate",
        success_wording_allowed_now: false,
        success_wording_allowed_after: "All child requests and planned readbacks returned ok and matched the requested semantic controls within tolerance.",
      }),
    ];
  }

  return [
    deepFreeze({
      id: "resolve_typed_blockers",
      blockers,
      purpose: "Do not hydrate, execute, or report success until these blockers are resolved.",
    }),
  ];
}

function customerHeadline({ plugin, starter, status, requestedControls }) {
  if (!plugin) return "Stock plugin control is blocked: choose a supported REAPER stock plugin.";
  const label = starter?.label ?? plugin.display_name;
  if (status === "ready_for_execution_and_readback") {
    return `${label} is planned on ${plugin.display_name}; ${requestedControls.length} controls need execution and readback before success.`;
  }
  if (status === "needs_fresh_parameter_metadata") {
    return `${label} is planned on ${plugin.display_name}, but fresh FX parameter metadata is needed first.`;
  }
  return `${label} is blocked before stock plugin changes can be planned.`;
}

function customerLines({ plugin, starter, status, requestedControls, humanReadback, hydrationFlow }) {
  const requestedLine = requestedControls.length > 0
    ? formatPhraseList(requestedControls.map((control) => control.phrase))
    : "No supported control values are ready yet.";
  if (!plugin) {
    return [
      "I need a supported stock plugin such as ReaEQ, ReaComp, ReaDelay, RS5k, ReaTune, ReaPitch, ReaXcomp, or ReaLimit.",
      "No REAPER mutation request was emitted.",
    ];
  }
  if (status === "ready_for_execution_and_readback") {
    return [
      starter ? `Starter: ${starter.label}.` : `Plugin: ${plugin.display_name}.`,
      `Planned controls: ${formatPhraseList(humanReadback.map((item) => item.phrase))}`,
      "Next: run the emitted child requests and then read back every touched control before reporting success.",
    ];
  }
  if (status === "needs_fresh_parameter_metadata") {
    return [
      starter ? `Starter: ${starter.label}.` : `Plugin: ${plugin.display_name}.`,
      `Requested controls: ${requestedLine}.`,
      hydrationFlow.next_step,
    ];
  }
  return [
    starter ? `Starter: ${starter.label}.` : `Plugin: ${plugin.display_name}.`,
    `Requested controls: ${requestedLine}.`,
    "Resolve the typed blockers before emitting stock plugin child requests.",
  ];
}

function customerRecoveryHint(status, blockers) {
  if (status === "ready_for_execution_and_readback") {
    return "If any child request or readback fails, report the typed blocker and leave the user with a clear retry or manual-check step.";
  }
  if (status === "needs_fresh_parameter_metadata") {
    return "Refresh FX identity and parameter metadata, then call the macro again with parameter_metadata marked fresh.";
  }
  const firstBlocker = uniqueBlockers(blockers)[0];
  return firstBlocker
    ? firstBlocker.message
    : "Resolve blockers before planning stock plugin changes.";
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

function summarizeRequestedControls(pluginMap, controls) {
  return Object.entries(controls).map(([field, value]) => {
    const parameterDef = pluginMap ? resolveParameter(pluginMap, field) : null;
    return deepFreeze({
      control: field,
      label: parameterDef?.label ?? field,
      requested_value: value,
      unit: parameterDef?.unit ?? null,
      supported: Boolean(parameterDef),
      phrase: parameterDef
        ? formatReadback(parameterDef.readback_template, value)
        : `${field}: ${value}`,
    });
  });
}

function resolveRequestedControls({ starter, requestedPluginMap, plugin, controls, control_overrides, action_parameters }) {
  const blockers = [];
  const explicitControls = isPlainObject(controls) ? controls : {};
  const overrides = isPlainObject(control_overrides) ? control_overrides : {};
  const actionParameters = isPlainObject(action_parameters) ? action_parameters : {};

  if (!starter) {
    return { controls: explicitControls, blockers, action_parameters: actionParameters };
  }

  if (requestedPluginMap && plugin && requestedPluginMap.id !== starter.plugin_id) {
    blockers.push(blocker(
      "plugin",
      "STARTER_ACTION_PLUGIN_MISMATCH",
      `Starter action ${starter.id} requires ${starter.plugin_id}, but ${requestedPluginMap.id} was supplied.`,
    ));
  }

  const actionControls = { ...starter.controls };
  if (starter.tempo && starter.id === "tempo_delay") {
    const tempo = resolveTempoDelay(actionParameters, starter.tempo);
    if (tempo.ok) {
      actionControls.delay_ms = tempo.delay_ms;
    } else {
      blockers.push(blocker("action_parameters.tempo_bpm", tempo.code, tempo.message));
    }
  }

  return {
    controls: { ...actionControls, ...overrides },
    blockers,
    action_parameters: actionParameters,
  };
}

function resolveTempoDelay(actionParameters, tempoSpec) {
  const tempoBpm = actionParameters.tempo_bpm ?? actionParameters.bpm;
  if (typeof tempoBpm !== "number" || !Number.isFinite(tempoBpm) || tempoBpm <= 0) {
    return {
      ok: false,
      code: "ACTION_INPUT_REQUIRED",
      message: "tempo_delay needs a finite positive tempo_bpm so delay_ms can be calculated without guessing.",
    };
  }
  const division = typeof actionParameters.division === "string" ? actionParameters.division : tempoSpec.defaults.division;
  const beats = delayDivisionBeats(division);
  if (beats === null) {
    return {
      ok: false,
      code: "ACTION_INPUT_UNSUPPORTED",
      message: "tempo_delay division must be one of 1/4, 1/8, 1/8d, 1/8t, 1/16, or 1/16d.",
    };
  }
  return {
    ok: true,
    delay_ms: round((60_000 / tempoBpm) * beats),
  };
}

function delayDivisionBeats(division) {
  return ({
    "1/4": 1,
    "1/8": 0.5,
    "1/8d": 0.75,
    "1/8t": 1 / 3,
    "1/16": 0.25,
    "1/16d": 0.375,
  })[division] ?? null;
}

function starterAction(id, label, pluginId, summary, controls, aliases, options = {}) {
  return deepFreeze({
    id,
    label,
    plugin_id: pluginId,
    summary,
    controls,
    aliases,
    tempo: options.requires?.includes("tempo_bpm")
      ? {
          requires: options.requires,
          defaults: options.defaults ?? {},
        }
      : null,
    safety: {
      added_tools: 0,
      plan_only: true,
      requires_fresh_parameter_metadata: true,
      writes_only_through: "template.fx.set_fx_parameter_normalized",
    },
  });
}

function resolveStarterAction(actionIdOrName) {
  if (typeof actionIdOrName !== "string") return null;
  const normalized = normalizeToken(actionIdOrName);
  return STOCK_PLUGIN_STARTER_ACTIONS.find((action) =>
    normalizeToken(action.id) === normalized ||
    normalizeToken(action.label) === normalized ||
    action.aliases.some((alias) => normalizeToken(alias) === normalized)
  ) ?? null;
}

function starterSummary(starter, controls, actionParameters) {
  return {
    id: starter.id,
    label: starter.label,
    plugin_id: starter.plugin_id,
    control_count: Object.keys(controls).length,
    action_parameters: cloneJson(actionParameters ?? {}),
    summary: starter.summary,
  };
}

function hydrationNextStep(status) {
  if (status === "ready_for_child_requests") {
    return "Run the planned child call_template requests, then run planned readback requests before reporting success.";
  }
  if (status === "needs_fresh_parameter_metadata") {
    return "Run verify_fx_identity and hydrate_parameter_metadata, then call this macro again with fresh parameter_metadata.";
  }
  return "Resolve blockers before planning stock plugin parameter writes.";
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

function stockPluginControlInputSchema() {
  const reaeqBandProperties = {
    band: { type: "integer", minimum: 1, maximum: 4 },
    type: {
      enum: ["low_shelf", "band", "high_shelf", "low_pass", "high_pass", "notch"],
      description: "Optional target ReaEQ band type; topology is written and read back before exact values are compiled.",
    },
    enabled: { type: "boolean" },
    frequency_hz: { type: "number", minimum: 10, maximum: 30000 },
    gain_db: { type: "number", minimum: -60, maximum: 60 },
    bandwidth_oct: { type: "number", minimum: 0.01, maximum: 8 },
  };
  const targetProperties = {
    id: { type: "string", minLength: 1 },
    param_index: { type: "integer", minimum: 0 },
    param_ident: { type: "string", minLength: 1 },
    param_name: { type: "string", minLength: 1 },
    normalized_value: { type: "number", minimum: 0, maximum: 1 },
    display_value: { type: "string", minLength: 1, maxLength: 80 },
    requested_formatted_value: { type: "string", minLength: 1 },
  };
  const assignmentProperties = {
    id: { type: "string", minLength: 1, maxLength: 12, pattern: "^[A-Za-z0-9_-]{1,12}$" },
    fx_ref: { type: "string", minLength: 1 },
    param_index: { type: "integer", minimum: 0 },
    param_ident: { type: "string", minLength: 1 },
    param_name: { type: "string", minLength: 1 },
    normalized_value: { type: "number", minimum: 0, maximum: 1 },
    display_value: { type: "string", minLength: 1, maxLength: 80 },
    requested_formatted_value: { type: "string", minLength: 1 },
  };
  const naturalControlProperties = {
    id: { type: "string", minLength: 1, maxLength: 24, pattern: "^[A-Za-z0-9_-]{1,24}$" },
    param_index: { type: "integer", minimum: 0 },
    param_ident: { type: "string", minLength: 1 },
    param_name: { type: "string", minLength: 1 },
    natural_value: { type: "string", minLength: 1, maxLength: 80 },
    display_value: { type: "string", minLength: 1, maxLength: 80 },
    tolerance: { type: "number", minimum: 0 },
  };
  const naturalControlsSchema = {
    type: "array",
    minItems: 1,
    maxItems: 8,
    items: {
      type: "object",
      required: ["id"],
      properties: naturalControlProperties,
      additionalProperties: false,
      allOf: [
        { oneOf: [{ required: ["natural_value"] }, { required: ["display_value"] }] },
        { anyOf: [
          { required: ["param_index"] },
          { required: ["param_ident"] },
          { required: ["param_name"] },
        ] },
      ],
    },
  };
  return {
    type: "object",
    required: [],
    properties: {
      mode: { enum: ["semantic", "exact_parameters", "exact_assignments", "reaeq_bands", "inspect_set", "shared_plan"] },
      plugin: { type: "string", minLength: 1 },
      controls: {
        oneOf: [
          { type: "object", additionalProperties: true },
          naturalControlsSchema,
        ],
      },
      fx_set_ref: { type: "string", pattern: "^fx-set:v1:" },
      parameter_plan_ref: { type: "string", pattern: "^fx-parameter-plan:v1:" },
      starter_action: { type: "string", minLength: 1 },
      action_parameters: { type: "object", additionalProperties: true },
      control_overrides: { type: "object", additionalProperties: true },
      selector: { type: "object", additionalProperties: true },
      changes: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: targetProperties,
          additionalProperties: false,
          allOf: [
            { oneOf: [{ required: ["normalized_value"] }, { required: ["display_value"] }] },
            { oneOf: [
              { required: ["param_index"] },
              { required: ["param_ident"], not: { required: ["param_index"] } },
              { required: ["param_name"], not: { anyOf: [{ required: ["param_index"] }, { required: ["param_ident"] }] } },
            ] },
          ],
        },
      },
      assignments: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: {
          type: "object",
          required: ["id", "fx_ref"],
          properties: assignmentProperties,
          additionalProperties: false,
          allOf: [
            { oneOf: [{ required: ["normalized_value"] }, { required: ["display_value"] }] },
            { oneOf: [
              { required: ["param_index"] },
              { required: ["param_ident"], not: { required: ["param_index"] } },
              { required: ["param_name"], not: { anyOf: [{ required: ["param_index"] }, { required: ["param_ident"] }] } },
            ] },
          ],
        },
      },
      bands: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          required: ["band"],
          properties: reaeqBandProperties,
          additionalProperties: false,
        },
      },
      dry_run: { type: "boolean" },
    },
    additionalProperties: false,
    oneOf: [
      {
        properties: {
          mode: { const: "semantic" },
          controls: { type: "object", additionalProperties: true },
        },
        not: {
          anyOf: [
            { required: ["changes"] },
            { required: ["assignments"] },
            { required: ["bands"] },
          ],
        },
      },
      {
        // Keep oneOf length 2 for compatibility while exposing exact_parameters and exact_assignments.
        anyOf: [
          {
            required: ["mode", "changes"],
            properties: {
              mode: { const: "exact_parameters" },
            },
            not: {
              anyOf: [
                { required: ["plugin"] },
                { required: ["controls"] },
                { required: ["starter_action"] },
                { required: ["action_parameters"] },
                { required: ["control_overrides"] },
                { required: ["assignments"] },
              ],
            },
          },
          {
            required: ["mode", "assignments"],
            properties: {
              mode: { const: "exact_assignments" },
            },
            not: {
              anyOf: [
                { required: ["plugin"] },
                { required: ["controls"] },
                { required: ["starter_action"] },
                { required: ["action_parameters"] },
                { required: ["control_overrides"] },
                { required: ["selector"] },
                { required: ["changes"] },
              ],
            },
          },
          {
            required: ["mode", "bands"],
            properties: { mode: { const: "reaeq_bands" } },
            not: {
              anyOf: [
                { required: ["plugin"] },
                { required: ["controls"] },
                { required: ["starter_action"] },
                { required: ["action_parameters"] },
                { required: ["control_overrides"] },
                { required: ["changes"] },
                { required: ["assignments"] },
              ],
            },
          },
          {
            required: ["mode", "fx_set_ref"],
            properties: {
              mode: { const: "inspect_set" },
              controls: naturalControlsSchema,
            },
            not: {
              anyOf: [
                { required: ["plugin"] },
                { required: ["starter_action"] },
                { required: ["action_parameters"] },
                { required: ["control_overrides"] },
                { required: ["selector"] },
                { required: ["changes"] },
                { required: ["assignments"] },
                { required: ["bands"] },
                { required: ["parameter_plan_ref"] },
                { required: ["dry_run"] },
              ],
            },
          },
          {
            required: ["mode", "fx_set_ref"],
            properties: {
              mode: { const: "shared_plan" },
              controls: naturalControlsSchema,
            },
            oneOf: [
              { required: ["parameter_plan_ref"], not: { required: ["controls"] } },
              { required: ["controls"], not: { required: ["parameter_plan_ref"] } },
            ],
            not: {
              anyOf: [
                { required: ["plugin"] },
                { required: ["starter_action"] },
                { required: ["action_parameters"] },
                { required: ["control_overrides"] },
                { required: ["selector"] },
                { required: ["changes"] },
                { required: ["assignments"] },
                { required: ["bands"] },
              ],
            },
          },
        ],
      },
    ],
  };
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
      ...createTemplateCatalogAlpha3C3Templates(),
    ],
  });
}

function formatReadback(template, value) {
  const sign = value > 0 ? "+" : "";
  return template
    .replaceAll("{value}", String(value))
    .replaceAll("{sign}", sign);
}

function formatPhraseList(phrases) {
  const cleaned = phrases.map((phrase) => String(phrase).replace(/[.]+$/g, ""));
  return `${cleaned.join("; ")}.`;
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

function normalizeLiveEvidenceByPlugin(value) {
  if (!isPlainObject(value)) return null;
  const output = {};
  for (const [pluginId, evidence] of Object.entries(value)) {
    if (!isPlainObject(evidence)) continue;
    output[pluginId] = {
      evidence_ref: typeof evidence.evidence_ref === "string" ? evidence.evidence_ref : null,
      status: typeof evidence.status === "string" ? evidence.status : null,
      scope: typeof evidence.scope === "string" ? evidence.scope : null,
      claim_allowed: typeof evidence.claim_allowed === "string" ? evidence.claim_allowed : null,
      claim_not_allowed: typeof evidence.claim_not_allowed === "string" ? evidence.claim_not_allowed : null,
    };
  }
  return output;
}

function isCompleteBoundedFixtureEvidence(evidence) {
  return isPlainObject(evidence)
    && evidence.status === "bounded_fixture_accepted"
    && nonEmptyString(evidence.evidence_ref)
    && nonEmptyString(evidence.scope)
    && nonEmptyString(evidence.claim_allowed)
    && nonEmptyString(evidence.claim_not_allowed);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
