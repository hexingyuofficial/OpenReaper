import assert from "node:assert/strict";
import { describe, it } from "node:test";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACT_LAST_RESULT_POLICY,
  ARTIFACT_STATE_STORE_BUDGETS,
  ARTIFACT_STATE_STORE_CONTRACT,
  ARTIFACT_STATE_STORE_TTL_POLICY,
  ArtifactStateStoreContractError,
  artifactIdFromCommandId,
  artifactPathFromParts,
  artifactPathFromRef,
  artifactRefDescriptorFromEnvelope,
  assertNoPublicArtifactLastResultRefs,
  classifyArtifactStorePath,
  createArtifactProducerResult,
  formatArtifactRef,
  isValidArtifactScope,
  isValidArtifactOwnerPack,
  normalizeArtifactEnvelope,
  parseArtifactRef,
  projectArtifactRead,
  shouldSweepArtifactPath,
  tryParseArtifactRef,
  validateArtifactEnvelope,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import { FOUNDATION_BRIDGE_PACK_IDS } from "../../packages/core/src/foundation-bridge-v1.mjs";

const VALID_ID = "art_20260703010203999_007_abcdef";
const VALID_REF = `artifact:analysis:loudness:${VALID_ID}`;
const ARTIFACT_ROOT = path.join(os.tmpdir(), "openreaper-artifacts-v1");

