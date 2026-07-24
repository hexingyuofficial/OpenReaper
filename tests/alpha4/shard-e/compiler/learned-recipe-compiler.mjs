import {
  RECIPE_CONTRACT,
  validateRecipeContract,
} from "../../../../packages/core/src/recipe-contract-v1.mjs";

export const LEARNING_SNAPSHOT_CONTRACT = "alpha4.learning_snapshot.v1";
export const LEARNED_DIFF_CONTRACT = "alpha4.learned_diff.v1";
export const LEARNED_COMPILER_CONTRACT = "alpha4.learned_recipe_compiler.v1";

export const FACT_CLASSIFICATIONS = Object.freeze([
  "supported",
  "ambiguous",
  "unsupported",
  "unknown",
  "no_op",
]);

const ENTITY_COLLECTIONS = Object.freeze([
  "tracks",
  "items",
  "takes",
  "markers",
  "sends",
  "fx",
  "envelopes",
  "envelope_points",
]);

const ENTITY_KINDS = Object.freeze({
  tracks: "track",
  items: "item",
  takes: "take",
  markers: "marker",
  sends: "send",
  fx: "fx",
  envelopes: "envelope",
  envelope_points: "envelope_point",
});

const COLLECTION_REF_ALIASES = Object.freeze({
  tracks: "track_ref",
  items: "item_ref",
  takes: "take_ref",
  markers: "marker_ref",
  sends: "send_ref",
  fx: "fx_ref",
  envelopes: "envelope_ref",
  envelope_points: "point_ref",
});

const COMMON_ENTITY_FIELDS = new Set([
  "ref",
  "identity",
  "kind",
  "selector",
  "intent_candidates",
  "trusted_surface",
  "name",
  "index",
  "position_seconds",
  "length_seconds",
  "color",
  "folder",
  "is_folder",
  "folder_depth",
  "folder_parent_ref",
  "folder_parent_identity",
  "track_ref",
  "track_identity",
  "source_track_ref",
  "source_track_identity",
  "target_track_ref",
  "target_track_identity",
  "take_ref",
  "take_identity",
  "fx_ref",
  "fx_identity",
  "owner_ref",
  "owner_identity",
  "owner_kind",
  "destination_track_ref",
  "destination_track_identity",
  "source_item_ref",
  "source_item_identity",
  "muted",
  "soloed",
  "solo_mode",
  "record_armed",
  "bypassed",
  "volume_db",
  "volume",
  "pan",
  "mode",
  "fade_in_seconds",
  "fade_out_seconds",
  "semitones",
  "playrate",
  "preserve_pitch",
  "plugin_name",
  "plugin_ident",
  "insert_at_index",
  "duplicate_policy",
  "param_index",
  "param_ident",
  "normalized_value",
  "tolerance",
  "parameters",
  "envelope_ref",
  "envelope_identity",
  "envelope_name",
  "parent_ref",
  "parent_identity",
  "active",
  "armed",
  "visible",
  "show_lane",
  "point_index",
  "time_seconds",
  "value",
  "shape",
  "tension",
  "selected",
  "points",
]);

const FORBIDDEN_REPLAY_FIELDS = new Set([
  "raw_lua",
  "lua",
  "action",
  "action_id",
  "action_command",
  "shell",
  "shell_command",
  "command",
  "process",
  "ui",
  "ui_state",
  "ui_gesture",
  "gesture",
  "gesture_history",
  "mouse_path",
  "keyboard_events",
  "replay",
  "replay_events",
  "bridge_request",
  "opaque_chunk",
  "plugin_chunk",
  "preset_blob",
  "hardware",
  "device",
]);

const UNSUPPORTED_SEMANTIC_FIELDS = new Set([
  "preset_name",
  "preset_index",
  "modulation",
  "automation_modulation",
  "plugin_state",
  "named_config",
  "hardware_output",
]);

const TEMPLATE_IDS = Object.freeze({
  track_create: "template.tracks.create_track",
  folder_track_create: "template.tracks.create_folder_track",
  track_rename: "template.tracks.rename_track",
  track_color: "template.tracks.set_color",
  track_mute: "template.tracks.set_mute",
  track_solo: "template.tracks.set_solo",
  track_record_arm: "template.tracks.set_record_arm",
  track_folder_depth: "template.tracks.set_folder_depth",
  item_move: "template.items.move_item",
  item_move_to_track: "template.items.move_item_to_track",
  item_fades: "template.items.set_item_fades",
  item_volume: "template.items.set_item_volume",
  item_pitch: "template.items.set_take_pitch",
  item_playrate: "template.items.set_take_playrate",
  marker_create: "template.project.create_marker",
  marker_rename: "template.project.rename_marker",
  fx_create_track: "template.fx.add_track_fx",
  fx_create_take: "template.fx.add_take_fx",
  fx_bypass: "template.fx.set_fx_bypass",
  fx_parameter: "template.fx.set_fx_parameter_normalized",
  send_create: "template.routing.create_track_send",
  send_volume: "template.routing.set_send_volume",
  send_pan: "template.routing.set_send_pan",
  send_mute: "template.routing.set_send_mute",
  send_mode: "template.routing.set_send_mode",
  envelope_create: "template.automation.ensure_fx_parameter_envelope",
  envelope_lane: "template.automation.set_envelope_lane_state",
  envelope_point_create: "template.automation.insert_envelope_point",
  envelope_point_update: "template.automation.set_envelope_point",
});

const ALLOWED_TEMPLATE_IDS = new Set(Object.values(TEMPLATE_IDS));

const TEMPLATE_OUTPUTS = Object.freeze({
  [TEMPLATE_IDS.track_create]: "track_ref",
  [TEMPLATE_IDS.folder_track_create]: "track_ref",
  [TEMPLATE_IDS.marker_create]: "marker_ref",
  [TEMPLATE_IDS.fx_create_track]: "fx_ref",
  [TEMPLATE_IDS.fx_create_take]: "fx_ref",
  [TEMPLATE_IDS.send_create]: "send_ref",
  [TEMPLATE_IDS.envelope_create]: "envelope_ref",
  [TEMPLATE_IDS.track_rename]: "track_ref",
  [TEMPLATE_IDS.track_color]: "track_ref",
  [TEMPLATE_IDS.track_mute]: "track_ref",
  [TEMPLATE_IDS.track_solo]: "track_ref",
  [TEMPLATE_IDS.track_record_arm]: "track_ref",
  [TEMPLATE_IDS.track_folder_depth]: "track_ref",
  [TEMPLATE_IDS.item_move]: "item_ref",
  [TEMPLATE_IDS.item_move_to_track]: "item_ref",
  [TEMPLATE_IDS.item_fades]: "item_ref",
  [TEMPLATE_IDS.item_volume]: "item_ref",
  [TEMPLATE_IDS.item_pitch]: "item_ref",
  [TEMPLATE_IDS.item_playrate]: "item_ref",
  [TEMPLATE_IDS.marker_rename]: "marker_ref",
  [TEMPLATE_IDS.fx_bypass]: "fx_ref",
  [TEMPLATE_IDS.fx_parameter]: "fx_ref",
  [TEMPLATE_IDS.send_volume]: "send_ref",
  [TEMPLATE_IDS.send_pan]: "send_ref",
  [TEMPLATE_IDS.send_mute]: "send_ref",
  [TEMPLATE_IDS.send_mode]: "send_ref",
  [TEMPLATE_IDS.envelope_lane]: "envelope_ref",
  [TEMPLATE_IDS.envelope_point_create]: "envelope_ref",
  [TEMPLATE_IDS.envelope_point_update]: "envelope_ref",
});

