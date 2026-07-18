import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
  isAlpha3_3B1VisibleExecutableMacroId,
} from "./alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  createAlpha3_3B1ExactMacroExpansion,
  rankAlpha3_3B1MacroIntents,
} from "./alpha3-3-b1-agent-context-macro-guide-v1.mjs";

export const ALPHA3_4_B_DISCOVERY_MANUAL_CONTRACT = "openreaper.alpha3.4.discovery_manual_first_try.v1";
export const ALPHA3_4_B_RECOMMENDATION_CONTRACT = "openreaper.alpha3.4.macro_recommendation.v1";
export const ALPHA3_4_B_FIRST_TRY_GUIDE_CONTRACT = "openreaper.alpha3.4.first_try_execution_guide.v1";
export const ALPHA3_4_B_MANUAL_AUDIT_CONTRACT = "openreaper.alpha3.4.manual_schema_audit.v1";
export const ALPHA3_4_B_DISCOVERY_MANUAL_VERSION = "1.0.0";

const PLACEHOLDER_REF_RE = /\{[A-Z][A-Z0-9_-]*\}/u;
const GUID_PLACEHOLDER_RE = /guid:\{[^}]+\}/iu;

const MACRO_TARGET_FACTS = deepFreeze({
  "macro.project.inspect": {
    required_targets: [],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "Read-only compact project snapshot; no write targets required.",
  },
  "macro.project.query": {
    required_targets: ["entity"],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "SQLite navigation only; returns candidate refs for later live writes.",
  },
  "macro.project.delete_targets": {
    required_targets: ["exact refs or unambiguous selectors"],
    preview_or_dry_run_mandatory: true,
    identity_required: true,
    notes: "dry_run true first; exact live refs before destructive delete.",
  },
  "macro.project.apply_layout": {
    required_targets: ["layout rows"],
    preview_or_dry_run_mandatory: true,
    identity_required: false,
    notes: "Preview layout with dry_run before mutation when writing.",
  },
  "macro.project.file": {
    required_targets: ["operation"],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "save_current needs no path; save_as needs absolute target_path and overwrite:true.",
  },
  "macro.routing.apply": {
    required_targets: ["exact track/send refs"],
    preview_or_dry_run_mandatory: true,
    identity_required: true,
    notes: "Obtain canonical track/send refs via macro.project.query first; dry_run true before execute.",
  },
  "macro.media.place_assets": {
    required_targets: ["search query or asset paths"],
    preview_or_dry_run_mandatory: true,
    identity_required: false,
    notes: "Media library search/placement; dry_run for placement preview when mutating.",
  },
  "macro.items.analyze": {
    required_targets: ["selected or exact item refs"],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "Read-only analysis; selected or exact item targets.",
  },
  "macro.items.apply": {
    required_targets: ["selected or exact item refs"],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "align/move/sequence/fades/properties; selected target is accepted for several modes.",
  },
  "macro.midi.apply": {
    required_targets: ["selector or track_ref for create_clips; exact take_ref for edit modes"],
    preview_or_dry_run_mandatory: false,
    identity_required: true,
    notes: "create_clips may use selector; edit_notes/quantize/write_cc require exact take refs from query.",
  },
  "macro.fx.apply_chain": {
    required_targets: ["selector or exact track/take ref"],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "Legacy single-node plugin=reacomp accepted; chain[] is canonical multi-node when used.",
  },
  "macro.fx.set_controls": {
    required_targets: ["exact fx_ref or unambiguous selector", "semantic controls or exact_parameters changes[]"],
    preview_or_dry_run_mandatory: false,
    identity_required: true,
    notes: "mode=semantic only when native proof exists; otherwise use mode=exact_parameters with complete parameter inventory paging.",
  },
  "macro.controls.set": {
    required_targets: ["target_kind + fields, or changes[]"],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: "Project BPM needs no ref; object targets need selector or exact ref.",
  },
  "macro.automation.apply": {
    required_targets: ["exact envelope/track/fx refs"],
    preview_or_dry_run_mandatory: false,
    identity_required: true,
    notes: "Always obtain canonical envelope/track/fx refs via macro.project.query first.",
  },
  "macro.render.targets": {
    required_targets: ["target_kind + format"],
    preview_or_dry_run_mandatory: true,
    identity_required: false,
    notes: "Preview/render bounded targets; region/item targets need exact refs when not whole_project.",
  },
});

