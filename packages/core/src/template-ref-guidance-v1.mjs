export const TEMPLATE_REF_GUIDANCE_CONTRACT = "alpha3.2.c2.ref_guidance.v1";

export const TEMPLATE_REF_GUIDANCE_ACCEPTED_INPUT_FORMS = Object.freeze([
  "object_ref_array",
  "descriptor_keyed_object",
]);

const MAX_EXPECTED_REFS = 16;
const MAX_GUIDANCE_STRINGS = 6;
const MAX_ERRORS = 16;
const MAX_ERROR_LENGTH = 512;
const MAX_ERROR_UTF8_BYTES = 512;

const EXAMPLES = Object.freeze({
  project: Object.freeze({
    example: ref("project", "project:current", "current", "current"),
    replacement: "No replacement is needed for project:current; it targets the current project.",
  }),
  track: Object.freeze({
    example: ref("track", "track:guid:{TRACK-GUID}", "guid", "{TRACK-GUID}"),
    fallback: ref("track", "track:index:0", "index", "0"),
    replacement: "Replace {TRACK-GUID} in ref and identity.value with a real track GUID returned by a resolver or query; track:index:0 is a current-view positional selector only, so re-resolve after track structure changes and use a GUID for stable operations.",
  }),
  item: Object.freeze({
    example: ref("item", "item:guid:{ITEM-GUID}", "guid", "{ITEM-GUID}"),
    fallback: ref("item", "item:index:0", "index", "0"),
    replacement: "Replace {ITEM-GUID} in ref and identity.value with a real item GUID returned by a resolver or query; item:index:0 is a current-view positional selector only, so re-resolve after item structure changes and use a GUID for stable operations.",
  }),
  take: Object.freeze({
    example: ref("take", "take:guid:{TAKE-GUID}", "guid", "{TAKE-GUID}"),
    fallback: ref("take", "take:index:0", "index", "0"),
    replacement: "Replace {TAKE-GUID} in ref and identity.value with a real take GUID returned by a resolver or query; take:index:0 is a current-view positional selector only, so re-resolve after take structure changes and use a GUID for stable operations.",
  }),
  fx: Object.freeze({
    example: ref("fx", "fx:track:guid:{TRACK-GUID}:0", "track_fx", "track:guid:{TRACK-GUID}:0"),
    fallback: ref("fx", "fx:take:guid:{TAKE-GUID}:0", "take_fx", "take:guid:{TAKE-GUID}:0"),
    replacement: "Replace the owner GUID in ref and identity.value with a real track or take GUID; keep the owner-qualified FX slot suffix.",
  }),
  marker: Object.freeze({
    example: ref("marker", "marker:index:1", "index", "1"),
    replacement: "Replace 1 with the real REAPER marker index_number returned by marker/region listing or creation.",
  }),
  region: Object.freeze({
    example: ref("region", "region:index:1", "index", "1"),
    replacement: "Replace 1 with the real REAPER region index_number returned by marker/region listing or creation.",
  }),
  file: Object.freeze({
    example: ref("file", "file:path:/absolute/path/to/audio.wav", "path", "/absolute/path/to/audio.wav"),
    replacement: "Replace /absolute/path/to/audio.wav in ref and identity.value with the same real absolute file path.",
  }),
});

export function templateRefExample(kind, options = {}) {
  const guidance = EXAMPLES[kind];
  const selected = options.fallback === true && guidance?.fallback
    ? guidance.fallback
    : guidance?.example ?? genericRef(kind);
  return clone(selected);
}

export function templateRefExampleGuidance(kind) {
  const guidance = EXAMPLES[kind];
  const noReplacementNeeded = kind === "project";
  return {
    status: noReplacementNeeded
      ? "current_project_literal_no_replacement_needed"
      : "structural_placeholder_not_live_resolved",
    replacement: boundedString(
      guidance?.replacement
        ?? "Replace the placeholder with a matching ref returned by a resolver, query, create, or list template.",
      320,
    ),
    replace_fields: noReplacementNeeded ? [] : ["ref", "identity.value"],
    recommended_sources: noReplacementNeeded
      ? ["current_project_literal"]
      : kind === "file"
        ? [
            "resolver_template_result",
            "query_template_result",
            "create_template_result",
            "list_template_result",
            "real_absolute_path",
          ]
        : [
            "resolver_template_result",
            "query_template_result",
            "create_template_result",
            "list_template_result",
          ],
  };
}

