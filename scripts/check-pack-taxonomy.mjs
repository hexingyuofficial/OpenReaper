import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
} from "../packages/core/src/foundation-bridge-v1.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export const FIXED_PACK_IDS = Object.freeze([
  "core",
  "project",
  "transport",
  "tracks",
  "items",
  "media",
  "analysis",
  "midi",
  "fx",
  "routing",
  "automation",
  "render",
  "actions",
  "ui",
  "system",
  "hardware_control",
]);

export const WORKFLOW_SHAPED_PACK_IDS = Object.freeze([
  "loop",
  "cleanup",
  "delivery",
  "layer",
  "music_sketch",
]);

export const REQUIRED_PACK_BOUNDARY_FIELDS = Object.freeze([
  "Owner domain:",
  "Belongs here:",
  "Does not belong here:",
  "Typical entity_kind:",
  "Default risk posture:",
  "Allowed bridge operation families:",
  "Ambiguous examples / placement notes:",
]);

export const REQUIRED_TAXONOMY_SECTIONS = Object.freeze([
  "## Fixed Top-Level Packs",
  "## Primary Owner Rule",
  "## Cross-Domain Tie-Breaker",
  "## Catch-All Guardrails",
  "## Canonical Metadata Value Rules",
  "## Allowed Bridge Operation Families",
  "## Pack Responsibilities",
  "## Legacy Workflow Names",
  "## Difficult Placement Decision Table",
]);

export const DIFFICULT_PLACEMENT_CASES = Object.freeze([
  ["video processor VIDEO_CODE", "fx"],
  ["import video source", "media"],
  ["trim video item", "items"],
  ["render video", "render"],
  ["region render matrix", "render"],
  ["spectral edits on take", "items"],
  ["notation", "midi"],
  ["MusicXML", "midi"],
  ["tempo/time map", "project"],
  ["warp grid", "project"],
  ["ordinary markers/regions", "project"],
  ["SWS marker action text editing", "project"],
  ["resolving/executing marker/custom action", "actions"],
  ["Project Bay", "media"],
  ["Media Explorer", "media"],
  ["SWS resources with media/project-template/FX-chain content", "media"],
  ["global resource paths/environment", "system"],
  ["snap/grid/groove for project timeline", "project"],
  ["snap/grid/groove for MIDI event data", "midi"],
  ["SWS warp grid", "project"],
  ["track/VCA grouping", "tracks"],
  ["item grouping", "items"],
  ["send grouping", "routing"],
  ["envelope grouping", "automation"],
  ["takes/comping/lanes", "items"],
  ["razor edit item operations", "items"],
  ["razor edit automation operations", "automation"],
  ["render razor edit areas", "render"],
  ["loudness/peak/RMS/LUFS measurement", "analysis"],
  ["loudness normalization/export application", "render"],
  ["SWS snapshots/resources/cycle actions/live configs/ReaConsole", "no SWS pack"],
  ["OSC/control surface/MIDI learn/hardware MIDI send", "hardware_control"],
  ["MIDI notes/CC/event list/notation", "midi"],
]);

