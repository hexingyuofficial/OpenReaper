import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { RiskLevel } from "./risk.js";

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
  idempotent: boolean;
  params: P;
  result: R;
}

export interface CapabilityMetadata {
  name: string;
  description: string;
  pack: string;
  risk: RiskLevel;
  mutates: boolean;
  undoable: boolean;
  idempotent: boolean;
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

  private toMetadata(c: CapabilityDefinition): CapabilityMetadata {
    return {
      name: c.name,
      description: c.description,
      pack: c.pack,
      risk: c.risk,
      mutates: c.mutates,
      undoable: c.undoable,
      idempotent: c.idempotent,
      params_schema: zodToJsonSchema(c.params, `${c.name}.params`),
      result_schema: zodToJsonSchema(c.result, `${c.name}.result`),
    };
  }
}
