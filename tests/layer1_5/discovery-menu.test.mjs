import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DiscoveryMenuRequestError,
  createDiscoveryCatalog,
  listRecipes,
  listTemplates,
} from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const LARGE_BODY = "x".repeat(10_000);

describe("Layer 1.5 discovery/menu contract", () => {
  it("returns a compact default template menu bounded by summary fields and pagination", () => {
    const responseA = listTemplates({}, makeTemplates(100));
    const responseB = listTemplates({}, makeTemplates(1_000));

    assert.equal(JSON.stringify(responseA), JSON.stringify(responseB));
    assert.equal(responseA.contract, "discovery.menu.v1");
    assert.equal(responseA.kind, "template_menu");
    assert.equal(responseA.mode, "menu");
    assert.equal(responseA.items.length, 25);
    assert.equal(responseA.page.limit, 25);
    assert.equal(responseA.page.has_more, true);
    assert.equal("total" in responseA.page, false);

    const payload = JSON.stringify(responseA);
    assert.doesNotMatch(payload, /inputSchema/);
    assert.doesNotMatch(payload, /outputSchema/);
    assert.doesNotMatch(payload, /examples/);
    assert.doesNotMatch(payload, /expectedDelta/);
    assert.doesNotMatch(payload, /large hidden template body/);
  });

  it("returns a compact default recipe menu bounded by summary fields and pagination", () => {
    const responseA = listRecipes({}, makeRecipes(100));
    const responseB = listRecipes({}, makeRecipes(1_000));

    assert.equal(JSON.stringify(responseA), JSON.stringify(responseB));
    assert.equal(responseA.contract, "discovery.menu.v1");
    assert.equal(responseA.kind, "recipe_menu");
    assert.equal(responseA.mode, "menu");
    assert.equal(responseA.items.length, 25);
    assert.equal(responseA.page.limit, 25);
    assert.equal(responseA.page.has_more, true);
    assert.equal("total" in responseA.page, false);

    const payload = JSON.stringify(responseA);
    assert.doesNotMatch(payload, /steps/);
    assert.doesNotMatch(payload, /assertions/);
    assert.doesNotMatch(payload, /recovery/);
    assert.doesNotMatch(payload, /large hidden recipe body/);
  });

  it("surfaces compact workflow cards in recipe menus without exposing recipe steps", () => {
    const response = listRecipes(
      {
        fields: ["title", "workflowCard"],
      },
      [
        recipe({
          id: "recipe.project.cleanup_fingerprint_report",
          title: "Cleanup fingerprint report",
          workflow_card: {
            intent: "Create a compact cleanup report from accepted static atoms.",
            token_budget: {
              target_prompt_tokens: 900,
              max_chat_summary_tokens: 180,
              same_typed_blocker_stop_after: 2,
            },
          },
        }),
      ],
    );

    assert.deepEqual(Object.keys(response.items[0]), ["id", "title", "workflow_card"]);
    assert.equal(response.items[0].workflow_card.token_budget.same_typed_blocker_stop_after, 2);
    const payload = JSON.stringify(response);
    assert.doesNotMatch(payload, /steps/);
    assert.doesNotMatch(payload, /assertions/);
    assert.doesNotMatch(payload, /recovery/);
  });

  it("expands exact template ids with selected detail fields only", () => {
    const response = listTemplates(
      {
        ids: ["template.0003", "missing.template"],
        fields: ["summary", "input_schema", "examples"],
      },
      makeTemplates(10),
    );

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["missing.template"]);
    assert.deepEqual(response.page, {
      limit: 2,
      cursor: null,
      next_cursor: null,
      has_more: false,
    });
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "id",
      "inputSchema",
      "summary",
    ]);
    assert.equal(response.items[0].id, "template.0003");
    assert.equal(response.items[0].inputSchema.kind, "template schema");
    assert.equal("expectedDelta" in response.items[0], false);
  });

  it("expands exact recipe ids with selected step fields only", () => {
    const response = listRecipes(
      {
        ids: ["recipe.0002"],
        fields: ["steps", "assertions"],
      },
      makeRecipes(10),
    );

    assert.equal(response.mode, "ids");
    assert.equal(response.items.length, 1);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "assertions",
      "id",
      "steps",
    ]);
    assert.equal(response.items[0].steps.length, 2);
    assert.equal("recovery" in response.items[0], false);
  });

  it("supports query, tag, pack, lifecycle, risk, and entity_kind filters", () => {
    const catalog = [
      template({
        id: "template.render.freeze",
        title: "Freeze render",
        summary: "Prepare a bounded render operation.",
        pack: "render",
        lifecycle: "stable",
        risk: "destructive",
        entity_kind: "project",
        tags: ["render", "delivery", "atomic"],
      }),
      template({
        id: "template.track.name",
        title: "Name track",
        summary: "Set a track label.",
        pack: "tracks",
        lifecycle: "experimental",
        risk: "safe",
        entity_kind: "track",
        tags: ["track", "atomic"],
      }),
    ];

    const response = listTemplates(
      {
        query: "bounded",
        tags: ["render", "atomic"],
        pack: ["render"],
        lifecycle: "stable",
        risk: "destructive",
        entity_kind: "project",
      },
      catalog,
    );

    assert.deepEqual(
      response.items.map((item) => item.id),
      ["template.render.freeze"],
    );
    assert.deepEqual(response.applied.filters, {
      query: "bounded",
      tags: ["render", "atomic"],
      pack: ["render"],
      lifecycle: ["stable"],
      risk: ["destructive"],
      entity_kind: ["project"],
    });
  });

  it("supports explicit compact task-oriented menu hints without schema or step dumps", () => {
    const templateMenu = listTemplates(
      {
        query: "render.project",
        fields: ["title", "capability_group", "task_intents", "support"],
      },
      [
        template({
          id: "template.render.freeze",
          title: "Freeze render",
          summary: "Prepare a bounded render operation.",
          pack: "render",
          lifecycle: "experimental",
          risk: "write",
          entity_kind: "project",
          tags: ["render", "delivery", "artifact"],
        }),
      ],
    );

    assert.deepEqual(Object.keys(templateMenu.items[0]), [
      "id",
      "title",
      "capability_group",
      "task_intents",
      "support",
    ]);
    assert.equal(templateMenu.items[0].capability_group, "render.project");
    assert.deepEqual(templateMenu.items[0].task_intents, [
      "render",
      "delivery",
      "artifact",
      "write",
      "project",
    ]);
    assert.deepEqual(templateMenu.items[0].support, {
      status: "candidate",
      lifecycle: "experimental",
      evidence: "lifecycle:experimental",
    });

    const recipeMenu = listRecipes(
      {
        query: "candidate",
        fields: ["summary", "capabilityGroup", "taskIntents", "support"],
      },
      [
        recipe({
          id: "recipe.project.cleanup_fingerprint_report",
          title: "Cleanup fingerprint report",
          summary: "Create a bounded cleanup report.",
          pack: "project",
          lifecycle: "draft",
          risk: "read",
          entity_kind: "cleanup_report",
          tags: ["cleanup", "report", "artifact"],
        }),
      ],
    );

    assert.equal(recipeMenu.items[0].capability_group, "project.cleanup_report");
    assert.deepEqual(recipeMenu.items[0].task_intents, [
      "cleanup",
      "report",
      "artifact",
      "read",
      "cleanup_report",
    ]);
    assert.deepEqual(recipeMenu.items[0].support, {
      status: "candidate",
      lifecycle: "draft",
      evidence: "lifecycle:draft",
    });

    const truthMenu = listTemplates(
      {
        fields: ["title", "capabilityTruth"],
      },
      [
        template({
          id: "template.render.freeze",
          title: "Freeze render",
          summary: "Prepare a bounded render operation.",
          pack: "render",
          lifecycle: "experimental",
          risk: "write",
          entity_kind: "project",
          tags: ["render", "delivery", "artifact"],
        }),
      ],
    );

    assert.deepEqual(Object.keys(truthMenu.items[0]), [
      "id",
      "title",
      "capability_truth",
    ]);
    assert.deepEqual(
      Object.keys(truthMenu.items[0].capability_truth),
      [
        "id",
        "kind",
        "domain",
        "route_group",
        "exists_in_catalog",
        "live_runnable_now",
        "evidence_level",
        "support_state",
        "known_blocker",
        "requires_refs",
        "required_ref_kinds",
        "allowed_live_group",
      ],
    );
    assert.equal(truthMenu.items[0].capability_truth.live_runnable_now, false);
    assert.equal(
      truthMenu.items[0].capability_truth.known_blocker,
      "live_executor_not_configured_or_not_in_allowed_group",
    );

    const payload = JSON.stringify({ templateMenu, recipeMenu, truthMenu });
    assert.doesNotMatch(payload, /inputSchema|outputSchema|examples|expectedDelta/);
    assert.doesNotMatch(payload, /steps|assertions|recovery/);
    assert.doesNotMatch(payload, /"refs"/);
  });

  it("uses a stable cursor pagination envelope", () => {
    const firstPage = listTemplates({ limit: 2 }, makeTemplates(5));

    assert.deepEqual(
      firstPage.items.map((item) => item.id),
      ["template.0000", "template.0001"],
    );
    assert.equal(firstPage.page.limit, 2);
    assert.equal(firstPage.page.cursor, null);
    assert.equal(firstPage.page.has_more, true);
    assert.equal(typeof firstPage.page.next_cursor, "string");

    const secondPage = listTemplates(
      { limit: 2, cursor: firstPage.page.next_cursor },
      makeTemplates(5),
    );

    assert.deepEqual(
      secondPage.items.map((item) => item.id),
      ["template.0002", "template.0003"],
    );
    assert.equal(secondPage.page.cursor, firstPage.page.next_cursor);
    assert.equal(secondPage.page.has_more, true);
  });

  it("rejects broad detail-field dumps without exact ids", () => {
    assert.throws(
      () => listTemplates({ fields: ["inputSchema"] }, makeTemplates(2)),
      DiscoveryMenuRequestError,
    );
    assert.throws(
      () => listRecipes({ fields: ["steps"] }, makeRecipes(2)),
      DiscoveryMenuRequestError,
    );
  });

  it("keeps ids exact expansion separate from broad menu filters and pagination", () => {
    assert.throws(
      () => listTemplates({ ids: ["template.0000"], tags: ["atomic"] }, makeTemplates(2)),
      DiscoveryMenuRequestError,
    );
    assert.throws(
      () => listRecipes({ ids: ["recipe.0000"], limit: 1 }, makeRecipes(2)),
      DiscoveryMenuRequestError,
    );
  });

  it("exposes an empty default catalog stub without adding MCP tools", () => {
    const catalog = createDiscoveryCatalog();

    assert.deepEqual(catalog.list_templates().items, []);
    assert.deepEqual(catalog.list_recipes().items, []);
  });
});

