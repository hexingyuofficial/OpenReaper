import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RECIPE_CONTRACT,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  USER_RECIPE_AUTHORING_CONTRACT,
  UserRecipeAuthoringError,
  defaultUserRecipeSourceRoots,
  discoverRecipeSourceFiles,
  loadUserRecipeAuthoringCatalog,
  loadUserRecipeCatalog,
} from "../../packages/core/src/user-recipe-authoring-v1.mjs";
import {
  createUserRecipeDiscovery,
  listUserRecipes,
} from "../../packages/mcp-server/src/user-recipe-discovery-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Layer 6 Narrow User Recipe Authoring v1", () => {
  it("loads strict *.recipe.json user recipes into the existing recipe discovery shape", () => {
    const fixture = createFixture();
    writeRecipe(fixture, "user", "tracks/prepare_dialog_track.recipe.json", makeRecipe({
      lifecycle: "validated",
    }));

    const authoring = loadUserRecipeAuthoringCatalog({ roots: fixture.roots });
    assert.equal(authoring.contract, USER_RECIPE_AUTHORING_CONTRACT);
    assert.equal(authoring.catalog.contract, "recipe.catalog.v1");
    assert.equal(authoring.catalog.size, 1);
    assert.equal(authoring.sources[0].source, "user");
    assert.equal(authoring.sources[0].id, "recipe.tracks.prepare_dialog_track");
    assert.equal(typeof authoring.catalog.run, "undefined");
    assert.equal(typeof authoring.catalog.execute, "undefined");

    const discovery = createUserRecipeDiscovery({ catalog: authoring.catalog });
    const menu = discovery.list_recipes();
    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "recipe_menu");
    assert.equal(menu.mode, "menu");
    assert.deepEqual(Object.keys(menu.items[0]), [
      "id",
      "title",
      "summary",
      "pack",
      "lifecycle",
      "risk",
      "entity_kind",
      "tags",
    ]);
    assert.equal("steps" in menu.items[0], false);
    assert.equal("assertions" in menu.items[0], false);
    assert.equal("recovery" in menu.items[0], false);

    const exact = listUserRecipes({
      ids: ["recipe.tracks.prepare_dialog_track"],
      fields: ["steps", "assertions", "recovery"],
    }, { catalog: authoring.catalog });
    assert.equal(exact.mode, "ids");
    assert.deepEqual(Object.keys(exact.items[0]).sort(), ["assertions", "id", "recovery", "steps"]);
  });

  it("keeps official, user, and community source lifecycle policy separate", () => {
    const userOfficial = createFixture();
    writeRecipe(userOfficial, "user", "tracks/bad_official.recipe.json", makeRecipe({
      lifecycle: "official",
    }));
    assert.throws(
      () => loadUserRecipeCatalog({ roots: userOfficial.roots }),
      /user recipes may not claim lifecycle official/,
    );

    const community = createFixture();
    writeRecipe(community, "user", "community/tracks/community_recipe.recipe.json", makeRecipe({
      id: "recipe.tracks.community_dialog_track",
      title: "Community dialog track",
      lifecycle: "community",
    }));
    const communityCatalog = loadUserRecipeAuthoringCatalog({ roots: community.roots });
    assert.equal(communityCatalog.sources[0].source, "community");
    assert.equal(communityCatalog.sources[0].lifecycle, "community");

    const communityLive = createFixture();
    writeRecipe(communityLive, "user", "community/tracks/bad_live.recipe.json", makeRecipe({
      lifecycle: "live_smoked",
    }));
    assert.throws(
      () => loadUserRecipeCatalog({ roots: communityLive.roots }),
      /community recipes may not claim lifecycle live_smoked/,
    );

    const official = createFixture();
    writeRecipe(official, "official", "tracks/official_fixture.recipe.json", makeRecipe({
      lifecycle: "official",
    }));
    const officialCatalog = loadUserRecipeAuthoringCatalog({ roots: official.roots });
    assert.equal(officialCatalog.sources[0].source, "official");
    assert.equal(officialCatalog.sources[0].lifecycle, "official");
  });

  it("rejects duplicate ids and user or community shadowing of official ids", () => {
    const duplicate = createFixture();
    writeRecipe(duplicate, "user", "tracks/one.recipe.json", makeRecipe());
    writeRecipe(duplicate, "user", "tracks/two.recipe.json", makeRecipe({
      title: "Duplicate dialog track",
    }));
    assert.throws(
      () => loadUserRecipeCatalog({ roots: duplicate.roots }),
      /Duplicate recipe id recipe\.tracks\.prepare_dialog_track/,
    );

    const shadow = createFixture();
    writeRecipe(shadow, "official", "tracks/official.recipe.json", makeRecipe({
      lifecycle: "validated",
    }));
    writeRecipe(shadow, "user", "tracks/user_shadow.recipe.json", makeRecipe({
      lifecycle: "draft",
    }));
    assert.throws(
      () => loadUserRecipeCatalog({ roots: shadow.roots }),
      /shadows official recipe id recipe\.tracks\.prepare_dialog_track/,
    );
  });

  it("rejects invalid source files before recipes can enter the catalog", () => {
    const badExtension = createFixture();
    writeText(badExtension, "user", "tracks/run_recipe.js", "module.exports = {};");
    assert.throws(
      () => discoverRecipeSourceFiles(badExtension.roots),
      /executable or ambiguous recipe source extension is forbidden/,
    );

    const badJsonName = createFixture();
    writeText(badJsonName, "user", "tracks/plain.json", "{}");
    assert.throws(
      () => discoverRecipeSourceFiles(badJsonName.roots),
      /recipe JSON files must use \.recipe\.json/,
    );

    const invalidJson = createFixture();
    writeText(invalidJson, "user", "tracks/bad.recipe.json", "{ trailing");
    assert.throws(
      () => loadUserRecipeCatalog({ roots: invalidJson.roots }),
      /Recipe source must be strict JSON/,
    );

    const arrayJson = createFixture();
    writeText(arrayJson, "user", "tracks/array.recipe.json", "[]");
    assert.throws(
      () => loadUserRecipeCatalog({ roots: arrayJson.roots }),
      /Recipe source must be a single JSON object/,
    );

    const symlinkEscape = createFixture();
    const outside = path.join(symlinkEscape.root, "..", `outside-${Date.now()}.recipe.json`);
    writeFileSync(outside, JSON.stringify(makeRecipe()), "utf8");
    mkdirSync(path.join(symlinkEscape.root, "recipes", "user", "tracks"), { recursive: true });
    symlinkSync(outside, path.join(symlinkEscape.root, "recipes", "user", "tracks", "escape.recipe.json"));
    assert.throws(
      () => discoverRecipeSourceFiles(symlinkEscape.roots),
      /symlink target escapes approved recipe root/,
    );
    rmSync(outside, { force: true });
  });

  it("continues to rely on Layer 5 for accepted template ids and bypass rejection", () => {
    const unknownTemplate = createFixture();
    const badTemplate = makeRecipe();
    badTemplate.steps[1].call_template.id = "template.tracks.not_in_catalog";
    badTemplate.recovery.evidence_requirements[0].template_id = "template.tracks.not_in_catalog";
    writeRecipe(unknownTemplate, "user", "tracks/unknown_template.recipe.json", badTemplate);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: unknownTemplate.roots }),
      /unknown or non-accepted template id/,
    );

    const rawLua = createFixture();
    const bypass = makeRecipe();
    bypass.steps[1].call_template.input.lua = "reaper.Main_OnCommand(40044, 0)";
    writeRecipe(rawLua, "user", "tracks/raw_lua.recipe.json", bypass);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: rawLua.roots }),
      /forbidden raw execution or bypass field/,
    );
  });

  it("accepts only minimal literal and earlier-step symbolic ref bindings", () => {
    const literal = createFixture();
    writeRecipe(literal, "user", "routing/read_track_routing.recipe.json", makeReadTrackRoutingRecipe());
    assert.equal(loadUserRecipeCatalog({ roots: literal.roots }).size, 1);

    const symbolic = createFixture();
    writeRecipe(symbolic, "user", "midi/create_midi_item.recipe.json", makeChainedMidiRecipe());
    assert.equal(loadUserRecipeCatalog({ roots: symbolic.roots }).size, 1);

    const missingRef = createFixture();
    const missing = makeChainedMidiRecipe();
    missing.steps[2].call_template.refs = {};
    writeRecipe(missingRef, "user", "midi/missing_ref.recipe.json", missing);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: missingRef.roots }),
      /refs\.track_ref is required/,
    );

    const futureRef = createFixture();
    const future = makeChainedMidiRecipe();
    future.steps[2].call_template.refs.track_ref = { $from_step: "create_midi_item", output: "track_ref" };
    writeRecipe(futureRef, "user", "midi/future_ref.recipe.json", future);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: futureRef.roots }),
      /references non-earlier step: create_midi_item/,
    );

    const badOperator = createFixture();
    const expression = makeChainedMidiRecipe();
    expression.steps[2].call_template.refs.track_ref = { $expr: "last_result.refs[0]" };
    writeRecipe(badOperator, "user", "midi/expression.recipe.json", expression);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: badOperator.roots }),
      /unsupported binding operator: \$expr/,
    );

    const wrongKind = createFixture();
    const wrong = makeChainedMidiRecipe();
    wrong.steps[2].call_template.refs.track_ref = {
      kind: "item",
      ref: "item:guid:{ITEM-GUID}",
      identity: { scheme: "guid", value: "{ITEM-GUID}" },
    };
    writeRecipe(wrongKind, "user", "midi/wrong_kind.recipe.json", wrong);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: wrongKind.roots }),
      /kind must be track/,
    );

    const fakeAssertionOutput = createFixture();
    writeRecipe(
      fakeAssertionOutput,
      "user",
      "midi/fake_assertion_output.recipe.json",
      makeFakeAssertionOutputBindingRecipe(),
    );
    assert.throws(
      () => loadUserRecipeCatalog({ roots: fakeAssertionOutput.roots }),
      /output track_ref is not declared by template\.transport\.read_state refs\.output/,
    );
  });

  it("rejects raw-looking or kind-incompatible literal ref objects", () => {
    const shellRef = createFixture();
    const raw = makeReadTrackRoutingRecipe();
    raw.steps[0].call_template.refs.track_ref.ref = "shell:rm -rf project";
    writeRecipe(shellRef, "user", "routing/raw_ref.recipe.json", raw);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: shellRef.roots }),
      /must not be raw execution, bridge-looking, path, traversal, shell expansion, or file URL/,
    );

    const wrongPrefix = createFixture();
    const badPrefix = makeReadTrackRoutingRecipe();
    badPrefix.steps[0].call_template.refs.track_ref.ref = "item:guid:{ITEM-GUID}";
    writeRecipe(wrongPrefix, "user", "routing/wrong_prefix.recipe.json", badPrefix);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: wrongPrefix.roots }),
      /ref must start with track:/,
    );

    const fileUrl = createFixture();
    const badFileUrl = makeReadTrackRoutingRecipe();
    badFileUrl.steps[0].call_template.refs.track_ref.ref = "file:///tmp/project.rpp";
    writeRecipe(fileUrl, "user", "routing/file_url.recipe.json", badFileUrl);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: fileUrl.roots }),
      /must not be raw execution, bridge-looking, path, traversal, shell expansion, or file URL/,
    );
  });

  it("validates artifact labels without adding artifact execution or live behavior", () => {
    const artifact = createFixture();
    writeRecipe(artifact, "user", "analysis/artifact_expectation.recipe.json", makeArtifactExpectationRecipe());
    assert.equal(loadUserRecipeCatalog({ roots: artifact.roots }).size, 1);

    const missingArtifact = createFixture();
    const bad = makeArtifactExpectationRecipe();
    bad.steps[2].get_state.refs = ["missing_report"];
    writeRecipe(missingArtifact, "user", "analysis/missing_artifact.recipe.json", bad);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: missingArtifact.roots }),
      /artifact ref must be a declared artifact output label/,
    );

    const canonicalArtifact = createFixture();
    const canonical = makeArtifactExpectationRecipe();
    canonical.steps[2].get_state.refs = ["artifact:analysis:report:art_20260703000000000_001_abcdef"];
    writeRecipe(canonicalArtifact, "user", "analysis/canonical_artifact.recipe.json", canonical);
    assert.throws(
      () => loadUserRecipeCatalog({ roots: canonicalArtifact.roots }),
      /get_state\.refs must use lower snake-case/,
    );
  });

  it("does not add MCP tools or recipe executor surface", () => {
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 5);

    const fixture = createFixture();
    writeRecipe(fixture, "user", "tracks/prepare.recipe.json", makeRecipe());
    const catalog = loadUserRecipeCatalog({ roots: fixture.roots });
    assert.equal(typeof catalog.runRecipe, "undefined");
    assert.equal(typeof catalog.executeRecipe, "undefined");
  });

  it("provides default official and user roots without loading product recipes", () => {
    const roots = defaultUserRecipeSourceRoots(process.cwd());
    assert.deepEqual(roots.map((root) => root.source), ["official", "user"]);
    assert.equal(roots[0].root.endsWith(path.join("recipes", "official")), true);
    assert.equal(roots[1].root.endsWith(path.join("recipes", "user")), true);
  });
});

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-layer6-"));
  const official = path.join(root, "recipes", "official");
  const user = path.join(root, "recipes", "user");
  mkdirSync(official, { recursive: true });
  mkdirSync(user, { recursive: true });
  return {
    root,
    roots: [
      { source: "official", root: official },
      { source: "user", root: user },
    ],
  };
}

