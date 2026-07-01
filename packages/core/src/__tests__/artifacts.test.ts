import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  artifactPathFromParts,
  artifactPathFromRef,
  formatArtifactRef,
  parseArtifactRef,
} from "../artifacts.js";

const VALID_ID = "art_20260701010101999_000_ab12cd";
const VALID_REF = `artifact:pack_contract_fixture:probe:${VALID_ID}`;

describe("artifact helpers", () => {
  it("parses and formats canonical artifact refs", () => {
    expect(parseArtifactRef(VALID_REF)).toEqual({
      owner_pack: "pack_contract_fixture",
      scope: "probe",
      id: VALID_ID,
    });
    expect(
      formatArtifactRef({
        owner_pack: "pack_contract_fixture",
        scope: "probe",
        id: VALID_ID,
      }),
    ).toBe(VALID_REF);
  });

  it("accepts future-looking pack-qualified refs", () => {
    expect(
      parseArtifactRef("artifact:cleanup:plan:art_20260701010200999_001_8f10aa"),
    ).toEqual({
      owner_pack: "cleanup",
      scope: "plan",
      id: "art_20260701010200999_001_8f10aa",
    });
  });

  it.each([
    "artifact:pack_contract_fixture:probe",
    "artifact:Pack:probe:art_20260701010101999_000_ab12cd",
    "artifact:pack-contract:probe:art_20260701010101999_000_ab12cd",
    "artifact:pack_contract_fixture:bad-scope:art_20260701010101999_000_ab12cd",
    "artifact:pack_contract_fixture:probe:ART_20260701010101999_000_ab12cd",
    "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ABCDEF",
    "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd/evil",
    "artifact:pack_contract_fixture:probe:../bad",
    "artifact:pack_contract_fixture:probe:~/bad",
    "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd:extra",
  ])("rejects invalid ref %s", (ref) => {
    expect(parseArtifactRef(ref)).toBeNull();
  });

  it("builds artifact paths from parsed segments under the artifact root", () => {
    const root = path.join(path.sep, "tmp", "openreaper-artifacts");
    expect(artifactPathFromRef(root, VALID_REF)).toBe(
      path.join(
        root,
        "pack_contract_fixture",
        "probe",
        `${VALID_ID}.json`,
      ),
    );
  });

  it("never uses raw ref text as a path", () => {
    const root = path.join(path.sep, "tmp", "openreaper-artifacts");
    expect(() => artifactPathFromRef(root, "../bad")).toThrow(/Invalid artifact ref/);
    expect(() =>
      artifactPathFromParts(root, {
        owner_pack: "../bad",
        scope: "probe",
        id: VALID_ID,
      }),
    ).toThrow(/owner_pack/);
  });
});
