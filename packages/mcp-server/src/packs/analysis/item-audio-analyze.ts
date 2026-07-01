import { z } from "zod";
import { callTemplateResultSchema, defineTemplate } from "../../templates/_shared.js";

const ANALYSIS_FEATURES = [
  "loudness",
  "peaks",
  "silence",
  "transients",
  "loop_candidates",
] as const;
const DEFAULT_ANALYSIS_FEATURES = ["loudness", "peaks", "silence"] as const;

const TimeRange = z
  .object({
    start: z
      .number()
      .finite()
      .min(0)
      .describe("Start offset in item-local seconds."),
    end: z
      .number()
      .finite()
      .positive()
      .describe("End offset in item-local seconds. Must be greater than start."),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "time_range.end must be greater than time_range.start",
    path: ["end"],
  });

const ItemAudioAnalyzeParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe("Item reference to analyze, e.g. selected:0, guid:{...}, or last_result:item:0."),
    features: z
      .array(z.enum(ANALYSIS_FEATURES))
      .min(1)
      .max(ANALYSIS_FEATURES.length)
      .optional()
      .default([...DEFAULT_ANALYSIS_FEATURES])
      .describe(
        "Feature set for analysis. Defaults to loudness, peaks, and silence; transients and loop_candidates must be requested explicitly.",
      ),
    time_range: TimeRange.optional().describe(
      "Optional item-local analysis window in seconds. Omitted means the whole item.",
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [i, feature] of value.features.entries()) {
      if (seen.has(feature)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["features", i],
          message: `Duplicate analysis feature: ${feature}`,
        });
      }
      seen.add(feature);
    }
  });

const ItemAudioAnalyzeResult = callTemplateResultSchema("item_audio_analyze");

export const itemAudioAnalyzeDefinition = defineTemplate({
  name: "item_audio_analyze",
  description:
    "Analyze one in-project audio item and write a bounded JSON analysis artifact. Reports RMS dBFS, sample peaks, silence segments, opt-in transient candidates, and opt-in loop candidate intervals.",
  pack: "analysis",
  risk: "filesystem",
  mutates: false,
  undoable: false,
  entity_kind: "artifact",
  undo_flags: [],
  idempotent: false,
  artifact: {
    kind: "json",
    scope: "analysis",
    ref_prefix: "artifact:analysis:analysis:",
    read_scope: "artifact",
    updates_last_result: false,
    schema: "openreaper.analysis.item_audio.v1",
  },
  params: ItemAudioAnalyzeParams,
  result: ItemAudioAnalyzeResult,
  examples: [
    {
      description: "Analyze the selected item's loudness, peaks, and silence.",
      params: {
        item_id: "selected:0",
      },
    },
    {
      description: "Analyze a bounded item-local window.",
      params: {
        item_id: "last_result:item:0",
        features: ["loudness", "peaks", "silence"],
        time_range: { start: 0, end: 1.5 },
      },
    },
    {
      description: "Analyze transient candidates only.",
      params: {
        item_id: "selected:0",
        features: ["transients"],
      },
    },
    {
      description: "Analyze loop candidate intervals only.",
      params: {
        item_id: "selected:0",
        features: ["loop_candidates"],
      },
    },
  ],
});