export function parseFixedPackList(markdown) {
  const heading = "## Fixed Top-Level Packs";
  const start = markdown.indexOf(heading);
  if (start === -1) {
    throw new Error("PACK_TAXONOMY_V1.md is missing ## Fixed Top-Level Packs.");
  }

  const afterHeading = markdown.slice(start + heading.length);
  const block = afterHeading.match(/```text\s*([\s\S]*?)```/);
  if (!block) {
    throw new Error("PACK_TAXONOMY_V1.md is missing the fixed pack text block.");
  }

  return block[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listPackDirectories(root = repoRoot) {
  const packRoot = path.join(root, "reaper/packs");
  if (!existsSync(packRoot)) return [];
  return readdirSync(packRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

export function validateFixedPackList(actual, expected = FIXED_PACK_IDS) {
  const errors = [];
  const duplicates = duplicateValues(actual);
  if (duplicates.length > 0) {
    errors.push(`Duplicate pack ids: ${duplicates.join(", ")}`);
  }

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((pack) => !actualSet.has(pack));
  const extra = actual.filter((pack) => !expectedSet.has(pack));
  const workflow = actual.filter((pack) => WORKFLOW_SHAPED_PACK_IDS.includes(pack));

  if (missing.length > 0) errors.push(`Missing pack ids: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`Extra pack ids: ${extra.join(", ")}`);
  if (workflow.length > 0) {
    errors.push(`Workflow-shaped pack ids are forbidden: ${workflow.join(", ")}`);
  }
  if (errors.length === 0 && actual.join("\n") !== expected.join("\n")) {
    errors.push("Pack ids are correct as a set but not in the frozen order.");
  }

  return { ok: errors.length === 0, errors };
}

export function validatePackTaxonomy(root = repoRoot) {
  const errors = [];
  const taxonomyPath = path.join(root, "docs/taxonomy/PACK_TAXONOMY_V1.md");
  const reviewNotesPath = path.join(root, "docs/taxonomy/PACK_TAXONOMY_REVIEW_NOTES.md");
  const layerProgressPath = path.join(root, "docs/LAYER_PROGRESS.md");

  const taxonomy = readRequiredFile(taxonomyPath, errors);
  const reviewNotes = readRequiredFile(reviewNotesPath, errors);
  const layerProgress = readRequiredFile(layerProgressPath, errors);
  if (errors.length > 0) return { ok: false, errors };

  let taxonomyPacks = [];
  try {
    taxonomyPacks = parseFixedPackList(taxonomy);
  } catch (error) {
    errors.push(error.message);
  }

  errors.push(...validateFixedPackList(taxonomyPacks).errors);
  errors.push(...compareOrdered("taxonomy fixed pack list", taxonomyPacks, FIXED_PACK_IDS));
  errors.push(...compareOrdered("FOUNDATION_BRIDGE_PACK_IDS", FOUNDATION_BRIDGE_PACK_IDS, FIXED_PACK_IDS));
  errors.push(
    ...compareSet(
      "reaper/packs directory names",
      listPackDirectories(root),
      FIXED_PACK_IDS,
    ),
  );

  for (const section of REQUIRED_TAXONOMY_SECTIONS) {
    if (!taxonomy.includes(section)) {
      errors.push(`PACK_TAXONOMY_V1.md is missing required section: ${section}`);
    }
  }

  for (const pack of FIXED_PACK_IDS) {
    const section = extractPackSection(taxonomy, pack);
    if (!section) {
      errors.push(`PACK_TAXONOMY_V1.md is missing pack section: ### \`${pack}\``);
      continue;
    }
    for (const field of REQUIRED_PACK_BOUNDARY_FIELDS) {
      if (!section.includes(field)) {
        errors.push(`Pack ${pack} is missing boundary field: ${field}`);
      }
    }
    errors.push(...validateAllowedBridgeFamilies(pack, section));
  }

  for (const workflow of WORKFLOW_SHAPED_PACK_IDS) {
    if (taxonomyPacks.includes(workflow) || listPackDirectories(root).includes(workflow)) {
      errors.push(`Workflow-shaped id must not exist as a pack: ${workflow}`);
    }
    const forbiddenMetadata = new RegExp(`\\bpack\\s*[:=]\\s*["']?${workflow}\\b`, "i");
    if (forbiddenMetadata.test(taxonomy) || forbiddenMetadata.test(reviewNotes)) {
      errors.push(`Workflow-shaped id must not be template/recipe pack metadata: ${workflow}`);
    }
  }

  const requiredRuleNeedles = [
    "A template's `pack` is its primary validation and ownership domain.",
    "not a workflow name",
    "not the template's full dependency list",
    "Prefer the pack for the main REAPER object being queried or modified.",
    "prefer `render`",
    "prefer `hardware_control`",
    "prefer `actions`",
    "do not place it in `actions`",
    "`core` MUST NOT become a functional junk drawer.",
    "`actions` MUST NOT become a junk drawer for every command.",
    "`system` MUST NOT become a junk drawer",
    "`ui` MUST NOT become an automatic GUI-clicking backdoor.",
    "draft",
    "experimental",
    "stable",
    "deprecated",
    "read",
    "safe",
    "write",
    "destructive",
    "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$",
    "^[a-z][a-z0-9_]*$",
  ];
  for (const needle of requiredRuleNeedles) {
    if (!taxonomy.includes(needle)) {
      errors.push(`PACK_TAXONOMY_V1.md is missing required rule text: ${needle}`);
    }
  }

  for (const [capability, owner] of DIFFICULT_PLACEMENT_CASES) {
    const line = `${capability} -> ${owner}`;
    if (!taxonomy.includes(line)) {
      errors.push(`PACK_TAXONOMY_V1.md is missing difficult placement: ${line}`);
    }
    if (!reviewNotes.includes(line)) {
      errors.push(`PACK_TAXONOMY_REVIEW_NOTES.md is missing difficult placement: ${line}`);
    }
  }

  const reviewNeedles = [
    "decision input only, not frozen taxonomy",
    "## External Sources Checked",
    "## Difficult REAPER/SWS Capability Placement",
    "## Tie-Breaker Examples",
    "## Layer 3 Taxonomy Test Cases",
  ];
  for (const needle of reviewNeedles) {
    if (!reviewNotes.includes(needle)) {
      errors.push(`PACK_TAXONOMY_REVIEW_NOTES.md is missing required text: ${needle}`);
    }
  }

  assertNoMigrationClaims({ taxonomy, reviewNotes, layerProgress }, errors);

  return { ok: errors.length === 0, errors };
}

function readRequiredFile(filePath, errors) {
  if (!existsSync(filePath)) {
    errors.push(`Missing required file: ${path.relative(repoRoot, filePath)}`);
    return "";
  }
  return readFileSync(filePath, "utf8");
}

function compareOrdered(label, actual, expected) {
  const result = validateFixedPackList([...actual], [...expected]);
  return result.ok ? [] : [`${label} does not exactly match: ${result.errors.join("; ")}`];
}

function compareSet(label, actual, expected) {
  const actualSorted = [...actual].sort((a, b) => a.localeCompare(b));
  const expectedSorted = [...expected].sort((a, b) => a.localeCompare(b));
  if (actualSorted.join("\n") === expectedSorted.join("\n")) return [];

  const actualSet = new Set(actualSorted);
  const expectedSet = new Set(expectedSorted);
  const missing = expectedSorted.filter((pack) => !actualSet.has(pack));
  const extra = actualSorted.filter((pack) => !expectedSet.has(pack));
  const errors = [`${label} does not match fixed pack ids.`];
  if (missing.length > 0) errors.push(`Missing: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`Extra: ${extra.join(", ")}`);
  return errors;
}

function extractPackSection(markdown, pack) {
  const heading = `### \`${pack}\``;
  const start = markdown.indexOf(heading);
  if (start === -1) return null;

  const afterHeading = markdown.slice(start + heading.length);
  const nextHeading = afterHeading.search(/\n(?:### `|## )/);
  return nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
}

function validateAllowedBridgeFamilies(pack, section) {
  const match = section.match(/Allowed bridge operation families:\s*([^\n]+)/);
  if (!match) return [];

  const families = [...match[1].matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
  if (families.length === 0) {
    return [`Pack ${pack} must list allowed bridge operation families in backticks.`];
  }

  return families
    .filter((family) => !FOUNDATION_BRIDGE_OPERATION_FAMILIES.includes(family))
    .map((family) => `Pack ${pack} lists unknown bridge operation family: ${family}`);
}

function assertNoMigrationClaims(docs, errors) {
  if (!docs.taxonomy.includes("Layer 3 does not migrate real pack content, templates, or recipes.")) {
    errors.push("PACK_TAXONOMY_V1.md must state that Layer 3 does not migrate content.");
  }
  if (!docs.layerProgress.includes("Legacy migrated: no.")) {
    errors.push("docs/LAYER_PROGRESS.md must keep Layer 3 legacy migration marked as no.");
  }

  const forbiddenClaims = [
    /\bLegacy migrated:\s*yes\b/i,
    /\btemplates?\/recipes?\/packs? implementation (?:is )?complete\b/i,
    /\btemplates? migrated\b/i,
    /\brecipes? migrated\b/i,
    /\bpack content migration complete\b/i,
  ];

  for (const [label, doc] of Object.entries(docs)) {
    for (const pattern of forbiddenClaims) {
      if (pattern.test(doc)) {
        errors.push(`${label} contains a forbidden migration/implementation completion claim.`);
      }
    }
  }
}

function main() {
  const result = validatePackTaxonomy(repoRoot);
  if (!result.ok) {
    console.error("Pack Taxonomy v1 check failed.");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  execFileSync(process.execPath, ["--test", "tests/layer3/pack-taxonomy.test.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  console.log(`Pack Taxonomy v1 ok (${FIXED_PACK_IDS.length} fixed packs).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
