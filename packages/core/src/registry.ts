import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { RiskLevel } from "./risk.js";

export const UNDO_STATE = {
  TRACKCFG: 1,
  FX: 2,
  ITEMS: 4,
  MISCCFG: 8,
  FREEZE: 16,
} as const;

export type UndoFlag = keyof typeof UNDO_STATE;

export interface FieldCheckDescriptor {
  field: string;
  scope: "take" | "item" | "track";
  paramPath: string;
  tolerance?: number;
  optional?: boolean;
  nullable?: boolean;
}

export interface ExpectedDelta {
  count: number | "any";
  creates?: boolean;
  maybeCreates?: boolean;
  deletes?: boolean;
  fields?: ReadonlyArray<FieldCheckDescriptor>;
}

export interface CapabilityExample {
  description?: string;
  params: Record<string, unknown>;
}

export interface CapabilityDefinition<
  P extends ZodTypeAny = ZodTypeAny,
  R extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  description: string;
  /** Name of the capability pack that contributed this capability. */
  pack: string;
  risk: RiskLevel;
  mutates: boolean;
  undoable: boolean;
  entity_kind: string;
  undo_flags: UndoFlag[];
  idempotent: boolean;
  params: P;
  result: R;
  examples: CapabilityExample[];
  expectedDelta?: ExpectedDelta;
  reads?: string[];
  writes?: string[];
  /**
   * Optional per-template wall-clock budget for the file-queue round trip.
   * When unset, callTemplate uses DEFAULT_CALL_TEMPLATE_TIMEOUT_MS (5 s).
   * Step 6's `render_region` sets this to 60_000 because render can take
   * tens of seconds. Note this is the OUTER timeout the MCP client waits
   * for the bridge's done file; the bridge has its own (slightly shorter)
   * internal deadline for the deferred-completion poll. See
   * docs/RENDER_NOTES.md.
   */
  timeoutMs?: number;
}

export interface CapabilityMetadata {
  name: string;
  description: string;
  pack: string;
  risk: RiskLevel;
  mutates: boolean;
  undoable: boolean;
  entity_kind: string;
  undo_flags: UndoFlag[];
  idempotent: boolean;
  examples: CapabilityExample[];
  expectedDelta?: ExpectedDelta;
  reads?: string[];
  writes?: string[];
  params_schema: unknown;
  result_schema: unknown;
}

/**
 * In-memory registry of capabilities. Built up at MCP-server start time as
 * each capability pack registers itself.
 *
 * The registry does NOT execute capabilities. It owns metadata and schemas.
 * Execution lives in the Lua bridge.
 */
export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDefinition>();

  register<P extends ZodTypeAny, R extends ZodTypeAny>(
    def: CapabilityDefinition<P, R>,
  ): void {
    if (this.capabilities.has(def.name)) {
      throw new Error(`Capability already registered: ${def.name}`);
    }
    validateDefinition(def);
    this.capabilities.set(def.name, def as unknown as CapabilityDefinition);
  }

  get(name: string): CapabilityDefinition | undefined {
    return this.capabilities.get(name);
  }

  has(name: string): boolean {
    return this.capabilities.has(name);
  }

  size(): number {
    return this.capabilities.size;
  }

  list(): CapabilityMetadata[] {
    return Array.from(this.capabilities.values()).map((c) => this.toMetadata(c));
  }

  rawDefinitions(): CapabilityDefinition[] {
    return Array.from(this.capabilities.values());
  }

  private toMetadata(c: CapabilityDefinition): CapabilityMetadata {
    const metadata: CapabilityMetadata = {
      name: c.name,
      description: c.description,
      pack: c.pack,
      risk: c.risk,
      mutates: c.mutates,
      undoable: c.undoable,
      entity_kind: c.entity_kind,
      undo_flags: [...c.undo_flags],
      idempotent: c.idempotent,
      examples: c.examples.map((example) => ({
        ...example,
        params: { ...example.params },
      })),
      params_schema: zodToJsonSchema(c.params, `${c.name}.params`),
      result_schema: zodToJsonSchema(c.result, `${c.name}.result`),
    };
    if (c.expectedDelta !== undefined) {
      metadata.expectedDelta = {
        ...c.expectedDelta,
        ...(c.expectedDelta.fields !== undefined
          ? {
              fields: c.expectedDelta.fields.map((field) => ({ ...field })),
            }
          : {}),
      };
    }
    if (c.reads !== undefined) metadata.reads = [...c.reads];
    if (c.writes !== undefined) metadata.writes = [...c.writes];
    return metadata;
  }
}

const UNDO_FLAG_NAMES = new Set<string>(Object.keys(UNDO_STATE));
const FIELD_CHECK_SCOPES = new Set<FieldCheckDescriptor["scope"]>([
  "take",
  "item",
  "track",
]);