export function createAlpha34BMacroRecommendations(query, { limit = 3 } = {}) {
  if (typeof query !== "string" || query.trim() === "") {
    return deepFreeze({
      contract: ALPHA3_4_B_RECOMMENDATION_CONTRACT,
      version: ALPHA3_4_B_DISCOVERY_MANUAL_VERSION,
      query_present: false,
      recommendations: [],
      covered: false,
      task_text_persisted: false,
    });
  }
  const ids = rankAlpha3_3B1MacroIntents(query, { limit })
    .filter((id) => isAlpha3_3B1VisibleExecutableMacroId(id))
    .slice(0, 3);
  return deepFreeze({
    contract: ALPHA3_4_B_RECOMMENDATION_CONTRACT,
    version: ALPHA3_4_B_DISCOVERY_MANUAL_VERSION,
    query_present: true,
    recommendations: ids.map((id) => createRecommendationRow(id)),
    covered: ids.length > 0,
    task_text_persisted: false,
  });
}

export function createAlpha34BRecommendationRowsForIds(ids = []) {
  return deepFreeze(
    (Array.isArray(ids) ? ids : [])
      .filter((id) => isAlpha3_3B1VisibleExecutableMacroId(id))
      .slice(0, 3)
      .map((id) => createRecommendationRow(id)),
  );
}

export function createAlpha34BFirstTryExecutionGuide(id, discoveryItem = null) {
  if (!isAlpha3_3B1VisibleExecutableMacroId(id)) return null;
  const expansion = createAlpha3_3B1ExactMacroExpansion(id);
  const manual = expansion?.action_manual ?? {};
  const inputSchema = discoveryItem?.inputSchema ?? expansion?.inputSchema ?? null;
  const schemaFields = collectSchemaFields(inputSchema);
  const modes = collectAcceptedModes(inputSchema, manual);
  const targetFacts = MACRO_TARGET_FACTS[id] ?? {
    required_targets: [],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: null,
  };
  const publicExamples = collectPublicExamples(expansion, discoveryItem)
    .map((entry) => annotatePlaceholderExample(id, entry));
  const exampleAudit = publicExamples.map((entry) => auditExampleAgainstSchema(id, entry, inputSchema));
  const identityUnresolved = exampleAudit.some((entry) => entry.has_placeholder_ref);
  const nextCalls = buildFirstTryNextCalls(id, {
    identityUnresolved: targetFacts.identity_required || identityUnresolved,
    dryRunMandatory: targetFacts.preview_or_dry_run_mandatory,
    modes,
    schemaFields,
    inputSchema,
    targetFacts,
  });
  const executableMacroCall = nextCalls.find((entry) =>
    entry.tool === "call_template"
      && entry.executable_now === true
      && entry.arguments?.id === id);
  return deepFreeze({
    contract: ALPHA3_4_B_FIRST_TRY_GUIDE_CONTRACT,
    version: ALPHA3_4_B_DISCOVERY_MANUAL_VERSION,
    id,
    accepted_modes: modes,
    public_fields: schemaFields,
    units_bounds_limits: collectUnitsBoundsLimits(manual, inputSchema),
    selector_or_ref_requirements: {
      required_targets: targetFacts.required_targets,
      identity_required: targetFacts.identity_required === true,
      notes: targetFacts.notes,
    },
    paging_budget: {
      cursor: Boolean(schemaFields.includes("cursor") || /cursor/i.test(JSON.stringify(manual.input_shape ?? {}))),
      limit_field: schemaFields.includes("limit"),
      compact_response_field: schemaFields.includes("compact_response"),
      recovery: "On budget/truncation: reduce limit/fields, continue with cursor, or get_state(scope=artifact).",
    },
    preview_or_dry_run_mandatory: targetFacts.preview_or_dry_run_mandatory === true,
    executable_now: Boolean(executableMacroCall),
    non_executable_reason: executableMacroCall
      ? null
      : "The exact manual can be expanded now, but this Macro still needs the request-specific fields or live target facts listed in next_calls.",
    next_calls: nextCalls,
    example_audit: exampleAudit,
    expand: exactExpansionCall(id),
  });
}