function makeTemplates(count) {
  return Array.from({ length: count }, (_, index) =>
    template({
      id: `template.${String(index).padStart(4, "0")}`,
      title: `Template ${index}`,
      summary: `Atomic operation ${index}`,
      pack: index % 2 === 0 ? "tracks" : "items",
      lifecycle: index % 3 === 0 ? "stable" : "draft",
      risk: index % 5 === 0 ? "destructive" : "safe",
      entity_kind: index % 2 === 0 ? "track" : "item",
      tags: ["atomic", index % 2 === 0 ? "track" : "item"],
    }),
  );
}

function makeRecipes(count) {
  return Array.from({ length: count }, (_, index) =>
    recipe({
      id: `recipe.${String(index).padStart(4, "0")}`,
      title: `Recipe ${index}`,
      summary: `Workflow contract ${index}`,
      pack: "official",
      lifecycle: index % 3 === 0 ? "stable" : "draft",
      risk: index % 5 === 0 ? "destructive" : "safe",
      entity_kind: index % 2 === 0 ? "project" : "track",
      tags: ["workflow", index % 2 === 0 ? "project" : "track"],
    }),
  );
}

function template(overrides) {
  return {
    id: "template.default",
    title: "Default template",
    summary: "Default compact summary",
    pack: "core",
    lifecycle: "draft",
    risk: "safe",
    entity_kind: "project",
    tags: ["atomic"],
    inputSchema: {
      kind: "template schema",
      body: `large hidden template body ${LARGE_BODY}`,
    },
    outputSchema: {
      kind: "template result schema",
      body: `large hidden template body ${LARGE_BODY}`,
    },
    examples: [
      {
        prompt: "Example",
        body: `large hidden template body ${LARGE_BODY}`,
      },
    ],
    expectedDelta: {
      body: `large hidden template body ${LARGE_BODY}`,
    },
    ...overrides,
  };
}

function recipe(overrides) {
  return {
    id: "recipe.default",
    title: "Default recipe",
    summary: "Default compact recipe summary",
    pack: "official",
    lifecycle: "draft",
    risk: "safe",
    entity_kind: "project",
    tags: ["workflow"],
    steps: [
      {
        call_template: "template.default",
        body: `large hidden recipe body ${LARGE_BODY}`,
      },
      {
        get_state: "project",
        body: `large hidden recipe body ${LARGE_BODY}`,
      },
    ],
    assertions: [
      {
        body: `large hidden recipe body ${LARGE_BODY}`,
      },
    ],
    recovery: [
      {
        body: `large hidden recipe body ${LARGE_BODY}`,
      },
    ],
    ...overrides,
  };
}
