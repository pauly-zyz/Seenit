// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Drives the escrow through random sequences of create / record / approve / reject /
///      finalize / close / time travel.
contract EscrowHandler is Test {
    MissionEscrow internal escrow;
    MockERC20 internal token;
    address internal verifier;
    address internal funder;
    address[] internal contributors;

    uint256[] public missionIds;
    uint256[] public submissionIds;
    uint256 internal mediaNonce;

    uint256 public totalDeposited;
    uint256 public totalPaidOut;
    uint256 public totalRefunded;

    constructor(
        MissionEscrow escrow_,
        MockERC20 token_,
        address verifier_,
        address funder_,
        address[] memory c
    ) {
        escrow = escrow_;
        token = token_;
        verifier = verifier_;
        funder = funder_;
        contributors = c;
    }

    function missionCount() external view returns (uint256) {
        return missionIds.length;
    }

    function create(uint128 reward, uint32 slots, uint32 ttl) external {
        reward = uint128(bound(reward, 1, 100e6));
        slots = uint32(bound(slots, 1, 5));
        ttl = uint32(bound(ttl, 1 hours, 10 days));
        vm.prank(funder);
        uint256 id = escrow.createMission(reward, slots, uint64(block.timestamp) + ttl, 1, bytes32(0));
        missionIds.push(id);
        totalDeposited += uint256(reward) * slots;
    }

    function record(uint256 missionSeed, uint256 contributorSeed) external {
        if (missionIds.length == 0) return;
        uint256 id = missionIds[missionSeed % missionIds.length];
        address who = contributors[contributorSeed % contributors.length];
        MissionEscrow.Mission memory m = escrow.getMission(id);
        if (
            m.status != MissionEscrow.MissionStatus.Open || block.timestamp > m.deadline
                || m.pending + m.approved >= m.maxSubmissions || escrow.hasSubmitted(id, who)
        ) return;
        vm.prank(verifier);
        uint256 sid = escrow.recordSubmission(id, who, keccak256(abi.encode(++mediaNonce)));
        submissionIds.push(sid);
    }

    function approve(uint256 seed) external {
        (bool ok, uint256 sid, MissionEscrow.Submission memory s) = _pending(seed);
        if (!ok) return;
        uint256 reward = escrow.getMission(s.missionId).reward;
        vm.prank(verifier);
        escrow.approve(sid);
        totalPaidOut += reward;
    }

    function reject(uint256 seed) external {
        (bool ok, uint256 sid, MissionEscrow.Submission memory s) = _pending(seed);
        if (!ok || block.timestamp > s.reviewDeadline) return;
        MissionEscrow.Mission memory m = escrow.getMission(s.missionId);
        vm.prank(verifier);
        escrow.reject(sid, "");
        if (m.status == MissionEscrow.MissionStatus.Closed) totalRefunded += m.reward;
    }

    function finalize(uint256 seed) external {
        (bool ok, uint256 sid, MissionEscrow.Submission memory s) = _pending(seed);
        if (!ok || block.timestamp <= s.reviewDeadline) return;
        uint256 reward = escrow.getMission(s.missionId).reward;
        escrow.finalize(sid);
        totalPaidOut += reward;
    }

    function close(uint256 seed) external {
        if (missionIds.length == 0) return;
        uint256 id = missionIds[seed % missionIds.length];
        MissionEscrow.Mission memory m = escrow.getMission(id);
        if (m.status != MissionEscrow.MissionStatus.Open) return;
        vm.prank(funder);
        escrow.closeMission(id);
        totalRefunded += uint256(m.reward) * (m.maxSubmissions - m.approved - m.pending);
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function _pending(uint256 seed) internal view returns (bool, uint256, MissionEscrow.Submission memory s) {
        if (submissionIds.length == 0) return (false, 0, s);
        uint256 sid = submissionIds[seed % submissionIds.length];
        s = escrow.getSubmission(sid);
        return (s.status == MissionEscrow.SubmissionStatus.Pending, sid, s);
    }
}

contract MissionEscrowInvariantTest is Test {
    MockERC20 internal token;
    PersonhoodRegistry internal registry;
    MissionEscrow internal escrow;
    EscrowHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        address admin = makeAddr("admin");
        address verifier = makeAddr("verifier");
        address funder = makeAddr("funder");

        token = new MockERC20();
        registry = new PersonhoodRegistry(admin, admin);
        escrow = new MissionEscrow(IERC20(address(token)), registry, admin, verifier, 5e6, 1 days);

        address[] memory c = new address[](4);
        for (uint256 i; i < c.length; ++i) {
            c[i] = makeAddr(string(abi.encode("contributor", i)));
            vm.prank(admin);
            registry.attest(c[i], 2, keccak256(abi.encode(i)), type(uint64).max);
        }

        token.mint(funder, type(uint128).max);
        vm.prank(funder);
        token.approve(address(escrow), type(uint256).max);

        handler = new EscrowHandler(escrow, token, verifier, funder, c);
        targetContract(address(handler));
    }

    /// The contract holds exactly what it still owes across all missions.
    function invariant_balanceEqualsSumOfEscrowed() public view {
        uint256 sum;
        uint256 n = handler.missionCount();
        for (uint256 i; i < n; ++i) {
            sum += escrow.escrowedFor(handler.missionIds(i));
        }
        assertEq(token.balanceOf(address(escrow)), sum);
    }

    /// Every token deposited is either still held, paid to a contributor, or refunded.
    function invariant_conservationOfFunds() public view {
        assertEq(
            handler.totalDeposited(),
            token.balanceOf(address(escrow)) + handler.totalPaidOut() + handler.totalRefunded()
        );
    }

    /// Slots never over-commit.
    function invariant_slotsNeverOvercommitted() public view {
        uint256 n = handler.missionCount();
        for (uint256 i; i < n; ++i) {
            MissionEscrow.Mission memory m = escrow.getMission(handler.missionIds(i));
            assertLe(uint256(m.pending) + m.approved, m.maxSubmissions);
        }
    }
}