export function attachAlpha34BFirstTryGuideToExpansion(expansion, discoveryItem = null) {
  if (!expansion || typeof expansion !== "object") return expansion;
  const guide = createAlpha34BFirstTryExecutionGuide(expansion.id, discoveryItem);
  if (!guide) return expansion;
  return deepFreeze({
    ...annotateExpansionPlaceholderExamples(expansion),
    first_try_execution_guide: guide,
  });
}

export function createAlpha34BDiscoveryManualProjection({
  query = null,
  requested_ids = [],
  discovery_items_by_id = null,
} = {}) {
  const recommendations = createAlpha34BMacroRecommendations(query);
  const requestedIds = Array.isArray(requested_ids)
    ? requested_ids.filter((id) => typeof id === "string" && isAlpha3_3B1VisibleExecutableMacroId(id))
    : [];
  const firstTryGuides = requestedIds.map((id) => {
    const discoveryItem = discovery_items_by_id?.get?.(id) ?? discovery_items_by_id?.[id] ?? null;
    return createAlpha34BFirstTryExecutionGuide(id, discoveryItem);
  }).filter(Boolean);
  return deepFreeze({
    contract: ALPHA3_4_B_DISCOVERY_MANUAL_CONTRACT,
    version: ALPHA3_4_B_DISCOVERY_MANUAL_VERSION,
    recommendations,
    first_try_guides: firstTryGuides,
    task_text_persisted: false,
    search_phrases_are_metadata_only: true,
    hidden_ids_executable: false,
    call_recipe_exposed: false,
  });
}

export function auditAlpha34BVisibleManuals({ discovery_items_by_id = null } = {}) {
  const findings = [];
  for (const id of ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS) {
    const expansion = createAlpha3_3B1ExactMacroExpansion(id);
    const discoveryItem = discovery_items_by_id?.get?.(id) ?? discovery_items_by_id?.[id] ?? null;
    const inputSchema = discoveryItem?.inputSchema ?? null;
    if (!expansion) {
      findings.push(finding(id, "EXPANSION_MISSING", "Exact expansion is missing for a visible Macro."));
      continue;
    }
    if (expansion.id !== id) {
      findings.push(finding(id, "EXPANSION_ID_MISMATCH", `Expansion id ${expansion.id} diverges from requested ${id}.`));
    }
    const manual = expansion.action_manual ?? {};
    const modes = collectAcceptedModes(inputSchema, manual);
    if (id === "macro.midi.apply" && !modes.includes("create_clips")) {
      findings.push(finding(id, "MIDI_CREATE_CLIPS_MODE_MISSING", "macro.midi.apply must expose create_clips mode."));
    }
    if (id === "macro.items.apply" && !modes.includes("apply_fades")) {
      findings.push(finding(id, "ITEMS_APPLY_FADES_MODE_MISSING", "macro.items.apply must expose apply_fades mode."));
    }
    const guide = createAlpha34BFirstTryExecutionGuide(id, discoveryItem);
    for (const audit of guide.example_audit) {
      if (audit.unknown_fields.length > 0) {
        findings.push(finding(id, "EXAMPLE_UNKNOWN_FIELD", `Example uses unknown fields: ${audit.unknown_fields.join(",")}.`, {
          example_name: audit.name,
          unknown_fields: audit.unknown_fields,
        }));
      }
      if (audit.invalid_mode) {
        findings.push(finding(id, "EXAMPLE_INVALID_MODE", `Example mode is not accepted: ${audit.mode}.`, {
          example_name: audit.name,
          mode: audit.mode,
        }));
      }
      if (audit.has_placeholder_ref && audit.executable_now !== false) {
        findings.push(finding(id, "EXAMPLE_EXECUTABLE_PLACEHOLDER", "Example presents placeholder refs as if executable without prerequisite.", {
          example_name: audit.name,
        }));
      }
    }
    for (const next of guide.next_calls) {
      if (next.tool === "call_template" && typeof next.arguments?.id === "string") {
        const nextId = next.arguments.id;
        if (nextId.startsWith("macro.") && !isAlpha3_3B1VisibleExecutableMacroId(nextId) && nextId !== "macro.project.query") {
          findings.push(finding(id, "NEXT_CALL_HIDDEN_ID", `next_call uses non-visible Macro id ${nextId}.`));
        }
      }
      if (next.tool === "list_templates" && Array.isArray(next.arguments?.ids)) {
        for (const nextId of next.arguments.ids) {
          if (typeof nextId === "string" && nextId.startsWith("macro.") && !isAlpha3_3B1VisibleExecutableMacroId(nextId)) {
            findings.push(finding(id, "NEXT_CALL_HIDDEN_ID", `next_call expansion uses non-visible Macro id ${nextId}.`));
          }
        }
      }
    }
  }
  return deepFreeze({
    contract: ALPHA3_4_B_MANUAL_AUDIT_CONTRACT,
    version: ALPHA3_4_B_DISCOVERY_MANUAL_VERSION,
    ok: findings.length === 0,
    macro_count: ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length,
    findings,
  });
}

