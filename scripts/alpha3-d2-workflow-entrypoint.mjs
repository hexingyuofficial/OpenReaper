#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY,
  forkAlpha3D2Workflow,
  installAlpha3D2Workflow,
  saveAlpha3D2Workflow,
  scrubAlpha3D2Workflow,
  shareAlpha3D2Workflow,
} from "../packages/core/src/alpha3-d2-workflow-entrypoints-v1.mjs";

const OPERATION_HANDLERS = Object.freeze({
  save: saveAlpha3D2Workflow,
  scrub: scrubAlpha3D2Workflow,
  share: shareAlpha3D2Workflow,
  install: installAlpha3D2Workflow,
  fork: forkAlpha3D2Workflow,
});

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.describe) {
    console.log(JSON.stringify(ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY, null, 2));
    process.exit(0);
  }

  const operation = args.operation;
  const handler = OPERATION_HANDLERS[operation];
  if (!handler) {
    throw new CliUsageError("Pass --operation save|scrub|share|install|fork.");
  }
  if (!args.input) {
    throw new CliUsageError("Pass --input <recipe-or-workflow-packet.json>.");
  }

  const payload = readJsonFile(args.input);
  const request = buildRequest(operation, payload, args);
  const result = handler(request);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  if (error instanceof CliUsageError) {
    console.error(error.message);
    printHelp();
    process.exit(2);
  }
  console.error(error?.stack ?? String(error));
  process.exit(1);
}

function buildRequest(operation, payload, args) {
  const request = payload?.contract === "alpha3.d2.workflow_packet.v1"
    ? { packet: payload }
    : { recipe: payload };
  request.operation = operation;
  copyIfPresent(args, request, "source");
  copyIfPresent(args, request, "output_directory");
  copyIfPresent(args, request, "recipe_root");
  copyIfPresent(args, request, "relative_path");
  copyIfPresent(args, request, "filename");
  copyIfPresent(args, request, "new_id");
  copyIfPresent(args, request, "title");
  copyIfPresent(args, request, "summary");
  copyIfPresent(args, request, "lifecycle");
  if (args.official_recipe_ids.length > 0) request.official_recipe_ids = args.official_recipe_ids;
  if (args.reserved_recipe_ids.length > 0) request.reserved_recipe_ids = args.reserved_recipe_ids;
  if (args.overwrite === true) request.overwrite = true;
  return request;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function copyIfPresent(source, target, key) {
  if (source[key] !== undefined) target[key] = source[key];
}

function parseArgs(argv) {
  const parsed = {
    _: [],
    help: false,
    describe: false,
    overwrite: false,
    official_recipe_ids: [],
    reserved_recipe_ids: [],
  };
  const keyMap = new Map([
    ["operation", "operation"],
    ["input", "input"],
    ["source", "source"],
    ["output-directory", "output_directory"],
    ["recipe-root", "recipe_root"],
    ["relative-path", "relative_path"],
    ["filename", "filename"],
    ["new-id", "new_id"],
    ["title", "title"],
    ["summary", "summary"],
    ["lifecycle", "lifecycle"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--describe") {
      parsed.describe = true;
      continue;
    }
    if (arg === "--overwrite") {
      parsed.overwrite = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const equalsAt = arg.indexOf("=");
    const rawKey = arg.slice(2, equalsAt === -1 ? undefined : equalsAt);
    const value = equalsAt === -1 ? argv[++index] : arg.slice(equalsAt + 1);
    if (value === undefined || value.startsWith("--")) {
      throw new CliUsageError(`Flag --${rawKey} needs a value.`);
    }
    if (rawKey === "official-recipe-id") {
      parsed.official_recipe_ids.push(value);
      continue;
    }
    if (rawKey === "reserved-recipe-id") {
      parsed.reserved_recipe_ids.push(value);
      continue;
    }
    const mapped = keyMap.get(rawKey);
    if (!mapped) throw new CliUsageError(`Unknown flag --${rawKey}.`);
    parsed[mapped] = value;
  }

  if (!parsed.operation && parsed._.length > 0) parsed.operation = parsed._[0];
  return parsed;
}

function printHelp() {
  console.error([
    "OpenReaper Alpha3 D2 workflow entrypoint",
    "",
    "Usage:",
    "  node scripts/alpha3-d2-workflow-entrypoint.mjs --operation share --input recipe.json --output-directory ./out",
    "  node scripts/alpha3-d2-workflow-entrypoint.mjs --operation install --input packet.json --recipe-root ./recipes/user",
    "  node scripts/alpha3-d2-workflow-entrypoint.mjs --operation fork --input packet.json --output-directory ./out --new-id recipe.project.my_variant",
    "",
    "Options:",
    "  --operation save|scrub|share|install|fork",
    "  --input <json>",
    "  --output-directory <dir>",
    "  --recipe-root <dir>",
    "  --relative-path <path.recipe.json>",
    "  --filename <name.workflow-packet.json>",
    "  --new-id <recipe.pack.lower_snake>",
    "  --official-recipe-id <id>       Repeatable install guard",
    "  --reserved-recipe-id <id>       Repeatable install guard",
    "  --overwrite                     Replace an existing target intentionally",
    "  --describe                      Print the entrypoint contract summary",
  ].join("\n"));
}

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}