export function buildTemplateRefGuidance({ declarations = [], refs, errors = [] } = {}) {
  const boundedErrors = errors.slice(0, MAX_ERRORS).map(boundedErrorString);
  const truncatedErrorStrings = boundedErrors.filter((entry) => entry.truncated).length;
  const omittedErrors = Math.max(0, errors.length - MAX_ERRORS);
  const expected = declarations.slice(0, MAX_EXPECTED_REFS).map((declaration) => {
    const guidance = EXAMPLES[declaration.kind];
    const exampleGuidance = templateRefExampleGuidance(declaration.kind);
    const entry = {
      name: boundedString(declaration.name, 128),
      kind: boundedString(declaration.kind, 64),
      required: declaration.required === true,
      example: templateRefExample(declaration.kind),
      example_status: exampleGuidance.status,
      replacement: exampleGuidance.replacement,
      replace_fields: exampleGuidance.replace_fields,
      recommended_sources: exampleGuidance.recommended_sources,
    };
    if (guidance?.fallback) entry.fallback_example = clone(guidance.fallback);
    return entry;
  });

  return {
    contract: TEMPLATE_REF_GUIDANCE_CONTRACT,
    errors: boundedErrors.map((entry) => entry.value),
    expected_refs: expected,
    missing_refs: missingRefNames(declarations, refs).slice(0, MAX_EXPECTED_REFS),
    accepted_input_forms: [...TEMPLATE_REF_GUIDANCE_ACCEPTED_INPUT_FORMS],
    replacement_guidance: [
      "Examples are complete structurally valid object-ref shapes, not proof that the referenced object exists.",
      "Replace every GUID or path placeholder consistently in both ref and identity.value before retrying.",
      "Prefer refs returned by resolver, query, create, or list template results instead of reconstructing refs from prose.",
    ].slice(0, MAX_GUIDANCE_STRINGS),
    next_action: "Supply each missing descriptor ref name with a matching live-resolved object ref, then retry the same call_template request.",
    guidance_budget: {
      max_expected_refs: MAX_EXPECTED_REFS,
      max_replacement_guidance: MAX_GUIDANCE_STRINGS,
      max_errors: MAX_ERRORS,
      max_error_length: MAX_ERROR_LENGTH,
      max_error_utf8_bytes: MAX_ERROR_UTF8_BYTES,
      errors_truncated: omittedErrors > 0 || truncatedErrorStrings > 0,
      omitted_errors: omittedErrors,
      truncated_error_strings: truncatedErrorStrings,
      expected_refs_truncated: declarations.length > MAX_EXPECTED_REFS,
    },
  };
}

function missingRefNames(declarations, refs) {
  const required = declarations.filter((entry) => entry.required === true);
  if (Array.isArray(refs)) {
    const counts = new Map();
    for (const value of refs) {
      const kind = isPlainObject(value) ? value.kind : null;
      if (typeof kind === "string" && hasUsableDeclaredRef(value, kind)) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    const missing = [];
    for (const declaration of required) {
      const count = counts.get(declaration.kind) ?? 0;
      if (count > 0) counts.set(declaration.kind, count - 1);
      else missing.push(declaration.name);
    }
    return missing;
  }
  if (isPlainObject(refs)) {
    return required
      .filter((entry) => !hasUsableDeclaredRef(refs[entry.name], entry.kind))
      .map((entry) => entry.name);
  }
  return required.map((entry) => entry.name);
}

function hasUsableDeclaredRef(value, kind) {
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) => isPlainObject(entry)
    && entry.kind === kind
    && typeof entry.ref === "string"
    && entry.ref.trim() !== ""
    && isPlainObject(entry.identity)
    && typeof entry.identity.scheme === "string"
    && entry.identity.scheme.trim() !== ""
    && typeof entry.identity.value === "string"
    && entry.identity.value.trim() !== "");
}

function genericRef(kind) {
  const safeKind = typeof kind === "string" && kind.trim() !== "" ? kind : "project";
  return ref(safeKind, `${safeKind}:replace-with-live-ref`, "replace", "replace-with-live-ref");
}

function ref(kind, canonical, scheme, value) {
  return Object.freeze({
    kind,
    ref: canonical,
    identity: Object.freeze({ scheme, value }),
  });
}

function boundedErrorString(value) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  let characters = 0;
  let utf8Bytes = 0;
  let exceedsBudget = false;
  for (const character of raw) {
    characters += 1;
    utf8Bytes += utf8Length(character);
    if (characters > MAX_ERROR_LENGTH || utf8Bytes > MAX_ERROR_UTF8_BYTES) {
      exceedsBudget = true;
      break;
    }
  }
  if (!exceedsBudget) return { value: raw, truncated: false };

  const ellipsis = "…";
  const maxCharacters = MAX_ERROR_LENGTH - 1;
  const maxBytes = MAX_ERROR_UTF8_BYTES - utf8Length(ellipsis);
  let result = "";
  characters = 0;
  utf8Bytes = 0;
  for (const character of raw) {
    const bytes = utf8Length(character);
    if (characters >= maxCharacters || utf8Bytes + bytes > maxBytes) break;
    result += character;
    characters += 1;
    utf8Bytes += bytes;
  }
  return { value: `${result}${ellipsis}`, truncated: true };
}

function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedString(value, maxLength) {
  const string = typeof value === "string" ? value : String(value ?? "");
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 1)}…`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
