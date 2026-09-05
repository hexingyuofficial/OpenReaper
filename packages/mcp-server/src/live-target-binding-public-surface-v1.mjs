import {
  createAcceptedOfficialMacroDependencyFacts,
  createAcceptedOfficialTemplateCatalogTemplates,
} from "./call-template-runtime-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "./alpha3-3-b1-macro-portfolio-v1.mjs";

export const LIVE_TARGET_BINDING_PUBLIC_SURFACE_CONTRACT = "openreaper.live_target_binding.public_surface.v1";
export const LIVE_TARGET_BINDING_PUBLIC_SURFACE_STATUSES = Object.freeze([
  "live_or_explicit",
  "explicit_only",
  "unsupported",
  "target_free",
  "constraint_only",
]);

const LIVE_DOMAINS = new Set(["track", "item", "take", "envelope", "automation_item", "point"]);
const LIVE_BINDING_DOMAINS = new Set(["tracks", "items", "takes", "envelopes", "automation_items", "points", "time_range"]);
const TARGET_REF_KINDS = new Set(["track", "item", "take", "envelope", "fx", "send", "marker", "region", "project"]);
const UNSUPPORTED_REF_KINDS = new Set(["hardware_output", "device"]);
const LIVE_DEFAULT_TEMPLATE_IDS = new Set([
  "template.tracks.freeze_track",
  "template.tracks.unfreeze_track",
]);

export function createLiveTargetBindingPublicSurfaceInventory({
  macros = createAcceptedOfficialMacroDependencyFacts(),
  templates = createAcceptedOfficialTemplateCatalogTemplates(),
} = {}) {
  const macroRows = macros.map((macro) => classifyMacro(macro, templates));
  const templateRows = templates.map(classifyTemplate);
  const macroIds = macroRows.map((row) => row.id);
  const templateIds = templateRows.map((row) => row.id);
  if (macroRows.length !== 15 || new Set(macroIds).size !== macroRows.length
    || templateRows.length !== 242 || new Set(templateIds).size !== templateRows.length) {
    throw new Error("Live target-binding public surface catalog count or uniqueness drift.");
  }
  return Object.freeze({
    contract: LIVE_TARGET_BINDING_PUBLIC_SURFACE_CONTRACT,
    counts: Object.freeze({ macros: macroRows.length, templates: templateRows.length }),
    macros: Object.freeze(macroRows),
    templates: Object.freeze(templateRows),
    domains: Object.freeze([...new Set([...macroRows, ...templateRows].flatMap((row) => row.domains))].sort()),
  });
}

export function validateLiveTargetBindingPublicSurfaceInventory(inventory = createLiveTargetBindingPublicSurfaceInventory()) {
  const errors = [];
  const macroSet = new Set(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS);
  const templateIds = new Set();
  for (const row of inventory.templates ?? []) {
    if (templateIds.has(row.id)) errors.push(`duplicate template row: ${row.id}`);
    templateIds.add(row.id);
    validateRow(row, errors);
  }
  for (const row of inventory.macros ?? []) {
    if (!macroSet.has(row.id)) errors.push(`stale or non-public Macro row: ${row.id}`);
    validateRow(row, errors);
  }
  if (inventory.counts?.macros !== macroSet.size) errors.push("Macro inventory count does not match the public portfolio.");
  if (inventory.counts?.templates !== 242) errors.push("Template inventory count does not match the live product catalog.");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function classifyMacro(macro, templates) {
  const fixed = new Set(macro.fixed_template_ids ?? []);
  const refs = templates.filter((template) => fixed.has(template.id)).flatMap((template) => template.refs?.input ?? []);
  const kinds = new Set(refs.map((ref) => ref.kind).filter((kind) => typeof kind === "string"));
  const domains = [...kinds].filter((kind) => LIVE_DOMAINS.has(kind)).map(pluralDomain);
  const unsupported = [...kinds].filter((kind) => UNSUPPORTED_REF_KINDS.has(kind));
  const targetBearing = [...kinds].some((kind) => TARGET_REF_KINDS.has(kind));
  let status = "target_free";
  if (unsupported.length > 0) status = "unsupported";
  else if (targetBearing) status = ["macro.project.query", "macro.items.apply", "macro.render.targets"].includes(macro.id) ? "live_or_explicit" : "explicit_only";
  return Object.freeze({
    id: macro.id,
    kind: "macro",
    status,
    domains: Object.freeze(domains.sort()),
    target_bearing: targetBearing,
    live_default: ["macro.items.apply", "macro.render.targets"].includes(macro.id),
    blocker: status === "unsupported" ? "HARDWARE_OR_DEVICE_IO_UNSUPPORTED" : null,
  });
}

function classifyTemplate(template) {
  const refs = Array.isArray(template.refs?.input) ? template.refs.input : [];
  const kinds = new Set(refs.map((ref) => ref.kind).filter((kind) => typeof kind === "string"));
  const bindingDomains = templateBindingDomains(template);
  const domains = [...new Set([
    ...[...kinds].filter((kind) => LIVE_DOMAINS.has(kind)).map(pluralDomain),
    ...bindingDomains,
  ])];
  const unsupported = [...kinds].filter((kind) => UNSUPPORTED_REF_KINDS.has(kind));
  const targetBearing = [...kinds].some((kind) => TARGET_REF_KINDS.has(kind)) || bindingDomains.length > 0;
  const supportsLiveBinding = bindingDomains.length > 0;
  return Object.freeze({
    id: template.id,
    kind: "template",
    status: unsupported.length > 0 ? "unsupported" : supportsLiveBinding ? "live_or_explicit" : targetBearing ? "explicit_only" : "target_free",
    domains: Object.freeze(domains.sort()),
    target_bearing: targetBearing,
    live_default: LIVE_DEFAULT_TEMPLATE_IDS.has(template.id),
    blocker: unsupported.length > 0 ? "HARDWARE_OR_DEVICE_IO_UNSUPPORTED" : null,
  });
}

function templateBindingDomains(template) {
  const domainSchema = template?.inputSchema?.properties?.target_binding?.properties?.domain;
  const candidates = domainSchema?.const === undefined
    ? Array.isArray(domainSchema?.enum) ? domainSchema.enum : []
    : [domainSchema.const];
  return [...new Set(candidates.filter((domain) => LIVE_BINDING_DOMAINS.has(domain)))];
}

function pluralDomain(kind) {
  return kind === "automation_item" ? "automation_items" : `${kind}s`;
}

function validateRow(row, errors) {
  if (!row || typeof row.id !== "string") errors.push("inventory row is missing id");
  if (!LIVE_TARGET_BINDING_PUBLIC_SURFACE_STATUSES.includes(row?.status)) errors.push(`invalid inventory status for ${row?.id}`);
  if (!Array.isArray(row?.domains) || row.domains.some((domain) => typeof domain !== "string")) errors.push(`invalid inventory domains for ${row?.id}`);
  if (row?.status === "target_free" && row?.target_bearing === true) errors.push(`target-bearing row marked target_free: ${row.id}`);
  if (row?.status === "constraint_only") errors.push(`constraint_only is reserved for the time_range source, not executable rows: ${row.id}`);
}
