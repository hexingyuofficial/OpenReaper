export const ALPHA3_4_C_FX_SEMANTIC_TRUTH_CONTRACT = "openreaper.alpha3.4.fx_semantic_truth.v1";
export const ALPHA3_4_C_FX_SEMANTIC_TRUTH_VERSION = "1.0.0";
export const ALPHA3_4_C_FX_SET_CONTROLS_MODES = Object.freeze(["semantic", "exact_parameters", "reaeq_bands"]);
export const ALPHA3_4_C_EXACT_PARAMETER_MAX_CHANGES = 8;
export const ALPHA3_4_C_PARAMETER_PAGE_HARD_CEILING = 4096;
export const ALPHA3_4_C_PARAMETER_PAGE_LIMIT = 128;
export const STOCK_SEMANTIC_UNIT_UNPROVEN = "STOCK_SEMANTIC_UNIT_UNPROVEN";

const STOCK_PLUGIN_CONTROL_CATALOG = deepFreeze([
  plugin("reaeq", "ReaEQ", ["high_pass_frequency_hz", "low_mid_gain_db", "presence_gain_db", "air_gain_db"]),
  plugin("reacomp", "ReaComp", ["threshold_db", "ratio", "attack_ms", "release_ms", "wet_mix_percent"]),
  plugin("reagate", "ReaGate", ["threshold_db", "hysteresis_db", "attack_ms", "hold_ms", "release_ms"]),
  plugin("readelay", "ReaDelay", ["delay_ms", "feedback_percent", "wet_mix_percent", "low_pass_hz"]),
  plugin("reasynth", "ReaSynth", ["volume_db", "attack_ms", "decay_ms", "sustain_percent", "release_ms"]),
  plugin("rs5k", "ReaSamplOmatic5000", ["volume_db", "pitch_semitones", "attack_ms", "release_ms"]),
  plugin("reatune", "ReaTune", ["correction_amount_percent", "attack_ms", "formant_shift"]),
  plugin("reapitch", "ReaPitch", ["shift_semitones", "fine_cents", "formant_shift", "wet_mix_percent"]),
  plugin("reaxcomp", "ReaXcomp", ["band_threshold_db", "band_ratio", "band_attack_ms", "band_release_ms", "band_gain_db"]),
  plugin("realimit", "ReaLimit", ["threshold_db", "ceiling_db", "release_ms", "lookahead_ms"]),
]);

const NATIVE_PROOF_RECORDS = deepFreeze({});

export function listAlpha34CStockSemanticControls() {
  const controls = [];
  for (const pluginEntry of STOCK_PLUGIN_CONTROL_CATALOG) {
    for (const controlId of pluginEntry.controls) {
      const proof = NATIVE_PROOF_RECORDS[`${pluginEntry.id}.${controlId}`] ?? null;
      controls.push({
        plugin_id: pluginEntry.id,
        plugin_display_name: pluginEntry.display_name,
        control_id: controlId,
        proof_status: proof ? "native_low_mid_high_proven" : "unproven",
        native_proof: proof,
        executable_semantic_conversion: Boolean(proof),
      });
    }
  }
  return deepFreeze({
    contract: ALPHA3_4_C_FX_SEMANTIC_TRUTH_CONTRACT,
    version: ALPHA3_4_C_FX_SEMANTIC_TRUTH_VERSION,
    plugin_count: STOCK_PLUGIN_CONTROL_CATALOG.length,
    control_count: controls.length,
    plugins: STOCK_PLUGIN_CONTROL_CATALOG.map((entry) => ({
      id: entry.id,
      display_name: entry.display_name,
      control_ids: entry.controls,
    })),
    controls,
  });
}

export function getAlpha34CSemanticProofStatus(pluginId, controlId) {
  const key = `${pluginId}.${controlId}`;
  const proof = NATIVE_PROOF_RECORDS[key] ?? null;
  return deepFreeze({
    plugin_id: pluginId,
    control_id: controlId,
    proof_status: proof ? "native_low_mid_high_proven" : "unproven",
    native_proof: proof,
    executable: Boolean(proof),
  });
}

export function assertAlpha34CSemanticUnitsProven(pluginId, controlIds = []) {
  const unproven = [];
  for (const controlId of controlIds) {
    const status = getAlpha34CSemanticProofStatus(pluginId, controlId);
    if (!status.executable) unproven.push(controlId);
  }
  if (unproven.length === 0) return { ok: true, unproven: [] };
  return {
    ok: false,
    code: STOCK_SEMANTIC_UNIT_UNPROVEN,
    unproven,
    message: `Semantic unit conversion is unproven for ${pluginId}: ${unproven.join(", ")}. Use mode=exact_parameters with native param_index after listing parameters.`,
    recovery: createExactParametersRecoveryCall({
      plugin_id: pluginId,
      unproven_controls: unproven,
    }),
  };
}