export function enrichAlpha34BRuntimeError(error, request = null) {
  if (!isPlainObject(error)) return error;
  const code = error.code;
  const details = isPlainObject(error.details) ? error.details : {};
  let nextCall = null;
  let requestPatch = null;

  if (code === "CALL_TEMPLATE_ID_REPLACED" && typeof details.replacement === "string") {
    nextCall = {
      tool: "call_template",
      arguments: {
        id: details.replacement,
        input: isPlainObject(details.replacement_input) ? details.replacement_input : {},
      },
    };
  } else if (code === "RESPONSE_TOO_LARGE" || error.failure_layer === "response_budget") {
    const action = error.recommended_next_action;
    if (isPlainObject(action?.request_patch)) {
      requestPatch = action.request_patch;
      nextCall = {
        tool: "call_template",
        arguments: mergeRequestPatch(request, requestPatch),
      };
    } else {
      nextCall = {
        tool: "list_templates",
        arguments: {
          ids: typeof request?.id === "string" ? [request.id] : undefined,
          fields: ["id", "inputSchema"],
        },
      };
    }
  } else if (error.failure_layer === "server_validation" || code === "CALL_TEMPLATE_REQUEST_INVALID") {
    if (typeof request?.id === "string" && request.id.startsWith("macro.")) {
      nextCall = exactExpansionCall(request.id);
    } else {
      nextCall = { tool: "ping", arguments: {} };
    }
  } else if (error.failure_layer === "transport_write" || error.failure_layer === "bridge_timeout" || error.failure_layer === "bridge_response") {
    nextCall = { tool: "ping", arguments: {} };
  }

  const enriched = {
    ...error,
    ...(nextCall ? { next_call: nextCall } : {}),
    ...(requestPatch ? { request_patch: requestPatch } : {}),
  };
  return enriched;
}

export function assertAlpha34BRecommendationShape(row) {
  if (!isPlainObject(row)) throw new Error("recommendation must be object");
  if (!isAlpha3_3B1VisibleExecutableMacroId(row.id)) throw new Error(`invalid recommendation id: ${row.id}`);
  if (row.id !== row.id.toLowerCase()) throw new Error("recommendation id must be lowercase");
  if (!isPlainObject(row.exact_expansion_call) || row.exact_expansion_call.tool !== "list_templates") {
    throw new Error("recommendation requires list_templates exact expansion call");
  }
  if (!Array.isArray(row.required_target_facts)) throw new Error("required_target_facts must be array");
  if (typeof row.preview_or_dry_run_mandatory !== "boolean") throw new Error("preview_or_dry_run_mandatory must be boolean");
  if (!isPlainObject(row.typed_template_fallback)) throw new Error("typed_template_fallback required");
  return true;
}