describe("Layer 4.5A artifact/state-store contract", () => {
  it("parses and formats canonical artifact refs for frozen pack owners only", () => {
    assert.equal(ARTIFACT_STATE_STORE_CONTRACT, "artifact.state_store.v1");
    assert.deepEqual(parseArtifactRef(VALID_REF), {
      owner_pack: "analysis",
      scope: "loudness",
      id: VALID_ID,
    });
    assert.equal(
      formatArtifactRef({
        owner_pack: "analysis",
        scope: "loudness",
        id: VALID_ID,
      }),
      VALID_REF,
    );

    for (const pack of FOUNDATION_BRIDGE_PACK_IDS) {
      assert.equal(isValidArtifactOwnerPack(pack), true, pack);
      assert.equal(formatArtifactRef({ owner_pack: pack, scope: "probe", id: VALID_ID }).startsWith(`artifact:${pack}:`), true);
    }
  });

  it("keeps the legacy command-id compatible artifact id derivation", () => {
    assert.equal(
      artifactIdFromCommandId("cmd_20260701010101999_000_ab12cd"),
      "art_20260701010101999_000_ab12cd",
    );
    assert.equal(
      artifactPathFromRef(
        ARTIFACT_ROOT,
        "artifact:analysis:probe:art_20260701010101999_000_ab12cd",
      ),
      path.join(ARTIFACT_ROOT, "analysis", "probe", "art_20260701010101999_000_ab12cd.json"),
    );
  });

  it("rejects malformed refs, raw paths, absolute paths, file URLs, wrong packs, and bad scopes", () => {
    const invalidRefs = [
      "artifact:analysis:loudness",
      "artifact:analysis:loudness:art_20260703010203999_007_abcdef:extra",
      "artifact:Analysis:loudness:art_20260703010203999_007_abcdef",
      "artifact:analysis:bad-scope:art_20260703010203999_007_abcdef",
      "artifact:analysis:cleanup:art_20260703010203999_007_abcdef",
      "artifact:analysis:loop:art_20260703010203999_007_abcdef",
      "artifact:cleanup:plan:art_20260703010203999_007_abcdef",
      "artifact:pack_contract_fixture:probe:art_20260703010203999_007_abcdef",
      "artifact:analysis:loudness:ART_20260703010203999_007_abcdef",
      "artifact:analysis:loudness:art_20260703010203999_007_ABCDEF",
      "artifact:analysis:loudness:art_20260703010203999_007_abcdef/evil",
      "/tmp/openreaper/artifact.json",
      "../artifact:analysis:loudness:art_20260703010203999_007_abcdef",
      "file:///tmp/artifact.json",
      "~/artifact.json",
      "analysis:loudness:art_20260703010203999_007_abcdef",
    ];

    for (const ref of invalidRefs) {
      assert.throws(() => parseArtifactRef(ref), ArtifactStateStoreContractError, ref);
      assert.equal(tryParseArtifactRef(ref), null, ref);
    }

    assert.equal(isValidArtifactScope("plan"), true);
    assert.equal(isValidArtifactScope("cleanup"), false);
    assert.equal(isValidArtifactScope("bad-scope"), false);
  });

  it("maps refs to paths under the artifact root and rejects escape shapes", () => {
    assert.equal(
      artifactPathFromRef(ARTIFACT_ROOT, VALID_REF),
      path.join(ARTIFACT_ROOT, "analysis", "loudness", `${VALID_ID}.json`),
    );

    assert.throws(
      () => artifactPathFromParts(ARTIFACT_ROOT, { owner_pack: "../analysis", scope: "loudness", id: VALID_ID }),
      /owner_pack/,
    );
    assert.throws(
      () => artifactPathFromRef("relative-root", VALID_REF),
      /artifactRoot must be an absolute path/,
    );
    assert.throws(
      () => artifactPathFromRef("file:///tmp/openreaper", VALID_REF),
      /artifactRoot must be a filesystem path/,
    );
    assert.throws(
      () => artifactPathFromRef("C:\\tmp\\openreaper-artifacts", VALID_REF),
      /artifactRoot must be an absolute path/,
    );

    assert.deepEqual(classifyArtifactStorePath(ARTIFACT_ROOT, path.join(os.tmpdir(), "outside.json")), {
      ok: false,
      action: "keep",
      reason: "outside_artifact_root",
      message: "Artifact store path is outside the artifact root.",
    });
    assert.deepEqual(classifyArtifactStorePath(ARTIFACT_ROOT, path.join(ARTIFACT_ROOT, "analysis", "bad.json")), {
      ok: false,
      action: "keep",
      reason: "unexpected_depth",
      message: "Artifact sweep only considers owner_pack/scope/id.json paths.",
    });
  });

  it("validates the canonical JSON artifact envelope", () => {
    const envelope = makeEnvelope();
    const normalized = normalizeArtifactEnvelope(envelope);

    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(normalized.contract, ARTIFACT_STATE_STORE_CONTRACT);
    assert.equal(normalized.ref, VALID_REF);
    assert.equal(normalized.producer.id, "template.analysis.write_loudness_artifact");
    assert.deepEqual(validateArtifactEnvelope(envelope), { ok: true, errors: [] });
  });

  it("rejects malformed envelopes and mismatched metadata", () => {
    const cases = [
      { name: "missing payload", value: withoutField(makeEnvelope(), "payload"), match: /Missing required artifact envelope field: payload/ },
      { name: "unknown top-level", value: { ...makeEnvelope(), path: "/tmp/raw.json" }, match: /Unknown artifact envelope field: path/ },
      { name: "wrong contract", value: { ...makeEnvelope(), contract: "openreaper.artifact.v1" }, match: /contract must be/ },
      { name: "mismatched owner", value: { ...makeEnvelope(), owner_pack: "core" }, match: /owner_pack must match/ },
      {
        name: "producer pack mismatch",
        value: {
          ...makeEnvelope(),
          producer: { kind: "template", id: "template.core.write_probe_artifact", pack: "core" },
        },
        match: /producer.pack must match/,
      },
      { name: "bad schema", value: { ...makeEnvelope(), schema: "loudness-report" }, match: /schema must use/ },
      { name: "bad summary", value: { ...makeEnvelope(), summary: [] }, match: /summary must be a JSON object/ },
      { name: "bad payload value", value: { ...makeEnvelope(), payload: { value: Number.POSITIVE_INFINITY } }, match: /non-finite/ },
      { name: "bad payload date", value: { ...makeEnvelope(), payload: { created: new Date("2026-07-03T00:00:00.000Z") } }, match: /plain objects/ },
      { name: "bad summary map", value: { ...makeEnvelope(), summary: new Map([["label", "bad"]]) }, match: /summary must be a JSON object/ },
      { name: "bad nested class", value: { ...makeEnvelope(), payload: { nested: new FixtureClass() } }, match: /plain objects/ },
      { name: "public artifact last result", value: { ...makeEnvelope(), payload: { ref: "last_result:artifact:0" } }, match: /last_result:artifact:N/ },
    ];

    for (const testCase of cases) {
      assert.equal(validateArtifactEnvelope(testCase.value).ok, false, testCase.name);
      assert.throws(() => normalizeArtifactEnvelope(testCase.value), testCase.match, testCase.name);
    }
  });

  it("enforces summary, payload, and read response budgets without partial JSON truncation", () => {
    assert.throws(
      () => normalizeArtifactEnvelope(makeEnvelope({ summary: { text: "s".repeat(ARTIFACT_STATE_STORE_BUDGETS.summary_max_bytes) } })),
      /summary exceeds/,
    );
    assert.throws(
      () => normalizeArtifactEnvelope(makeEnvelope({ payload: { text: "p".repeat(ARTIFACT_STATE_STORE_BUDGETS.payload_max_bytes) } })),
      /payload exceeds/,
    );
    assert.throws(
      () => projectArtifactRead(makeEnvelope(), { view: "payload", budget: { max_response_bytes: 120 } }),
      (error) => error instanceof ArtifactStateStoreContractError && error.code === "RESPONSE_TOO_LARGE",
    );
  });

  it("defines summary vs payload read semantics at helper level", () => {
    const summary = projectArtifactRead(makeEnvelope(), { view: "summary" });
    assert.equal(summary.artifact.view, "summary");
    assert.equal(summary.artifact.truncated, false);
    assert.equal("payload" in summary.artifact, false);
    assert.equal(typeof summary.artifact.response_bytes, "number");

    const payload = projectArtifactRead(makeEnvelope(), { view: "payload" });
    assert.equal(payload.artifact.view, "payload");
    assert.deepEqual(payload.artifact.payload, { peaks: [0.1, 0.2], note: "fixture-only payload" });

    assert.throws(
      () => projectArtifactRead(makeEnvelope(), { view: "metadata" }),
      (error) => error instanceof ArtifactStateStoreContractError && error.code === "PARAMS_INVALID",
    );
  });

  it("defines TTL sweep shape without deleting files or leaving the root", () => {
    const validPath = path.join(ARTIFACT_ROOT, "analysis", "loudness", `${VALID_ID}.json`);
    const classified = classifyArtifactStorePath(ARTIFACT_ROOT, validPath);
    assert.equal(classified.ok, true);
    assert.equal(classified.action, "candidate");
    assert.equal(classified.ref, VALID_REF);

    assert.equal(ARTIFACT_STATE_STORE_TTL_POLICY.default_ttl_ms, 604_800_000);
    assert.equal(
      shouldSweepArtifactPath({
        artifactRoot: ARTIFACT_ROOT,
        candidatePath: validPath,
        now_ms: 1_000_000,
        mtime_ms: 1_000_000 - ARTIFACT_STATE_STORE_TTL_POLICY.default_ttl_ms - 1,
      }).action,
      "delete",
    );
    assert.equal(
      shouldSweepArtifactPath({
        artifactRoot: ARTIFACT_ROOT,
        candidatePath: validPath,
        now_ms: 1_000_000,
        mtime_ms: 999_999,
      }).action,
      "keep",
    );
    assert.equal(classifyArtifactStorePath(ARTIFACT_ROOT, validPath.replace(".json", ".txt")).action, "keep");
    assert.equal(classifyArtifactStorePath(ARTIFACT_ROOT, path.join(ARTIFACT_ROOT, "analysis", "bad.json")).action, "keep");
  });

  it("keeps artifact refs out of public last_result:artifact:N resolver space", () => {
    assert.equal(ARTIFACT_LAST_RESULT_POLICY.public_last_result_artifact_refs, false);
    assert.equal(ARTIFACT_LAST_RESULT_POLICY.producers_update_last_result, false);
    assert.equal(ARTIFACT_LAST_RESULT_POLICY.reads_update_last_result, false);

    const producerResult = createArtifactProducerResult({ artifact_refs: [VALID_REF] });
    assert.equal(producerResult.artifacts[0].ref, VALID_REF);
    assert.deepEqual(producerResult.last_result, {
      updated: false,
      refs: [],
      truncated: false,
    });
    assert.equal(assertNoPublicArtifactLastResultRefs(producerResult), true);
    assert.throws(
      () => assertNoPublicArtifactLastResultRefs({ refs: ["last_result:artifact:0"] }),
      /last_result:artifact:N/,
    );

    const descriptor = artifactRefDescriptorFromEnvelope(makeEnvelope());
    assert.equal(descriptor.kind, "artifact");
    assert.equal(descriptor.identity.scheme, "artifact_ref");
    assert.equal(assertNoPublicArtifactLastResultRefs(projectArtifactRead(makeEnvelope())), true);
  });
});

function makeEnvelope(overrides = {}) {
  return {
    contract: ARTIFACT_STATE_STORE_CONTRACT,
    ref: VALID_REF,
    id: VALID_ID,
    owner_pack: "analysis",
    scope: "loudness",
    schema: "analysis.loudness.v1",
    producer: {
      kind: "template",
      id: "template.analysis.write_loudness_artifact",
      pack: "analysis",
    },
    created_at: "2026-07-03T01:02:03.999Z",
    summary: {
      label: "Loudness fixture",
      samples: 2,
    },
    payload: {
      peaks: [0.1, 0.2],
      note: "fixture-only payload",
    },
    ...overrides,
  };
}

function withoutField(value, field) {
  const clone = { ...value };
  delete clone[field];
  return clone;
}

class FixtureClass {
  constructor() {
    this.label = "not-json-plain";
  }
}