export function createExactParametersRecoveryCall({
  plugin_id = null,
  unproven_controls = [],
  fx_ref = null,
} = {}) {
  if (typeof fx_ref !== "string" || !fx_ref.startsWith("fx:")) return null;
  return deepFreeze({
    tool: "call_template",
    arguments: {
      id: "template.fx.list_fx_parameters",
      input: { limit: ALPHA3_4_C_PARAMETER_PAGE_LIMIT, offset: 0 },
      refs: { fx_ref },
    },
    recovery_context: {
      plugin_id,
      unproven_controls: unproven_controls.slice(0, ALPHA3_4_C_EXACT_PARAMETER_MAX_CHANGES),
      continue_until_inventory_complete: true,
      next_macro: "macro.fx.set_controls",
      next_mode: "exact_parameters",
    },
    instruction: "Follow every next_offset until inventory_complete=true, choose returned exact param_index/param_ident values, then call macro.fx.set_controls mode=exact_parameters.",
  });
}

export function normalizeAlpha34CFxSetControlsInput(input = {}) {
  if (Object.hasOwn(input, "dry_run") && typeof input.dry_run !== "boolean") {
    return {
      ok: false,
      code: "FX_SET_CONTROLS_DRY_RUN_INVALID",
      message: "dry_run must be a boolean when supplied.",
    };
  }
  const mode = typeof input.mode === "string" && input.mode.trim() !== ""
    ? input.mode.trim()
    : "semantic";
  if (!ALPHA3_4_C_FX_SET_CONTROLS_MODES.includes(mode)) {
    return {
      ok: false,
      code: "FX_SET_CONTROLS_MODE_UNSUPPORTED",
      message: `mode must be one of ${ALPHA3_4_C_FX_SET_CONTROLS_MODES.join(" | ")}.`,
    };
  }
  if (mode === "reaeq_bands") {
    const bands = Array.isArray(input.bands) ? input.bands : null;
    if (!bands || bands.length < 1 || bands.length > 4) {
      return { ok: false, code: "FX_REAEQ_BANDS_INVALID", message: "reaeq_bands requires 1 through 4 band rows." };
    }
    const seen = new Set();
    const normalizedBands = [];
    const allowed = new Set(["band", "type", "enabled", "frequency_hz", "gain_db", "bandwidth_oct"]);
    const types = new Set(["low_shelf", "band", "high_shelf", "low_pass", "high_pass", "notch"]);
    for (let index = 0; index < bands.length; index += 1) {
      const row = bands[index];
      if (!isPlainObject(row) || Object.keys(row).some((key) => !allowed.has(key))) {
        return { ok: false, code: "FX_REAEQ_BAND_ROW_INVALID", message: `bands[${index}] contains unsupported fields.` };
      }
      if (!Number.isInteger(row.band) || row.band < 1 || row.band > 4 || seen.has(row.band)) {
        return { ok: false, code: "FX_REAEQ_BAND_INDEX_INVALID", message: `bands[${index}].band must be a unique integer from 1 through 4.` };
      }
      if (row.type !== undefined && !types.has(row.type)) {
        return { ok: false, code: "FX_REAEQ_BAND_TYPE_INVALID", message: `bands[${index}].type is not an approved ReaEQ topology assertion.` };
      }
      for (const [field, min, max] of [["frequency_hz", 10, 30000], ["gain_db", -60, 60], ["bandwidth_oct", 0.01, 8]]) {
        if (row[field] !== undefined && (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < min || row[field] > max)) {
          return { ok: false, code: "FX_REAEQ_BAND_VALUE_INVALID", message: `bands[${index}].${field} is outside the bounded native range.` };
        }
      }
      if (row.enabled !== undefined && typeof row.enabled !== "boolean") {
        return { ok: false, code: "FX_REAEQ_BAND_ENABLED_INVALID", message: `bands[${index}].enabled must be boolean.` };
      }
      seen.add(row.band);
      normalizedBands.push({ ...row });
    }
    return { ok: true, mode, dry_run: input.dry_run === true, bands: normalizedBands, selector: isPlainObject(input.selector) ? input.selector : null };
  }
  if (mode === "exact_parameters") {
    const changes = Array.isArray(input.changes) ? input.changes : null;
    if (!changes || changes.length < 1 || changes.length > ALPHA3_4_C_EXACT_PARAMETER_MAX_CHANGES) {
      return {
        ok: false,
        code: "FX_EXACT_PARAMETERS_CHANGES_INVALID",
        message: `exact_parameters requires changes[] with 1 through ${ALPHA3_4_C_EXACT_PARAMETER_MAX_CHANGES} rows.`,
      };
    }
    const seenIds = new Set();
    const seenTargets = new Set();
    const normalizedChanges = [];
    for (let index = 0; index < changes.length; index += 1) {
      const row = changes[index];
      if (!isPlainObject(row)) {
        return { ok: false, code: "FX_EXACT_PARAMETERS_ROW_INVALID", message: `changes[${index}] must be an object.` };
      }
      const id = typeof row.id === "string" && row.id.trim() !== "" ? row.id.trim() : `change_${index + 1}`;
      if (seenIds.has(id)) {
        return { ok: false, code: "FX_EXACT_PARAMETERS_DUPLICATE_ID", message: `Duplicate changes id ${id}.` };
      }
      seenIds.add(id);
      const hasIndex = Number.isInteger(row.param_index) && row.param_index >= 0;
      const hasName = typeof row.param_name === "string" && row.param_name.trim() !== "";
      const hasIdent = typeof row.param_ident === "string" && row.param_ident.trim() !== "";
      if (!hasIndex && !hasName && !hasIdent) {
        return {
          ok: false,
          code: "FX_EXACT_PARAMETERS_TARGET_REQUIRED",
          message: `changes[${index}] requires param_index, or one exact param_name/param_ident.`,
        };
      }
      if (typeof row.normalized_value !== "number" || !Number.isFinite(row.normalized_value) || row.normalized_value < 0 || row.normalized_value > 1) {
        return {
          ok: false,
          code: "FX_EXACT_PARAMETERS_VALUE_INVALID",
          message: `changes[${index}].normalized_value must be a finite number in [0,1].`,
        };
      }
      const targetKey = hasIndex
        ? `index:${row.param_index}`
        : hasIdent
          ? `ident:${row.param_ident.trim().toLowerCase()}`
          : `name:${row.param_name.trim().toLowerCase()}`;
      if (seenTargets.has(targetKey)) {
        return { ok: false, code: "FX_EXACT_PARAMETERS_DUPLICATE_TARGET", message: `Duplicate parameter target ${targetKey}.` };
      }
      seenTargets.add(targetKey);
      normalizedChanges.push({
        id,
        param_index: hasIndex ? row.param_index : null,
        param_ident: hasIdent ? row.param_ident.trim() : null,
        param_name: hasName ? row.param_name.trim() : null,
        normalized_value: row.normalized_value,
        requested_formatted_value: typeof row.requested_formatted_value === "string" ? row.requested_formatted_value : null,
      });
    }
    return {
      ok: true,
      mode: "exact_parameters",
      dry_run: input.dry_run === true,
      changes: normalizedChanges,
      selector: isPlainObject(input.selector) ? input.selector : null,
    };
  }
  return {
    ok: true,
    mode: "semantic",
    dry_run: input.dry_run === true,
    controls: isPlainObject(input.controls) ? input.controls : {},
    starter_action: input.starter_action ?? null,
    plugin: input.plugin ?? input.plugin_id ?? input.plugin_name ?? null,
    selector: isPlainObject(input.selector) ? input.selector : null,
    action_parameters: isPlainObject(input.action_parameters) ? input.action_parameters : {},
    control_overrides: isPlainObject(input.control_overrides) ? input.control_overrides : {},
  };
}

