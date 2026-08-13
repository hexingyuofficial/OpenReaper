import { createHash } from "node:crypto";

import {
  ARTIFACT_STATE_STORE_BUDGETS,
  artifactIdFromCommandId,
  formatArtifactRef,
} from "../../core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../../core/src/artifact-state-store-live-helper-v1.mjs";

export const AUDIO_BATCH_ARTIFACT_SCHEMA = "items.audio_batch_evidence.v1";
export const AUDIO_BATCH_ARTIFACT_MANIFEST_SCHEMA = "items.audio_batch_evidence_manifest.v1";
export const AUDIO_BATCH_ARTIFACT_CHUNK_SCHEMA = "items.audio_batch_evidence_chunk.v1";
export const AUDIO_BATCH_ARTIFACT_SCOPE = "audio_batch_evidence";
export const AUDIO_BATCH_ARTIFACT_CONTRACT = "openreaper.audio_batch_evidence.v1";

const AUDIO_BATCH_ARTIFACT_CHUNK_BYTES = 40_000;
const AUDIO_BATCH_ARTIFACT_ENCODING = "json_utf8_base64_chunks";
const AUDIO_BATCH_ARTIFACT_PRODUCER = Object.freeze({
  kind: "template",
  id: "template.items.split_item_by_silence",
  pack: "items",
});

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
    const envelopeInput = {
      ref,
      schema: AUDIO_BATCH_ARTIFACT_SCHEMA,
      producer: AUDIO_BATCH_ARTIFACT_PRODUCER,
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
    };

    if (jsonBytes(payload) > ARTIFACT_STATE_STORE_BUDGETS.payload_max_bytes) {
      return writeChunkedAudioBatchEvidence({
        artifactRoot,
        artifactId,
        envelopeInput,
        aggregateReadback,
        compactReadback,
      });
    }

    const envelope = createArtifactStateStoreEnvelope(envelopeInput);
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

async function writeChunkedAudioBatchEvidence({
  artifactRoot,
  artifactId,
  envelopeInput,
  aggregateReadback,
  compactReadback,
}) {
  const completeBytes = Buffer.from(JSON.stringify(envelopeInput.payload), "utf8");
  const chunkBuffers = splitBuffer(completeBytes, AUDIO_BATCH_ARTIFACT_CHUNK_BYTES);
  const chunkDescriptors = [];

  for (let index = 0; index < chunkBuffers.length; index += 1) {
    const bytes = chunkBuffers[index];
    const chunkId = childArtifactId(artifactId, index);
    const chunkRef = formatArtifactRef({
      owner_pack: "items",
      scope: AUDIO_BATCH_ARTIFACT_SCOPE,
      id: chunkId,
    });
    const sha256 = hashBytes(bytes);
    const chunkPayload = {
      contract: AUDIO_BATCH_ARTIFACT_CONTRACT,
      encoding: "base64",
      manifest_ref: envelopeInput.ref,
      chunk_index: index,
      chunk_count: chunkBuffers.length,
      byte_start: index * AUDIO_BATCH_ARTIFACT_CHUNK_BYTES,
      byte_end_exclusive: (index * AUDIO_BATCH_ARTIFACT_CHUNK_BYTES) + bytes.length,
      bytes: bytes.length,
      sha256,
      data: bytes.toString("base64"),
    };
    const chunkEnvelope = createArtifactStateStoreEnvelope({
      ref: chunkRef,
      schema: AUDIO_BATCH_ARTIFACT_CHUNK_SCHEMA,
      producer: AUDIO_BATCH_ARTIFACT_PRODUCER,
      created_at: envelopeInput.created_at,
      summary: {
        contract: AUDIO_BATCH_ARTIFACT_CONTRACT,
        manifest_ref: envelopeInput.ref,
        chunk_index: index,
        chunk_count: chunkBuffers.length,
        bytes: bytes.length,
        sha256,
      },
      payload: chunkPayload,
    });
    const written = await writeArtifactStateStoreEnvelope({ artifactRoot, envelope: chunkEnvelope });
    chunkDescriptors.push(Object.freeze({
      ref: written.ref,
      chunk_index: index,
      byte_start: chunkPayload.byte_start,
      byte_end_exclusive: chunkPayload.byte_end_exclusive,
      bytes: bytes.length,
      sha256,
    }));
  }

  const manifestPayload = {
    contract: AUDIO_BATCH_ARTIFACT_CONTRACT,
    encoding: AUDIO_BATCH_ARTIFACT_ENCODING,
    complete_payload_bytes: completeBytes.length,
    complete_payload_sha256: hashBytes(completeBytes),
    chunk_count: chunkDescriptors.length,
    chunks: chunkDescriptors,
    result: {
      plan_hash: envelopeInput.summary.plan_hash,
      target_count: envelopeInput.summary.target_count,
      returned_target_count: envelopeInput.summary.returned_target_count,
      aggregate_readback_count: envelopeInput.summary.aggregate_readback_count,
      total_ms: envelopeInput.summary.total_ms,
      undo_closed: envelopeInput.summary.undo_closed,
      batch_timings: cloneJson(envelopeInput.payload.result.batch_timings),
      native_counters: cloneJson(envelopeInput.payload.result.native_counters),
      undo: cloneJson(envelopeInput.payload.result.undo),
    },
  };
  const manifestEnvelope = createArtifactStateStoreEnvelope({
    ...envelopeInput,
    schema: AUDIO_BATCH_ARTIFACT_MANIFEST_SCHEMA,
    summary: {
      ...envelopeInput.summary,
      storage: "chunked_manifest",
      complete_payload_bytes: completeBytes.length,
      complete_payload_sha256: manifestPayload.complete_payload_sha256,
      chunk_count: chunkDescriptors.length,
    },
    payload: manifestPayload,
  });
  const written = await writeArtifactStateStoreEnvelope({ artifactRoot, envelope: manifestEnvelope });
  return Object.freeze({
    ref: written.ref,
    path: written.path,
    bytes: written.bytes,
    aggregate_readback_count: aggregateReadback.length,
    inline_readback: false,
    storage: "chunked_manifest",
    complete_payload_bytes: completeBytes.length,
    complete_payload_sha256: manifestPayload.complete_payload_sha256,
    chunk_count: chunkDescriptors.length,
    chunk_refs: Object.freeze(chunkDescriptors.map((entry) => entry.ref)),
  });
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

function childArtifactId(parentId, index) {
  const match = /^art_([0-9]{17})_([0-9]{3})_[a-f0-9]{6}$/.exec(parentId);
  if (!match) throw new Error("Audio batch parent artifact id is invalid.");
  const sequence = String((Number(match[2]) + index + 1) % 1_000).padStart(3, "0");
  const digest = createHash("sha256")
    .update(`${parentId}:chunk:${index}`)
    .digest("hex")
    .slice(0, 6);
  return `art_${match[1]}_${sequence}_${digest}`;
}

function splitBuffer(value, maxBytes) {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += maxBytes) {
    chunks.push(value.subarray(offset, Math.min(offset + maxBytes, value.length)));
  }
  return chunks;
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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
