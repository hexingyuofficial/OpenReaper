import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS = Object.freeze([
  "template.fx.delete_fx",
  "template.routing.remove_send",
  "template.items.move_item_to_track",
]);

export const ALPHA3_3_LIFECYCLE_ATOM_TEMPLATES = deepFreeze([
  destructiveDescriptor({
    id: "template.fx.delete_fx",
    title: "Delete exact FX",
    summary: "Delete one exact Track-FX or Take-FX instance and prove its native FX GUID is absent from the complete owner chain.",
    pack: "fx",
    entity_kind: "fx",
    tags: ["alpha3_3", "fx", "delete", "exact_ref", "native"],
    capability: "fx.delete_fx",
    outputSchema: objectSchema({
      deleted_fx_ref: { type: "string" },
      owner_kind: { enum: ["track", "take"] },
      owner_ref: { type: "string" },
      slot_index: { type: "integer" },
      name: { type: "string" },
      ident: { type: "string" },
      fx_guid: { type: "string" },
      fx_count_before: { type: "integer" },
      fx_count_after: { type: "integer" },
    }),
    refs: refs({
      input: [ref("fx_ref", "fx", true, "Exact Track-FX or Take-FX ref with a GUID owner and exact slot.")],
      output: [ref("deleted_fx_ref", "fx", true, "Deleted FX ref echoed for bounded cleanup evidence.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Deletes exactly one FX instance from its existing owner chain.",
      entities: [
        { entity_kind: "fx", action: "delete", summary: "The exact native FX GUID disappears from the complete owner chain." },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("fx_guid_absent", "state_delta", "The deleted native FX GUID is absent from every slot in the complete owner chain."),
      check("fx_count_decremented", "state_delta", "The complete owner chain count is exactly one smaller."),
    ]),
    examples: [{
      name: "delete_exact_track_fx",
      summary: "Delete one previously resolved exact Track-FX ref.",
      input: {},
    }],
  }),
  destructiveDescriptor({
    id: "template.routing.remove_send",
    title: "Remove exact internal send",
    summary: "Remove one exact category-0 internal send after proving source, destination, index, and a non-duplicate routing fingerprint.",
    pack: "routing",
    entity_kind: "send",
    tags: ["alpha3_3", "routing", "send", "remove", "exact_ref", "native"],
    capability: "routing.remove_send",
    outputSchema: objectSchema({
      deleted_send_ref: { type: "string" },
      source_track_ref: { type: "string" },
      destination_track_ref: { type: "string" },
      send_index: { type: "integer" },
      category: { const: 0 },
      fingerprint: { type: "string" },
      send_count_before: { type: "integer" },
      send_count_after: { type: "integer" },
    }),
    refs: refs({
      input: [ref("send_ref", "send", true, "Exact category-0 internal send ref with a GUID source Track and exact send index.")],
      output: [ref("deleted_send_ref", "send", true, "Deleted send ref echoed for bounded cleanup evidence.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Deletes exactly one internal Track send without addressing hardware outputs.",
      entities: [
        { entity_kind: "send", action: "delete", summary: "The exact preflight routing fingerprint disappears from the source Track." },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("send_fingerprint_absent", "state_delta", "The exact preflight send fingerprint is absent from the complete source routing list."),
      check("send_count_decremented", "state_delta", "The category-0 send count is exactly one smaller."),
    ]),
    examples: [{
      name: "remove_exact_internal_send",
      summary: "Remove one previously resolved exact internal send ref.",
      input: {},
    }],
  }),
  writeDescriptor({
    id: "template.items.move_item_to_track",
    title: "Move item to existing track",
    summary: "Move one exact Item to one exact existing Track while preserving Item GUID, position, length, takes, and active take.",
    pack: "items",
    entity_kind: "item",
    tags: ["alpha3_3", "items", "move", "track", "exact_ref", "native"],
    capability: "items.move_item_to_track",
    idempotency: "supported",
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      source_track_ref: { type: "string" },
      target_track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      take_count: { type: "integer" },
      take_refs: { type: "array" },
      active_take_ref: { type: "string" },
      track_count_unchanged: { type: "boolean" },
    }),
    refs: refs({
      input: [
        ref("item_ref", "item", true, "Exact Item GUID ref to move; selection and index aliases are rejected."),
        ref("target_track_ref", "track", true, "Exact existing target Track GUID ref; this template never creates a Track."),
      ],
      output: [
        ref("item_ref", "item", true, "Same exact Item GUID after the move."),
        ref("target_track_ref", "track", true, "Existing target Track GUID read back from the moved Item."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Updates only the owning Track of one exact Item.",
      entities: [
        { entity_kind: "item", action: "update", summary: "The Item owner changes to the exact existing target Track." },
        { entity_kind: "track", action: "read", summary: "The existing target Track identity is read without creating Tracks." },
      ],
      idempotent: true,
    }),
    verification: requiredVerification([
      check("item_target_track_matches", "state_delta", "Live Item owner readback exactly matches the target Track GUID."),
      check("item_identity_preserved", "state_delta", "Item GUID, position, and length are unchanged."),
      check("item_takes_preserved", "state_delta", "Take count, ordered Take GUIDs, and active Take GUID are unchanged."),
      check("track_count_unchanged", "state_delta", "The project Track count is unchanged."),
    ]),
    examples: [{
      name: "move_exact_item_to_existing_track",
      summary: "Move one resolved exact Item to one resolved exact existing Track.",
      input: {},
    }],
  }),
]);

export function createAlpha3_3LifecycleAtomTemplates() {
  return cloneJson(ALPHA3_3_LIFECYCLE_ATOM_TEMPLATES);
}

function destructiveDescriptor(options) {
  return writeDescriptor({ ...options, risk: "destructive", idempotency: "none" });
}

function writeDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: options.pack,
    lifecycle: "experimental",
    risk: options.risk ?? "write",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: {
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: options.capability,
      idempotency: options.idempotency ?? "supported",
      timeout_ms: 5_000,
    },
    inputSchema: objectSchema({}, []),
    outputSchema: options.outputSchema,
    refs: options.refs,
    artifacts: { mode: "none", input: [], output: [] },
    expectedDelta: options.expectedDelta,
    verification: options.verification,
    examples: options.examples,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

function refs(overrides = {}) {
  return { input: [], output: [], ...overrides };
}

function ref(name, kind, required, summary) {
  return { name, kind, required, summary };
}

function mutationDelta(overrides = {}) {
  return { kind: "mutation", summary: "Mutates one exact object.", entities: [], idempotent: false, ...overrides };
}

function requiredVerification(checks) {
  return { mode: "required", checks };
}

function check(name, kind, summary) {
  return { name, kind, summary };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