export async function hydrateCompleteFxParameterInventory({
  executeAtomic,
  request,
  fxRef,
  listTemplateId = "template.fx.list_fx_parameters",
  pageLimit = ALPHA3_4_C_PARAMETER_PAGE_LIMIT,
  hardCeiling = ALPHA3_4_C_PARAMETER_PAGE_HARD_CEILING,
  budget = { max_response_bytes: 120_000, max_items: 1_000, max_inline_value_bytes: 12_000 },
} = {}) {
  if (typeof executeAtomic !== "function") {
    return { ok: false, code: "FX_PARAMETER_LIST_EXECUTOR_UNAVAILABLE", message: "exact_parameters needs the managed atomic route." };
  }
  const rows = [];
  const seenIndexes = new Set();
  let offset = 0;
  let pages = 0;
  let totalCount = null;
  let inventoryComplete = false;
  while (rows.length < hardCeiling) {
    pages += 1;
    const execution = await executeAtomic({
      id: listTemplateId,
      input: { limit: pageLimit, offset },
      refs: { fx_ref: fxRef },
      context: request?.context,
      budget,
      idempotency_key: request?.idempotency_key ? `${request.idempotency_key}:list:${offset}` : undefined,
    });
    if (execution?.ok !== true) {
      return {
        ok: false,
        code: execution?.error?.code ?? "FX_PARAMETER_LIST_FAILED",
        message: execution?.error?.message ?? "template.fx.list_fx_parameters failed.",
        execution,
      };
    }
    const payload = execution?.result?.data
      ?? execution?.result?.readback
      ?? execution?.result?.summary
      ?? execution?.result
      ?? {};
    const pageRows = Array.isArray(payload.parameters) ? payload.parameters : [];
    if (!Number.isInteger(payload.parameter_count) || payload.parameter_count < 0) {
      return {
        ok: false,
        code: "FX_PARAMETER_INVENTORY_COUNT_INVALID",
        message: "Parameter paging did not return one valid total parameter_count.",
        rows_collected: rows.length,
      };
    }
    if (totalCount !== null && totalCount !== payload.parameter_count) {
      return {
        ok: false,
        code: "FX_PARAMETER_INVENTORY_COUNT_CHANGED",
        message: "The live FX parameter count changed during paging; retry from a fresh snapshot.",
        rows_collected: rows.length,
      };
    }
    totalCount = payload.parameter_count;
    if (totalCount > hardCeiling) {
      return {
        ok: false,
        code: "FX_PARAMETER_INVENTORY_CEILING_EXCEEDED",
        message: `FX parameter inventory exceeded the hard ceiling of ${hardCeiling}.`,
        parameter_count: totalCount,
        rows_collected: rows.length,
      };
    }
    if (Number.isInteger(payload.offset) && payload.offset !== offset) {
      return {
        ok: false,
        code: "FX_PARAMETER_LIST_OFFSET_MISMATCH",
        message: "Parameter paging returned a different offset than requested.",
        requested_offset: offset,
        observed_offset: payload.offset,
        rows_collected: rows.length,
      };
    }
    for (const row of pageRows) {
      const paramIndex = row?.param_index;
      if (!Number.isInteger(paramIndex) || paramIndex < 0 || paramIndex >= totalCount || seenIndexes.has(paramIndex)) {
        return {
          ok: false,
          code: "FX_PARAMETER_INVENTORY_ROW_INVALID",
          message: "Parameter paging returned a missing, out-of-range, or duplicate param_index.",
          param_index: Number.isInteger(paramIndex) ? paramIndex : null,
          rows_collected: rows.length,
        };
      }
      seenIndexes.add(paramIndex);
      rows.push(row);
    }
    const nextOffset = Object.hasOwn(payload, "next_offset") ? payload.next_offset : null;
    const truncated = payload.truncated === true || payload.coverage_status === "paged";
    inventoryComplete = payload.inventory_complete === true
      && payload.coverage_status === "complete"
      && nextOffset === null
      && !truncated
      && rows.length === totalCount;
    if (inventoryComplete) break;
    if (nextOffset === null || nextOffset === undefined || pageRows.length === 0) break;
    if (!Number.isInteger(nextOffset) || nextOffset <= offset) {
      return {
        ok: false,
        code: "FX_PARAMETER_LIST_PAGING_STALLED",
        message: "Parameter paging did not advance; complete coverage could not be proven.",
        rows_collected: rows.length,
      };
    }
    if (nextOffset !== offset + pageRows.length) {
      return {
        ok: false,
        code: "FX_PARAMETER_LIST_PAGING_GAP",
        message: "Parameter paging skipped or overlapped rows; complete coverage could not be proven.",
        rows_collected: rows.length,
        requested_offset: offset,
        next_offset: nextOffset,
      };
    }
    offset = nextOffset;
  }
  if (!inventoryComplete) {
    return {
      ok: false,
      code: "FX_PARAMETER_INVENTORY_INCOMPLETE",
      message: "Could not prove complete FX parameter coverage before lookup.",
      rows_collected: rows.length,
      hard_ceiling: hardCeiling,
    };
  }
  if (rows.length > hardCeiling) {
    return {
      ok: false,
      code: "FX_PARAMETER_INVENTORY_CEILING_EXCEEDED",
      message: `FX parameter inventory exceeded the hard ceiling of ${hardCeiling}.`,
      rows_collected: rows.length,
    };
  }
  return {
    ok: true,
    parameters: rows,
    parameter_count: totalCount ?? rows.length,
    pages,
    inventory_complete: true,
    coverage_status: "complete",
  };
}

