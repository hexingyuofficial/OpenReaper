import {
  createAlpha3_2AExactMacroExpansion,
} from "./alpha3-2a-agent-context-macro-guide-v1.mjs";
import {
  ALPHA3_3_B1_DEPRECATED_ALIASES,
  ALPHA3_3_B1_FINAL_TARGET_IDS,
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
  alpha3_3B1ExecutorSourceId,
  canonicalizeAlpha3_3B1MacroExecutionEnvelope,
  isAlpha3_3B1VisibleExecutableMacroId,
} from "./alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
  createAlpha3_3B1bItemsAnalyzeExactManual,
} from "./alpha3-3-b1b-items-analyze-v1.mjs";
import {
  ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
  createAlpha3_3B1cItemsApplyExactManual,
} from "./alpha3-3-b1c-items-apply-v1.mjs";
import {
  ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID,
  createAlpha3_3B1dAutomationApplyExactManual,
} from "./alpha3-3-b1d-automation-apply-v1.mjs";
import {
  createAlpha3_3MidiApplyExactManual,
} from "./alpha3-3-midi-apply-v1.mjs";
import {
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
  createAlpha3_3MediaPlaceAssetsExactManual,
} from "./alpha3-2e-media-place-assets-v1.mjs";
import {
  attachAlpha34BFirstTryGuideToExpansion,
  createAlpha34BMacroRecommendations,
  createAlpha34BRecommendationRowsForIds,
} from "./alpha3-4-b-discovery-manual-v1.mjs";

export const ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT = "alpha3.3.agent_context_macro_guide.v1";
export const ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION = "1.0.0";
export const ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT = "alpha3.3.agent_context_macro_guide.requested_expansions.v1";

