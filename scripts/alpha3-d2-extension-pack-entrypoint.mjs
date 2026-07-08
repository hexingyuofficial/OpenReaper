#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_DISCOVERY_SUMMARY,
  forkAlpha3D2ExtensionPack,
  installAlpha3D2ExtensionPack,
  planAlpha3D2ExtensionPackPromotion,
  saveAlpha3D2ExtensionPack,
  scrubAlpha3D2ExtensionPack,
  shareAlpha3D2ExtensionPack,
} from "../packages/core/src/alpha3-d2-extension-pack-entrypoints-v1.mjs";

const OPERATION_HANDLERS = Object.freeze({
  save: saveAlpha3D2ExtensionPack,
  scrub: scrubAlpha3D2ExtensionPack,
  share: shareAlpha3D2ExtensionPack,
  install: installAlpha3D2ExtensionPack,
  fork: forkAlpha3D2ExtensionPack,
  enable: planAlpha3D2ExtensionPackPromotion,
  disable: planAlpha3D2ExtensionPackPromotion,
  update: planAlpha3D2ExtensionPackPromotion,
  uninstall: planAlpha3D2ExtensionPackPromotion,
  promote_global_alias: planAlpha3D2ExtensionPackPromotion,
});

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.describe) {
    console.log(JSON.stringify(ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_DISCOVERY_SUMMARY, null, 2));
    process.exit(0);
  }

  const operation = normalizeOperation(args.operation);
  const handler = OPERATION_HANDLERS[operation];
  if (!handler) {
    throw new CliUsageError("Pass --operation save|scrub|share|install|fork|enable|disable|update|uninstall|promote_global_alias.");
  }
  if (!args.input) throw new CliUsageError("Pass --input <manifest-or-pack-packet.json>.");

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
  const request = payload?.contract === "alpha3.d2.extension_pack_packet.v1"
    ? { packet: payload }
    : { manifest: payload };
  request.operation = operation;
  copyIfPresent(args, request, "source");
  copyIfPresent(args, request, "output_directory");
  copyIfPresent(args, request, "pack_root");
  copyIfPresent(args, request, "relative_path");
  copyIfPresent(args, request, "filename");
  copyIfPresent(args, request, "new_namespace");
  copyIfPresent(args, request, "display_name");
  copyIfPresent(args, request, "version");
  if (args.promotion_evidence !== undefined) {
    request.promotion_evidence = parseJsonFlag(args.promotion_evidence, "--promotion-evidence");
  }
  if (args.control_tower_approval === true) request.control_tower_approval = true;
  if (args.overwrite === true) request.overwrite = true;
  if (args.enable === true) request.enable = true;
  return request;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function copyIfPresent(source, target, key) {
  if (source[key] !== undefined) target[key] = source[key];
}

function parseJsonFlag(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new CliUsageError(`${label} must be strict JSON: ${error.message}`);
  }
}

function parseArgs(argv) {
  const parsed = {
    _: [],
    help: false,
    describe: false,
    overwrite: false,
    enable: false,
  };
  const keyMap = new Map([
    ["operation", "operation"],
    ["input", "input"],
    ["source", "source"],
    ["output-directory", "output_directory"],
    ["pack-root", "pack_root"],
    ["relative-path", "relative_path"],
    ["filename", "filename"],
    ["new-namespace", "new_namespace"],
    ["display-name", "display_name"],
    ["version", "version"],
    ["promotion-evidence", "promotion_evidence"],
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
    if (arg === "--enable") {
      parsed.enable = true;
      continue;
    }
    if (arg === "--control-tower-approval") {
      parsed.control_tower_approval = true;
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
    const mapped = keyMap.get(rawKey);
    if (!mapped) throw new CliUsageError(`Unknown flag --${rawKey}.`);
    parsed[mapped] = value;
  }

  if (!parsed.operation && parsed._.length > 0) parsed.operation = parsed._[0];
  return parsed;
}

function normalizeOperation(operation) {
  return typeof operation === "string" ? operation.trim().toLowerCase().replaceAll("-", "_") : operation;
}

function printHelp() {
  console.error([
    "OpenReaper Alpha3 D2 extension pack entrypoint",
    "",
    "Usage:",
    "  node scripts/alpha3-d2-extension-pack-entrypoint.mjs --operation share --input manifest.json --output-directory ./out",
    "  node scripts/alpha3-d2-extension-pack-entrypoint.mjs --operation install --input packet.json --pack-root ./extension-packs",
    "  node scripts/alpha3-d2-extension-pack-entrypoint.mjs --operation fork --input packet.json --output-directory ./out --new-namespace my_pack",
    "",
    "Options:",
    "  --operation save|scrub|share|install|fork|enable|disable|update|uninstall|promote_global_alias",
    "  --input <json>",
    "  --output-directory <dir>",
    "  --pack-root <dir>",
    "  --relative-path <path/extension-pack.manifest.json>",
    "  --filename <name.extension-pack-packet.json>",
    "  --new-namespace <lower_snake_or_dotted>",
    "  --display-name <name>",
    "  --version <semver-or-label>",
    "  --promotion-evidence <json-object>  Accepted evidence envelope for plan-only promotion readiness",
    "  --control-tower-approval           Marks evidence as explicitly control-tower approved",
    "  --overwrite",
    "  --enable                       Always blocked in D2.3 portability gate",
    "  --describe",
  ].join("\n"));
}

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}
