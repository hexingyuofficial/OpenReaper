import { describe, it, expect } from "vitest";
import {
  defaultPolicy,
  withAllowed,
  allow,
  ALL_RISK_LEVELS,
  RiskLevels,
} from "../risk.js";

describe("default risk policy", () => {
  it("allows read, write_safe, filesystem", () => {
    const policy = defaultPolicy();
    expect(allow(policy, RiskLevels.read)).toBe(true);
    expect(allow(policy, RiskLevels.write_safe)).toBe(true);
    expect(allow(policy, RiskLevels.filesystem)).toBe(true);
  });

  it("blocks destructive and unsafe_eval", () => {
    const policy = defaultPolicy();
    expect(allow(policy, RiskLevels.destructive)).toBe(false);
    expect(allow(policy, RiskLevels.unsafe_eval)).toBe(false);
  });
});

describe("custom risk policy", () => {
  it("opts into destructive without unlocking unsafe_eval", () => {
    const policy = withAllowed([
      RiskLevels.read,
      RiskLevels.write_safe,
      RiskLevels.destructive,
    ]);
    expect(allow(policy, RiskLevels.destructive)).toBe(true);
    expect(allow(policy, RiskLevels.unsafe_eval)).toBe(false);
    expect(allow(policy, RiskLevels.filesystem)).toBe(false);
  });
});

describe("ALL_RISK_LEVELS", () => {
  it("includes every risk level once", () => {
    expect(ALL_RISK_LEVELS).toHaveLength(5);
    expect(new Set(ALL_RISK_LEVELS).size).toBe(5);
  });
});