const MENU_ROWS = deepFreeze(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.map((id) => compactMenuRow(id)));
const INTENT_ROUTES = deepFreeze([
  intent("macro.project.inspect", [
    term("inspect project", 8), term("project overview", 8), term("project map", 7), term("what is in this project", 9),
    term("project status", 7), term("show project", 7), term("current project", 6), term("project summary", 8),
    term("检查项目", 8), term("项目概览", 8), term("项目地图", 7), term("项目里有什么", 9), term("项目状态", 7), term("查看项目", 7),
    term("检查工程", 8), term("工程概览", 8), term("工程里有什么", 9), term("工程里都有什么", 9), term("查看工程", 7),
    term("轨道多不多", 8),
  ]),
  intent("macro.project.query", [
    term("find track", 8), term("find item", 8), term("find fx", 8), term("search project", 7), term("locate", 5), term("query", 5),
    term("list tracks", 8), term("which track", 7), term("lookup ref", 8), term("get refs", 8), term("canonical ref", 9),
    term("查找", 6), term("搜索", 6), term("查询", 6), term("定位", 5), term("找轨道", 8), term("找item", 8), term("拿ref", 8),
  ]),
  intent("macro.project.delete_targets", [
    term("delete target", 9), term("delete track", 9), term("delete item", 9), term("delete fx", 10), term("remove fx", 9), term("remove track", 8), term("remove item", 8), term("cleanup project", 6),
    term("trash track", 8), term("drop fx", 8), term("erase item", 8),
    term("删除目标", 9), term("删除轨道", 9), term("删除item", 9), term("删除fx", 10), term("移除效果器", 9), term("移除轨道", 8), term("清理项目", 6), term("删掉轨道", 8),
  ]),
  intent("macro.project.apply_layout", [
    term("create track", 9), term("create folder", 9), term("track layout", 8), term("organize tracks", 8), term("create marker", 10), term("create region", 10), term("timeline marker", 9),
    term("add track", 8), term("new folder", 8), term("make region", 9), term("add marker", 9),
    term("创建轨道", 9), term("创建文件夹", 9), term("轨道布局", 8), term("整理轨道", 8), term("创建标记", 10), term("创建区域", 10), term("时间线标记", 9), term("标记", 8), term("区域", 8), term("新建轨道", 8),
  ]),
  intent("macro.project.file", [
    term("save as", 10), term("save project", 9), term("save", 6), term("write project", 7), term("persist project", 7),
    term("open project", 10), term("switch project", 10), term("activate tab", 10), term("create a new project", 9),
    term("list open projects", 9), term("project tab", 8),
    term("另存为", 10), term("保存项目", 9), term("保存", 6), term("存盘", 7),
    term("打开工程", 10), term("切换工程", 10), term("切换当前工程", 10), term("激活工程页签", 10), term("新建工程", 9), term("打开项目", 9), term("创建项目", 8),
  ]),
  intent("macro.routing.apply", [
    term("routing", 8), term("route track", 8), term("create send", 9), term("remove send", 10), term("delete send", 10), term("send to", 7), term("sidechain", 8), term("bus", 5),
    term("track send", 9), term("reverb send", 8), term("aux send", 8),
    term("路由", 8), term("发送到", 7), term("创建send", 9), term("删除send", 10), term("移除发送", 10), term("侧链", 8), term("总线", 5), term("发送", 6),
  ]),
  intent("macro.media.place_assets", [
    term("search sound library", 10), term("find a sound", 9), term("find a sample", 10), term("media explorer", 10), term("sound library", 9), term("find a kick", 10),
    term("import audio", 10), term("import media", 10), term("import sample", 9), term("place assets", 9), term("place media", 9),
    term("drop sample", 8), term("insert audio file", 9), term("bring in media", 8),
    term("搜索音效库", 10), term("找音效", 9), term("找素材", 10), term("媒体浏览器", 10), term("找kick", 10),
    term("导入音频", 10), term("导入媒体", 10), term("导入素材", 10), term("导入工程素材", 10), term("导入采样", 9), term("放置素材", 9), term("放音频", 8),
  ]),
  intent("macro.items.analyze", [
    term("analyze item", 9), term("analyze audio", 9), term("loudness", 8), term("transient", 8), term("silence", 7), term("peak analysis", 8),
    term("measure loudness", 9), term("detect silence", 8), term("item analysis", 8),
    term("分析 item", 9), term("分析item", 9), term("分析音频", 9), term("分析", 7), term("响度", 8), term("瞬态", 8), term("静音检测", 7), term("峰值分析", 8),
  ]),
  intent("macro.items.apply", [
    term("arrange items", 10), term("align items", 9), term("align item starts", 9), term("align starts", 9), term("sequence items", 9), term("move items", 8), term("item properties", 7),
    term("fade", 9), term("fades", 9), term("fade in", 10), term("fade out", 10), term("apply fades", 10), term("item fade", 10),
    term("trim item", 8), term("split silence", 7), term("stack items", 8), term("nudge items", 7),
    term("set_item_take_controls", 10), term("batch item controls", 10), term("item take controls", 10), term("active take pan", 9), term("take pan", 8), term("item volume batch", 8),
    term("排列 item", 10), term("排列item", 10), term("对齐 item", 9), term("对齐item", 9), term("对齐开头", 9), term("排序 item", 9), term("排序item", 9), term("移动 item", 8), term("移动item", 8), term("item属性", 7),
    term("淡入", 10), term("淡出", 10), term("淡入淡出", 10), term("加淡入", 10), term("加淡出", 10), term("item淡入", 10),
    term("批量item", 9), term("批量 take", 9), term("take声像", 8), term("item批量控制", 9),
  ], ["normalize", "normalise", "lufs", "标准化", "归一化"]),
  intent("macro.midi.apply", [
    term("midi clip", 10), term("create midi", 9), term("midi note", 8), term("midi", 6), term("quantize", 10), term("edit midi", 10), term("edit existing notes", 10), term("write cc", 10), term("control change", 9),
    term("make midi", 8), term("draw notes", 8), term("midi item", 9), term("piano roll", 7),
    term("write four quarter notes", 10), term("four quarter notes", 10), term("quarter notes", 8),
    term("midi片段", 10), term("创建midi", 9), term("midi音符", 8), term("音符片段", 8), term("量化", 10), term("编辑midi", 10), term("编辑现有音符", 10), term("写入cc", 10), term("控制器", 9), term("做一段midi", 9),
    term("写四个四分音符", 10), term("四个四分音符", 10), term("四分音符", 8),
  ]),
  intent("macro.fx.apply_chain", [
    term("add compressor", 10), term("add a compressor", 10), term("apply compressor", 10), term("apply a compressor", 10), term("compressor chain", 9), term("add reacomp", 10), term("apply reacomp", 10), term("add fx chain", 8),
    term("add fx", 8), term("insert fx", 8), term("put a compressor", 9), term("add eq", 8), term("plugin chain", 8),
    term("添加压缩器", 10), term("应用压缩器", 10), term("压缩器链", 9), term("添加reacomp", 10), term("添加效果链", 8), term("加压缩", 9), term("加效果器", 8), term("加eq", 8),
  ]),
  intent("macro.fx.set_controls", [
    term("adjust compressor", 10), term("compressor controls", 9), term("fx controls", 8), term("plugin controls", 8), term("threshold", 7), term("ratio", 6),
    term("tweak fx", 8), term("set plugin params", 9), term("change fx settings", 8),
    term("调整压缩器", 10), term("压缩器参数", 9), term("效果参数", 8), term("插件参数", 8), term("阈值", 7), term("压缩比", 6), term("调效果", 8),
  ]),
  intent("macro.controls.set", [
    term("project bpm", 10), term("set bpm", 9), term("tempo", 8), term("project grid", 10), term("set grid", 9), term("snap", 8), term("track volume", 8), term("track pan", 8), term("transport", 6),
    term("change bpm", 9), term("set tempo", 9), term("mute track", 7), term("solo transport", 6),
    term("项目bpm", 10), term("设置bpm", 9), term("速度", 7), term("项目网格", 10), term("设置网格", 9), term("吸附", 8), term("轨道音量", 8), term("轨道声像", 8), term("传输控制", 6), term("改bpm", 9),
  ]),
  intent("macro.automation.apply", [
    term("automation item", 10), term("automation", 6), term("automate", 7), term("envelope", 8), term("automation curve", 9), term("automation points", 9),
    term("volume automation", 7), term("draw envelope", 8), term("write automation", 8),
    term("自动化项", 10), term("自动化", 3), term("包络", 8), term("自动化曲线", 9), term("自动化点", 9), term("音量自动化", 7), term("写自动化", 8),
  ]),
  intent("macro.render.targets", [
    term("render", 9), term("export audio", 9), term("bounce", 8), term("render wav", 10), term("render ogg", 10),
    term("export mix", 9), term("print stems", 8), term("render region", 9),
    term("渲染", 9), term("导出音频", 9), term("导出wav", 10), term("导出ogg", 10), term("导出混音", 9), term("渲染区域", 9),
  ], ["mp3"]),
]);