function createRecommendationRow(id) {
  const facts = MACRO_TARGET_FACTS[id] ?? {
    required_targets: [],
    preview_or_dry_run_mandatory: false,
    identity_required: false,
    notes: null,
  };
  return {
    id,
    exact_expansion_call: exactExpansionCall(id),
    required_target_facts: [...facts.required_targets],
    preview_or_dry_run_mandatory: facts.preview_or_dry_run_mandatory === true,
    identity_required: facts.identity_required === true,
    notes: facts.notes,
    typed_template_fallback: {
      allowed: true,
      only_after_typed_reason: true,
      reasons: [
        "macro_missing_for_task",
        "macro_task_out_of_scope",
        "macro_target_ambiguous_or_unavailable",
        "macro_domain_not_accepted",
        "macro_budget_prefers_atomic_template",
      ],
      discovery: { tool: "list_templates", arguments: { surface: "catalog", query: "one bounded capability phrase", limit: 25 } },
    },
  };
}

function exactExpansionCall(id) {
  return {
    tool: "list_templates",
    executable_now: true,
    arguments: {
      ids: [id],
      fields: ["id", "inputSchema"],
    },
    purpose: "Expand the exact public manual and current input schema before constructing a call_template request.",
  };
}

function buildFirstTryNextCalls(id, {
  identityUnresolved,
  dryRunMandatory,
  modes,
  inputSchema,
  targetFacts,
}) {
  const calls = [
    exactExpansionCall(id),
  ];
  if (identityUnresolved) {
    calls.unshift({
      tool: "call_template",
      executable_now: true,
      arguments: {
        id: "macro.project.query",
        input: {
          entity: defaultQueryEntityFor(id),
          limit: 25,
          refresh_policy: "if_stale",
        },
      },
      purpose: "Obtain canonical live refs before mutation; do not invent placeholder refs.",
    });
  }
  if (dryRunMandatory) {
    calls.push({
      tool: "call_template",
      executable_now: false,
      arguments: {
        id,
        input: { dry_run: true },
      },
      missing_fields: collectMissingRequiredFields(inputSchema, { dry_run: true }),
      missing_target_facts: [...(targetFacts?.required_targets ?? [])],
      purpose: "Non-executable skeleton: add the operation-specific fields and live target facts, then preview with dry_run:true.",
    });
  } else if (modes.includes("create_clips") && id === "macro.midi.apply") {
    calls.push({
      tool: "call_template",
      executable_now: false,
      arguments: {
        id,
        input: {
          mode: "create_clips",
          start_seconds: 0,
          end_seconds: 2,
          notes: [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }],
          selector: { name: "Instrument" },
          dry_run: true,
        },
      },
      missing_fields: [],
      missing_target_facts: ["an existing unambiguous destination Track selector or canonical track_ref"],
      purpose: "Schema-valid create_clips dry-run shape; replace the example Track selector with a live-resolved destination before execution.",
    });
  }
  if (id === "macro.project.inspect") {
    calls.push({
      tool: "call_template",
      executable_now: true,
      arguments: {
        id,
        input: {
          include: ["project_path", "dirty_state", "selected_context"],
          refresh_policy: "if_stale",
          limit: 25,
        },
      },
      purpose: "Run a bounded read-only project inspection without guessing live identities.",
    });
  } else if (id === "macro.project.query") {
    calls.push({
      tool: "call_template",
      executable_now: true,
      arguments: {
        id,
        input: {
          entity: "status",
          limit: 25,
          refresh_policy: "if_stale",
        },
      },
      purpose: "Run a bounded read-only index status query before choosing a narrower entity query.",
    });
  } else if (id === "macro.items.analyze") {
    calls.push({
      tool: "call_template",
      executable_now: true,
      arguments: {
        id,
        input: {
          profile: "quick",
          target: "selected",
          limit: 4,
        },
      },
      purpose: "Analyze the current REAPER selection without inventing Item refs.",
    });
  }
  return calls;
}