export function resolveExactParameterTargets(changes, inventoryRows) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const resolved = [];
  const resolvedIndexes = new Set();
  const suggestions = [];
  for (const change of changes) {
    let matches = [];
    if (Number.isInteger(change.param_index)) {
      matches = rows.filter((row) => row?.param_index === change.param_index);
      if (change.param_ident) {
        matches = matches.filter((row) => String(row?.param_ident ?? "") === change.param_ident);
      }
      if (change.param_name) {
        matches = matches.filter((row) => String(row?.name ?? "").toLowerCase() === change.param_name.toLowerCase());
      }
    } else if (change.param_ident) {
      matches = rows.filter((row) => String(row?.param_ident ?? "") === change.param_ident);
    } else if (change.param_name) {
      const wanted = change.param_name.toLowerCase();
      matches = rows.filter((row) => String(row?.name ?? "").toLowerCase() === wanted);
    }
    if (matches.length === 0) {
      suggestions.push(...rows.slice(0, 8).map((row) => ({
        param_index: row.param_index,
        name: row.name ?? null,
        param_ident: row.param_ident ?? null,
      })));
      return {
        ok: false,
        code: "FX_PARAMETER_MATCH_NOT_FOUND",
        message: `No exact parameter match for change ${change.id}.`,
        change_id: change.id,
        suggestions: uniqueSuggestions(suggestions),
        parameter_count: rows.length,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: "FX_PARAMETER_MATCH_AMBIGUOUS",
        message: `Parameter target for change ${change.id} is not unique.`,
        change_id: change.id,
        matches: matches.slice(0, 8).map((row) => ({
          param_index: row.param_index,
          name: row.name ?? null,
          param_ident: row.param_ident ?? null,
        })),
      };
    }
    const match = matches[0];
    if (resolvedIndexes.has(match.param_index)) {
      return {
        ok: false,
        code: "FX_EXACT_PARAMETERS_DUPLICATE_TARGET",
        message: `More than one change resolves to parameter index ${match.param_index}.`,
        change_id: change.id,
        param_index: match.param_index,
      };
    }
    resolvedIndexes.add(match.param_index);
    resolved.push({
      ...change,
      param_index: match.param_index,
      param_ident: match.param_ident ?? change.param_ident,
      name: match.name ?? null,
      step_sizes_available: match.step_sizes_available ?? null,
      step_size: match.step_size ?? null,
      is_toggle: match.is_toggle ?? null,
      is_discrete: match.is_discrete ?? null,
    });
  }
  return { ok: true, resolved };
}