export function createAlpha3_3B1AgentContextMacroGuide({
  requested_ids = [],
  missing_ids = [],
  recommended_macro_ids = [],
  query = null,
  discovery_items_by_id = null,
} = {}) {
  const requestedIds = stringArray(requested_ids);
  const missingIds = stringArray(missing_ids);
  const recommendedIds = stringArray(recommended_macro_ids)
    .filter((id) => isAlpha3_3B1VisibleExecutableMacroId(id))
    .slice(0, 3);
  const expansions = requestedIds
    .map((id) => {
      const base = createAlpha3_3B1ExactMacroExpansion(id);
      if (!base) return null;
      const discoveryItem = discovery_items_by_id?.get?.(id) ?? discovery_items_by_id?.[id] ?? null;
      return attachAlpha34BFirstTryGuideToExpansion(base, discoveryItem);
    })
    .filter(Boolean);
  const unresolvedIds = [...new Set([
    ...missingIds,
    ...requestedIds.filter((id) => !expansions.some((entry) => entry.id === id)),
  ])];
  const recommendationProjection = typeof query === "string" && query.trim() !== ""
    ? createAlpha34BMacroRecommendations(query)
    : createAlpha34BMacroRecommendations(null);
  const macroRecommendations = recommendedIds.length > 0
    ? createAlpha34BRecommendationRowsForIds(recommendedIds)
    : recommendationProjection.recommendations;

  return deepFreeze({
    contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
    version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
    phase: "Alpha3.3-B1d",
    tool_surface: {
      count: 6,
      tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"],
      macro_tool: "call_template",
      adds_public_tool: true,
    },
    macro_menu: {
      compact: true,
      flat: true,
      final_target_count: ALPHA3_3_B1_FINAL_TARGET_IDS.length,
      visible_executable_count: ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length,
      macro_ids: ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
      rows: MENU_ROWS,
      exact_manual_request: { tool: "list_templates", ids: ["macro.project.inspect"] },
    },
    recommended_macro_ids: recommendedIds,
    macro_recommendations: macroRecommendations,
    requested_expansions: {
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      mode: requestedIds.length > 0 ? "ids" : "none",
      requested_ids: requestedIds,
      items: expansions,
      missing_ids: unresolvedIds,
    },
    compatibility: {
      visible_in_menu: false,
      aliases: ALPHA3_3_B1_DEPRECATED_ALIASES,
    },
    direct_template_fallback: {
      allowed: true,
      trigger: "only_when_no_visible_macro_covers_the_task",
      discovery_tool: "list_templates",
      request_shape: { surface: "catalog", query: "one bounded capability phrase", limit: 25 },
      typed_gap_reasons: [
        "macro_missing_for_task",
        "macro_task_out_of_scope",
        "macro_target_ambiguous_or_unavailable",
        "macro_domain_not_accepted",
        "macro_budget_prefers_atomic_template",
      ],
      routing: "Use exact or filtered Template discovery only after recording one typed fallback reason. Do not add a new tool for this atomic fallback: it does not execute a Recipe; use the public call_recipe tool separately for saved Recipe lifecycle operations. Do not use raw SQL.",
    },
    safety_boundary: {
      hidden_recipe_executor: false,
      raw_sql: false,
      raw_lua: false,
      raw_reaper_action: false,
      shell_or_process: false,
      ui_automation: false,
      hardware_or_device_io: false,
      sqlite_write_authority: false,
    },
    search_phrases_are_metadata_only: true,
  });
}

