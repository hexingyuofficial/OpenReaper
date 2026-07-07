import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
  ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT,
  createAlpha3D2ExtensionPackPacket,
  planAlpha3D2ExtensionPackPortability,
  scanAlpha3D2ExtensionPackPortablePayload,
  scrubAlpha3D2ExtensionPackPortablePayload,
  validateAlpha3D2ExtensionPackManifest,
  validateAlpha3D2ExtensionPackPacket,
} from "../../packages/core/src/alpha3-d2-extension-pack-portability-v1.mjs";
import {
  ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT,
  ALPHA3_D2_EXTENSION_PACK_REGISTRY_CONTRACT,
  forkAlpha3D2ExtensionPack,
  installAlpha3D2ExtensionPack,
  loadAlpha3D2ExtensionPackRegistry,
  shareAlpha3D2ExtensionPack,
} from "../../packages/core/src/alpha3-d2-extension-pack-entrypoints-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const CLI_PATH = path.join(REPO_ROOT, "scripts", "alpha3-d2-extension-pack-entrypoint.mjs");

describe("Alpha3 D2 extension pack portability", () => {
  it("validates a Vital-style plugin control pack without adding execution surface", () => {
    const manifest = vitalManifest();
    const validation = validateAlpha3D2ExtensionPackManifest(manifest);
    const packet = createAlpha3D2ExtensionPackPacket({
      manifest,
      source: "partner",
    }, fixedClock());

    assert.equal(validation.ok, true);
    assert.equal(packet.contract, ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT);
    assert.equal(packet.packet_kind, "extension_pack");
    assert.equal(packet.user_word, "pack");
    assert.equal(packet.pack.namespace, "vital_for_reaper");
    assert.deepEqual(packet.dependencies.required_templates, ["template.fx.set_parameter"]);
    assert.equal(packet.safety.added_tools, 0);
    assert.equal(packet.safety.public_call_recipe, false);
    assert.equal(packet.safety.hidden_executor, false);
    assert.equal(packet.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(packet.safety.executable_entries_exposed, false);
    assert.equal(packet.safety.package_scoped_aliases_only, true);
    assert.equal(validateAlpha3D2ExtensionPackPacket(packet).ok, true);
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
  });

  it("validates sound-library search contract shape for future semantic/audio/transient search", () => {
    const manifest = soundLibraryManifest();
    const plan = planAlpha3D2ExtensionPackPortability({
      operation: "share",
      manifest,
    }, fixedClock());

    assert.equal(validateAlpha3D2ExtensionPackManifest(manifest).ok, true);
    assert.equal(plan.ok, true);
    assert.equal(plan.pack.kind, "sound_library");
    assert.equal(plan.packet.capabilities[0].kind, "sound_library_search");
    assert.deepEqual(plan.packet.capabilities[0].permissions, [
      "media_library_read",
      "media_preview",
      "media_import",
      "local_index_read",
    ]);
    assert.equal(plan.safety.executable_entries_exposed, false);
  });

  it("scrubs generated caches and blocks private paths, privacy rows, licensed assets, global aliases, and raw bypass", () => {
    const manifest = vitalManifest();
    const bad = {
      ...manifest,
      aliases: [
        ...manifest.aliases,
        {
          alias: "set_vital",
          target: "capability.vital_for_reaper.set_macro",
          scope: "global",
          exact_match: false,
        },
      ],
      generated_cache_rows: [{ embedding: [1, 2, 3] }],
      privacy_index_rows: [{ query: "private vocal take" }],
      private_notes: "Client path /Users/Zhuanz/Music/private.rpp",
      dependencies: {
        ...manifest.dependencies,
        assets: [
          {
            label: "licensed preset",
            redistributable: false,
          },
        ],
      },
      raw_lua: "Main_OnCommand(40001, 0)",
      createTool: {
        name: "sixth_tool",
      },
    };

    const scan = scanAlpha3D2ExtensionPackPortablePayload(bad);
    const scrubbed = scrubAlpha3D2ExtensionPackPortablePayload(bad);
    const validation = validateAlpha3D2ExtensionPackManifest(bad);
    const plan = planAlpha3D2ExtensionPackPortability({
      operation: "share",
      manifest: bad,
    }, fixedClock());

    assert.equal(scan.ok, false);
    assert.equal(scrubbed.payload.generated_cache_rows.length, 0);
    assert.equal("private_notes" in scrubbed.payload, false);
    assert.equal(validation.ok, false);
    assert.equal(plan.ok, false);
    assert.equal(
      validation.blockers.filter((entry) => entry.code === "FORBIDDEN_EXECUTION_SURFACE").length >= 2,
      true,
    );
    assert.deepEqual(
      new Set([
        ...scan.blockers.map((entry) => entry.code),
        ...validation.blockers.map((entry) => entry.code),
        ...plan.portability.blockers.map((entry) => entry.code),
      ]),
      new Set([
        "PRIVACY_INDEX_ROWS_PRESENT",
        "LICENSE_NOT_SHAREABLE",
        "GLOBAL_ALIAS_NOT_ALLOWED",
        "ALIAS_MUST_BE_EXACT",
        "ALIAS_NOT_PACKAGE_SCOPED",
        "FORBIDDEN_EXECUTION_SURFACE",
      ]),
    );
  });

  it("blocks forbidden execution concepts when they appear as manifest string values", () => {
    const manifest = soundLibraryManifest();
    const bad = {
      ...manifest,
      dependencies: {
        ...manifest.dependencies,
        handlers: ["hidden_executor"],
      },
      contributed_capabilities: [
        {
          ...manifest.contributed_capabilities[0],
          task_intents: [
            ...manifest.contributed_capabilities[0].task_intents,
            "run_shell",
          ],
          required_handlers: ["raw_lua"],
        },
      ],
    };

    const validation = validateAlpha3D2ExtensionPackManifest(bad);
    const plan = planAlpha3D2ExtensionPackPortability({
      operation: "install",
      manifest: bad,
    }, fixedClock());

    assert.equal(validation.ok, false);
    assert.equal(plan.ok, false);
    assert.equal(
      validation.blockers.filter((entry) => entry.code === "FORBIDDEN_EXECUTION_SURFACE").length >= 3,
      true,
    );
    assert.equal(plan.portability.blockers.some((entry) => entry.code === "FORBIDDEN_EXECUTION_SURFACE"), true);
  });

  it("shares, forks, installs, and registers extension packs without enabling executable entries", () => {
    const manifest = vitalManifest();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-pack-"));
    const outputDirectory = path.join(temp, "packets");
    const packRoot = path.join(temp, "extension-packs");

    const shared = shareAlpha3D2ExtensionPack({
      manifest,
      source: "partner",
      output_directory: outputDirectory,
    }, fixedClock());
    const forked = forkAlpha3D2ExtensionPack({
      packet: shared.packet,
      output_directory: outputDirectory,
      new_namespace: "my_vital_pack",
      display_name: "My Vital Pack",
      source: "local",
    }, fixedClock());
    const installed = installAlpha3D2ExtensionPack({
      packet: forked.packet,
      pack_root: packRoot,
    }, fixedClock());
    const registry = loadAlpha3D2ExtensionPackRegistry(packRoot);

    assert.equal(shared.contract, ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT);
    assert.equal(shared.ok, true);
    assert.equal(existsSync(shared.paths.packet_path), true);
    assert.equal(forked.ok, true);
    assert.equal(forked.packet.provenance.parent_packet_id, shared.packet.packet_id);
    assert.equal(forked.packet.manifest.namespace, "my_vital_pack");
    assert.equal(forked.packet.manifest.aliases[0].alias, "my_vital_pack.set_macro");
    assert.equal(forked.packet.manifest.aliases[0].scope, "package");
    assert.equal(installed.ok, true);
    assert.equal(installed.verification.ok, true);
    assert.equal(installed.safety.executable_entries_exposed, false);
    assert.equal(registry.contract, ALPHA3_D2_EXTENSION_PACK_REGISTRY_CONTRACT);
    assert.equal(registry.executable_entries_exposed, false);
    assert.equal(registry.packs.length, 1);
    assert.equal(registry.packs[0].namespace, "my_vital_pack");
    assert.equal(registry.packs[0].enabled, false);
  });

  it("forks sound-library pack namespaces across indexes, capabilities, aliases, and provenance", () => {
    const manifest = soundLibraryManifest();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-pack-sound-fork-"));
    const outputDirectory = path.join(temp, "packets");

    const shared = shareAlpha3D2ExtensionPack({
      manifest,
      source: "partner",
      output_directory: outputDirectory,
    }, fixedClock());
    const forked = forkAlpha3D2ExtensionPack({
      packet: shared.packet,
      output_directory: outputDirectory,
      new_namespace: "my_sound_pack",
      display_name: "My Sound Pack",
      source: "local",
    }, fixedClock());
    const resharedFork = shareAlpha3D2ExtensionPack({
      ...forked.packet,
      output_directory: outputDirectory,
      filename: "my_sound_pack-reshare.extension-pack-packet.json",
    }, fixedClock());

    assert.equal(shared.ok, true);
    assert.equal(forked.ok, true);
    assert.equal(forked.packet.manifest.namespace, "my_sound_pack");
    assert.equal(forked.packet.manifest.dependencies.indexes[0], "my_sound_pack.local_index");
    assert.equal(forked.packet.manifest.contributed_capabilities[0].capability_id, "capability.my_sound_pack.search");
    assert.equal(forked.packet.manifest.contributed_capabilities[0].required_indexes[0], "my_sound_pack.local_index");
    assert.equal(forked.packet.manifest.aliases[0].alias, "my_sound_pack.search");
    assert.equal(forked.packet.manifest.aliases[0].target, "capability.my_sound_pack.search");
    assert.equal(forked.packet.provenance.parent_packet_id, shared.packet.packet_id);
    assert.equal(resharedFork.ok, true);
    assert.equal(resharedFork.packet.provenance.parent_packet_id, shared.packet.packet_id);
    assert.equal(resharedFork.packet.provenance.forked_from, shared.packet.packet_id);
  });

  it("blocks same-namespace fork, enable during install, overwrite accidents, and path escapes", () => {
    const manifest = vitalManifest();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-pack-blocks-"));
    const outputDirectory = path.join(temp, "packets");
    const packRoot = path.join(temp, "extension-packs");
    const shared = shareAlpha3D2ExtensionPack({
      manifest,
      source: "partner",
      output_directory: outputDirectory,
    }, fixedClock());
    const sameNamespaceFork = forkAlpha3D2ExtensionPack({
      packet: shared.packet,
      output_directory: outputDirectory,
      new_namespace: manifest.namespace,
    }, fixedClock());
    const enableInstall = installAlpha3D2ExtensionPack({
      packet: shared.packet,
      pack_root: packRoot,
      enable: true,
    }, fixedClock());
    const escapeInstall = installAlpha3D2ExtensionPack({
      packet: shared.packet,
      pack_root: packRoot,
      relative_path: "../extension-pack.manifest.json",
    }, fixedClock());
    const firstInstall = installAlpha3D2ExtensionPack({
      packet: shared.packet,
      pack_root: packRoot,
    }, fixedClock());
    const secondInstall = installAlpha3D2ExtensionPack({
      packet: shared.packet,
      pack_root: packRoot,
    }, fixedClock());

    assert.equal(sameNamespaceFork.ok, false);
    assert.equal(blockerCodes(sameNamespaceFork).includes("FORK_NAMESPACE_UNCHANGED"), true);
    assert.equal(enableInstall.ok, false);
    assert.equal(blockerCodes(enableInstall).includes("ENABLE_NOT_IN_PORTABILITY_GATE"), true);
    assert.equal(escapeInstall.ok, false);
    assert.equal(blockerCodes(escapeInstall).includes("INSTALL_PATH_INVALID"), true);
    assert.equal(firstInstall.ok, true);
    assert.equal(secondInstall.ok, false);
    assert.equal(blockerCodes(secondInstall).includes("TARGET_EXISTS"), true);
    assert.equal(blockerCodes(secondInstall).includes("PACK_NAMESPACE_ALREADY_INSTALLED"), true);
  });

  it("exposes a local CLI entrypoint for share, fork, and install", () => {
    const manifest = vitalManifest();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-pack-cli-"));
    const inputPath = path.join(temp, "manifest.json");
    const outputDirectory = path.join(temp, "packets");
    const packRoot = path.join(temp, "extension-packs");
    writeFileSync(inputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const shareOutput = execFileSync(process.execPath, [
      CLI_PATH,
      "--operation",
      "share",
      "--input",
      inputPath,
      "--output-directory",
      outputDirectory,
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    const shared = JSON.parse(shareOutput);
    const packetPath = path.join(outputDirectory, "vital_for_reaper.extension-pack-packet.json");
    assert.equal(shared.ok, true);
    assert.equal(existsSync(packetPath), true);

    const forkOutput = execFileSync(process.execPath, [
      CLI_PATH,
      "--operation",
      "fork",
      "--input",
      packetPath,
      "--output-directory",
      outputDirectory,
      "--new-namespace",
      "cli_vital_pack",
      "--display-name",
      "CLI Vital Pack",
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    const forked = JSON.parse(forkOutput);
    const forkPath = path.join(outputDirectory, "cli_vital_pack.extension-pack-packet.json");
    assert.equal(forked.ok, true);
    assert.equal(existsSync(forkPath), true);

    const installOutput = execFileSync(process.execPath, [
      CLI_PATH,
      "--operation",
      "install",
      "--input",
      forkPath,
      "--pack-root",
      packRoot,
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    const installed = JSON.parse(installOutput);
    assert.equal(installed.ok, true);
    assert.equal(existsSync(installed.paths.manifest_path), true);
    assert.equal(existsSync(installed.paths.registry_path), true);
  });
});

function vitalManifest() {
  return {
    contract: ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
    pack_id: "extension_pack.vital_for_reaper",
    namespace: "vital_for_reaper",
    display_name: "Vital for REAPER",
    kind: "plugin_control",
    owner: "OpenReaper Labs",
    source: "partner",
    version: "0.1.0",
    openreaper_compatibility: {
      min_alpha: "alpha3",
    },
    support_status: "schema_validated",
    risk_classes: ["write"],
    permissions: ["project_read", "fx_parameter_control"],
    dependencies: {
      templates: ["template.fx.set_parameter"],
      handlers: [],
      plugins: [{ name: "Vital", vendor: "Vital Audio" }],
      services: [],
      indexes: [],
      assets: [],
    },
    contributed_capabilities: [
      {
        capability_id: "capability.vital_for_reaper.set_macro",
        kind: "plugin_control",
        user_label: "Set Vital macro",
        task_intents: ["control_vital", "plugin_parameter_control"],
        input_schema: {
          type: "object",
          required: ["fx_ref", "macro", "value"],
        },
        output_schema: {
          type: "object",
          required: ["readback"],
        },
        risk_policy: {
          risk: "write",
          authorization_domain: "fx_parameter_control",
        },
        permissions: ["fx_parameter_control"],
        required_templates: ["template.fx.set_parameter"],
        required_handlers: [],
        required_plugins: [{ name: "Vital", vendor: "Vital Audio" }],
        required_services: [],
        required_indexes: [],
        readback_contract: {
          summary: "Read back the owner-scoped FX parameter value after setting it.",
        },
        evidence: [{ tier: "schema_validated" }],
        support_status: "schema_validated",
        typed_blockers: [
          "PLUGIN_NOT_FOUND",
          "FX_OWNER_MISMATCH",
          "PARAMETER_IDENTITY_UNSUPPORTED",
        ],
        semantic_parameter_map: {
          parameters: [
            {
              id: "macro_1",
              label: "Macro 1",
              safe_range: [0, 1],
            },
          ],
        },
      },
    ],
    aliases: [
      {
        alias: "vital_for_reaper.set_macro",
        target: "capability.vital_for_reaper.set_macro",
        scope: "package",
        exact_match: true,
      },
    ],
    evidence: [{ tier: "schema_validated" }],
    privacy: {
      local_only: true,
    },
    scrub_policy: {
      remove: ["local_path", "private_notes", "generated_cache_rows"],
    },
    cache_policy: {
      generated: false,
    },
    changelog: [],
    deprecation_policy: {
      policy: "none",
    },
  };
}

function soundLibraryManifest() {
  return {
    contract: ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
    pack_id: "extension_pack.sound_search_lab",
    namespace: "sound_search_lab",
    display_name: "Sound Search Lab",
    kind: "sound_library",
    owner: "OpenReaper Labs",
    source: "partner",
    version: "0.1.0",
    openreaper_compatibility: {
      min_alpha: "alpha3",
    },
    support_status: "schema_validated",
    risk_classes: ["read", "write"],
    permissions: [
      "media_library_read",
      "media_preview",
      "media_import",
      "local_index_read",
    ],
    dependencies: {
      templates: ["template.media.insert_media_file"],
      handlers: [],
      plugins: [],
      services: [],
      indexes: ["sound_search_lab.local_index"],
      assets: [],
    },
    contributed_capabilities: [
      {
        capability_id: "capability.sound_search_lab.search",
        kind: "sound_library_search",
        user_label: "Search sound library",
        task_intents: [
          "semantic_sound_search",
          "audio_similarity_search",
          "transient_shape_search",
        ],
        input_schema: {
          type: "object",
          properties: {
            text_query: { type: "string" },
            audio_ref: { type: "string" },
            transient_shape: { type: "object" },
          },
        },
        output_schema: {
          type: "object",
          required: [
            "candidate_ref",
            "label",
            "score",
            "duration",
            "source",
            "license",
            "provenance",
            "preview_status",
            "coverage_status",
          ],
        },
        risk_policy: {
          risk: "read",
          import_requires: "media_import",
        },
        permissions: [
          "media_library_read",
          "media_preview",
          "media_import",
          "local_index_read",
        ],
        required_templates: ["template.media.insert_media_file"],
        required_handlers: [],
        required_plugins: [],
        required_services: [],
        required_indexes: ["sound_search_lab.local_index"],
        readback_contract: {
          summary: "Return compact candidate refs, scores, source, license, and preview status by default.",
        },
        evidence: [{ tier: "schema_validated" }],
        support_status: "schema_validated",
        typed_blockers: [
          "PACK_NOT_INSTALLED",
          "INDEX_NOT_READY",
          "LICENSE_NOT_IMPORTABLE",
          "PREVIEW_UNAVAILABLE",
        ],
      },
    ],
    aliases: [
      {
        alias: "sound_search_lab.search",
        target: "capability.sound_search_lab.search",
        scope: "package",
        exact_match: true,
      },
    ],
    evidence: [{ tier: "schema_validated" }],
    privacy: {
      local_only: true,
      voice_query_opt_in_required: true,
    },
    scrub_policy: {
      remove: ["local_path", "privacy_index_rows", "generated_cache_rows"],
    },
    cache_policy: {
      generated: true,
      share_cache_rows: false,
    },
    changelog: [],
    deprecation_policy: {
      policy: "none",
    },
  };
}

function fixedClock() {
  return {
    now: () => new Date("2026-07-07T13:56:00.000Z"),
  };
}

function blockerCodes(result) {
  return result.blockers.map((entry) => entry.code);
}