function writeRecipe(fixture, source, relativePath, recipe) {
  writeText(fixture, source, relativePath, JSON.stringify(recipe, null, 2));
}

function writeText(fixture, source, relativePath, contents) {
  const root = fixture.roots.find((entry) => entry.source === source).root;
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

function makeRecipe(overrides = {}) {
  const recipe = {
    contract: RECIPE_CONTRACT,
    id: "recipe.tracks.prepare_dialog_track",
    title: "Prepare dialog track",
    summary: "Read compact project state, create a dialog track, and retain compact evidence.",
    pack: "tracks",
    lifecycle: "draft",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "setup"],
    steps: [
      readProjectStep(),
      createTrackStep(),
    ],
    assertions: [
      expectedOutputAssertion({
        refs: ["track_ref"],
        state: ["track"],
      }),
      templateEvidenceAssertion(),
    ],
    recovery: recoveryFor({
      checkpoints: [
        checkpoint("checkpoint_read_project", "read_project", []),
        checkpoint("checkpoint_create_dialog_track", "create_dialog_track", ["evidence_create_dialog_track"]),
      ],
      evidence: [
        evidence("evidence_create_dialog_track", "create_dialog_track", "template.tracks.create_track"),
      ],
      branches: defaultBranches("create_dialog_track"),
      risk_gates: [writeRiskGate("create_dialog_track")],
    }),
  };

  return mergeRecipe(recipe, overrides);
}

