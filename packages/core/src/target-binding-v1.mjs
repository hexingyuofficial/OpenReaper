import { createHash } from "node:crypto";

export const TARGET_BINDING_CONTRACT = "target_binding.v1";
export const TARGET_SET_RESOLVER_CONTRACT = "target_set_resolver.v1";
export const TARGET_BINDING_DOMAINS = Object.freeze([
  "tracks",
  "items",
  "takes",
  "envelopes",
  "automation_items",
  "points",
  "time_range",
]);
export const TARGET_BINDING_SELECTORS = Object.freeze([
  "selected",
  "explicit_refs",
  "explicit_range",
  "all",
  "time_selection",
]);
export const TARGET_BINDING_RELATIONS = Object.freeze(["overlaps", "within"]);
export const TARGET_BINDING_AGGREGATIONS = Object.freeze(["single", "each", "span", "batch"]);

const DOMAIN_SET = new Set(TARGET_BINDING_DOMAINS);
const SELECTOR_SET = new Set(TARGET_BINDING_SELECTORS);
const RELATION_SET = new Set(TARGET_BINDING_RELATIONS);
const AGGREGATION_SET = new Set(TARGET_BINDING_AGGREGATIONS);
const MAX_TARGETS = 512;

export function resolveTargetSet({ binding, inventory = {}, selection = {}, timeSelection = null, operation = "unknown" } = {}) {
  const normalized = normalizeTargetBinding(binding);
  if (!normalized.ok) return normalized;
  const rows = Array.isArray(inventory[normalized.value.domain]) ? inventory[normalized.value.domain] : [];
  const selected = Array.isArray(selection[normalized.value.domain])
    ? selection[normalized.value.domain]
    : rows.filter((row) => row?.selected === true);
  const source = normalized.value.selector === "selected"
    ? selected
    : normalized.value.selector === "all"
      ? rows
      : normalized.value.selector === "explicit_refs"
        ? rows.filter((row) => normalized.value.refs.includes(rowRef(row, normalized.value.domain)))
        : normalized.value.selector === "explicit_range"
          ? [normalized.value.range]
        : normalized.value.domain === "time_range"
          ? [timeSelection ?? selection.time_range].filter(Boolean)
          : [];
  const missing = normalized.value.selector === "explicit_refs"
    ? normalized.value.refs.filter((ref) => !source.some((row) => rowRef(row, normalized.value.domain) === ref))
    : [];
  if (missing.length > 0) return targetFailure("TARGET_BINDING_REF_NOT_FOUND", `Some explicit ${normalized.value.domain} refs were not found.`, { missing_refs: missing });

  let members = [...source];
  for (const constraint of normalized.value.constraints) {
    if (constraint.kind === "owner_in") {
      const owner = resolveTargetSet({ binding: constraint.source, inventory, selection, timeSelection, operation });
      if (!owner.ok) return owner;
      const ownerRefs = new Set(owner.target_set.members.map((row) => rowRef(row, constraint.source.domain)));
      members = members.filter((row) => ownerRefs.has(ownerRef(row, normalized.value.domain, constraint.source.domain)));
    } else if (constraint.kind === "time_relation") {
      const range = resolveTargetRange(constraint.source, { selection, timeSelection });
      if (!range.ok) return range;
      members = members.filter((row) => rangeMatches(row, range.range, constraint.relation));
    }
  }
  const unique = uniqueRows(members, normalized.value.domain);
  const cardinality = normalized.value.cardinality;
  if (unique.length < cardinality.minimum || unique.length > cardinality.maximum) {
    return targetFailure("TARGET_BINDING_CARDINALITY_INVALID", `Resolved ${unique.length} ${normalized.value.domain} target(s), outside the allowed range ${cardinality.minimum}-${cardinality.maximum}.`, {
      domain: normalized.value.domain,
      resolved_count: unique.length,
      minimum: cardinality.minimum,
      maximum: cardinality.maximum,
    });
  }
  const fingerprint = targetFingerprint({ operation, binding: normalized.value, members: unique });
  return {
    ok: true,
    contract: TARGET_SET_RESOLVER_CONTRACT,
    target_set: Object.freeze({
      domain: normalized.value.domain,
      members: Object.freeze(unique.map((row) => Object.freeze({ ...row }))),
      member_refs: Object.freeze(unique.map((row) => rowRef(row, normalized.value.domain))),
      count: unique.length,
      fingerprint,
      resolved_at: normalized.value.bind_at,
      operation,
    }),
    zero_write: false,
  };
}

