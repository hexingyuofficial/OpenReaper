export const EXECUTION_DEADLINE_CONTRACT = "openreaper.execution_deadline.v1";
export const EXECUTION_DEADLINE_MAX_MS = 3_600_000;

export class ExecutionDeadlineError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExecutionDeadlineError";
    this.code = "EXECUTION_DEADLINE_EXCEEDED";
    this.details = details;
  }
}

export function normalizeExecutionDeadlineMs(value) {
  if (value === undefined || value === null) return null;
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > EXECUTION_DEADLINE_MAX_MS
  ) {
    throw new TypeError(
      `deadline_ms must be an integer from 1 to ${EXECUTION_DEADLINE_MAX_MS}.`,
    );
  }
  return value;
}

export function createExecutionDeadline({
  deadlineMs,
  signal = null,
  now = Date.now,
} = {}) {
  const normalized = normalizeExecutionDeadlineMs(deadlineMs);
  const clock = typeof now === "function" ? now : Date.now;
  const passthroughSignal = normalized === null && signal != null ? signal : null;
  // An explicit deadline needs its own controller so it can compose with the
  // caller's AbortSignal without treating that signal as an AbortController.
  const controller = new AbortController();
  const deadlineAt = normalized === null ? null : clock() + normalized;
  let timer = null;
  let deadlineExpired = false;
  let cleaned = false;

  const abortFromCaller = () => {
    if (!controller.signal.aborted) controller.abort(signal?.reason);
  };
  if (normalized !== null && signal?.aborted === true) {
    abortFromCaller();
  } else if (normalized !== null && typeof signal?.addEventListener === "function") {
    signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (normalized !== null) {
    timer = setTimeout(() => {
      deadlineExpired = true;
      if (!controller.signal.aborted) {
        controller.abort(new ExecutionDeadlineError(
          "Execution deadline expired before the operation reached a verified terminal result.",
          { deadline_ms: normalized, deadline_at: deadlineAt },
        ));
      }
    }, normalized);
    timer.unref?.();
  }

  const remainingMs = () => {
    if (deadlineAt === null) return null;
    return Math.max(0, deadlineAt - clock());
  };
  const isExpired = () => deadlineExpired || (
    deadlineAt !== null && remainingMs() <= 0
  );
  const details = () => isExpired()
    ? { deadline_exceeded: true, deadline_ms: normalized, deadline_at: deadlineAt }
    : null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== null) clearTimeout(timer);
    if (typeof signal?.removeEventListener === "function") {
      signal.removeEventListener("abort", abortFromCaller);
    }
  };

  return Object.freeze({
    contract: EXECUTION_DEADLINE_CONTRACT,
    deadline_ms: normalized,
    deadline_at: deadlineAt,
    signal: passthroughSignal ?? controller.signal,
    remainingMs,
    isExpired,
    details,
    cleanup,
  });
}

export function mergeDeadlineDetails(deadline, details = {}) {
  const deadlineDetails = deadline?.details?.() ?? null;
  return deadlineDetails === null
    ? { ...details }
    : { ...details, ...deadlineDetails };
}

export function effectiveDispatchTimeoutMs(dispatchTimeoutMs, deadline) {
  const remaining = deadline?.remainingMs?.() ?? null;
  if (remaining === null) return dispatchTimeoutMs;
  if (remaining < 1) return 1;
  if (!Number.isSafeInteger(dispatchTimeoutMs) || dispatchTimeoutMs < 1) return remaining;
  return Math.min(dispatchTimeoutMs, remaining);
}