const OPERATION_RANK = Object.freeze({
  "track.create": 10,
  "track.rename": 20,
  "track.update": 20,
  "marker.create": 30,
  "marker.update": 40,
  "send.create": 50,
  "send.update": 60,
  "fx.create": 70,
  "fx.update": 80,
  "envelope.create": 90,
  "envelope.update": 100,
  "envelope_point.create": 110,
  "envelope_point.update": 120,
  "item.update": 130,
});

export class LearningSnapshotError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "LearningSnapshotError";
    this.details = details;
  }
}

/**
 * @typedef {{ scheme: string, value: string }} LearningIdentity
 * @typedef {{ kind: string, ref: string, identity: LearningIdentity }} LearningRef
 * @typedef {{ project_ref: string, bridge_owner: string, bridge_generation: string, capture_id: string }} CaptureIdentity
 */

export function normalizeLearningSnapshot(input) {
  if (!isRecord(input)) throw new LearningSnapshotError("Learning snapshot must be an object.");
  if (input.contract !== undefined && input.contract !== LEARNING_SNAPSHOT_CONTRACT) {
    throw new LearningSnapshotError(`Unsupported learning snapshot contract: ${String(input.contract)}.`);
  }

  const capture = normalizeCaptureIdentity(input.capture ?? input);
  const entitiesInput = input.entities;
  if (!isRecord(entitiesInput)) {
    throw new LearningSnapshotError("Learning snapshot entities must be an object.");
  }

  const topLevelUnknownFields = Object.keys(input).filter((key) =>
    !new Set(["contract", "capture", "entities", "metadata"]).has(key),
  );
  const topLevelForbiddenFields = topLevelUnknownFields.filter((key) =>
    FORBIDDEN_REPLAY_FIELDS.has(normalizeFieldName(key)),
  );

  const entities = {};
  for (const collection of ENTITY_COLLECTIONS) {
    const rawEntities = entitiesInput[collection] ?? [];
    if (!Array.isArray(rawEntities)) {
      throw new LearningSnapshotError(`entities.${collection} must be an array.`);
    }
    entities[collection] = rawEntities
      .map((entity, index) => normalizeEntity(collection, entity, index))
      .sort(compareNormalizedEntities);
  }

  const duplicateIdentityKeys = [];
  for (const collection of ENTITY_COLLECTIONS) {
    const seen = new Set();
    for (const entity of entities[collection]) {
      if (!entity.identity_key) continue;
      if (seen.has(entity.identity_key)) duplicateIdentityKeys.push(entity.identity_key);
      seen.add(entity.identity_key);
    }
  }

  return deepFreeze({
    contract: LEARNING_SNAPSHOT_CONTRACT,
    capture,
    entities,
    diagnostics: {
      top_level_unknown_fields: topLevelUnknownFields,
      top_level_forbidden_fields: topLevelForbiddenFields,
      duplicate_identity_keys: [...new Set(duplicateIdentityKeys)].sort(),
    },
  });
}

export function diffLearningSnapshots(beforeInput, afterInput) {
  const before = ensureSnapshot(beforeInput);
  const after = ensureSnapshot(afterInput);
  const facts = [];

  if (!sameCaptureIdentity(before.capture, after.capture)) {
    facts.push(makeFact({
      factId: "capture.identity",
      classification: "unknown",
      kind: "capture",
      operation: "identity_mismatch",
      field: "capture",
      reason: "Before and after capture identities do not match.",
    }));
  }

  for (const field of before.diagnostics.top_level_forbidden_fields) {
    facts.push(makeFact({
      factId: `snapshot.forbidden.${field}`,
      classification: "unsupported",
      kind: "snapshot",
      operation: "replay_surface",
      field,
      reason: `Forbidden replay-shaped snapshot field: ${field}.`,
    }));
  }
  for (const field of after.diagnostics.top_level_forbidden_fields) {
    if (!before.diagnostics.top_level_forbidden_fields.includes(field)) {
      facts.push(makeFact({
        factId: `snapshot.forbidden.${field}`,
        classification: "unsupported",
        kind: "snapshot",
        operation: "replay_surface",
        field,
        reason: `Forbidden replay-shaped snapshot field: ${field}.`,
      }));
    }
  }
  for (const field of [...before.diagnostics.top_level_unknown_fields, ...after.diagnostics.top_level_unknown_fields]) {
    if (FORBIDDEN_REPLAY_FIELDS.has(normalizeFieldName(field))) continue;
    facts.push(makeFact({
      factId: `snapshot.unknown.${field}`,
      classification: "unknown",
      kind: "snapshot",
      operation: "unknown_field",
      field,
      reason: `Unrecognized snapshot field: ${field}.`,
    }));
  }
  for (const key of new Set([
    ...before.diagnostics.duplicate_identity_keys,
    ...after.diagnostics.duplicate_identity_keys,
  ])) {
    facts.push(makeFact({
      factId: `snapshot.duplicate.${key}`,
      classification: "unknown",
      kind: "snapshot",
      operation: "duplicate_identity",
      field: "identity",
      reason: `Duplicate identity prevents safe target binding: ${key}.`,
    }));
  }

  for (const collection of ENTITY_COLLECTIONS) {
    diffCollection(collection, before.entities[collection], after.entities[collection], facts);
  }

  return deepFreeze({
    contract: LEARNED_DIFF_CONTRACT,
    capture: after.capture,
    ok: facts.every((fact) => fact.classification === "supported" || fact.classification === "no_op"),
    facts: facts.sort((left, right) => left.fact_id.localeCompare(right.fact_id)),
  });
}