export function normalizeTargetBinding(binding) {
  if (!isObject(binding)) return targetFailure("TARGET_BINDING_REQUIRED", "target_binding must be an object.");
  const allowed = new Set(["bind_at", "domain", "selector", "refs", "range", "constraints", "cardinality", "aggregation"]);
  const unknown = Object.keys(binding).filter((key) => !allowed.has(key));
  if (unknown.length > 0) return targetFailure("TARGET_BINDING_FIELD_UNSUPPORTED", `Unsupported target_binding field(s): ${unknown.join(", ")}.`, { fields: unknown });
  const bindAt = binding.bind_at ?? "execution";
  if (bindAt !== "execution" && bindAt !== "run_start") return targetFailure("TARGET_BINDING_BIND_AT_INVALID", "bind_at must be execution or run_start.");
  const domain = binding.domain;
  if (!DOMAIN_SET.has(domain)) return targetFailure("TARGET_BINDING_DOMAIN_INVALID", `domain must be one of ${TARGET_BINDING_DOMAINS.join(", ")}.`);
  const selector = binding.selector ?? (binding.refs ? "explicit_refs" : "selected");
  if (!SELECTOR_SET.has(selector)) return targetFailure("TARGET_BINDING_SELECTOR_INVALID", `selector must be one of ${TARGET_BINDING_SELECTORS.join(", ")}.`);
  const refs = binding.refs ?? [];
  if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string" || ref.length === 0) || new Set(refs).size !== refs.length) {
    return targetFailure("TARGET_BINDING_REFS_INVALID", "refs must be a unique array of non-empty canonical refs.");
  }
  if (selector === "explicit_refs" && refs.length === 0) return targetFailure("TARGET_BINDING_REFS_REQUIRED", "explicit_refs requires at least one ref.");
  if (selector !== "explicit_refs" && refs.length > 0) return targetFailure("TARGET_BINDING_REFS_CONFLICT", "refs are only valid with selector=explicit_refs.");
  const range = binding.range ?? null;
  if (selector === "explicit_range" && (domain !== "time_range" || !isRange(range))) {
    return targetFailure("TARGET_BINDING_RANGE_INVALID", "explicit_range requires domain=time_range and a valid range.");
  }
  if (selector !== "explicit_range" && range !== null) return targetFailure("TARGET_BINDING_RANGE_CONFLICT", "range is only valid with selector=explicit_range.");
  if (domain === "time_range" && !["time_selection", "explicit_range"].includes(selector)) {
    return targetFailure("TARGET_BINDING_SELECTOR_INVALID", "time_range supports only time_selection or explicit_range.");
  }
  const constraints = binding.constraints ?? [];
  if (!Array.isArray(constraints) || constraints.length > 8) return targetFailure("TARGET_BINDING_CONSTRAINTS_INVALID", "constraints must contain at most eight rows.");
  for (const constraint of constraints) {
    if (!isObject(constraint) || !["owner_in", "time_relation"].includes(constraint.kind) || !isObject(constraint.source)) return targetFailure("TARGET_BINDING_CONSTRAINT_INVALID", "Each constraint needs kind, source, and a supported shape.");
    if (constraint.kind === "time_relation" && !RELATION_SET.has(constraint.relation)) return targetFailure("TARGET_BINDING_RELATION_INVALID", "time_relation relation must be overlaps or within.");
    const source = normalizeTargetBinding(constraint.source);
    if (!source.ok) return source;
    if (constraint.kind === "time_relation" && source.value.domain !== "time_range") {
      return targetFailure("TARGET_BINDING_TIME_SOURCE_INVALID", "time_relation source must use domain=time_range.");
    }
    if (constraint.kind === "owner_in" && !ownerDomainSupported(domain, source.value.domain)) {
      return targetFailure("TARGET_BINDING_OWNER_DOMAIN_INVALID", `${domain} cannot be constrained by owners in ${source.value.domain}.`);
    }
  }
  const cardinality = binding.cardinality ?? { minimum: 1, maximum: MAX_TARGETS };
  if (!isObject(cardinality) || !Number.isInteger(cardinality.minimum) || !Number.isInteger(cardinality.maximum) || cardinality.minimum < 0 || cardinality.maximum < cardinality.minimum || cardinality.maximum > MAX_TARGETS) {
    return targetFailure("TARGET_BINDING_CARDINALITY_INVALID", `cardinality must be integer minimum/maximum within 0-${MAX_TARGETS}.`);
  }
  const aggregation = binding.aggregation ?? "batch";
  if (!AGGREGATION_SET.has(aggregation)) return targetFailure("TARGET_BINDING_AGGREGATION_INVALID", `aggregation must be one of ${TARGET_BINDING_AGGREGATIONS.join(", ")}.`);
  if (aggregation === "single" && (cardinality.minimum > 1 || cardinality.maximum > 1)) {
    return targetFailure("TARGET_BINDING_CARDINALITY_INVALID", "aggregation=single requires cardinality maximum 1.");
  }
  return { ok: true, value: Object.freeze({
    bind_at: bindAt,
    domain,
    selector,
    refs: Object.freeze([...refs]),
    range: range === null ? null : Object.freeze({ start_seconds: Number(range.start_seconds), end_seconds: Number(range.end_seconds) }),
    constraints: Object.freeze(constraints.map((constraint) => Object.freeze({ ...constraint, source: normalizeTargetBinding(constraint.source).value }))),
    cardinality: Object.freeze({ minimum: cardinality.minimum, maximum: cardinality.maximum }),
    aggregation,
  }) };
}