function makeReadTrackRoutingRecipe(overrides = {}) {
  const recipe = {
    contract: RECIPE_CONTRACT,
    id: "recipe.routing.read_track_routing_fixture",
    title: "Read track routing fixture",
    summary: "Read compact routing state for a literal track ref.",
    pack: "routing",
    lifecycle: "draft",
    risk: "read",
    entity_kind: "send",
    tags: ["routing", "read"],
    steps: [
      {
        id: "read_track_routing",
        title: "Read track routing",
        summary: "Read accepted routing state through a literal ref.",
        uses: "call_template",
        call_template: {
          id: "template.routing.read_track_routing",
          input: {
            include_receives: true,
            include_master_parent: true,
            max_routes: 16,
          },
          refs: {
            track_ref: {
              kind: "track",
              ref: "track:guid:{TRACK-GUID}",
              identity: { scheme: "guid", value: "{TRACK-GUID}" },
            },
          },
        },
        get_state: null,
        checkpoint: "checkpoint_read_track_routing",
        evidence: "evidence_read_track_routing",
        idempotency: {
          mode: "none",
          key_scope: "none",
          on_resume: "rerun",
        },
        on_failure: "branch_request_user",
      },
    ],
    assertions: [
      expectedOutputAssertion({
        id: "assert_routing_state",
        evidence: ["evidence_read_track_routing"],
        refs: ["send_refs"],
        state: ["send"],
      }),
    ],
    recovery: recoveryFor({
      checkpoints: [checkpoint("checkpoint_read_track_routing", "read_track_routing", ["evidence_read_track_routing"])],
      evidence: [evidence("evidence_read_track_routing", "read_track_routing", "template.routing.read_track_routing")],
      branches: defaultBranches("read_track_routing"),
      risk_gates: [],
    }),
  };
  return mergeRecipe(recipe, overrides);
}