function validateDefinition(def: CapabilityDefinition): void {
  if (!def.entity_kind || typeof def.entity_kind !== "string") {
    throw new Error(`Capability ${def.name} is missing entity_kind`);
  }

  if (!Array.isArray(def.undo_flags)) {
    throw new Error(`Capability ${def.name} is missing undo_flags`);
  }
  for (const flag of def.undo_flags) {
    if (!UNDO_FLAG_NAMES.has(flag)) {
      throw new Error(`Capability ${def.name} has unknown undo flag: ${flag}`);
    }
  }
  if (def.undoable && def.undo_flags.length === 0) {
    throw new Error(`Capability ${def.name} is undoable but has no undo_flags`);
  }
  if (!def.undoable && def.undo_flags.length > 0) {
    throw new Error(`Capability ${def.name} is not undoable but has undo_flags`);
  }

  if (!Array.isArray(def.examples) || def.examples.length < 1) {
    throw new Error(`Capability ${def.name} must declare at least one example`);
  }
  for (const [i, example] of def.examples.entries()) {
    if (!example || typeof example.params !== "object" || example.params === null) {
      throw new Error(`Capability ${def.name} example ${i} must include params`);
    }
  }

  if (def.expectedDelta !== undefined) {
    const activeDeltaModes = [
      def.expectedDelta.creates,
      def.expectedDelta.maybeCreates,
      def.expectedDelta.deletes,
    ].filter(Boolean).length;
    if (activeDeltaModes > 1) {
      throw new Error(
        `Capability ${def.name} expectedDelta declares incompatible delta modes`,
      );
    }
    if (
      def.expectedDelta.maybeCreates &&
      def.expectedDelta.count === "any"
    ) {
      throw new Error(
        `Capability ${def.name} expectedDelta maybeCreates requires a numeric count`,
      );
    }
    validateExpectedDeltaFields(def.name, def.expectedDelta);
  }
}

function validateExpectedDeltaFields(
  name: string,
  expectedDelta: ExpectedDelta,
): void {
  const fields = expectedDelta.fields;
  if (fields === undefined) return;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error(
      `Capability ${name} expectedDelta.fields must be a non-empty array when present`,
    );
  }

  if (expectedDelta.deletes) {
    throw new Error(
      `Capability ${name} expectedDelta.fields cannot coexist with deletes`,
    );
  }
  if (
    (expectedDelta.creates || expectedDelta.maybeCreates) &&
    (typeof expectedDelta.count !== "number" ||
      !Number.isFinite(expectedDelta.count) ||
      Math.floor(expectedDelta.count) !== expectedDelta.count ||
      expectedDelta.count < 1)
  ) {
    const mode = expectedDelta.creates ? "creates:true" : "maybeCreates:true";
    throw new Error(
      `Capability ${name} expectedDelta.fields with ${mode} requires numeric count >= 1`,
    );
  }

  const seen = new Set<string>();
  let optionalCount = 0;
  let nullableCount = 0;
  for (const [i, field] of fields.entries()) {
    if (!field || typeof field !== "object") {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] must be an object`,
      );
    }
    if (typeof field.field !== "string" || field.field.length === 0) {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] is missing field`,
      );
    }
    if (!FIELD_CHECK_SCOPES.has(field.scope)) {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] has unsupported scope`,
      );
    }
    if (typeof field.paramPath !== "string" || field.paramPath.length === 0) {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] is missing paramPath`,
      );
    }
    if (field.paramPath.includes(".")) {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] paramPath must be a top-level key`,
      );
    }
    if (
      field.tolerance !== undefined &&
      (!Number.isFinite(field.tolerance) || field.tolerance < 0)
    ) {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] tolerance must be a finite non-negative number`,
      );
    }
    if (field.optional !== undefined && typeof field.optional !== "boolean") {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] optional must be boolean when present`,
      );
    }
    if (field.nullable !== undefined && typeof field.nullable !== "boolean") {
      throw new Error(
        `Capability ${name} expectedDelta.fields[${i}] nullable must be boolean when present`,
      );
    }
    if (field.optional === true) optionalCount += 1;
    if (field.nullable === true) nullableCount += 1;

    const key = `${field.scope}:${field.field}`;
    if (seen.has(key)) {
      throw new Error(
        `Capability ${name} expectedDelta.fields contains duplicate ${key}`,
      );
    }
    seen.add(key);
  }
  if (optionalCount === fields.length && nullableCount !== fields.length) {
    throw new Error(
      `Capability ${name} expectedDelta.fields may be all-optional only when every field is nullable`,
    );
  }
}