export function compileLearnedRecipe(diffInput, options = {}) {
  const diff = ensureDiff(diffInput);
  const bypassBlockers = findForbiddenKeys(diff);
  const allFacts = Array.isArray(diff.facts) ? diff.facts : [];
  const blockers = allFacts
    .filter((fact) => fact.classification !== "supported" && fact.classification !== "no_op")
    .map((fact) => ({
      fact_id: fact.fact_id,
      classification: fact.classification,
      reason: fact.reason,
    }));
  for (const key of bypassBlockers) {
    blockers.push({
      fact_id: "compiler.input",
      classification: "unsupported",
      reason: `Forbidden replay-shaped compiler input field: ${key}.`,
    });
  }

  const supportedFacts = allFacts.filter((fact) => fact.classification === "supported");
  if (blockers.length > 0) {
    return deepFreeze({
      contract: LEARNED_COMPILER_CONTRACT,
      ok: false,
      status: "blocked",
      recipe: null,
      blockers: uniqueBlockers(blockers),
      no_op_facts: allFacts.filter((fact) => fact.classification === "no_op").map((fact) => fact.fact_id),
    });
  }
  if (supportedFacts.length === 0) {
    return deepFreeze({
      contract: LEARNED_COMPILER_CONTRACT,
      ok: true,
      status: "no_op",
      recipe: null,
      blockers: [],
      no_op_facts: allFacts.map((fact) => fact.fact_id),
    });
  }

  const unsupportedTemplates = supportedFacts
    .map((fact) => fact.template_id)
    .filter((templateId) => !ALLOWED_TEMPLATE_IDS.has(templateId));
  if (unsupportedTemplates.length > 0) {
    return deepFreeze({
      contract: LEARNED_COMPILER_CONTRACT,
      ok: false,
      status: "blocked",
      recipe: null,
      blockers: [...new Set(unsupportedTemplates)].sort().map((templateId) => ({
        fact_id: "compiler.template",
        classification: "unsupported",
        reason: `Template is not in the closed compiler allowlist: ${templateId}.`,
      })),
      no_op_facts: [],
    });
  }

  const orderedFactsResult = dependencyOrder(supportedFacts);
  if (!orderedFactsResult.ok) {
    return deepFreeze({
      contract: LEARNED_COMPILER_CONTRACT,
      ok: false,
      status: "blocked",
      recipe: null,
      blockers: [{
        fact_id: "compiler.dependencies",
        classification: "unknown",
        reason: orderedFactsResult.reason,
      }],
      no_op_facts: [],
    });
  }

  const stepIds = new Map();
  for (const [index, fact] of orderedFactsResult.facts.entries()) {
    stepIds.set(fact.fact_id, `apply_${String(index + 1).padStart(2, "0")}_${slug(fact.operation)}_${slug(fact.field ?? fact.kind)}`);
  }
  const producerSteps = new Map();
  for (const fact of orderedFactsResult.facts) {
    if (!fact.produces_identity) continue;
    producerSteps.set(identityKey(fact.produces_identity.kind, fact.produces_identity.identity), {
      step_id: stepIds.get(fact.fact_id),
      output: TEMPLATE_OUTPUTS[fact.template_id],
    });
  }

  const steps = [makeReadStateStep()];
  const callSteps = [];
  for (const fact of orderedFactsResult.facts) {
    const step = makeCallTemplateStep(fact, stepIds.get(fact.fact_id), producerSteps);
    callSteps.push(step);
    steps.push(step);
  }

  const recipe = makeOrdinaryRecipe({
    facts: orderedFactsResult.facts,
    steps,
    callSteps,
    options,
  });
  const validation = validateRecipeContract(recipe);
  if (!validation.ok) {
    return deepFreeze({
      contract: LEARNED_COMPILER_CONTRACT,
      ok: false,
      status: "blocked",
      recipe: null,
      blockers: [{
        fact_id: "compiler.recipe",
        classification: "unknown",
        reason: `Compiled Recipe failed the frozen Recipe contract: ${validation.errors.join("; ")}`,
      }],
      no_op_facts: [],
    });
  }

  return deepFreeze({
    contract: LEARNED_COMPILER_CONTRACT,
    ok: true,
    status: "compiled",
    recipe,
    blockers: [],
    no_op_facts: allFacts.filter((fact) => fact.classification === "no_op").map((fact) => fact.fact_id),
    order: orderedFactsResult.facts.map((fact) => fact.fact_id),
  });
}

function normalizeCaptureIdentity(input) {
  if (!isRecord(input)) throw new LearningSnapshotError("Learning capture identity must be an object.");
  const capture = {
    project_ref: input.project_ref,
    bridge_owner: input.bridge_owner,
    bridge_generation: String(input.bridge_generation ?? ""),
    capture_id: input.capture_id,
  };
  for (const [key, value] of Object.entries(capture)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new LearningSnapshotError(`Learning capture identity field ${key} must be a non-empty string.`);
    }
  }
  return capture;
}

function normalizeEntity(collection, input, sourceIndex) {
  const kind = ENTITY_KINDS[collection];
  if (!isRecord(input)) {
    return {
      kind,
      ref: null,
      identity: null,
      identity_key: null,
      selector: null,
      values: {},
      unknown_fields: ["entity_not_object"],
      forbidden_fields: [],
      invalid_reasons: ["entity_not_object"],
      source_index: sourceIndex,
    };
  }

  const alias = COLLECTION_REF_ALIASES[collection];
  const ref = typeof input.ref === "string"
    ? input.ref
    : typeof input[alias] === "string" ? input[alias] : null;
  const identity = normalizeEntityIdentity(kind, ref, input.identity);
  const selector = isRecord(input.selector) ? cloneJson(input.selector) : null;
  const knownFields = new Set([...COMMON_ENTITY_FIELDS]);
  const unknownFields = Object.keys(input).filter((key) => !knownFields.has(key) && key !== alias);
  const forbiddenFields = findForbiddenKeys(input);
  const values = {};
  for (const key of Object.keys(input)) {
    if (knownFields.has(key) && !["ref", "identity", "kind", "selector", "intent_candidates"].includes(key)) {
      values[key] = cloneJson(input[key]);
    }
  }
  if (Array.isArray(input.intent_candidates)) values.intent_candidates = cloneJson(input.intent_candidates);
  const invalidReasons = [];
  if (input.kind !== undefined && input.kind !== kind) invalidReasons.push("kind_mismatch");
  if (ref && !ref.startsWith(`${kind}:`)) invalidReasons.push("ref_kind_mismatch");
  if (input.identity !== undefined && !identity) invalidReasons.push("malformed_identity");

  return {
    kind,
    ref,
    identity,
    identity_key: identity ? identityKey(kind, identity) : null,
    selector,
    values,
    unknown_fields: unknownFields,
    forbidden_fields: forbiddenFields,
    invalid_reasons: invalidReasons,
    source_index: sourceIndex,
  };
}

function normalizeEntityIdentity(kind, ref, input) {
  if (input !== undefined && input !== null) {
    if (!isRecord(input) || typeof input.scheme !== "string" || typeof input.value !== "string") return null;
    const identity = { scheme: input.scheme, value: input.value };
    if (ref) {
      const derived = deriveIdentityFromRef(ref, kind);
      if (!derived || derived.scheme !== identity.scheme || derived.value !== identity.value) return null;
    }
    return identity;
  }
  return ref ? deriveIdentityFromRef(ref, kind) : null;
}