export function createAlpha34CExactParametersPublicResult({
  fxRef,
  inventory,
  changes,
  readbackRows = [],
} = {}) {
  return deepFreeze({
    mode: "exact_parameters",
    fx_ref: fxRef,
    parameter_count: inventory?.parameter_count ?? null,
    inventory_complete: inventory?.inventory_complete === true,
    selected_parameters: changes.map((change) => ({
      id: change.id,
      param_index: change.param_index,
      param_ident: change.param_ident ?? null,
      name: change.name ?? null,
      requested_normalized_value: change.normalized_value,
    })),
    suggestions: [],
    readback: readbackRows,
    coverage: {
      pages: inventory?.pages ?? null,
      hard_ceiling: ALPHA3_4_C_PARAMETER_PAGE_HARD_CEILING,
      status: inventory?.coverage_status ?? null,
    },
  });
}

export function createAlpha34CStockSemanticLiveAuditPlan() {
  const catalog = listAlpha34CStockSemanticControls();
  return deepFreeze({
    contract: "openreaper.alpha3.4.stock_semantic_live_audit_plan.v1",
    version: ALPHA3_4_C_FX_SEMANTIC_TRUTH_VERSION,
    auto_promote_proof: false,
    plugin_count: catalog.plugin_count,
    control_count: catalog.control_count,
    probes: catalog.controls.map((control) => ({
      plugin_id: control.plugin_id,
      control_id: control.control_id,
      points: ["low", "mid", "high"],
      transport: "installed_wrapper_only",
      promotion_allowed: false,
    })),
  });
}

function uniqueSuggestions(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = `${value.param_index}:${value.param_ident ?? ""}:${value.name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 12) break;
  }
  return out;
}

function plugin(id, displayName, controls) {
  return { id, display_name: displayName, controls: [...controls] };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
