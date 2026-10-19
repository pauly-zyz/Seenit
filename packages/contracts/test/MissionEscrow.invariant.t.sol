// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Drives the escrow through random sequences of create / record / accept / reject /
///      finalize / cancel / refund / fee changes / time travel, tracking expected flows.
contract EscrowHandler is Test {
    MissionEscrow internal escrow;
    MockERC20 internal token;
    address internal operator;
    address internal admin;
    address internal funder;
    address[] internal contributors;

    uint256[] public missionIds;
    uint256[] public submissionIds;
    uint256 internal mediaNonce;

    uint256 public totalDeposited;
    uint256 public totalPaidOut;
    uint256 public totalFees;
    uint256 public totalRefunded;
    mapping(uint256 submissionId => uint256) public timesPaid;

    constructor(
        MissionEscrow escrow_,
        MockERC20 token_,
        address operator_,
        address admin_,
        address funder_,
        address[] memory c
    ) {
        escrow = escrow_;
        token = token_;
        operator = operator_;
        admin = admin_;
        funder = funder_;
        contributors = c;
    }

    function missionCount() external view returns (uint256) {
        return missionIds.length;
    }

    function submissionCount() external view returns (uint256) {
        return submissionIds.length;
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
                || m.pending + m.accepted >= m.maxCaptures || escrow.hasSubmitted(id, who)
        ) return;
        vm.prank(operator);
        submissionIds.push(escrow.recordSubmission(id, who, keccak256(abi.encode(++mediaNonce))));
    }

    function accept(uint256 seed) external {
        (bool ok, uint256 sid, MissionEscrow.Submission memory s) = _pending(seed);
        if (!ok) return;
        _trackPay(sid, s.missionId);
        vm.prank(operator);
        escrow.acceptSubmission(sid);
    }

    function reject(uint256 seed) external {
        (bool ok, uint256 sid, MissionEscrow.Submission memory s) = _pending(seed);
        if (!ok || block.timestamp > s.reviewDeadline) return;
        MissionEscrow.Mission memory m = escrow.getMission(s.missionId);
        vm.prank(operator);
        escrow.rejectSubmission(sid, "");
        if (m.status != MissionEscrow.MissionStatus.Open || block.timestamp > m.deadline) {
            totalRefunded += m.rewardPerCapture;
        }
    }

    function finalize(uint256 seed) external {
        (bool ok, uint256 sid, MissionEscrow.Submission memory s) = _pending(seed);
        if (!ok || block.timestamp <= s.reviewDeadline) return;
        _trackPay(sid, s.missionId);
        escrow.finalize(sid);
    }

    function cancel(uint256 seed) external {
        if (missionIds.length == 0) return;
        uint256 id = missionIds[seed % missionIds.length];
        MissionEscrow.Mission memory m = escrow.getMission(id);
        if (m.status != MissionEscrow.MissionStatus.Open) return;
        vm.prank(funder);
        escrow.cancelMission(id);
        totalRefunded += uint256(m.rewardPerCapture) * (m.maxCaptures - m.accepted - m.pending);
    }

    function refund(uint256 seed) external {
        if (missionIds.length == 0) return;
        uint256 id = missionIds[seed % missionIds.length];
        MissionEscrow.Mission memory m = escrow.getMission(id);
        if (m.status != MissionEscrow.MissionStatus.Open || block.timestamp <= m.deadline) return;
        escrow.refund(id);
        totalRefunded += uint256(m.rewardPerCapture) * (m.maxCaptures - m.accepted - m.pending);
    }

    function setFee(uint16 bps) external {
        uint16 value = uint16(bound(bps, 0, escrow.MAX_FEE_BPS())); // before prank: prank hits the next call
        vm.prank(admin);
        escrow.setFeeBps(value);
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function _trackPay(uint256 sid, uint256 missionId) internal {
        (uint256 payout, uint256 fee) = escrow.quotePayout(missionId);
        totalPaidOut += payout;
        totalFees += fee;
        timesPaid[sid] += 1;
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
    address internal treasury = makeAddr("treasury");
    address[] internal contributors;

    function setUp() public {
        vm.warp(1_700_000_000);
        address admin = makeAddr("admin");
        address operator = makeAddr("operator");
        address funder = makeAddr("funder");

        token = new MockERC20();
        registry = new PersonhoodRegistry(admin, 0, admin);
        escrow = new MissionEscrow(
            MissionEscrow.Config({
                rewardToken: IERC20(address(token)),
                registry: registry,
                admin: admin,
                adminDelay: 0,
                operator: operator,
                pauser: admin,
                treasury: treasury,
                feeBps: 250,
                tier1MaxReward: 1_000e6,
                reviewWindow: 1 days
            })
        );

        for (uint256 i; i < 4; ++i) {
            address c = makeAddr(string(abi.encode("contributor", i)));
            contributors.push(c);
            vm.prank(admin);
            registry.attest(c, PersonhoodRegistry.Provider.Self, keccak256(abi.encode(i)), type(uint64).max);
        }

        token.mint(funder, type(uint128).max);
        vm.prank(funder);
        token.approve(address(escrow), type(uint256).max);

        handler = new EscrowHandler(escrow, token, operator, admin, funder, contributors);
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

    /// Every token deposited is held, paid to a contributor, taken as fee, or refunded.
    function invariant_conservationOfFunds() public view {
        assertEq(
            handler.totalDeposited(),
            token.balanceOf(address(escrow)) + handler.totalPaidOut() + handler.totalFees()
                + handler.totalRefunded()
        );
        assertEq(token.balanceOf(treasury), handler.totalFees());
        uint256 paid;
        for (uint256 i; i < contributors.length; ++i) {
            paid += token.balanceOf(contributors[i]);
        }
        assertEq(paid, handler.totalPaidOut());
    }

    /// Slots never over-commit.
    function invariant_slotsNeverOvercommitted() public view {
        uint256 n = handler.missionCount();
        for (uint256 i; i < n; ++i) {
            MissionEscrow.Mission memory m = escrow.getMission(handler.missionIds(i));
            assertLe(uint256(m.pending) + m.accepted, m.maxCaptures);
        }
    }

    /// No submission is ever paid twice.
    function invariant_eachSubmissionPaidAtMostOnce() public view {
        uint256 n = handler.submissionCount();
        for (uint256 i; i < n; ++i) {
            uint256 sid = handler.submissionIds(i);
            uint256 paid = handler.timesPaid(sid);
            assertLe(paid, 1);
            bool accepted = escrow.getSubmission(sid).status == MissionEscrow.SubmissionStatus.Accepted;
            assertEq(paid == 1, accepted);
        }
    }
}