function diffCollection(collection, beforeEntities, afterEntities, facts) {
  const beforeByIdentity = new Map();
  const afterByIdentity = new Map();
  const beforeByRef = new Map();
  const afterByRef = new Map();
  const beforeUnbound = [];
  const afterUnbound = [];

  for (const entity of beforeEntities) {
    if (entity.identity_key) beforeByIdentity.set(entity.identity_key, entity);
    else beforeUnbound.push(entity);
    if (entity.ref) beforeByRef.set(entity.ref, entity);
  }
  for (const entity of afterEntities) {
    if (entity.identity_key) afterByIdentity.set(entity.identity_key, entity);
    else afterUnbound.push(entity);
    if (entity.ref) afterByRef.set(entity.ref, entity);
  }

  for (const [ref, before] of beforeByRef) {
    const after = afterByRef.get(ref);
    if (after && before.identity_key !== after.identity_key) {
      facts.push(makeFact({
        factId: `${collection}.identity_drift.${slug(ref)}`,
        classification: "unknown",
        kind: before.kind,
        operation: "identity_drift",
        field: "identity",
        target: targetForEntity(after.identity ? after : before),
        reason: "The same ref changed identity across the capture boundary.",
      }));
      beforeByIdentity.delete(before.identity_key);
      afterByIdentity.delete(after.identity_key);
    }
  }

  for (const [identity, before] of beforeByIdentity) {
    const after = afterByIdentity.get(identity);
    if (!after) {
      facts.push(...classifyRemoved(before));
      continue;
    }
    facts.push(...classifyEntityPair(before, after));
    afterByIdentity.delete(identity);
  }
  for (const after of afterByIdentity.values()) facts.push(...classifyAdded(after));

  for (const after of afterUnbound) {
    const candidates = beforeUnbound.filter((before) => sameSelector(before, after));
    if (!after.selector) {
      facts.push(makeUnknownEntityFact(after, "Missing stable identity and selector."));
    } else if (candidates.length > 1) {
      facts.push(makeFact({
        factId: `${collection}.ambiguous.${after.source_index}`,
        classification: "ambiguous",
        kind: after.kind,
        operation: "select_target",
        field: "selector",
        target: targetForEntity(after),
        reason: "Selector matches more than one identity-aware entity.",
      }));
    } else if (candidates.length === 1) {
      facts.push(...classifyEntityPair(candidates[0], after, { resolvedViaSelector: true }));
    } else {
      facts.push(makeUnknownEntityFact(after, "Selector did not resolve to one before-state identity."));
    }
  }
  for (const before of beforeUnbound) {
    if (!afterUnbound.some((after) => sameSelector(before, after))) {
      facts.push(makeUnknownEntityFact(before, "Before-state entity has no stable identity for safe deletion matching."));
    }
  }
}

function classifyEntityPair(before, after, options = {}) {
  const target = targetForEntity(after.identity ? after : before);
  if (before.invalid_reasons.length > 0 || after.invalid_reasons.length > 0) {
    return [makeFact({
      factId: `${before.kind}.unknown.${identitySlug(target)}`,
      classification: "unknown",
      kind: before.kind,
      operation: "invalid_entity",
      field: "identity",
      target,
      reason: "Entity shape or identity is malformed.",
    })];
  }
  if (before.forbidden_fields.length > 0 || after.forbidden_fields.length > 0) {
    return [makeFact({
      factId: `${before.kind}.unsupported.${identitySlug(target)}`,
      classification: "unsupported",
      kind: before.kind,
      operation: "replay_surface",
      field: first([...before.forbidden_fields, ...after.forbidden_fields]),
      target,
      reason: "The fact contains a forbidden replay surface.",
    })];
  }
  if (before.unknown_fields.length > 0 || after.unknown_fields.length > 0) {
    return [makeFact({
      factId: `${before.kind}.unknown_fields.${identitySlug(target)}`,
      classification: "unknown",
      kind: before.kind,
      operation: "unknown_field",
      field: first([...before.unknown_fields, ...after.unknown_fields]),
      target,
      reason: "The fact contains fields outside the typed snapshot vocabulary.",
    })];
  }
  if (Array.isArray(after.values.intent_candidates) && after.values.intent_candidates.length > 1) {
    return [makeFact({
      factId: `${before.kind}.ambiguous.${identitySlug(target)}`,
      classification: "ambiguous",
      kind: before.kind,
      operation: "intent",
      field: "intent_candidates",
      target,
      reason: "More than one semantic intent remains possible.",
    })];
  }

  const changes = valueChanges(before.values, after.values);
  if (changes.length === 0) {
    return [makeFact({
      factId: `${before.kind}.no_op.${identitySlug(target)}`,
      classification: "no_op",
      kind: before.kind,
      operation: "no_op",
      field: null,
      target,
      reason: "Identity-aware before/after values are equal.",
    })];
  }

  const facts = [];
  for (const change of changes) {
    if (change.field === "parameters") {
      facts.push(...classifyParameterChanges(before, after, target));
      continue;
    }
    const mapping = mapField(before.kind, change.field, before, after);
    if (!mapping) {
      facts.push(makeFact({
        factId: `${before.kind}.unsupported.${identitySlug(target)}.${slug(change.field)}`,
        classification: UNSUPPORTED_SEMANTIC_FIELDS.has(change.field) ? "unsupported" : "unknown",
        kind: before.kind,
        operation: "field_change",
        field: change.field,
        target,
        before: change.before,
        after: change.after,
        reason: UNSUPPORTED_SEMANTIC_FIELDS.has(change.field)
          ? `The semantic field ${change.field} is intentionally unsupported.`
          : `No closed compiler mapping exists for ${before.kind}.${change.field}.`,
      }));
      continue;
    }
    facts.push(makeFact({
      factId: `${before.kind}.supported.${identitySlug(target)}.${slug(mapping.field)}`,
      classification: mapping.classification ?? "supported",
      kind: before.kind,
      operation: mapping.operation,
      field: mapping.field,
      templateId: mapping.template_id,
      target,
      before: change.before,
      after: change.after,
      input: mapping.input,
      bindings: mapping.bindings,
      references: mapping.references,
      reason: options.resolvedViaSelector
        ? "Unique selector resolved to one identity-aware target."
        : "Typed semantic field change maps to an accepted Template.",
      producesIdentity: mapping.produces_identity,
    }));
  }
  return facts;
}

function classifyParameterChanges(before, after, target) {
  const beforeParameters = isRecord(before.values.parameters) ? before.values.parameters : {};
  const afterParameters = isRecord(after.values.parameters) ? after.values.parameters : {};
  const keys = new Set([...Object.keys(beforeParameters), ...Object.keys(afterParameters)]);
  if (!isTrustedFx(after)) {
    return [makeFact({
      factId: `fx.unsupported.${identitySlug(target)}.parameters`,
      classification: "unsupported",
      kind: "fx",
      operation: "parameter_change",
      field: "parameters",
      target,
      reason: "FX parameter learning requires an exact D-trusted plugin identity.",
    })];
  }
  return [...keys].sort().map((key) => {
    const beforeValue = beforeParameters[key];
    const afterValue = afterParameters[key];
    if (stableStringify(beforeValue) === stableStringify(afterValue)) return makeFact({
      factId: `fx.no_op.${identitySlug(target)}.parameter_${slug(key)}`,
      classification: "no_op",
      kind: "fx",
      operation: "no_op",
      field: `parameters.${key}`,
      target,
      reason: "Identity-aware FX parameter value is unchanged.",
    });
    if (!isRecord(afterValue) || typeof afterValue.normalized_value !== "number") {
      return makeFact({
        factId: `fx.unknown.${identitySlug(target)}.parameter_${slug(key)}`,
        classification: "unknown",
        kind: "fx",
        operation: "parameter_change",
        field: `parameters.${key}`,
        target,
        reason: "FX parameter lacks a typed normalized value.",
      });
    }
    const paramIndex = Number.isInteger(afterValue.param_index) ? afterValue.param_index : Number(key);
    if (!Number.isInteger(paramIndex) || paramIndex < 0 || afterValue.normalized_value < 0 || afterValue.normalized_value > 1) {
      return makeFact({
        factId: `fx.unsupported.${identitySlug(target)}.parameter_${slug(key)}`,
        classification: "unsupported",
        kind: "fx",
        operation: "parameter_change",
        field: `parameters.${key}`,
        target,
        reason: "FX parameter is outside the bounded normalized parameter contract.",
      });
    }
    return makeFact({
      factId: `fx.supported.${identitySlug(target)}.parameter_${slug(key)}`,
      classification: "supported",
      kind: "fx",
      operation: "fx.parameter",
      field: `parameters.${key}`,
      templateId: TEMPLATE_IDS.fx_parameter,
      target,
      before: beforeValue,
      after: afterValue,
      input: {
        param_index: paramIndex,
        ...(typeof afterValue.param_ident === "string" ? { param_ident: afterValue.param_ident } : {}),
        normalized_value: afterValue.normalized_value,
        tolerance: typeof afterValue.tolerance === "number" ? afterValue.tolerance : 0.0001,
      },
      bindings: { fx_ref: target },
      references: { fx: target },
      reason: "D-trusted exact FX identity and normalized parameter map to the accepted parameter Template.",
    });
  });
}

