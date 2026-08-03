import { createHash } from "node:crypto";

import {
  artifactIdFromCommandId,
  formatArtifactRef,
} from "../../core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../../core/src/artifact-state-store-live-helper-v1.mjs";

export const AUDIO_BATCH_ARTIFACT_SCHEMA = "items.audio_batch_evidence.v1";
export const AUDIO_BATCH_ARTIFACT_SCOPE = "audio_batch_evidence";
export const AUDIO_BATCH_ARTIFACT_CONTRACT = "openreaper.audio_batch_evidence.v1";

let fallbackSequence = 0;

export function createAudioBatchArtifactWriter({ artifactRoot, now = () => new Date() } = {}) {
  if (typeof artifactRoot !== "string" || artifactRoot.trim() === "") return null;

  return async function writeAudioBatchEvidence({
    request = {},
    input = {},
    execution = null,
    summary = {},
    rows = [],
    publicReadback = [],
    failure = null,
  } = {}) {
    const commandId = execution?.request?.id ?? request?.request_id ?? request?.id ?? null;
    const artifactId = artifactIdFor(commandId, now);
    const ref = formatArtifactRef({ owner_pack: "items", scope: AUDIO_BATCH_ARTIFACT_SCOPE, id: artifactId });
    const aggregateReadback = cloneJson(rows);
    const compactReadback = cloneJson(publicReadback);
    const normalizedSummary = cloneJson(summary);
    const payload = {
      contract: AUDIO_BATCH_ARTIFACT_CONTRACT,
      request: {
        id: commandId,
        macro_id: request?.macro_id ?? null,
        input: cloneJson(input),
        refs: cloneJson(request?.refs ?? {}),
      },
      execution: {
        ok: execution?.ok === true,
        status: execution?.execution?.status ?? null,
        request: cloneJson(execution?.request ?? null),
        template: cloneJson(execution?.template ?? null),
        error: cloneJson(execution?.error ?? null),
        failure: cloneJson(failure),
      },
      result: {
        summary: normalizedSummary,
        aggregate_readback: aggregateReadback,
        public_readback: compactReadback,
        plan_hash: normalizedSummary.plan_hash ?? null,
        batch_timings: cloneJson(normalizedSummary.batch_timings ?? normalizedSummary.timings ?? {}),
        native_counters: cloneJson(normalizedSummary.native_counters ?? normalizedSummary.counters ?? {}),
        undo: {
          opened: normalizedSummary.undo_opened === true,
          closed: normalizedSummary.undo_closed === true,
        },
      },
    };
    const envelope = createArtifactStateStoreEnvelope({
      ref,
      schema: AUDIO_BATCH_ARTIFACT_SCHEMA,
      producer: {
        kind: "template",
        id: "template.items.split_item_by_silence",
        pack: "items",
      },
      created_at: safeIso(now),
      summary: {
        contract: AUDIO_BATCH_ARTIFACT_CONTRACT,
        mode: input?.mode ?? null,
        plan_hash: normalizedSummary.plan_hash ?? null,
        target_count: normalizedSummary.target_count ?? aggregateReadback.length,
        returned_target_count: normalizedSummary.returned_target_count ?? aggregateReadback.length,
        aggregate_readback_count: aggregateReadback.length,
        total_ms: normalizedSummary.batch_timings?.total_ms ?? normalizedSummary.timings?.total_ms ?? null,
        undo_closed: normalizedSummary.undo_closed === true,
      },
      payload,
    });
    const written = await writeArtifactStateStoreEnvelope({ artifactRoot, envelope });
    return Object.freeze({
      ref: written.ref,
      path: written.path,
      bytes: written.bytes,
      aggregate_readback_count: aggregateReadback.length,
      inline_readback: compactReadback.length <= 8
        && Buffer.byteLength(JSON.stringify(compactReadback), "utf8") <= 12_000,
    });
  };
}

function artifactIdFor(commandId, now) {
  if (typeof commandId === "string") {
    try {
      return artifactIdFromCommandId(commandId);
    } catch {
      // Some fake/unit executors do not provide a Foundation command id.
    }
  }
  const date = safeDate(now);
  const stamp = [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
    date.getUTCHours().toString().padStart(2, "0"),
    date.getUTCMinutes().toString().padStart(2, "0"),
    date.getUTCSeconds().toString().padStart(2, "0"),
    date.getUTCMilliseconds().toString().padStart(3, "0"),
  ].join("");
  const sequence = String(fallbackSequence++ % 1_000).padStart(3, "0");
  const digest = createHash("sha256")
    .update(`${commandId ?? "none"}:${stamp}:${sequence}`)
    .digest("hex")
    .slice(0, 6);
  return `art_${stamp}_${sequence}_${digest}`;
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function safeDate(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  } catch {
    // Use the current clock below.
  }
  return new Date();
}

function safeIso(now) {
  return safeDate(now).toISOString();
}
