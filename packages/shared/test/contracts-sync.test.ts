import { describe, expect, it } from "vitest";

import {
  MissionStatus,
  missionEscrowAbi,
  missionEscrowEnums,
  PersonhoodProvider,
  personhoodRegistryAbi,
  personhoodRegistryEnums,
  SubmissionStatus,
  tierForProvider,
  PersonhoodTier,
} from "../src/index.js";

/** Asserts a TS const object maps each Solidity enum member to its declaration index. */
function expectEnumMatches(ts: Record<string, number>, solidity: readonly string[]) {
  expect(Object.keys(ts)).toEqual([...solidity]);
  solidity.forEach((name, i) => expect(ts[name]).toBe(i));
}

const fnNames = (abi: readonly { type: string; name?: string }[], type: string) =>
  abi.filter((x) => x.type === type).map((x) => x.name);

describe("shared constants stay in sync with the contracts", () => {
  it("MissionStatus / SubmissionStatus match MissionEscrow enums", () => {
    expectEnumMatches(MissionStatus, missionEscrowEnums.MissionStatus);
    expectEnumMatches(SubmissionStatus, missionEscrowEnums.SubmissionStatus);
  });

  it("PersonhoodProvider matches PersonhoodRegistry.Provider", () => {
    expectEnumMatches(PersonhoodProvider, personhoodRegistryEnums.Provider);
  });

  it("tierForProvider mirrors the contract", () => {
    expect(tierForProvider(PersonhoodProvider.None)).toBe(PersonhoodTier.None);
    expect(tierForProvider(PersonhoodProvider.HumanPassport)).toBe(PersonhoodTier.Passport);
    expect(tierForProvider(PersonhoodProvider.Self)).toBe(PersonhoodTier.Self);
  });
});

describe("exported ABIs", () => {
  it("MissionEscrow exposes the mission lifecycle", () => {
    expect(fnNames(missionEscrowAbi, "function")).toEqual(
      expect.arrayContaining([
        "createMission",
        "recordSubmission",
        "acceptSubmission",
        "rejectSubmission",
        "finalize",
        "cancelMission",
        "refund",
        "quotePayout",
        "requiredTier",
      ]),
    );
    expect(fnNames(missionEscrowAbi, "event")).toEqual(
      expect.arrayContaining([
        "MissionCreated",
        "MissionCancelled",
        "MissionRefunded",
        "SubmissionRecorded",
        "SubmissionAccepted",
        "SubmissionRejected",
      ]),
    );
  });

  it("PersonhoodRegistry exposes attest / revoke / isVerified", () => {
    expect(fnNames(personhoodRegistryAbi, "function")).toEqual(
      expect.arrayContaining(["attest", "revoke", "isVerified", "tierOf", "getAttestation"]),
    );
  });
});