function classifyAdded(entity) {
  const target = targetForEntity(entity);
  if (!entity.identity) return [makeUnknownEntityFact(entity, "Created entity lacks a stable identity.")];
  if (entity.invalid_reasons.length > 0) return [makeUnknownEntityFact(entity, "Created entity shape or identity is malformed.")];
  if (entity.forbidden_fields.length > 0) return [makeFact({
    factId: `${entity.kind}.unsupported.create.${identitySlug(target)}`,
    classification: "unsupported",
    kind: entity.kind,
    operation: "create",
    field: first(entity.forbidden_fields),
    target,
    reason: "Created entity contains a forbidden replay surface.",
  })];
  if (entity.unknown_fields.length > 0) return [makeFact({
    factId: `${entity.kind}.unknown.create.${identitySlug(target)}`,
    classification: "unknown",
    kind: entity.kind,
    operation: "create",
    field: first(entity.unknown_fields),
    target,
    reason: "Created entity contains fields outside the typed snapshot vocabulary.",
  })];

  const values = entity.values;
  if (entity.kind === "track") {
    if (typeof values.name !== "string") return [makeUnknownEntityFact(entity, "Created Track has no typed name.")];
    const templateId = values.is_folder === true || values.folder === true
      ? TEMPLATE_IDS.folder_track_create
      : TEMPLATE_IDS.track_create;
    return [makeFact({
      factId: `track.supported.create.${identitySlug(target)}`,
      classification: "supported",
      kind: "track",
      operation: "track.create",
      field: "create",
      templateId,
      target,
      input: {
        name: values.name,
        ...(Number.isInteger(values.index) ? { index: values.index } : {}),
      },
      bindings: {},
      references: {},
      reason: "Typed Track identity and name map to the accepted Track creation Template.",
      producesIdentity: target,
    })];
  }
  if (entity.kind === "marker") {
    if (typeof values.name !== "string" || typeof values.position_seconds !== "number") return [makeUnknownEntityFact(entity, "Created Marker lacks a typed name or position.")];
    return [makeFact({
      factId: `marker.supported.create.${identitySlug(target)}`,
      classification: "supported",
      kind: "marker",
      operation: "marker.create",
      field: "create",
      templateId: TEMPLATE_IDS.marker_create,
      target,
      input: {
        name: values.name,
        position_seconds: values.position_seconds,
        ...(typeof values.color === "string" ? { color: values.color } : {}),
      },
      bindings: {},
      references: {},
      reason: "Typed Marker identity, name, and position map to the accepted Marker creation Template.",
      producesIdentity: target,
    })];
  }
  if (entity.kind === "send") {
    const source = relationRef(values, "source_track");
    const destination = relationRef(values, "destination_track");
    if (!source || !destination) return [makeUnknownEntityFact(entity, "Created Send lacks exact source and destination Track identities.")];
    return [makeFact({
      factId: `send.supported.create.${identitySlug(target)}`,
      classification: "supported",
      kind: "send",
      operation: "send.create",
      field: "create",
      templateId: TEMPLATE_IDS.send_create,
      target,
      input: { duplicate_policy: values.duplicate_policy ?? "reject_existing" },
      bindings: { source_track_ref: source, destination_track_ref: destination },
      references: { source_track: source, destination_track: destination },
      reason: "Exact source/destination Track identities map to the accepted Send creation Template.",
      producesIdentity: target,
    })];
  }
  if (entity.kind === "fx") {
    if (!isTrustedFx(entity)) return [makeFact({
      factId: `fx.unsupported.create.${identitySlug(target)}`,
      classification: "unsupported",
      kind: "fx",
      operation: "fx.create",
      field: "plugin_identity",
      target,
      reason: "FX creation requires an exact D-trusted plugin name and identity.",
    })];
    const owner = entity.values.owner_kind === "take"
      ? relationRef(values, "take")
      : relationRef(values, "track");
    if (!owner) return [makeUnknownEntityFact(entity, "Created FX lacks an exact owner identity.")];
    const templateId = entity.values.owner_kind === "take" ? TEMPLATE_IDS.fx_create_take : TEMPLATE_IDS.fx_create_track;
    const createFact = makeFact({
      factId: `fx.supported.create.${identitySlug(target)}`,
      classification: "supported",
      kind: "fx",
      operation: "fx.create",
      field: "create",
      templateId,
      target,
      input: {
        plugin_name: values.plugin_name,
        ...(Number.isInteger(values.insert_at_index) ? { insert_at_index: values.insert_at_index } : {}),
      },
      bindings: { [entity.values.owner_kind === "take" ? "take_ref" : "track_ref"]: owner },
      references: { owner },
      reason: "D-trusted exact FX identity maps to the accepted FX creation Template.",
      producesIdentity: target,
    });
    const parameterFacts = classifyParameterChanges(
      { ...entity, values: { ...values, parameters: {} } },
      entity,
      target,
    );
    return [createFact, ...parameterFacts];
  }
  if (entity.kind === "envelope") {
    const fx = relationRef(values, "fx");
    if (!fx || !Number.isInteger(values.param_index) || values.param_index < 0) return [makeUnknownEntityFact(entity, "Created Envelope lacks exact FX identity or parameter index.")];
    return [makeFact({
      factId: `envelope.supported.create.${identitySlug(target)}`,
      classification: "supported",
      kind: "envelope",
      operation: "envelope.create",
      field: "create",
      templateId: TEMPLATE_IDS.envelope_create,
      target,
      input: {
        param_index: values.param_index,
        ...(typeof values.param_ident === "string" ? { param_ident: values.param_ident } : {}),
      },
      bindings: { fx_ref: fx },
      references: { fx },
      reason: "Exact FX identity and parameter map to the accepted Envelope ensure Template.",
      producesIdentity: target,
    })];
  }
  if (entity.kind === "envelope_point") {
    const envelope = relationRef(values, "envelope");
    if (!envelope || !validPoint(values)) return [makeUnknownEntityFact(entity, "Created Envelope point lacks exact Envelope identity or point fields.")];
    return [makeFact({
      factId: `envelope_point.supported.create.${identitySlug(target)}`,
      classification: "supported",
      kind: "envelope_point",
      operation: "envelope_point.create",
      field: "create",
      templateId: TEMPLATE_IDS.envelope_point_create,
      target,
      input: pointInput(values),
      bindings: { envelope_ref: envelope },
      references: { envelope },
      reason: "Exact Envelope identity and typed point values map to the accepted point Template.",
    })];
  }
  return [makeUnknownEntityFact(entity, `Creation of ${entity.kind} is not in the closed compiler surface.`)];
}

