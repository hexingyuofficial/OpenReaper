import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildS3AudioRunRow,
  resultData,
  summarizeS3Result,
} from "../../scripts/lib/s3-release-matrix-results.mjs";

describe("S3 live matrix result envelopes", () => {
  it("uses structured result.data when compact result.summary is a string", () => {
    const value = {
      ok: true,
      execution: { status: "completed" },
      result: {
        summary: "remove_silence completed in one native batch",
        verification: { evidence_refs: ["cmd:verification"] },
        data: {
          target_count: 8,
          returned_target_count: 8,
          plan_hash: "alpha33_silence_batch:123",
          aggregate_readback: [{ status: "APPLIED" }],
          undo_opened: true,
          undo_closed: true,
          timings: { total_ms: 12 },
          native_counters: { mutation: 1 },
        },
      },
    };

    assert.equal(resultData(value).plan_hash, "alpha33_silence_batch:123");
    assert.deepEqual(buildS3AudioRunRow(value, { label: "eight-1", refs: Array(8), elapsedMs: 20 }), {
      label: "eight-1",
      ok: true,
      elapsed_ms: 20,
      target_count: 8,
      returned_target_count: 8,
      plan_hash: "alpha33_silence_batch:123",
      zero_write: false,
      undo_opened: true,
      undo_closed: true,
      source_media_deleted: false,
      aggregate_readback_count: 1,
      artifact_refs: ["cmd:verification"],
      timings: { total_ms: 12 },
      native_counters: { mutation: 1 },
      status: "completed",
      error_code: null,
      reason_code: null,
      aggregate_readback: [{ status: "APPLIED" }],
      before_item: null,
    });
  });

  it("retains object-form result.summary when data is absent", () => {
    const value = { ok: true, result: { summary: { plan_hash: "summary-hash", aggregate_readback: [] } } };
    assert.equal(resultData(value).plan_hash, "summary-hash");
    assert.equal(summarizeS3Result(value).zero_write, false);
  });

  it("maps typed zero-write from data, error details, blockers, and explicit diagnostics", () => {
    assert.equal(summarizeS3Result({ ok: false, result: { summary: "blocked", data: { zero_write: true } } }).zero_write, true);
    assert.equal(summarizeS3Result({ ok: false, error: { details: { zero_write: true } } }).zero_write, true);
    assert.equal(summarizeS3Result({ ok: false, blockers: [{ details: { zero_write: true } }] }).zero_write, true);
    assert.equal(summarizeS3Result({ ok: false, error: { message: "ITEM_NOT_FOUND zero_write=true" } }).zero_write, true);
  });
});