export function rankAlpha3_3B1MacroIntents(taskText, { limit = 3 } = {}) {
  if (typeof taskText !== "string" || taskText.trim() === "") return [];
  const normalized = normalizeIntentText(taskText);
  const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 3)) : 3;
  return INTENT_ROUTES
    .map((route, index) => ({
      id: route.id,
      index,
      score: route.blocked_by.some((entry) => normalized.includes(entry))
        ? 0
        : route.terms.reduce((score, entry) => score + (normalized.includes(entry.text) ? entry.weight : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, boundedLimit)
    .map((entry) => entry.id);
}

export function attachAlpha3_3B1AgentContextProductMetadata(response) {
  if (!isPlainObject(response)) return response;
  const requestedIds = response.mode === "ids" && Array.isArray(response.applied?.ids)
    ? response.applied.ids
    : [];
  const missingIds = Array.isArray(response.missing_ids) ? response.missing_ids : [];
  return deepFreeze({
    ...response,
    product_surface: {
      ...(isPlainObject(response.product_surface) ? response.product_surface : {}),
      agent_context_macro_guide: createAlpha3_3B1AgentContextMacroGuide({
        requested_ids: requestedIds,
        missing_ids: missingIds,
      }),
    },
  });
}

export function createAlpha3_3B1ExactMacroExpansion(id) {
  if (!isAlpha3_3B1VisibleExecutableMacroId(id)) return null;
  if (id === ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID) {
    const expansion = createAlpha3_3B1bItemsAnalyzeExactManual();
    return deepFreeze({
      ...expansion,
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      guide_contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
      guide_version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      implementation_status: "executable_registered_program",
      runnable: true,
    });
  }
  if (id === ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID) {
    const expansion = createAlpha3_3B1cItemsApplyExactManual();
    return deepFreeze({
      ...expansion,
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      guide_contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
      guide_version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      implementation_status: "executable_registered_program",
      runnable: true,
    });
  }
  if (id === ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID) {
    const expansion = createAlpha3_3B1dAutomationApplyExactManual();
    return deepFreeze({
      ...expansion,
      action_manual: {
        ...expansion.action_manual,
        examples: [
          {
            name: "preview one exact Envelope point insert",
            input: {
              mode: "insert_points",
              envelope_refs: ["envelope:guid:{ENVELOPE-GUID}"],
              points: [{ time_seconds: 1, value: 0.75, shape: 0, tension: 0 }],
              dry_run: true,
            },
          },
        ],
      },
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      guide_contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
      guide_version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      implementation_status: "executable_registered_program",
      runnable: true,
    });
  }
  if (id === ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID) {
    const expansion = createAlpha3_3MediaPlaceAssetsExactManual();
    return deepFreeze({
      ...expansion,
      action_manual: {
        ...expansion.action_manual,
        examples: [
          {
            name: "search the approved Media Explorer library",
            input: { mode: "search_library", query: "metal impact", page_size: 10 },
          },
          {
            name: "preview one explicit asset placement",
            input: {
              mode: "place_assets",
              assets: [{ id: "impact", path: "/absolute/path/from-search.wav" }],
              placement: { mode: "sequence_on_one_track", start_seconds: 0, align_basis: "item_start" },
              track_policy: "one_shared_new_track",
              new_track: { name: "SFX" },
              dry_run: true,
            },
          },
        ],
      },
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      guide_contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
      guide_version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      implementation_status: "executable_registered_program",
      runnable: true,
    });
  }
  const sourceId = alpha3_3B1ExecutorSourceId(id);
  const historical = createAlpha3_2AExactMacroExpansion(sourceId);
  if (!historical) return null;

  const canonical = canonicalizeAlpha3_3B1MacroExecutionEnvelope(historical, id);
  delete canonical.guide_tier;
  canonical.id = id;
  canonical.contract = ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT;
  canonical.guide_contract = ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT;
  canonical.guide_version = ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION;
  canonical.implementation_status = "executable_registered_program";
  canonical.runnable = true;
  canonical.action_manual = stripTierFields(canonical.action_manual);

  if (id === "macro.midi.apply") {
    const createClipReadiness = canonical.action_manual.required_readiness ?? [];
    const createClipRecovery = canonical.action_manual.recovery_steps ?? [];
    const createClipExamples = [{
      name: "create four quarter notes",
      input: {
        mode: "create_clips",
        start_seconds: 0,
        duration_quarter_notes: 4,
        notes: [
          { start_offset_quarter_notes: 0, end_offset_quarter_notes: 1, pitch: 60, velocity: 96, channel: 0 },
          { start_offset_quarter_notes: 1, end_offset_quarter_notes: 2, pitch: 62, velocity: 96, channel: 0 },
          { start_offset_quarter_notes: 2, end_offset_quarter_notes: 3, pitch: 64, velocity: 96, channel: 0 },
          { start_offset_quarter_notes: 3, end_offset_quarter_notes: 4, pitch: 65, velocity: 96, channel: 0 },
        ],
        selector: { name: "Instrument" },
        dry_run: false,
      },
    }];
    const createClipInputShape = {
      start_seconds: "Required clip start time in project seconds.",
      duration_quarter_notes: "Preferred clip duration in project quarter notes; mutually exclusive with end_seconds.",
      end_seconds: "Legacy absolute clip end time; mutually exclusive with duration_quarter_notes.",
      notes: "Preferred musical rows use start_offset_quarter_notes/end_offset_quarter_notes. Legacy PPQ rows use start_ppq/end_ppq with end_seconds.",
      selector: "Optional singular fresh SQLite-backed track selector instead of manual low-level ref assembly.",
      dry_run: "Boolean; performs target resolution and validation without creating the item or notes.",
    };
    const editing = createAlpha3_3MidiApplyExactManual().action_manual;
    canonical.action_manual.input_shape = {
      create_clips: createClipInputShape,
      ...editing.input_shape,
      mode: "create_clips | edit_notes | quantize | write_cc; create_clips defaults to musical-relative timing, while existing-Take modes require operations[].",
    };
    canonical.action_manual.when_to_use = [
      "Use create_clips for one new bounded musical MIDI Item (duration_quarter_notes + relative offsets), edit_notes for indexed existing-note fields, quantize for existing notes, and write_cc for PPQ CC insertion.",
      "For English or Chinese asks such as write four quarter notes / 写四个四分音符, prefer macro.midi.apply create_clips with musical coordinates.",
      ...editing.when_to_use,
    ];
    canonical.action_manual.when_not_to_use = [
      "Do not use create_clips to edit an existing Take, write CC/text/sysex, load an instrument, or claim audible playback.",
      "Do not use existing-Take edit modes to create a new MIDI Item; use create_clips instead.",
    ];
    canonical.action_manual.required_readiness = [
      ...createClipReadiness,
      "For existing-Take modes, use macro.project.query to obtain exact take:guid refs; do not assemble Take GUID refs manually.",
      ...editing.required_readiness,
    ];
    canonical.action_manual.readback_steps = [
      "For create_clips musical mode, require live start_qn/end_qn from create, insert with position_unit project_qn, and page list_take_notes with include_project_qn and include_project_time to completion before applied.",
      ...editing.readback_steps,
    ];
    canonical.action_manual.success_criteria = [
      "For create_clips, the created Item live QN duration matches duration_quarter_notes and every applied note has complete matching PPQ, project-QN, and project-time readback.",
      ...editing.success_criteria,
    ];
    canonical.action_manual.common_blockers = [
      { code: "MIDI_CLIP_BOUNDS_AMBIGUOUS", message: "Supply exactly one of duration_quarter_notes or legacy end_seconds.", recoverable: true },
      { code: "MIDI_NOTE_COORDINATE_MIXED", message: "Do not mix musical-relative and legacy PPQ note coordinates.", recoverable: true },
      { code: "MIDI_NOTE_OFFSET_OUT_OF_RANGE", message: "Keep every musical note inside duration_quarter_notes.", recoverable: true },
      { code: "MIDI_CREATE_QN_EXTENT_MISMATCH", message: "The created Item live QN extent did not preserve the requested musical duration.", recoverable: false },
      { code: "MIDI_NOTE_LIST_READBACK_MISMATCH", message: "Complete live note rows did not match the requested musical or PPQ state.", recoverable: true },
      ...editing.common_blockers,
    ];
    canonical.action_manual.recovery_steps = [...createClipRecovery, ...editing.recovery_steps];
    canonical.action_manual.dry_run_shape = {
      supported: true,
      behavior: "create_clips validates its musical or legacy shape and live-resolves the destination Track without mutation; existing-Take modes live-resolve exact Takes and perform complete preflight reads without mutation or index invalidation.",
    };
    canonical.action_manual.examples = [
      ...createClipExamples,
      ...(Array.isArray(editing.examples) ? editing.examples : []),
    ];
  }
  if (id === "macro.routing.apply") {
    canonical.action_manual.when_to_use = [
      "Create, update, or delete bounded internal Track sends, set exact send volume/pan/mute fields, or set Track master-parent and channel-count posture.",
      "Use one registered Macro transaction when every target is already an exact canonical Track or Send ref.",
    ];
    canonical.action_manual.when_not_to_use = [
      "Do not configure hardware/device I/O, infer ambiguous Track identities, create self-sends, or directed feedback cycles.",
      "Do not use it for send mode, audio/MIDI channel maps, or any field outside the exact input shape below; use a typed direct-Template fallback when no Macro field covers the task.",
    ];
    canonical.action_manual.required_readiness = [
      "Obtain exact source_track_ref and destination_track_ref values with macro.project.query before creating a route; updates and deletes require one exact send_ref.",
      "Run the operation set with dry_run:true first, then send the same operation input with only dry_run changed to false.",
      "Execution requires a complete, untruncated live graph preflight covering up to 128 Tracks and 256 internal sends before the first write.",
    ];
    canonical.action_manual.input_shape = {
      routes: "0-64 rows of {id,action=create|update|delete}. create requires source_track_ref and destination_track_ref; update requires send_ref; delete accepts only id, action, and exact send_ref. create/update optionally accept volume 0..4, pan -1..1, and muted boolean. duplicate_policy=reject_existing blocks a live duplicate; reuse_existing binds exactly one matching canonical Send and applies requested controls; allow_duplicate creates another Send.",
      master_parent: "0-64 rows of {id,track_ref,enabled}; id may be omitted only when track_ref is a suitable bounded id source.",
      channel_counts: "0-64 rows of {id,track_ref,channel_count}. Use even counts from 2 through 64 for currently verified live behavior; the Macro schema accepts through 128, but values above 64 require lower-layer truth alignment before success may be claimed.",
      dry_run: "Defaults true. A preview emits no mutations; set only this field to false on the same operation input to execute.",
      compact_response: "Optional boolean requesting the registered compact public result without weakening internal graph or readback truth.",
    };
    canonical.action_manual.preflight_steps = [
      "Validate all rows, exact refs, unique operation ids, self-send/duplicate-edge posture, and request-local cycles before planning any write.",
      "Read the complete live project routing graph; fail before the first write on truncation, incomplete enumeration, malformed counts, a reject_existing duplicate, an ambiguous reuse_existing match, or a live-plus-request cycle.",
    ];
    canonical.action_manual.underlying_actions = [
      "template.routing.read_project_routing_graph",
      "template.routing.create_track_send",
      "template.routing.set_send_volume",
      "template.routing.set_send_pan",
      "template.routing.set_send_mute",
      "template.routing.set_master_parent_send",
      "template.routing.set_track_channel_count",
      "template.routing.remove_send",
      "template.routing.read_track_routing",
    ];
    canonical.action_manual.readback_steps = [
      "After all bounded mutations, read every affected source Track with template.routing.read_track_routing.",
      "Verify every logical route by exact send_ref plus requested source_track_ref, destination_track_ref, volume, pan, and muted fields; verify deletion by exact absence.",
      "Verify master_parent with master_parent_enabled and channel_counts with channel_count on the exact Track row.",
      "Report mutation, per-operation live readback, and Project Index maintenance separately; dispatch success alone never marks a change applied.",
    ];
    canonical.action_manual.success_criteria = [
      "Every logical operation has all of its atomic mutations completed and an exact, complete live readback match.",
      "No routing change is marked applied from dispatch success, stale SQLite state, an incomplete Track read, or a different Send row.",
    ];
    canonical.action_manual.common_blockers = [
      { code: "ROUTING_GRAPH_COVERAGE_INCOMPLETE", summary: "REAPER could not enumerate the complete live internal-routing graph, so no write started." },
      { code: "ROUTING_GRAPH_TRUNCATED", summary: "The project exceeded the bounded complete-graph preflight; no write started." },
      { code: "ROUTING_LIVE_DUPLICATE_EDGE", summary: "A reject_existing source-to-destination edge already exists live, so no write started; use allow_duplicate only when another Send is intentional." },
      { code: "ROUTING_LIVE_DUPLICATE_EDGE_AMBIGUOUS", summary: "reuse_existing found multiple matches or a match without a canonical send_ref, so no write started." },
      { code: "ROUTING_LIVE_CYCLE", summary: "The complete live graph plus requested creates forms a directed cycle; no write started." },
      { code: "ROUTING_SEND_READBACK_MISMATCH", summary: "The exact live Send row did not match every requested field after mutation." },
    ];
    canonical.action_manual.recovery_steps = [
      "For a preflight blocker, correct the exact operation set and run a fresh preview before execution.",
      "If any write was attempted, do not blindly replay the request. Inspect per-operation mutation/live-readback truth, reread current routing, and retry only work still needed with a new preview.",
    ];
    canonical.action_manual.dry_run_shape = {
      supported: true,
      required_first: true,
      output: ["preview", "zero_mutations"],
    };
    canonical.action_manual.resume_or_retry_policy = {
      before_first_write: "correct_and_retry after a fresh dry-run preview",
      after_write_attempt: "do_not_replay; inspect live routing and retry only remaining work",
      hard_stop: "Stop on hardware/device I/O, incomplete graph truth, duplicate edges, cycles, stale Send identity, or repeated exact-readback mismatch.",
    };
    canonical.action_manual.examples = [
      {
        name: "preview one exact create",
        input: {
          routes: [{ id: "vox_to_verb", action: "create", source_track_ref: "track:guid:{VOCAL}", destination_track_ref: "track:guid:{VERB}", duplicate_policy: "reject_existing", volume: 0.5, pan: 0, muted: false }],
          master_parent: [],
          channel_counts: [],
          dry_run: true,
        },
      },
      {
        name: "execute the unchanged create after preview",
        input: {
          routes: [{ id: "vox_to_verb", action: "create", source_track_ref: "track:guid:{VOCAL}", destination_track_ref: "track:guid:{VERB}", duplicate_policy: "reject_existing", volume: 0.5, pan: 0, muted: false }],
          master_parent: [],
          channel_counts: [],
          dry_run: false,
        },
      },
      {
        name: "preview one exact update",
        input: { routes: [{ id: "lower_verb", action: "update", send_ref: "send:track:guid:{VOCAL}:2", volume: 0.35, pan: -0.1, muted: false }], dry_run: true },
      },
      {
        name: "preview one exact delete",
        input: { routes: [{ id: "remove_old_verb", action: "delete", send_ref: "send:track:guid:{VOCAL}:2" }], dry_run: true },
      },
    ];
  }
  if (id === "macro.fx.apply_chain") {
    canonical.action_manual.when_to_use = [
      "Use one fixed call to search REAPER's installed inventory and apply a bounded ordered Track or Take FX chain with final complete-chain readback.",
    ];
    canonical.action_manual.when_not_to_use = [
      "Do not use it to install plugins, delete FX, load external preset files, control hardware, or configure unsupported third-party semantic controls.",
    ];
    canonical.action_manual.required_readiness = [
      "The live route must be ready and the target must be one exact Take ref, one exact Track ref, or one unambiguous fresh Track selector.",
      "Installed-inventory search and both initial and final FX-chain reads must be complete; incomplete coverage fails closed.",
    ];
    canonical.action_manual.input_shape = {
      owner_kind: "track | take; inferred from take_ref when omitted, otherwise track.",
      chain: "Required canonical mode: 1-8 ordered nodes. Each node supplies exactly one plugin_name or plugin_query.",
      chain_node: "Optional duplicate_policy=allow|reuse_exact|skip_exact|fail_if_present, insert_at_index, preset_name or preset_index, enabled, target_index, and reviewed ReaComp controls.",
      selector: "Optional singular fresh Project Index Track selector; not accepted for Take owners.",
      refs: "Supply exact track_ref or take_ref when already known.",
      dry_run: "Defaults true for chain[]; set false to mutate. The legacy one-node ReaComp input remains compatible.",
    };
    canonical.action_manual.preflight_steps = [
      "Live-resolve the exact owner and read its complete initial FX chain.",
      "Resolve every requested node to one exact identity from REAPER EnumInstalledFX authority.",
      "Apply duplicate policy before any node mutation and reject ambiguous or incomplete inventory results.",
    ];
    canonical.action_manual.underlying_actions = [
      "template.fx.search_installed_fx",
      "template.fx.list_track_fx_chain or template.fx.list_take_fx_chain",
      "template.fx.add_track_fx or template.fx.add_take_fx",
      "optional accepted preset, bypass, reorder, and reviewed ReaComp semantic-control Templates",
      "complete final owner-chain readback",
    ];
    canonical.action_manual.readback_steps = [
      "Read the complete final owner chain and match every requested node by exact installed name, owner, slot/order, enabled state, and canonical fx_ref.",
      "Report mutation, live readback, and Project Index maintenance independently for each node.",
    ];
    canonical.action_manual.success_criteria = [
      "Every requested node is present or intentionally reused/skipped according to duplicate_policy and every successful row has exact final live readback.",
    ];
    canonical.action_manual.common_blockers = [
      { code: "FX_INSTALLED_MATCH_NOT_FOUND", summary: "No installed FX matched; choose an exact identity returned by REAPER inventory search." },
      { code: "FX_INSTALLED_MATCH_AMBIGUOUS", summary: "The search matched more than one installed FX; retry with one exact plugin_name." },
      { code: "FX_INVENTORY_COVERAGE_INCOMPLETE", summary: "Installed inventory coverage was incomplete, so OpenReaper did not guess." },
      { code: "FX_CHAIN_COVERAGE_INCOMPLETE", summary: "Initial or final chain readback was incomplete, so no definitive chain result was returned." },
      { code: "FX_CHAIN_FINAL_READBACK_MISMATCH", summary: "At least one final live chain row did not match the requested result." },
    ];
    canonical.action_manual.recovery_steps = [
      "Use the exact installed-name suggestions from the blocker, then retry the same Macro with dry_run first if needed.",
      "If a mutation completed but final verification failed, inspect the returned partial changes and use per-stage undo before retrying only the remaining work.",
    ];
    canonical.action_manual.dry_run_shape = {
      supported: true,
      default_for_chain: true,
      output: ["exact_owner", "resolved_installed_names", "duplicate_policy", "planned_chain", "initial_chain"],
    };
    canonical.action_manual.resume_or_retry_policy = {
      resume_from: "exact live owner plus current complete chain",
      retry: "Retry with one exact installed plugin_name or after restoring complete chain coverage.",
      hard_stop: "Stop on incomplete inventory/chain coverage or repeated live-readback mismatch.",
    };
    canonical.action_manual.examples = [
      {
        name: "apply a two-node Track chain",
        input: {
          owner_kind: "track",
          selector: { name: "Lead Vox" },
          chain: [
            { plugin_query: "ReaEQ", duplicate_policy: "reuse_exact" },
            { plugin_name: "VST: ReaComp (Cockos)", controls: { threshold_db: -18, ratio: 3 } },
          ],
          dry_run: false,
        },
      },
      {
        name: "preview a Take FX insertion",
        refs: { take_ref: "take:guid:{TAKE-GUID}" },
        input: {
          owner_kind: "take",
          chain: [{ plugin_name: "VST: ReaEQ (Cockos)", duplicate_policy: "fail_if_present" }],
        },
      },
    ];
  }
  if (id === "macro.fx.set_controls") {
    canonical.action_manual.when_to_use = [
      "Prefer this Macro for FX parameter work: mode=semantic (default) for proven stock controls; mode=reaeq_bands for 1-4 strict ReaEQ band rows; mode=exact_parameters for 1-8 parameters on one FX; mode=exact_assignments for 1-64 parameters across exact fx_ref targets.",
      "exact_parameters and exact_assignments are the general highways for ReaPlugs, third-party, and large parameter inventories; direct parameter Templates remain compatibility/debug fallback.",
    ];
    canonical.action_manual.when_not_to_use = [
      "Do not invent semantic unit conversions without native proof; unproven semantic fields fail closed with STOCK_SEMANTIC_UNIT_UNPROVEN and an exact_parameters recovery call.",
      "Do not guess fuzzy parameter names; exact modes require param_index or one unique exact returned name/ident after complete inventory paging.",
      "Do not mix selectors or legacy plugin/controls fields into exact_assignments; obtain exact fx_ref values first.",
    ];
    canonical.action_manual.input_shape = {
      mode: "semantic | reaeq_bands | exact_parameters | exact_assignments; defaults to semantic for compatibility.",
      semantic: "plugin/controls/starter_action as before; executable only when each control has native low/mid/high proof.",
      reaeq_bands: "bands[] 1-4 unique rows with band 1-4 and optional type/enabled/frequency_hz/gain_db/bandwidth_oct; exact ReaEQ fx_ref or one unambiguous selector required.",
      exact_parameters: "changes[] 1-8 rows with id, normalized_value in [0,1], and param_index (optional param_ident) or one unique exact param_name/param_ident; selector or exact fx_ref required.",
      exact_assignments: "assignments[] 1-64 rows of {id,fx_ref,param_index|param_ident|param_name,normalized_value,requested_formatted_value?}. dry_run defaults true; set dry_run:false to mutate.",
      dry_run: "Boolean; preflight and inventory without mutation when true. exact_assignments defaults true when omitted.",
    };
    canonical.action_manual.examples = [
      {
        name: "exact parameters dry_run",
        input: {
          mode: "exact_parameters",
          selector: { plugin_id: "reacomp" },
          dry_run: true,
          changes: [{ id: "p0", param_index: 0, normalized_value: 0.5 }],
        },
      },
      {
        name: "exact assignments multi-FX",
        input: {
          mode: "exact_assignments",
          dry_run: false,
          assignments: [
            { id: "a1", fx_ref: "fx:track:guid:{TRACK-A}:0", param_index: 0, normalized_value: 0.4 },
            { id: "a2", fx_ref: "fx:track:guid:{TRACK-B}:0", param_index: 1, normalized_value: 0.6 },
          ],
        },
      },
      {
        name: "set one ordinary Audio Take FX parameter from apply_chain output",
        prerequisite: {
          public_sequence: [
            {
              tool: "call_template",
              arguments: {
                id: "macro.project.query",
                input: { entity: "takes", limit: 25, refresh_policy: "if_stale" },
              },
              returns: "Choose one exact take:guid ref from the live result.",
            },
            {
              tool: "call_template",
              arguments: {
                id: "macro.fx.apply_chain",
                refs: { take_ref: "take:guid:{TAKE-GUID}" },
                input: {
                  owner_kind: "take",
                  chain: [{ plugin_name: "VST: ReaEQ (Cockos)", duplicate_policy: "reuse_exact" }],
                  dry_run: false,
                },
              },
              returns: "Copy the exact fx_ref from fx_refs; do not construct it or call an internal resolver.",
            },
          ],
        },
        input: {
          mode: "exact_assignments",
          dry_run: false,
          assignments: [
            { id: "take_tone", fx_ref: "fx:take:guid:{TAKE-GUID}:0", param_index: 0, normalized_value: 0.5 },
          ],
        },
      },
      {
        name: "semantic unproven recovery path",
        input: {
          mode: "semantic",
          plugin: "reasynth",
          controls: { attack_ms: 250 },
          selector: { name: "Synth" },
          dry_run: true,
        },
      },
    ];
  }
  if (id === "macro.controls.set") {
    canonical.action_manual.when_to_use = [
      "Use one task-shaped Macro call for project BPM or accepted Track, Item, Take, Transport, and Send control edits instead of hand-assembling atomic write chains.",
      "Use changes[] for one to eight independent common control targets when one public call should preserve per-row resolution, mutation, live readback, and index truth.",
    ];
    canonical.action_manual.input_shape = {
      target_kind: "project | track | item | take | transport | send",
      fields: "Required allowlisted field object. For target_kind=project use bpm from 20 through 400; tempo is accepted only as a normalized alias.",
      selector: "Optional singular bounded Project Index selector for object targets when canonical refs are not supplied; project and transport do not use selectors.",
      refs: "Optional top-level call_template refs: track_ref, item_ref, or send_ref as required by object target kinds. Project BPM needs no ref.",
      changes: "Alternative to the single-target shape: 1-8 rows of {id,target_kind,fields,selector?,refs?}. Top-level refs/target fields cannot be mixed in. Defaults to dry-run.",
      dry_run: "Boolean; returns target resolution and accepted field writes without mutating. changes[] defaults true; set false to execute the preflighted rows serially.",
    };
    canonical.action_manual.preflight_steps = [
      "Validate target_kind and its allowlisted fields before any write.",
      "For project BPM, read the live tempo at project time zero; for object targets, live-resolve one exact ref from the request or fresh SQLite candidate set.",
      "For changes[], preflight and live-resolve every row before the first mutation; duplicate row ids or any blocked row stop the batch with zero writes.",
    ];
    canonical.action_manual.readback_steps = [
      "Read the affected live target after mutation and compare each requested field, including effective project BPM at time zero.",
      "Report mutation, live readback, and Project Index maintenance independently; applied never comes from dispatch success alone.",
      "For changes[], stop at the first failed row, preserve earlier row truth, and mark every later row not_run.",
    ];
    canonical.action_manual.common_blockers = [
      { code: "CONTROL_PROJECT_TEMPO_UNAVAILABLE", summary: "The active project BPM could not be read before mutation." },
      { code: "CONTROL_BPM_INVALID", summary: "Project BPM must be a finite number from 20 through 400." },
      { code: "CONTROL_TARGET_REF_REQUIRED", summary: "An object control target needs one exact ref or one unambiguous selector." },
      { code: "CONTROL_BATCH_PREFLIGHT_FAILED", summary: "At least one changes[] row did not pass complete preflight; no batch mutation started." },
      { code: "SELECTOR_TARGET_AMBIGUOUS", summary: "The bounded selector matched more than one candidate." },
      { code: "CONTROL_READBACK_MISMATCH", summary: "Post-write live readback did not match every requested value." },
    ];
    canonical.action_manual.examples = [
      { name: "set project BPM", input: { target_kind: "project", fields: { bpm: 128 }, dry_run: false } },
      { name: "set Track volume", input: { target_kind: "track", selector: { name: "Bass" }, fields: { volume: 0.75 }, dry_run: true } },
      { name: "preview two Track controls", input: { changes: [{ id: "lead", target_kind: "track", selector: { name: "Lead Vocal" }, fields: { volume: 0.75 } }, { id: "bass", target_kind: "track", selector: { name: "Bass" }, fields: { pan: -0.1 } }], dry_run: true } },
    ];
  }

  return deepFreeze(canonical);
}

function compactMenuRow(id) {
  const expansion = createAlpha3_3B1ExactMacroExpansion(id);
  const manual = expansion?.action_manual ?? {};
  return {
    id,
    purpose: firstText(manual.when_to_use) ?? id,
    risk: riskFor(id),
    implementation_status: "executable",
    expand: { tool: "list_templates", ids: [id] },
  };
}

function intent(id, terms, blockedBy = []) {
  return {
    id,
    terms,
    blocked_by: blockedBy.map(normalizeIntentText),
  };
}

function term(text, weight) {
  return { text: normalizeIntentText(text), weight };
}

function normalizeIntentText(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_/.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function riskFor(id) {
  if (id === "macro.project.inspect" || id === "macro.project.query" || id === ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID) return "read";
  if (id === "macro.project.delete_targets" || id === "macro.items.apply") return "destructive";
  return "write";
}

function stripTierFields(value) {
  if (Array.isArray(value)) return value.map(stripTierFields);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["guide_tier", "primary_macro_ids", "primary_spine", "secondary_menu"].includes(key))
    .map(([key, entry]) => [key, stripTierFields(entry)]));
}

function firstText(value) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
