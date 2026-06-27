/**
 * Risk levels for capabilities, matching the kernel design.
 *
 * `unsafe_eval` is NEVER enabled by default. The default policy also blocks
 * `destructive` so capabilities that delete or overwrite user work require
 * explicit opt-in.
 */
export const RiskLevels = {
  read: "read",
  write_safe: "write_safe",
  filesystem: "filesystem",
  destructive: "destructive",
  unsafe_eval: "unsafe_eval",
} as const;

export type RiskLevel = (typeof RiskLevels)[keyof typeof RiskLevels];

export const ALL_RISK_LEVELS: readonly RiskLevel[] = [
  RiskLevels.read,
  RiskLevels.write_safe,
  RiskLevels.filesystem,
  RiskLevels.destructive,
  RiskLevels.unsafe_eval,
];

/**
 * Default risk policy for v0.1. `filesystem` is allowed because the demo
 * needs to render WAVs; `destructive` and `unsafe_eval` require opt-in.
 */
export const DEFAULT_ALLOWED: ReadonlySet<RiskLevel> = new Set<RiskLevel>([
  RiskLevels.read,
  RiskLevels.write_safe,
  RiskLevels.filesystem,
]);

export interface RiskPolicy {
  allowed: ReadonlySet<RiskLevel>;
}

export function defaultPolicy(): RiskPolicy {
  return { allowed: DEFAULT_ALLOWED };
}

export function withAllowed(levels: readonly RiskLevel[]): RiskPolicy {
  return { allowed: new Set(levels) };
}

export function allow(policy: RiskPolicy, level: RiskLevel): boolean {
  return policy.allowed.has(level);
}
