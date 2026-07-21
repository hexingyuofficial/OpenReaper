import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOOL_ABI_V1_TOOL_NAMES,
  TOOL_ABI_V1_TOOLS,
} from "../packages/mcp-server/src/tool-abi-v1.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const expectedToolNames = [
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
  "call_recipe",
];

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

function duplicates(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
}

function assertUnique(label, names) {
  const dupes = duplicates(names);
  if (dupes.length > 0) {
    fail(`${label} contains duplicate tool name(s): ${dupes.join(", ")}`);
  }
}

function assertStrictToolSet(label, actualNames) {
  assertUnique(label, actualNames);

  const actual = new Set(actualNames);
  const expected = new Set(expectedToolNames);
  const missing = expectedToolNames.filter((name) => !actual.has(name));
  const extra = actualNames.filter((name) => !expected.has(name));

  if (missing.length > 0 || extra.length > 0) {
    fail(`${label} does not strictly match Tool ABI v1.`);
    if (missing.length > 0) fail(`  Missing: ${missing.join(", ")}`);
    if (extra.length > 0) fail(`  Extra: ${extra.join(", ")}`);
  }
}

function readFilesUnder(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readFilesUnder(absolute));
    } else if (entry.isFile() && /\.(mjs|js|mts|ts)$/.test(entry.name)) {
      files.push(absolute);
    }
  }

  return files;
}

function lineAndColumn(source, index) {
  const prefix = source.slice(0, index);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function parseStringLiteral(source, startIndex) {
  let index = startIndex;
  while (/\s/.test(source[index] ?? "")) index += 1;

  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let value = "";
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === "\\") {
      value += source[cursor + 1] ?? "";
      cursor += 1;
      continue;
    }
    if (quote === "`" && char === "$" && source[cursor + 1] === "{") {
      return null;
    }
    if (char === quote) return value;
    value += char;
  }

  return null;
}

function findPotentialRegistrationCalls(file, source) {
  const calls = [];
  const seen = new Set();
  const patterns = [
    /\.\s*tool\s*\(/g,
    /\bregisterTool\s*\(/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (seen.has(match.index)) continue;
      seen.add(match.index);

      const openParenIndex = source.indexOf("(", match.index);
      const location = lineAndColumn(source, match.index);
      calls.push({
        file,
        line: location.line,
        column: location.column,
        name: parseStringLiteral(source, openParenIndex + 1),
      });
    }
  }

  return calls.sort((a, b) =>
    a.file === b.file ? a.line - b.line || a.column - b.column : a.file.localeCompare(b.file),
  );
}

function extractMcpToolRegistrations() {
  const srcDir = path.join(repoRoot, "packages/mcp-server/src");
  if (!existsSync(srcDir)) return [];

  const calls = [];
  for (const file of readFilesUnder(srcDir)) {
    const source = readFileSync(file, "utf8");
    calls.push(...findPotentialRegistrationCalls(file, source));
  }

  return calls;
}

function extractFrozenToolBlock(markdown) {
  const heading = "## Frozen MCP Tool Surface";
  const sectionStart = markdown.indexOf(heading);
  if (sectionStart === -1) {
    fail("docs/abi/TOOL_ABI_V1.md is missing ## Frozen MCP Tool Surface.");
    return [];
  }

  const remaining = markdown.slice(sectionStart);
  const nextSectionOffset = remaining.slice(heading.length).search(/\n## /);
  const section =
    nextSectionOffset === -1
      ? remaining
      : remaining.slice(0, heading.length + nextSectionOffset);

  const block = section.match(/```text\s*([\s\S]*?)```/);
  if (!block) {
    fail("docs/abi/TOOL_ABI_V1.md is missing the frozen tool-name text block.");
    return [];
  }

  return block[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

assertUnique("Expected Tool ABI v1 names", expectedToolNames);
assertStrictToolSet(
  "packages/mcp-server/src/tool-abi-v1.mjs TOOL_ABI_V1_TOOLS",
  TOOL_ABI_V1_TOOLS.map((tool) => tool.name),
);
assertStrictToolSet(
  "packages/mcp-server/src/tool-abi-v1.mjs TOOL_ABI_V1_TOOL_NAMES",
  TOOL_ABI_V1_TOOL_NAMES,
);

const registeredMcpToolCalls = extractMcpToolRegistrations();
if (registeredMcpToolCalls.length > 0) {
  const callsWithoutLiteralNames = registeredMcpToolCalls.filter((call) => !call.name);
  if (callsWithoutLiteralNames.length > 0) {
    fail("Potential MCP tool registration calls were found, but Tool ABI v1 parity could not be proven.");
    fail("Use literal tool names matching TOOL_ABI_V1_TOOL_NAMES, expose/import the Tool ABI source of truth, or update scripts/check-tool-abi.mjs to prove parity.");
    for (const call of callsWithoutLiteralNames) {
      fail(`  Unproven call: ${path.relative(repoRoot, call.file)}:${call.line}:${call.column}`);
    }
  }

  assertStrictToolSet(
    "packages/mcp-server/src MCP server registrations",
    registeredMcpToolCalls
      .map((call) => call.name)
      .filter((name) => typeof name === "string"),
  );
}

const toolAbiDoc = readFileSync(
  path.join(repoRoot, "docs/abi/TOOL_ABI_V1.md"),
  "utf8",
);

assertStrictToolSet(
  "docs/abi/TOOL_ABI_V1.md frozen tool block",
  extractFrozenToolBlock(toolAbiDoc),
);

assertStrictToolSet(
  "docs/abi/TOOL_ABI_V1.md tool role headings",
  [...toolAbiDoc.matchAll(/^### `([^`]+)`\s*$/gm)].map((match) => match[1]),
);

const callRecipeSection = toolAbiDoc.split("### `call_recipe`")[1]?.split("\n## ")[0] ?? "";
for (const operation of ["validate", "save", "list", "get", "delete", "run", "resume"]) {
  if (!new RegExp(`^${operation}$`, "mu").test(callRecipeSection)) {
    fail(`docs/abi/TOOL_ABI_V1.md call_recipe section is missing ${operation}.`);
  }
}
if (/^evidence_page$/mu.test(callRecipeSection)) {
  fail("docs/abi/TOOL_ABI_V1.md must use get(evidence_ref), not an eighth evidence_page operation.");
}

if (failed) process.exit(1);

console.log(`Tool ABI v1 ok (${expectedToolNames.length} tools).`);