export function targetFingerprint({ operation = "unknown", binding, members = [] } = {}) {
  const payload = {
    contract: TARGET_SET_RESOLVER_CONTRACT,
    binding,
    member_refs: members.map((row) => row.ref ?? row.item_ref ?? row.track_ref ?? row.take_ref ?? row.envelope_ref ?? row.autoitem_ref ?? row.point_ref).sort(),
  };
  return `target-set:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)}`;
}

function resolveTargetRange(binding, { selection, timeSelection }) {
  const normalized = normalizeTargetBinding(binding);
  if (!normalized.ok) return normalized;
  if (normalized.value.domain !== "time_range" || !["time_selection", "explicit_range"].includes(normalized.value.selector)) return targetFailure("TARGET_BINDING_TIME_SOURCE_INVALID", "time_relation requires a time_range source.");
  const range = normalized.value.selector === "explicit_range" ? normalized.value.range : timeSelection ?? selection.time_range;
  if (!isRange(range)) return targetFailure("TARGET_BINDING_TIME_RANGE_UNAVAILABLE", "The current time selection is empty or unavailable.");
  return { ok: true, range };
}

function rangeMatches(row, range, relation) {
  const start = Number(row.position_seconds ?? row.start_seconds ?? row.time_seconds);
  const end = Number(row.end_seconds ?? (Number.isFinite(Number(row.length_seconds)) ? start + Number(row.length_seconds) : start));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (end === start) {
    return relation === "within"
      ? start >= range.start_seconds && start <= range.end_seconds
      : start >= range.start_seconds && start < range.end_seconds;
  }
  return relation === "within" ? start >= range.start_seconds && end <= range.end_seconds : start < range.end_seconds && end > range.start_seconds;
}

function rowRef(row, domain) {
  return row?.ref ?? row?.[`${domain.slice(0, -1)}_ref`] ?? row?.item_ref ?? row?.track_ref ?? row?.take_ref ?? row?.envelope_ref ?? row?.autoitem_ref ?? row?.point_ref ?? null;
}

function ownerRef(row, domain, ownerDomain) {
  if (ownerDomain === "tracks") return row?.track_ref ?? row?.owner_track_ref ?? row?.owner_ref ?? null;
  if (ownerDomain === "items") return row?.item_ref ?? row?.owner_item_ref ?? row?.owner_ref ?? null;
  if (ownerDomain === "takes") return row?.take_ref ?? row?.owner_take_ref ?? row?.owner_ref ?? null;
  if (ownerDomain === "envelopes") return row?.envelope_ref ?? row?.owner_envelope_ref ?? row?.owner_ref ?? null;
  return rowRef(row, domain);
}

function ownerDomainSupported(domain, ownerDomain) {
  return ({
    items: ["tracks"],
    takes: ["tracks", "items"],
    envelopes: ["tracks", "takes"],
    automation_items: ["envelopes"],
    points: ["envelopes", "automation_items"],
  }[domain] ?? []).includes(ownerDomain);
}

function uniqueRows(rows, domain) {
  const seen = new Set();
  return rows.filter((row) => {
    const ref = rowRef(row, domain);
    if (!ref || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
}

function isRange(value) {
  return isObject(value) && Number.isFinite(Number(value.start_seconds)) && Number.isFinite(Number(value.end_seconds)) && Number(value.end_seconds) > Number(value.start_seconds);
}

function targetFailure(code, message, details = {}) {
  return { ok: false, zero_write: true, code, message, blockers: [{ code, message, recoverable: true, details }] };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
