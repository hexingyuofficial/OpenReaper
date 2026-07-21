import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ARTIFACT_STATE_STORE_BUDGETS,
  ARTIFACT_STATE_STORE_CONTRACT,
  assertNoPublicArtifactLastResultRefs,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  FOUNDATION_BRIDGE_PACK_IDS,
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  GET_STATE_ARTIFACT_SCOPE,
  GET_STATE_RUNTIME_CONTRACT,
  createGetStateArtifactRuntime,
  getStateArtifactProjection,
} from "../../packages/mcp-server/src/get-state-runtime-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

const VALID_ID = "art_20260703010203999_007_abcdef";
const REPORT_REF = `artifact:analysis:loudness_report:${VALID_ID}`;

describe("Layer 4.5B get_state artifact projection runtime binding", () => {
  it("projects artifact report summaries through existing get_state semantics", async () => {
    const store = memoryArtifactStore([[REPORT_REF, makeEnvelope()]]);
    const runtime = createGetStateArtifactRuntime({
      artifactStore: store,
      now: () => new Date("2026-07-03T01:02:03.999Z"),
    });

    const response = await runtime.get_state({
      scope: GET_STATE_ARTIFACT_SCOPE,
      artifact_ref: REPORT_REF,
    });

    assert.equal(response.contract, GET_STATE_RUNTIME_CONTRACT);
    assert.equal(response.ok, true);
    assert.equal(response.scope, "artifact");
    assert.equal(response.request.artifact_ref, REPORT_REF);
    assert.equal(response.request.view, "summary");
    assert.equal(response.completed_at, "2026-07-03T01:02:03.999Z");
    assert.equal(response.result.artifact.ref, REPORT_REF);
    assert.equal(response.result.artifact.schema, "analysis.loudness_report.v1");
    assert.deepEqual(response.result.artifact.summary, {
      label: "Loudness report fixture",
      item_count: 1,
    });
    assert.equal("payload" in response.result.artifact, false);
    assert.equal(response.result.artifact.truncated, false);
    assert.equal(response.last_result.updated, false);
    assert.deepEqual(response.last_result.refs, []);
    assert.equal(response.budget.truncated, false);
    assert.equal(response.budget.response_bytes <= response.budget.max_response_bytes, true);
    assert.deepEqual(store.seen, [{ ref: REPORT_REF, owner_pack: "analysis", scope: "loudness_report" }]);
    assert.equal(assertNoPublicArtifactLastResultRefs(response), true);
  });

  it("projects artifact payloads only when view payload is explicit", async () => {
    const store = memoryArtifactStore([[REPORT_REF, JSON.stringify(makeEnvelope())]]);
    const response = await getStateArtifactProjection({
      scope: "artifact",
      artifact_ref: REPORT_REF,
      view: "payload",
    }, {
      artifactStore: store,
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.artifact.view, "payload");
    assert.deepEqual(response.result.artifact.payload, {
      peaks: [0.1, 0.2],
      note: "fixture-only payload",
    });
    assert.equal(response.result.artifact.truncated, false);
    assert.equal(response.last_result.updated, false);
  });

  it("validates report/artifact refs against the fixed 16 pack owners before store access", async () => {
    const entries = FOUNDATION_BRIDGE_PACK_IDS.map((pack, index) => {
      const id = `art_20260703010203999_${String(index + 1).padStart(3, "0")}_${String(index).padStart(6, "0")}`;
      const ref = `artifact:${pack}:report:${id}`;
      return [ref, makeEnvelope({
        ref,
        id,
        owner_pack: pack,
        scope: "report",
        schema: `${pack}.report.v1`,
        producer: {
          kind: "template",
          id: `template.${pack}.write_report_artifact`,
          pack,
        },
      })];
    });
    const store = memoryArtifactStore(entries);
    const runtime = createGetStateArtifactRuntime({ artifactStore: store });

    for (const [ref] of entries) {
      const response = await runtime.get_state({ scope: "artifact", artifact_ref: ref });
      assert.equal(response.ok, true, ref);
      assert.equal(response.result.artifact.ref, ref);
    }

    const invalidStore = memoryArtifactStore([[REPORT_REF, makeEnvelope()]]);
    for (const ref of [
      `report:analysis:loudness_report:${VALID_ID}`,
      `artifact:cleanup:report:${VALID_ID}`,
      `artifact:analysis:loop:${VALID_ID}`,
      `file:///tmp/${VALID_ID}.json`,
      `/tmp/${VALID_ID}.json`,
      `../artifact:analysis:loudness_report:${VALID_ID}`,
      `artifact:analysis:loudness_report:${VALID_ID}/evil`,
    ]) {
      const response = await getStateArtifactProjection({
        scope: "artifact",
        artifact_ref: ref,
      }, {
        artifactStore: invalidStore,
      });
      assert.equal(response.ok, false, ref);
      assert.equal(response.error.code, "PARAMS_INVALID", ref);
      assert.equal(response.last_result.updated, false, ref);
    }
    assert.deepEqual(invalidStore.seen, []);
  });

  it("returns typed missing, corrupt, and oversized artifact errors", async () => {
    const missing = await getStateArtifactProjection({
      scope: "artifact",
      artifact_ref: REPORT_REF,
    }, {
      artifactStore: memoryArtifactStore([]),
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "ARTIFACT_NOT_FOUND");
    assert.equal(missing.last_result.updated, false);

    const corrupt = await getStateArtifactProjection({
      scope: "artifact",
      artifact_ref: REPORT_REF,
    }, {
      artifactStore: memoryArtifactStore([[REPORT_REF, "{not-json"]]),
    });
    assert.equal(corrupt.ok, false);
    assert.equal(corrupt.error.code, "ARTIFACT_INVALID");
    assert.equal(corrupt.last_result.updated, false);

    const oversized = await getStateArtifactProjection({
      scope: "artifact",
      artifact_ref: REPORT_REF,
      view: "payload",
    }, {
      artifactStore: memoryArtifactStore([[
        REPORT_REF,
        makeEnvelope({
          payload: {
            text: "p".repeat(ARTIFACT_STATE_STORE_BUDGETS.payload_max_bytes),
          },
        }),
      ]]),
    });
    assert.equal(oversized.ok, false);
    assert.equal(oversized.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(oversized.last_result.updated, false);
  });

  it("enforces response budgets with complete typed errors instead of partial JSON", async () => {
    const response = await getStateArtifactProjection({
      scope: "artifact",
      artifact_ref: REPORT_REF,
      view: "payload",
      budget: { max_response_bytes: 240 },
    }, {
      artifactStore: memoryArtifactStore([[REPORT_REF, makeEnvelope()]]),
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "RESPONSE_TOO_LARGE");
    assert.equal("result" in response, false);
    assert.equal(response.budget.truncated, false);
    assert.equal(response.last_result.updated, false);
    assert.doesNotMatch(JSON.stringify(response), /fixture-only payload|peaks/);
  });

  it("rejects artifact-only bypass fields and invalid budgets before store access", async () => {
    const store = memoryArtifactStore([[REPORT_REF, makeEnvelope()]]);
    const cases = [
      { scope: "artifact", artifact_ref: REPORT_REF, path: "/tmp/raw.json" },
      { scope: "artifact", artifact_ref: REPORT_REF, file_url: `file:///tmp/${VALID_ID}.json` },
      { scope: "artifact", artifact_ref: REPORT_REF, budget: "large" },
      { scope: "artifact", artifact_ref: REPORT_REF, budget: { max_response_bytes: 0 } },
      { scope: "project", artifact_ref: REPORT_REF },
      { scope: "artifact" },
      { scope: "artifact", artifact_ref: REPORT_REF, view: "metadata" },
    ];

    for (const input of cases) {
      const response = await getStateArtifactProjection(input, { artifactStore: store });
      assert.equal(response.ok, false, JSON.stringify(input));
      assert.equal(response.error.code, "PARAMS_INVALID", JSON.stringify(input));
      assert.equal(response.last_result.updated, false, JSON.stringify(input));
    }

    assert.deepEqual(store.seen, []);
  });

  it("confirms call_template artifact-producing results still carry refs only", async () => {
    const bridge = new FakeFoundationBridge();
    const item = createObjectRef("item", { scheme: "guid", value: "{ITEM-ARTIFACT-REFS-ONLY}" });
    const artifact = createArtifactRef({
      owner_pack: "analysis",
      scope: "loudness_report",
      id: VALID_ID,
      schema: "analysis.loudness_report.v1",
      summary: { label: "Loudness report fixture" },
    });
    const runtime = createCallTemplateRuntime({
      executor: (request) =>
        bridge.okEnvelope(request, "2026-07-03T00:00:00.000Z", {
          summary: { artifact_ref: artifact.ref, schema: "analysis.loudness_report.v1" },
          refs: [],
          artifacts: [artifact],
          jobs: [],
          last_result: {
            updated: false,
            refs: [],
            truncated: false,
          },
        }),
    });

    const response = await runtime.call_template({
      id: "template.analysis.measure_item_rms",
      input: {},
      refs: { item_ref: item },
      context: context(),
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.artifacts.length, 1);
    assert.equal(response.result.artifacts[0].ref, REPORT_REF);
    assert.equal("payload" in response.result.artifacts[0], false);
    assert.equal(response.result.last_result.updated, false);
    assert.doesNotMatch(JSON.stringify(response), /fixture-only payload|peaks|samples/);
  });

  it("keeps 4.5B out of MCP tool additions, live bridge, and Lua helper work", () => {
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_recipe",
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 6);

    const runtimeSource = readFileSync(
      new URL("../../packages/mcp-server/src/get-state-runtime-v1.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(runtimeSource, /\.tool\s*\(|registerTool\s*\(/);
    assert.doesNotMatch(runtimeSource, /reaper\/bridge|openreaper-live-bridge|reaper\.defer|Main_OnCommand/);
    assert.doesNotMatch(runtimeSource, /child_process|spawn\(|execFile|execSync|REAPER\.app/);
  });
});

function memoryArtifactStore(entries) {
  const map = new Map(entries);
  const seen = [];
  return {
    seen,
    async read(ref, parts) {
      seen.push({ ref, owner_pack: parts.owner_pack, scope: parts.scope });
      return map.get(ref);
    },
  };
}

function makeEnvelope(overrides = {}) {
  const ref = overrides.ref ?? REPORT_REF;
  const id = overrides.id ?? VALID_ID;
  const ownerPack = overrides.owner_pack ?? "analysis";
  const scope = overrides.scope ?? "loudness_report";
  return {
    contract: ARTIFACT_STATE_STORE_CONTRACT,
    ref,
    id,
    owner_pack: ownerPack,
    scope,
    schema: "analysis.loudness_report.v1",
    producer: {
      kind: "template",
      id: "template.analysis.write_loudness_report",
      pack: "analysis",
    },
    created_at: "2026-07-03T01:02:03.999Z",
    summary: {
      label: "Loudness report fixture",
      item_count: 1,
    },
    payload: {
      peaks: [0.1, 0.2],
      note: "fixture-only payload",
    },
    ...overrides,
  };
}

function context() {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
  };
}