function collectMissingRequiredFields(inputSchema, input) {
  if (!isPlainObject(inputSchema)) return [];
  const candidates = [];
  if (Array.isArray(inputSchema.required)) candidates.push(inputSchema.required);
  if (Array.isArray(inputSchema.oneOf)) {
    for (const branch of inputSchema.oneOf) {
      if (Array.isArray(branch?.required)) candidates.push(branch.required);
    }
  }
  if (candidates.length === 0) return [];
  const missing = candidates
    .map((required) => required.filter((field) => input?.[field] === undefined))
    .sort((left, right) => left.length - right.length)[0];
  return [...new Set(missing)];
}

function defaultQueryEntityFor(id) {
  if (id === "macro.midi.apply") return "takes";
  if (id === "macro.automation.apply") return "automation";
  if (id === "macro.routing.apply") return "routing";
  if (id === "macro.fx.apply_chain" || id === "macro.fx.set_controls") return "fx";
  if (id === "macro.items.apply" || id === "macro.items.analyze") return "items";
  return "tracks";
}

function collectAcceptedModes(inputSchema, manual) {
  const modes = new Set();
  if (inputSchema?.oneOf) {
    for (const branch of inputSchema.oneOf) {
      const mode = branch?.properties?.mode;
      if (mode?.const) modes.add(mode.const);
      if (Array.isArray(mode?.enum)) mode.enum.forEach((value) => modes.add(value));
    }
  }
  const direct = inputSchema?.properties?.mode;
  if (direct?.const) modes.add(direct.const);
  if (Array.isArray(direct?.enum)) direct.enum.forEach((value) => modes.add(value));
  if (typeof manual?.input_shape?.mode === "string") {
    for (const part of manual.input_shape.mode.split("|")) {
      const token = part.split(";")[0].trim();
      if (/^[a-z][a-z0-9_]*$/u.test(token)) modes.add(token);
    }
  }
  return [...modes];
}

function collectSchemaFields(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object") return [];
  const fields = new Set();
  if (inputSchema.properties && typeof inputSchema.properties === "object") {
    for (const key of Object.keys(inputSchema.properties)) fields.add(key);
  }
  if (Array.isArray(inputSchema.oneOf)) {
    for (const branch of inputSchema.oneOf) {
      if (branch?.properties) {
        for (const key of Object.keys(branch.properties)) fields.add(key);
      }
    }
  }
  return [...fields];
}

function collectUnitsBoundsLimits(manual, inputSchema) {
  const shape = manual?.input_shape && typeof manual.input_shape === "object" ? manual.input_shape : {};
  return {
    input_shape_keys: Object.keys(shape),
    schema_field_count: collectSchemaFields(inputSchema).length,
    notes: Object.fromEntries(
      Object.entries(shape)
        .filter(([, value]) => typeof value === "string")
        .slice(0, 24),
    ),
  };
}

function collectPublicExamples(expansion, discoveryItem) {
  const fromManual = Array.isArray(expansion?.action_manual?.examples)
    ? expansion.action_manual.examples.map((entry, index) => ({
      name: entry?.name ?? `manual_${index}`,
      input: entry?.input ?? entry,
      source: "action_manual",
      executable_now: entry?.executable_now,
      non_executable_reason: entry?.non_executable_reason,
      prerequisite: entry?.prerequisite,
    }))
    : [];
  const fromDiscovery = Array.isArray(discoveryItem?.examples)
    ? discoveryItem.examples.map((entry, index) => ({
      name: entry?.name ?? `discovery_${index}`,
      input: entry?.input ?? entry,
      source: "discovery",
      executable_now: entry?.executable_now,
      non_executable_reason: entry?.non_executable_reason,
      prerequisite: entry?.prerequisite,
    }))
    : [];
  return [...fromManual, ...fromDiscovery];
}