function makeChainedMidiRecipe(overrides = {}) {
  const recipe = {
    contract: RECIPE_CONTRACT,
    id: "recipe.midi.create_midi_item_from_track",
    title: "Create MIDI item from track",
    summary: "Create a track, bind its ref into a MIDI item creation step, and retain compact evidence.",
    pack: "midi",
    lifecycle: "draft",
    risk: "write",
    entity_kind: "midi_item",
    tags: ["midi", "track"],
    steps: [
      readProjectStep(),
      createTrackStep({
        id: "create_track",
        checkpoint: "checkpoint_create_track",
        evidence: "evidence_create_track",
      }),
      {
        id: "create_midi_item",
        title: "Create MIDI item",
        summary: "Create one empty MIDI item on the track produced earlier.",
        uses: "call_template",
        call_template: {
          id: "template.midi.create_midi_item",
          input: {
            start_seconds: 0,
            end_seconds: 2,
          },
          refs: {
            track_ref: { $from_step: "create_track", output: "track_ref" },
          },
        },
        get_state: null,
        checkpoint: "checkpoint_create_midi_item",
        evidence: "evidence_create_midi_item",
        idempotency: {
          mode: "supported",
          key_scope: "recipe_run",
          on_resume: "reuse_evidence",
        },
        on_failure: "branch_retry_create_midi_item",
      },
    ],
    assertions: [
      expectedOutputAssertion({
        id: "assert_track_output",
        evidence: ["evidence_create_track"],
        refs: ["track_ref"],
        state: ["track"],
      }),
      expectedOutputAssertion({
        id: "assert_midi_item_output",
        evidence: ["evidence_create_midi_item"],
        refs: ["item_ref", "take_ref"],
        state: ["midi_item"],
      }),
    ],
    recovery: recoveryFor({
      checkpoints: [
        checkpoint("checkpoint_read_project", "read_project", []),
        checkpoint("checkpoint_create_track", "create_track", ["evidence_create_track"]),
        checkpoint("checkpoint_create_midi_item", "create_midi_item", ["evidence_create_midi_item"]),
      ],
      evidence: [
        evidence("evidence_create_track", "create_track", "template.tracks.create_track"),
        evidence("evidence_create_midi_item", "create_midi_item", "template.midi.create_midi_item"),
      ],
      branches: [
        ...defaultBranches("create_track"),
        {
          id: "branch_retry_create_midi_item",
          trigger: "template_error",
          step: "create_midi_item",
          strategy: "retry_step",
          summary: "Retry the MIDI item creation step when compact evidence says it is recoverable.",
        },
      ],
      risk_gates: [writeRiskGate("create_track")],
    }),
  };
  return mergeRecipe(recipe, overrides);
}