function classifyRemoved(entity) {
  return [makeFact({
    factId: `${entity.kind}.unsupported.delete.${identitySlug(targetForEntity(entity))}`,
    classification: "unsupported",
    kind: entity.kind,
    operation: "delete",
    field: "delete",
    target: targetForEntity(entity),
    reason: "Deletion is destructive and is not inferred from a demonstration.",
  })];
}

function mapField(kind, field, before, after) {
  const target = targetForEntity(after);
  if (kind === "track") {
    const mappings = {
      name: ["track.rename", TEMPLATE_IDS.track_rename, { name: after.values.name }, { track_ref: target }],
      color: ["track.update", TEMPLATE_IDS.track_color, { color: after.values.color }, { track_ref: target }],
      muted: ["track.update", TEMPLATE_IDS.track_mute, { muted: after.values.muted }, { track_ref: target }],
      soloed: ["track.update", TEMPLATE_IDS.track_solo, { mode: after.values.soloed === true ? "solo" : "off" }, { track_ref: target }],
      solo_mode: ["track.update", TEMPLATE_IDS.track_solo, { mode: after.values.solo_mode }, { track_ref: target }],
      record_armed: ["track.update", TEMPLATE_IDS.track_record_arm, { armed: after.values.record_armed }, { track_ref: target }],
      folder_depth: ["track.update", TEMPLATE_IDS.track_folder_depth, { folder_depth: after.values.folder_depth }, { track_ref: target }],
    };
    return makeMapping(mappings[field], target, field);
  }
  if (kind === "item") {
    if (field === "track_ref") {
      const targetTrack = relationRef(after.values, "track");
      return targetTrack ? makeMapping(["item.update", TEMPLATE_IDS.item_move_to_track, {}, { item_ref: target, target_track_ref: targetTrack }], target, field, { targetTrack }) : null;
    }
    const mappings = {
      position_seconds: ["item.update", TEMPLATE_IDS.item_move, { position_seconds: after.values.position_seconds }, { item_ref: target }],
      semitones: ["item.update", TEMPLATE_IDS.item_pitch, { semitones: after.values.semitones }, { item_ref: target }],
      playrate: ["item.update", TEMPLATE_IDS.item_playrate, { playrate: after.values.playrate, preserve_pitch: after.values.preserve_pitch === true }, { item_ref: target }],
      volume_db: ["item.update", TEMPLATE_IDS.item_volume, { volume_db: after.values.volume_db }, { item_ref: target }],
      fade_in_seconds: ["item.update", TEMPLATE_IDS.item_fades, { fade_in_seconds: after.values.fade_in_seconds ?? null, fade_out_seconds: after.values.fade_out_seconds ?? null }, { item_ref: target }],
      fade_out_seconds: ["item.update", TEMPLATE_IDS.item_fades, { fade_in_seconds: after.values.fade_in_seconds ?? null, fade_out_seconds: after.values.fade_out_seconds ?? null }, { item_ref: target }],
    };
    return makeMapping(mappings[field], target, field);
  }
  if (kind === "marker" && field === "name") {
    return makeMapping(["marker.update", TEMPLATE_IDS.marker_rename, { name: after.values.name }, { marker_ref: target }], target, field);
  }
  if (kind === "fx" && field === "bypassed") {
    if (!isTrustedFx(after)) return null;
    return makeMapping(["fx.update", TEMPLATE_IDS.fx_bypass, { enabled: after.values.bypassed !== true }, { fx_ref: target }], target, field);
  }
  if (kind === "send") {
    const mappings = {
      volume: ["send.update", TEMPLATE_IDS.send_volume, { volume: after.values.volume }, { send_ref: target }],
      pan: ["send.update", TEMPLATE_IDS.send_pan, { pan: after.values.pan }, { send_ref: target }],
      muted: ["send.update", TEMPLATE_IDS.send_mute, { muted: after.values.muted }, { send_ref: target }],
      mode: ["send.update", TEMPLATE_IDS.send_mode, { mode: after.values.mode }, { send_ref: target }],
    };
    return makeMapping(mappings[field], target, field);
  }
  if (kind === "envelope" && ["active", "armed", "visible", "show_lane"].includes(field)) {
    return makeMapping(["envelope.update", TEMPLATE_IDS.envelope_lane, { [field]: after.values[field] }, { envelope_ref: target }], target, field);
  }
  if (kind === "envelope_point" && ["time_seconds", "value", "shape", "tension", "selected", "point_index"].includes(field)) {
    const envelope = relationRef(after.values, "envelope");
    if (!envelope || !Number.isInteger(after.values.point_index)) return null;
    return makeMapping(["envelope_point.update", TEMPLATE_IDS.envelope_point_update, { point_index: after.values.point_index, ...pointInput(after.values, false) }, { envelope_ref: envelope }], target, field, { envelope });
  }
  return null;
}

function makeMapping(mapping, target, field, extra = {}) {
  if (!mapping) return null;
  return {
    operation: mapping[0],
    template_id: mapping[1],
    input: mapping[2],
    bindings: mapping[3],
    references: { target, ...extra },
    field,
  };
}

function classifyPairChangesForFields(before, after) {
  const changes = valueChanges(before.values, after.values);
  if (changes.some((change) => ["fade_in_seconds", "fade_out_seconds"].includes(change.field))) {
    const other = changes.filter((change) => !["fade_in_seconds", "fade_out_seconds"].includes(change.field));
    return [...other, { field: "fade_in_seconds", before: before.values.fade_in_seconds, after: after.values.fade_in_seconds }];
  }
  return changes;
}

function valueChanges(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].sort().filter((field) => !field.endsWith("_identity") && stableStringify(before[field]) !== stableStringify(after[field])).map((field) => ({
    field,
    before: cloneJson(before[field]),
    after: cloneJson(after[field]),
  }));
}