function auditExampleAgainstSchema(id, example, inputSchema) {
  const input = isPlainObject(example?.input) ? example.input : (isPlainObject(example) ? example : {});
  const text = JSON.stringify(input);
  const hasPlaceholder = PLACEHOLDER_REF_RE.test(text) || GUID_PLACEHOLDER_RE.test(text);
  const schemaFields = collectSchemaFields(inputSchema);
  const unknown = schemaFields.length > 0
    ? Object.keys(input).filter((field) => !schemaFields.includes(field) && !isOneOfAllowed(field, inputSchema, input))
    : [];
  const modes = collectAcceptedModes(inputSchema, {});
  const mode = typeof input.mode === "string" ? input.mode : null;
  const invalidMode = mode !== null && modes.length > 0 && !modes.includes(mode);
  const explicitlyNonExecutable = example?.executable_now === false;
  const executablePlaceholder = hasPlaceholder && !explicitlyNonExecutable;
  return {
    name: example?.name ?? null,
    source: example?.source ?? null,
    mode,
    has_placeholder_ref: hasPlaceholder,
    executable_now: hasPlaceholder ? false : (typeof example?.executable_now === "boolean" ? example.executable_now : null),
    non_executable_reason: hasPlaceholder
      ? example?.non_executable_reason ?? "Placeholder refs are documentation only; resolve canonical live refs before calling the Macro."
      : example?.non_executable_reason ?? null,
    prerequisite: hasPlaceholder ? example?.prerequisite ?? exactExpansionCall(id) : example?.prerequisite ?? null,
    unknown_fields: unknown,
    invalid_mode: invalidMode,
    executable_placeholder: executablePlaceholder,
    schema_checked: schemaFields.length > 0,
  };
}

function annotateExpansionPlaceholderExamples(expansion) {
  const examples = expansion?.action_manual?.examples;
  if (!Array.isArray(examples)) return expansion;
  return {
    ...expansion,
    action_manual: {
      ...expansion.action_manual,
      examples: examples.map((entry, index) => {
        const projected = annotatePlaceholderExample(expansion.id, {
          name: entry?.name ?? `manual_${index}`,
          input: entry?.input ?? entry,
          source: "action_manual",
        });
        if (projected.executable_now !== false) return entry;
        return {
          ...entry,
          executable_now: false,
          non_executable_reason: projected.non_executable_reason,
          prerequisite: projected.prerequisite,
        };
      }),
    },
  };
}

function annotatePlaceholderExample(id, example) {
  const input = isPlainObject(example?.input) ? example.input : {};
  const text = JSON.stringify(input);
  const hasPlaceholder = PLACEHOLDER_REF_RE.test(text) || GUID_PLACEHOLDER_RE.test(text);
  if (!hasPlaceholder) return example;
  return {
    ...example,
    executable_now: false,
    non_executable_reason: "Placeholder refs are documentation only; resolve canonical live refs before calling the Macro.",
    prerequisite: {
      tool: "call_template",
      executable_now: true,
      arguments: {
        id: "macro.project.query",
        input: {
          entity: defaultQueryEntityFor(id),
          limit: 25,
          refresh_policy: "if_stale",
        },
      },
    },
  };
}

function isOneOfAllowed(field, inputSchema, input) {
  if (!Array.isArray(inputSchema?.oneOf)) return false;
  return inputSchema.oneOf.some((branch) => {
    if (!branch?.properties || !Object.hasOwn(branch.properties, field)) return false;
    if (branch.required?.includes("mode") && input.mode !== undefined) {
      const mode = branch.properties.mode;
      if (mode?.const && input.mode !== mode.const) return false;
      if (Array.isArray(mode?.enum) && !mode.enum.includes(input.mode)) return false;
    }
    return true;
  });
}

function mergeRequestPatch(request, patch) {
  const base = isPlainObject(request) ? { ...request } : {};
  if (isPlainObject(patch?.budget)) {
    base.budget = { ...(isPlainObject(base.budget) ? base.budget : {}), ...patch.budget };
  }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === "budget") continue;
    base[key] = value;
  }
  if (typeof base.id !== "string" && typeof request?.id === "string") base.id = request.id;
  if (!isPlainObject(base.input) && isPlainObject(request?.input)) base.input = request.input;
  return base;
}

function finding(id, code, message, details = null) {
  return { id, code, message, ...(details ? { details } : {}) };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