function makeFakeAssertionOutputBindingRecipe(overrides = {}) {
  const recipe = makeChainedMidiRecipe({
    id: "recipe.midi.fake_assertion_output_binding",
    title: "Fake assertion output binding",
  });
  recipe.steps[1] = {
    id: "read_transport",
    title: "Read transport",
    summary: "Read transport state with a template that declares no output refs.",
    uses: "call_template",
    call_template: {
      id: "template.transport.read_state",
      input: {},
      refs: {},
    },
    get_state: null,
    checkpoint: "checkpoint_read_transport",
    evidence: "evidence_read_transport",
    idempotency: {
      mode: "none",
      key_scope: "none",
      on_resume: "rerun",
    },
    on_failure: "branch_request_user",
  };
  recipe.steps[2].call_template.refs.track_ref = { $from_step: "read_transport", output: "track_ref" };
  recipe.recovery.checkpoints[1] = checkpoint("checkpoint_read_transport", "read_transport", ["evidence_read_transport"]);
  recipe.recovery.evidence_requirements[0] = evidence(
    "evidence_read_transport",
    "read_transport",
    "template.transport.read_state",
  );
  recipe.recovery.branches = [
    ...defaultBranches("read_transport"),
    {
      id: "branch_retry_create_midi_item",
      trigger: "template_error",
      step: "create_midi_item",
      strategy: "retry_step",
      summary: "Retry the MIDI item creation step when compact evidence says it is recoverable.",
    },
  ];
  recipe.recovery.risk_gates = [writeRiskGate("create_midi_item")];
  recipe.assertions[0] = expectedOutputAssertion({
    id: "assert_fake_transport_track_ref",
    evidence: ["evidence_read_transport"],
    refs: ["track_ref"],
    state: ["track"],
  });
  return mergeRecipe(recipe, overrides);
}

function makeArtifactExpectationRecipe(overrides = {}) {
  const recipe = makeRecipe({
    id: "recipe.analysis.artifact_expectation",
    title: "Artifact expectation",
    summary: "Declare an artifact output expectation and read only a symbolic artifact projection.",
    pack: "analysis",
    entity_kind: "analysis_report",
    tags: ["analysis", "artifact"],
  });
  recipe.steps.push({
    id: "read_artifact_summary",
    title: "Read artifact summary",
    summary: "Read a bounded artifact summary by symbolic artifact output label.",
    uses: "get_state",
    call_template: null,
    get_state: {
      projection: "artifact.summary",
      refs: ["analysis_report"],
    },
    checkpoint: "checkpoint_read_artifact_summary",
    evidence: null,
    idempotency: {
      mode: "read_only",
      key_scope: "none",
      on_resume: "rerun",
    },
    on_failure: "branch_request_user",
  });
  recipe.assertions[0].outputs.artifacts = ["analysis_report"];
  recipe.recovery.checkpoints.push(checkpoint("checkpoint_read_artifact_summary", "read_artifact_summary", []));
  return mergeRecipe(recipe, overrides);
}