function dependencyOrder(facts) {
  const producerByIdentity = new Map();
  for (const fact of facts) {
    if (fact.produces_identity) {
      const key = identityKey(fact.produces_identity.kind, fact.produces_identity.identity);
      if (producerByIdentity.has(key)) return { ok: false, reason: `Multiple compiler facts produce identity ${key}.` };
      producerByIdentity.set(key, fact);
    }
  }
  const edges = new Map(facts.map((fact) => [fact.fact_id, new Set()]));
  const indegree = new Map(facts.map((fact) => [fact.fact_id, 0]));
  for (const fact of facts) {
    for (const reference of Object.values(fact.references ?? {})) {
      if (!reference?.identity || !reference.kind) continue;
      const producer = producerByIdentity.get(identityKey(reference.kind, reference.identity));
      if (!producer || producer.fact_id === fact.fact_id) continue;
      if (!edges.get(producer.fact_id).has(fact.fact_id)) {
        edges.get(producer.fact_id).add(fact.fact_id);
        indegree.set(fact.fact_id, indegree.get(fact.fact_id) + 1);
      }
    }
  }
  const ready = facts.filter((fact) => indegree.get(fact.fact_id) === 0).sort(compareFacts);
  const ordered = [];
  while (ready.length > 0) {
    const fact = ready.shift();
    ordered.push(fact);
    for (const dependentId of edges.get(fact.fact_id)) {
      indegree.set(dependentId, indegree.get(dependentId) - 1);
      if (indegree.get(dependentId) === 0) {
        ready.push(facts.find((candidate) => candidate.fact_id === dependentId));
        ready.sort(compareFacts);
      }
    }
  }
  if (ordered.length !== facts.length) return { ok: false, reason: "Compiler dependency graph contains a cycle." };
  return { ok: true, facts: ordered };
}

function makeCallTemplateStep(fact, stepId, producerSteps) {
  const refs = {};
  for (const [name, reference] of Object.entries(fact.bindings ?? {})) {
    if (!reference?.kind || !reference.identity || typeof reference.ref !== "string") {
      throw new LearningSnapshotError(`Supported fact ${fact.fact_id} lacks an exact binding for ${name}.`);
    }
    const producer = producerSteps.get(identityKey(reference.kind, reference.identity));
    refs[name] = producer
      ? { $from_step: producer.step_id, output: producer.output }
      : literalRef(reference);
  }
  const checkpoint = `checkpoint_${stepId}`;
  const evidence = `evidence_${stepId}`;
  const branch = `branch_retry_${stepId}`;
  return {
    id: stepId,
    title: titleForFact(fact),
    summary: `Apply the captured ${fact.kind} semantic change through an accepted Template.`,
    uses: "call_template",
    call_template: {
      id: fact.template_id,
      input: cloneJson(fact.input ?? {}),
      refs,
    },
    get_state: null,
    checkpoint,
    evidence,
    idempotency: {
      mode: "supported",
      key_scope: "recipe_run",
      on_resume: "reuse_evidence",
    },
    on_failure: branch,
  };
}

function makeReadStateStep() {
  return {
    id: "read_capture_state",
    title: "Read bounded target state",
    summary: "Read bounded state before applying the learned transformation.",
    uses: "get_state",
    call_template: null,
    get_state: {
      projection: "project.summary",
      refs: [],
    },
    checkpoint: "checkpoint_read_capture_state",
    evidence: null,
    idempotency: {
      mode: "read_only",
      key_scope: "none",
      on_resume: "rerun",
    },
    on_failure: "branch_request_user",
  };
}

function makeOrdinaryRecipe({ facts, steps, callSteps, options }) {
  const pack = options.pack ?? dominantPack(callSteps);
  const recipeId = options.recipe_id ?? `recipe.${pack}.learned_demonstration`;
  const expectedRefs = [...new Set(callSteps.flatMap((step) => {
    const output = TEMPLATE_OUTPUTS[step.call_template.id];
    return output ? [output] : [];
  }))];
  const expectedState = [...new Set(facts.map((fact) => fact.kind).filter((kind) => kind !== "envelope_point"))];
  const checkpoints = [
    {
      id: "checkpoint_read_capture_state",
      after_step: "read_capture_state",
      required_evidence: [],
      on_resume: "continue_next_step",
      summary: "Bounded target state read completed before learned writes.",
    },
  ];
  const evidenceRequirements = [];
  const branches = [{
    id: "branch_request_user",
    trigger: "resume_conflict",
    step: null,
    strategy: "request_user",
    summary: "Pause when target identity or recovery evidence is ambiguous.",
  }];
  for (const step of callSteps) {
    checkpoints.push({
      id: step.checkpoint,
      after_step: step.id,
      required_evidence: [step.evidence],
      on_resume: "continue_next_step",
      summary: `Verified ${step.id} through compact runtime evidence.`,
    });
    evidenceRequirements.push({
      id: step.evidence,
      step: step.id,
      source: "template.runtime.evidence.v1",
      template_id: step.call_template.id,
      require_ok: true,
      require_request_id: true,
      counts: { refs_min: 0, artifacts_min: 0, jobs_min: 0, last_result_refs_min: 0 },
      timestamps: "current_run",
    });
    branches.push({
      id: step.on_failure,
      trigger: "template_error",
      step: step.id,
      strategy: "retry_step",
      summary: `Retry only ${step.id} when retained evidence says it is safe.`,
    });
  }

  const recipe = {
    contract: RECIPE_CONTRACT,
    id: recipeId,
    title: options.title ?? "Learned demonstrated transformation",
    summary: options.summary ?? "An immutable user Recipe compiled from identity-aware semantic differences.",
    pack,
    lifecycle: "validated",
    risk: "write",
    entity_kind: facts.length === 1 ? facts[0].kind : "project",
    tags: ["learned", "demonstrated", "semantic"],
    workflow_card: {
      intent: "Replay a demonstrated semantic transformation through accepted Templates.",
      entry_conditions: [
        "Use exact target identity from the current bounded state.",
        "Require fresh state before the first write.",
      ],
      supported_steps: [
        "Apply only supported identity-aware facts.",
        "Respect dependency order and retain compact evidence.",
      ],
      candidate_steps: ["Ask one compact question when a target intent remains ambiguous."],
      blocked_steps: [
        "Do not replay gestures or UI history.",
        "Do not use raw Lua, actions, shell commands, or bridge bypass fields.",
      ],
      required_questions: ["Ask before proceeding when identity or semantic scope is ambiguous."],
      template_atoms: [...new Set(callSteps.map((step) => step.call_template.id))],
      evidence_required: ["template.runtime.evidence.v1 with request id"],
      cleanup_plan: "Use Whole-Recipe Undo and retained evidence; never infer destructive cleanup.",
      typed_blockers: ["ambiguous_identity", "unsupported_semantic_fact", "unknown_capture_state", "no_replay_bypass"],
      token_budget: {
        menu_max_bytes: 4096,
        exact_max_bytes: 32768,
        compact_chat_max_items: 5,
        same_typed_blocker_stop_after: 2,
      },
    },
    steps,
    assertions: [
      {
        id: "assert_learned_outputs",
        kind: "expected_output",
        summary: "The learned Recipe retains compact refs and changed semantic state.",
        required: true,
        evidence: callSteps.map((step) => step.evidence),
        outputs: {
          refs: expectedRefs,
          artifacts: [],
          jobs: [],
          state: expectedState,
        },
      },
      {
        id: "assert_template_evidence",
        kind: "template_evidence",
        summary: "Every learned Template step must return compact runtime evidence.",
        required: true,
        evidence: callSteps.map((step) => step.evidence),
        outputs: { refs: [], artifacts: [], jobs: [], state: [] },
      },
    ],
    recovery: {
      run_state: {
        contract: "recipe.run_state.v1",
        initial: "not_started",
        states: ["not_started", "running", "paused", "succeeded", "failed", "blocked"],
        terminal: ["succeeded", "failed", "blocked"],
      },
      checkpoints,
      evidence_requirements: evidenceRequirements,
      idempotency: {
        scope: "recipe_run",
        default_step_policy: "follow_step_idempotency",
        on_resume: "skip_completed_checkpoints",
        on_replay: "reuse_verified_evidence",
      },
      resume: {
        from_checkpoint: "latest_verified",
        on_missing_evidence: "rerun_step",
        on_failed_evidence: "use_recovery_branch",
        on_risk_gate: "pause_for_user",
      },
      branches,
      risk_gates: [{
        id: "gate_write_fresh_state",
        applies_to: ["write"],
        required_before_step: callSteps[0].id,
        policy: "fresh_state",
        blocks_auto_resume: true,
        summary: "Require a fresh bounded state read before learned writes.",
      }],
    },
  };
  return deepFreeze(recipe);
}

