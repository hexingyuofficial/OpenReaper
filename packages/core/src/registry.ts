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

export interface ExpectedDelta {
  count: number | "any";
  creates?: boolean;
  maybeCreates?: boolean;
  deletes?: boolean;
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
      metadata.expectedDelta = { ...c.expectedDelta };
    }
    if (c.reads !== undefined) metadata.reads = [...c.reads];
    if (c.writes !== undefined) metadata.writes = [...c.writes];
    return metadata;
  }
}

const UNDO_FLAG_NAMES = new Set<string>(Object.keys(UNDO_STATE));

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
  }
}
