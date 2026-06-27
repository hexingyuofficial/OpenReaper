import {
  defaultRecoverable,
  type ErrorCode,
  type StreetlightError,
} from "./errors.js";

export interface Ok<T> {
  ok: true;
  result: T;
}

export interface Err {
  ok: false;
  error: StreetlightError;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(result: T): Ok<T> {
  return { ok: true, result };
}

export interface ErrOptions {
  /** Override the default recoverability for this error code. */
  recoverable?: boolean;
  /** Structured context attached to the error. */
  details?: Record<string, unknown>;
}

export function err(
  code: ErrorCode,
  message: string,
  opts: ErrOptions = {},
): Err {
  const recoverable = opts.recoverable ?? defaultRecoverable(code);
  const error: StreetlightError = { code, message, recoverable };
  if (opts.details !== undefined) {
    error.details = opts.details;
  }
  return { ok: false, error };
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.ok;
}

export function isErr<T>(r: Result<T>): r is Err {
  return !r.ok;
}