function makeFact({
  factId,
  classification,
  kind,
  operation,
  field = null,
  templateId,
  target,
  before,
  after,
  input,
  bindings,
  references,
  reason,
  producesIdentity,
}) {
  if (!FACT_CLASSIFICATIONS.includes(classification)) throw new LearningSnapshotError(`Invalid fact classification: ${classification}.`);
  return {
    contract: "alpha4.semantic_fact.v1",
    fact_id: factId,
    classification,
    kind,
    operation,
    field,
    ...(templateId ? { template_id: templateId } : {}),
    ...(target ? { target: cloneJson(target) } : {}),
    ...(before !== undefined ? { before: cloneJson(before) } : {}),
    ...(after !== undefined ? { after: cloneJson(after) } : {}),
    ...(input !== undefined ? { input: cloneJson(input) } : {}),
    ...(bindings ? { bindings: cloneJson(bindings) } : {}),
    ...(references ? { references: cloneJson(references) } : {}),
    ...(producesIdentity ? { produces_identity: cloneJson(producesIdentity) } : {}),
    reason,
  };
}

function makeUnknownEntityFact(entity, reason) {
  return makeFact({
    factId: `${entity.kind}.unknown.${entity.source_index}`,
    classification: "unknown",
    kind: entity.kind,
    operation: "unknown",
    field: "identity",
    target: entity.identity ? targetForEntity(entity) : undefined,
    reason,
  });
}

function targetForEntity(entity) {
  if (!entity?.identity || !entity.ref) return undefined;
  return { kind: entity.kind, ref: entity.ref, identity: cloneJson(entity.identity) };
}

function relationRef(values, prefix) {
  const ref = values[`${prefix}_ref`];
  const identity = values[`${prefix}_identity`];
  if (typeof ref !== "string") return null;
  const normalizedIdentity = isRecord(identity) ? normalizeEntityIdentity(prefix === "fx" ? "fx" : prefix === "envelope" ? "envelope" : prefix === "take" ? "take" : "track", ref, identity) : deriveIdentityFromRef(ref, prefix === "fx" ? "fx" : prefix === "envelope" ? "envelope" : prefix === "take" ? "take" : "track");
  if (!normalizedIdentity) return null;
  const kind = prefix === "fx" ? "fx" : prefix === "envelope" ? "envelope" : prefix === "take" ? "take" : "track";
  return { kind, ref, identity: normalizedIdentity };
}

function isTrustedFx(entity) {
  return entity?.values?.trusted_surface === "D"
    && typeof entity.values.plugin_name === "string"
    && entity.values.plugin_name.trim() !== ""
    && typeof entity.values.plugin_ident === "string"
    && entity.values.plugin_ident.trim() !== "";
}

function validPoint(values) {
  return typeof values.time_seconds === "number"
    && typeof values.value === "number"
    && Number.isInteger(values.shape)
    && typeof values.tension === "number"
    && typeof values.selected === "boolean";
}

function pointInput(values, includeSelected = true) {
  return {
    ...(Number.isInteger(values.point_index) ? { point_index: values.point_index } : {}),
    time_seconds: values.time_seconds,
    value: values.value,
    shape: values.shape,
    tension: values.tension,
    ...(includeSelected ? { selected: values.selected } : {}),
  };
}

function literalRef(reference) {
  return {
    kind: reference.kind,
    ref: reference.ref,
    identity: cloneJson(reference.identity),
  };
}

function ensureSnapshot(input) {
  return input?.contract === LEARNING_SNAPSHOT_CONTRACT ? input : normalizeLearningSnapshot(input);
}

function ensureDiff(input) {
  if (!isRecord(input) || input.contract !== LEARNED_DIFF_CONTRACT || !Array.isArray(input.facts)) {
    throw new LearningSnapshotError("Compiler input must be an alpha4.learned_diff.v1 result.");
  }
  return input;
}

function sameCaptureIdentity(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function sameSelector(left, right) {
  return left.selector && right.selector && stableStringify(left.selector) === stableStringify(right.selector);
}

function identityKey(kind, identity) {
  return `${kind}|${identity.scheme}|${identity.value}`;
}

function deriveIdentityFromRef(ref, kind) {
  if (typeof ref !== "string" || !ref.startsWith(`${kind}:`)) return null;
  const remainder = ref.slice(kind.length + 1);
  const separator = remainder.indexOf(":");
  if (separator <= 0 || separator === remainder.length - 1) return null;
  return {
    scheme: remainder.slice(0, separator),
    value: remainder.slice(separator + 1),
  };
}

function compareNormalizedEntities(left, right) {
  return (left.identity_key ?? left.selector ? stableStringify(left.identity_key ?? left.selector) : "")
    .localeCompare(right.identity_key ?? right.selector ? stableStringify(right.identity_key ?? right.selector) : "")
    || left.source_index - right.source_index;
}

function compareFacts(left, right) {
  return (OPERATION_RANK[left.operation] ?? 900) - (OPERATION_RANK[right.operation] ?? 900)
    || left.fact_id.localeCompare(right.fact_id);
}

function titleForFact(fact) {
  return `${fact.kind.replace(/_/g, " ")} ${fact.field ? fact.field.replace(/_/g, " ") : fact.operation.replace(/\./g, " ")}`
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dominantPack(steps) {
  const counts = new Map();
  for (const step of steps) {
    const pack = step.call_template.id.split(".")[1];
    counts.set(pack, (counts.get(pack) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
}

function identitySlug(target) {
  return target ? slug(`${target.kind}_${target.identity.scheme}_${target.identity.value}`) : "unbound";
}

function slug(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "unknown";
}

function normalizeFieldName(value) {
  return String(value).replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`).toLowerCase();
}

function findForbiddenKeys(value, path = "") {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...findForbiddenKeys(child, `${path}[${index}]`)));
    return found;
  }
  if (!isRecord(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeFieldName(key);
    if (FORBIDDEN_REPLAY_FIELDS.has(normalized)) found.push(path ? `${path}.${key}` : key);
    found.push(...findForbiddenKeys(child, path ? `${path}.${key}` : key));
  }
  return [...new Set(found)];
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  return blockers.filter((blocker) => {
    const key = `${blocker.classification}|${blocker.fact_id}|${blocker.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function first(values) {
  return values.find((value) => value !== undefined && value !== null) ?? "unknown";
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