function readProjectStep() {
  return {
    id: "read_project",
    title: "Read project",
    summary: "Read bounded state needed before recipe work.",
    uses: "get_state",
    call_template: null,
    get_state: {
      projection: "project.summary",
      refs: [],
    },
    checkpoint: "checkpoint_read_project",
    evidence: null,
    idempotency: {
      mode: "read_only",
      key_scope: "none",
      on_resume: "rerun",
    },
    on_failure: "branch_request_user",
  };
}

function createTrackStep(overrides = {}) {
  return {
    id: "create_dialog_track",
    title: "Create dialog track",
    summary: "Call the accepted track creation template.",
    uses: "call_template",
    call_template: {
      id: "template.tracks.create_track",
      input: {
        name: "Dialog",
      },
      refs: {},
    },
    get_state: null,
    checkpoint: "checkpoint_create_dialog_track",
    evidence: "evidence_create_dialog_track",
    idempotency: {
      mode: "supported",
      key_scope: "recipe_run",
      on_resume: "reuse_evidence",
    },
    on_failure: "branch_retry_create",
    ...cloneJson(overrides),
  };
}

function expectedOutputAssertion({
  id = "assert_dialog_track_output",
  evidence = ["evidence_create_dialog_track"],
  refs = [],
  artifacts = [],
  jobs = [],
  state = [],
} = {}) {
  return {
    id,
    kind: "expected_output",
    summary: "The recipe declares compact expected outputs.",
    required: true,
    evidence,
    outputs: {
      refs,
      artifacts,
      jobs,
      state,
    },
  };
}

function templateEvidenceAssertion() {
  return {
    id: "assert_template_evidence",
    kind: "template_evidence",
    summary: "The call_template step must retain compact Layer 4D runtime evidence.",
    required: true,
    evidence: ["evidence_create_dialog_track"],
    outputs: {
      refs: [],
      artifacts: [],
      jobs: [],
      state: [],
    },
  };
}

function recoveryFor({ checkpoints, evidence: evidenceRequirements, branches, risk_gates }) {
  return {
    run_state: {
      contract: "recipe.run_state.v1",
      initial: "not_started",
      states: [
        "not_started",
        "running",
        "paused",
        "succeeded",
        "failed",
        "blocked",
      ],
      terminal: [
        "succeeded",
        "failed",
        "blocked",
      ],
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
    risk_gates,
  };
}

function checkpoint(id, after_step, required_evidence) {
  return {
    id,
    after_step,
    required_evidence,
    on_resume: "continue_next_step",
    summary: "Checkpoint fixture for compact recipe evidence.",
  };
}

function evidence(id, step, template_id, counts = {}) {
  return {
    id,
    step,
    source: "template.runtime.evidence.v1",
    template_id,
    require_ok: true,
    require_request_id: true,
    counts: {
      refs_min: counts.refs_min ?? 0,
      artifacts_min: counts.artifacts_min ?? 0,
      jobs_min: counts.jobs_min ?? 0,
      last_result_refs_min: counts.last_result_refs_min ?? 0,
    },
    timestamps: "current_run",
  };
}

function defaultBranches(step) {
  return [
    {
      id: "branch_retry_create",
      trigger: "template_error",
      step,
      strategy: "retry_step",
      summary: "Retry only the failed accepted template step when evidence says it is recoverable.",
    },
    {
      id: "branch_request_user",
      trigger: "resume_conflict",
      step: null,
      strategy: "request_user",
      summary: "Pause for the agent or user when state recovery is ambiguous.",
    },
  ];
}

function writeRiskGate(required_before_step) {
  return {
    id: "gate_write_fresh_state",
    applies_to: ["write"],
    required_before_step,
    policy: "fresh_state",
    blocks_auto_resume: true,
    summary: "Require a fresh bounded state read before write-risk recipe work.",
  };
}

function mergeRecipe(base, overrides) {
  const recipe = cloneJson(base);
  for (const [key, value] of Object.entries(overrides)) recipe[key] = cloneJson(value);
  return recipe;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
