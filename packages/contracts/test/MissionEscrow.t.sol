// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {EscrowBase} from "./Base.t.sol";
import {FeeOnTransferERC20} from "./mocks/MockERC20.sol";

contract MissionEscrowTest is EscrowBase {
    // --- constructor -------------------------------------------------------------------------

    function test_constructor() public view {
        assertEq(address(escrow.rewardToken()), address(token));
        assertEq(address(escrow.registry()), address(registry));
        assertEq(escrow.treasury(), treasury);
        assertEq(escrow.feeBps(), FEE_BPS);
        assertEq(escrow.tier1MaxReward(), TIER1_MAX);
        assertEq(escrow.reviewWindow(), REVIEW);
        assertEq(escrow.defaultAdmin(), admin);
        assertTrue(escrow.hasRole(escrow.OPERATOR_ROLE(), operator));
        assertTrue(escrow.hasRole(escrow.PAUSER_ROLE(), pauser));
        assertFalse(escrow.hasRole(escrow.OPERATOR_ROLE(), admin));
    }

    function test_constructor_reverts() public {
        IERC20 t = IERC20(address(token));
        MissionEscrow.Config memory c;

        c = _config(IERC20(address(0)));
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(c);

        c = _config(t);
        c.registry = PersonhoodRegistry(address(0));
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(c);

        c = _config(t);
        c.operator = address(0);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(c);

        c = _config(t);
        c.pauser = address(0);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(c);

        c = _config(t);
        c.treasury = address(0);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(c);

        c = _config(t);
        c.feeBps = 1001;
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.FeeTooHigh.selector, 1001));
        new MissionEscrow(c);

        c = _config(t);
        c.reviewWindow = 59 minutes;
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidReviewWindow.selector, 59 minutes));
        new MissionEscrow(c);

        c = _config(t);
        c.reviewWindow = 15 days;
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidReviewWindow.selector, 15 days));
        new MissionEscrow(c);
    }

    // --- createMission -----------------------------------------------------------------------

    function test_create_escrowsFunds() public {
        uint256 before = token.balanceOf(funder);
        uint64 deadline = _deadline();
        vm.expectEmit(address(escrow));
        emit MissionEscrow.MissionCreated(1, funder, REWARD, SLOTS, deadline, T1, FEE_BPS, SPEC);
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, SLOTS, deadline, T1, SPEC);

        assertEq(id, 1);
        assertEq(escrow.nextMissionId(), 2);
        assertEq(token.balanceOf(address(escrow)), uint256(REWARD) * SLOTS);
        assertEq(token.balanceOf(funder), before - uint256(REWARD) * SLOTS);
        assertEq(escrow.escrowedFor(id), uint256(REWARD) * SLOTS);

        MissionEscrow.Mission memory m = escrow.getMission(id);
        assertEq(m.funder, funder);
        assertEq(m.rewardPerCapture, REWARD);
        assertEq(m.maxCaptures, SLOTS);
        assertEq(m.deadline, deadline);
        assertEq(m.minTier, T1);
        assertEq(m.feeBps, FEE_BPS);
        assertEq(m.specHash, SPEC);
        assertEq(uint8(m.status), uint8(MissionEscrow.MissionStatus.Open));
    }

    function test_create_tierRule() public {
        vm.startPrank(funder);
        assertEq(escrow.getMission(escrow.createMission(REWARD, 1, _deadline(), 0, SPEC)).minTier, T1);
        assertEq(escrow.getMission(escrow.createMission(REWARD, 1, _deadline(), T2, SPEC)).minTier, T2);
        assertEq(escrow.getMission(escrow.createMission(TIER1_MAX, 1, _deadline(), T1, SPEC)).minTier, T1);
        assertEq(escrow.getMission(escrow.createMission(TIER1_MAX + 1, 1, _deadline(), T1, SPEC)).minTier, T2);
        vm.stopPrank();
    }

    function testFuzz_create_tierRule(uint128 reward, uint8 requested) public {
        reward = uint128(bound(reward, 1, 1_000e6));
        requested = uint8(bound(requested, 0, 2));
        vm.prank(funder);
        uint256 id = escrow.createMission(reward, 1, _deadline(), requested, SPEC);
        uint8 expected = requested < T1 ? T1 : requested;
        if (reward > TIER1_MAX) expected = T2;
        assertEq(escrow.getMission(id).minTier, expected);
        assertEq(escrow.requiredTier(reward, requested), expected);
    }

    function test_create_reverts() public {
        vm.startPrank(funder);
        vm.expectRevert(MissionEscrow.ZeroReward.selector);
        escrow.createMission(0, SLOTS, _deadline(), T1, SPEC);
        vm.expectRevert(MissionEscrow.ZeroCaptures.selector);
        escrow.createMission(REWARD, 0, _deadline(), T1, SPEC);
        uint64 now_ = uint64(block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.DeadlineInPast.selector, now_));
        escrow.createMission(REWARD, SLOTS, now_, T1, SPEC);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidTier.selector, 3));
        escrow.createMission(REWARD, SLOTS, _deadline(), 3, SPEC);
        vm.stopPrank();
    }

    function test_create_withoutAllowanceReverts() public {
        token.mint(stranger, 100e6);
        vm.expectRevert();
        vm.prank(stranger);
        escrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
    }

    function test_create_rejectsFeeOnTransferToken() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20();
        MissionEscrow e2 = new MissionEscrow(_config(IERC20(address(fot))));
        fot.mint(funder, 100e6);
        vm.startPrank(funder);
        fot.approve(address(e2), type(uint256).max);
        uint256 total = uint256(REWARD) * SLOTS;
        vm.expectRevert(
            abi.encodeWithSelector(MissionEscrow.TransferShortfall.selector, total, total - total / 100)
        );
        e2.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
        vm.stopPrank();
    }

    function test_create_snapshotsFee() public {
        uint256 id = _create();
        vm.prank(admin);
        escrow.setFeeBps(1000);
        assertEq(escrow.getMission(id).feeBps, FEE_BPS);
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.acceptSubmission(sid);
        assertEq(token.balanceOf(treasury), _fee(REWARD)); // old 5%, not new 10%
    }

    // --- recordSubmission --------------------------------------------------------------------

    function test_record() public {
        uint256 id = _create();
        bytes32 media = keccak256("m1");
        uint64 reviewDeadline = uint64(block.timestamp) + REVIEW;
        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionRecorded(1, id, alice, media, reviewDeadline);
        uint256 sid = _record(id, alice, media);

        assertEq(sid, 1);
        MissionEscrow.Submission memory s = escrow.getSubmission(sid);
        assertEq(s.missionId, id);
        assertEq(s.contributor, alice);
        assertEq(s.mediaHash, media);
        assertEq(s.recordedAt, block.timestamp);
        assertEq(s.reviewDeadline, reviewDeadline);
        assertEq(uint8(s.status), uint8(MissionEscrow.SubmissionStatus.Pending));
        assertTrue(escrow.mediaHashUsed(media));
        assertTrue(escrow.hasSubmitted(id, alice));
        assertEq(escrow.getMission(id).pending, 1);
    }

    function test_record_reverts() public {
        uint256 id = _create();

        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.UnknownMission.selector, 99));
        _record(99, alice, keccak256("x"));
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        _record(id, address(0), keccak256("x"));
        vm.expectRevert(MissionEscrow.ZeroMediaHash.selector);
        _record(id, alice, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotVerified.selector, mallory, T1));
        _record(id, mallory, keccak256("x"));

        vm.prank(attester);
        registry.attest(funder, PersonhoodRegistry.Provider.HumanPassport, keccak256("f"), _deadline());
        vm.expectRevert(MissionEscrow.FunderCannotSubmit.selector);
        _record(id, funder, keccak256("x"));

        _record(id, alice, keccak256("a1"));
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.AlreadySubmitted.selector, id, alice));
        _record(id, alice, keccak256("a2"));
    }

    function test_record_tier2MissionRejectsTier1() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(TIER1_MAX + 1, 2, _deadline(), T1, SPEC);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotVerified.selector, alice, T2));
        _record(id, alice, keccak256("a"));
        _record(id, carol, keccak256("c"));
    }

    function test_record_revokedContributorRejected() public {
        uint256 id = _create();
        vm.prank(attester);
        registry.revoke(alice, PersonhoodRegistry.Provider.HumanPassport, "fraud");
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotVerified.selector, alice, T1));
        _record(id, alice, keccak256("a"));
    }

    function test_record_full() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), T1, SPEC);
        _record(id, alice, keccak256("a"));
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionFull.selector, id));
        _record(id, bob, keccak256("b"));
    }

    function test_record_deadline() public {
        uint256 id = _create();
        vm.warp(_deadline());
        _record(id, alice, keccak256("a")); // exactly at deadline is fine
        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionExpired.selector, id));
        _record(id, bob, keccak256("b"));
    }

    function test_record_closedMission() public {
        uint256 id = _create();
        vm.prank(funder);
        escrow.cancelMission(id);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, id));
        _record(id, alice, keccak256("a"));
    }

    function test_record_mediaHashGloballyUnique() public {
        uint256 id1 = _create();
        uint256 id2 = _create();
        bytes32 media = keccak256("same");
        _record(id1, alice, media);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MediaHashAlreadyUsed.selector, media));
        _record(id2, bob, media);
    }

    // --- acceptSubmission --------------------------------------------------------------------

    function test_accept_paysContributorAndTreasury() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        uint256 fee = _fee(REWARD);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionAccepted(sid, id, alice, REWARD - fee, fee, false);
        vm.prank(funder);
        escrow.acceptSubmission(sid);

        assertEq(token.balanceOf(alice), REWARD - fee);
        assertEq(token.balanceOf(treasury), fee);
        MissionEscrow.Mission memory m = escrow.getMission(id);
        assertEq(m.pending, 0);
        assertEq(m.accepted, 1);
        assertEq(uint8(escrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Accepted));
        assertEq(escrow.escrowedFor(id), uint256(REWARD) * (SLOTS - 1));
    }

    function test_accept_byOperator() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(operator);
        escrow.acceptSubmission(sid);
        assertEq(token.balanceOf(alice), REWARD - _fee(REWARD));
    }

    function test_accept_zeroFeeSkipsTreasury() public {
        vm.prank(admin);
        escrow.setFeeBps(0);
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.acceptSubmission(sid);
        assertEq(token.balanceOf(alice), REWARD);
        assertEq(token.balanceOf(treasury), 0);
    }

    function test_accept_afterReviewWindowStillAllowed() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(funder);
        escrow.acceptSubmission(sid);
        assertEq(token.balanceOf(alice), REWARD - _fee(REWARD));
    }

    function test_accept_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, 42));
        vm.prank(funder);
        escrow.acceptSubmission(42);
    }

    function testFuzz_feeMath(uint128 reward, uint16 bps) public {
        reward = uint128(bound(reward, 1, type(uint64).max));
        bps = uint16(bound(bps, 0, escrow.MAX_FEE_BPS()));
        vm.prank(admin);
        escrow.setFeeBps(bps);
        token.mint(funder, reward);
        vm.prank(funder);
        uint256 id = escrow.createMission(reward, 1, _deadline(), T2, SPEC);
        (uint256 payout, uint256 fee) = escrow.quotePayout(id);
        assertEq(payout + fee, reward);
        assertLe(fee * 10_000, uint256(reward) * escrow.MAX_FEE_BPS());

        uint256 sid = _record(id, carol, keccak256("c"));
        vm.prank(operator);
        escrow.acceptSubmission(sid);
        assertEq(token.balanceOf(carol), payout);
        assertEq(token.balanceOf(treasury), fee);
    }

    // --- rejectSubmission --------------------------------------------------------------------

    function test_reject_freesSlot() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), T1, SPEC);
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionRejected(sid, id, "blurry", 0);
        vm.prank(funder);
        escrow.rejectSubmission(sid, "blurry");

        assertEq(uint8(escrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Rejected));
        assertEq(escrow.getMission(id).pending, 0);
        assertEq(escrow.getMission(id).maxCaptures, 1);
        _record(id, bob, keccak256("b")); // slot reusable
        assertTrue(escrow.hasSubmitted(id, alice));
        assertTrue(escrow.mediaHashUsed(keccak256("a")));
    }

    function test_reject_byOperator() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(operator);
        escrow.rejectSubmission(sid, "off-location");
        assertEq(uint8(escrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Rejected));
    }

    function test_reject_afterReviewWindowReverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(escrow.getSubmission(sid).reviewDeadline); // boundary ok
        vm.prank(funder);
        escrow.rejectSubmission(sid, "");

        uint256 sid2 = _record(id, bob, keccak256("b"));
        vm.warp(escrow.getSubmission(sid2).reviewDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.ReviewWindowOver.selector, sid2));
        vm.prank(funder);
        escrow.rejectSubmission(sid2, "");
    }

    function test_reject_afterDeadlineRefundsImmediately() public {
        uint256 id = _create();
        uint64 deadline = escrow.getMission(id).deadline;
        vm.warp(deadline - 1 hours); // recorded late, so its review window runs past the deadline
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(deadline + 1);
        uint256 before = token.balanceOf(funder);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionRejected(sid, id, "", REWARD);
        vm.prank(funder);
        escrow.rejectSubmission(sid, "");
        assertEq(token.balanceOf(funder), before + REWARD);
        assertEq(escrow.getMission(id).maxCaptures, SLOTS - 1);
        // the unused slots are still refundable afterwards
        escrow.refund(id);
        assertEq(token.balanceOf(funder), before + uint256(REWARD) * SLOTS);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_reject_onCancelledMissionRefunds() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.cancelMission(id);
        uint256 before = token.balanceOf(funder);
        vm.prank(operator);
        escrow.rejectSubmission(sid, "");
        assertEq(token.balanceOf(funder), before + REWARD);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(escrow.escrowedFor(id), 0);
    }

    // --- finalize ----------------------------------------------------------------------------

    function test_finalize_afterWindowPays() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(block.timestamp + REVIEW + 1);
        uint256 fee = _fee(REWARD);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionAccepted(sid, id, alice, REWARD - fee, fee, true);
        vm.prank(stranger);
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), REWARD - fee);
        assertEq(token.balanceOf(treasury), fee);
    }

    function test_finalize_duringWindowReverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(block.timestamp + REVIEW);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.ReviewWindowActive.selector, sid));
        escrow.finalize(sid);
    }

    function test_finalize_afterCancelPays() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.cancelMission(id);
        vm.warp(block.timestamp + REVIEW + 1);
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), REWARD - _fee(REWARD));
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // --- double resolution -------------------------------------------------------------------

    function test_doubleAccept_reverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.acceptSubmission(sid);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        vm.prank(operator);
        escrow.acceptSubmission(sid);
        vm.warp(block.timestamp + REVIEW + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), REWARD - _fee(REWARD)); // paid exactly once
    }

    function test_acceptAfterReject_reverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.rejectSubmission(sid, "");
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        vm.prank(funder);
        escrow.acceptSubmission(sid);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        vm.prank(funder);
        escrow.rejectSubmission(sid, "");
        vm.warp(block.timestamp + REVIEW + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_rejectAfterAccept_reverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(operator);
        escrow.acceptSubmission(sid);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        vm.prank(funder);
        escrow.rejectSubmission(sid, "");
    }

    // --- cancelMission / refund --------------------------------------------------------------

    function test_cancel_refundsUnused() public {
        uint256 id = _create();
        uint256 s1 = _record(id, alice, keccak256("a"));
        _record(id, bob, keccak256("b"));
        vm.prank(funder);
        escrow.acceptSubmission(s1);

        uint256 before = token.balanceOf(funder);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.MissionCancelled(id, REWARD); // 3 - 1 accepted - 1 pending
        vm.prank(funder);
        escrow.cancelMission(id);

        assertEq(token.balanceOf(funder), before + REWARD);
        MissionEscrow.Mission memory m = escrow.getMission(id);
        assertEq(uint8(m.status), uint8(MissionEscrow.MissionStatus.Cancelled));
        assertEq(m.maxCaptures, 2);
        assertEq(escrow.escrowedFor(id), REWARD); // bob's pending reward stays
    }

    function test_cancel_fullyUsedRefundsZero() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), T1, SPEC);
        _record(id, alice, keccak256("a"));
        uint256 before = token.balanceOf(funder);
        vm.prank(funder);
        escrow.cancelMission(id);
        assertEq(token.balanceOf(funder), before);
    }

    function test_cancel_reverts() public {
        uint256 id = _create();
        vm.expectRevert(MissionEscrow.NotFunder.selector);
        vm.prank(operator);
        escrow.cancelMission(id);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.UnknownMission.selector, 99));
        vm.prank(funder);
        escrow.cancelMission(99);
        vm.prank(funder);
        escrow.cancelMission(id);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, id));
        vm.prank(funder);
        escrow.cancelMission(id);
    }

    function test_refund_afterDeadlineByAnyone() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.DeadlineNotReached.selector, id));
        vm.prank(stranger);
        escrow.refund(id);

        vm.warp(_deadline() + 1);
        uint256 before = token.balanceOf(funder);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.MissionRefunded(id, uint256(REWARD) * SLOTS);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(token.balanceOf(funder), before + uint256(REWARD) * SLOTS);
        assertEq(token.balanceOf(stranger), 0);
        assertEq(uint8(escrow.getMission(id).status), uint8(MissionEscrow.MissionStatus.Refunded));

        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, id));
        escrow.refund(id);
    }

    function test_refund_afterCancelReverts() public {
        uint256 id = _create();
        vm.prank(funder);
        escrow.cancelMission(id);
        vm.warp(_deadline() + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, id));
        escrow.refund(id);
    }

    // --- pause -------------------------------------------------------------------------------

    function test_pause_blocksNewActivity() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(pauser);
        escrow.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(funder);
        escrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _record(id, bob, keccak256("b"));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(operator);
        escrow.acceptSubmission(sid);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(operator);
        escrow.rejectSubmission(sid, "");
    }

    function test_pause_exitsStayOpen() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(pauser);
        escrow.pause();

        vm.prank(funder);
        escrow.cancelMission(id); // funder can exit
        vm.warp(block.timestamp + REVIEW + 1);
        escrow.finalize(sid); // contributor still gets paid
        assertEq(token.balanceOf(alice), REWARD - _fee(REWARD));

        uint256 id2;
        vm.prank(pauser);
        escrow.unpause();
        id2 = _create();
        vm.prank(pauser);
        escrow.pause();
        vm.warp(_deadline() + 1);
        escrow.refund(id2); // refund after deadline works while paused
        assertEq(escrow.escrowedFor(id2), 0);
    }

    // --- access control ----------------------------------------------------------------------

    function _unauthorized(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    function test_access_recordRequiresOperator() public {
        uint256 id = _create();
        bytes32 role = escrow.OPERATOR_ROLE();
        address[3] memory callers = [funder, admin, alice];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(_unauthorized(callers[i], role));
            vm.prank(callers[i]);
            escrow.recordSubmission(id, alice, keccak256("a"));
        }
    }

    function test_access_acceptRejectRequireFunderOrOperator() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        address[4] memory callers = [stranger, alice, admin, pauser];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            vm.expectRevert(MissionEscrow.NotFunderOrOperator.selector);
            escrow.acceptSubmission(sid);
            vm.expectRevert(MissionEscrow.NotFunderOrOperator.selector);
            escrow.rejectSubmission(sid, "");
            vm.stopPrank();
        }
    }

    function test_access_adminSetters() public {
        bytes32 role = escrow.DEFAULT_ADMIN_ROLE();
        vm.startPrank(operator);
        vm.expectRevert(_unauthorized(operator, role));
        escrow.setFeeBps(1);
        vm.expectRevert(_unauthorized(operator, role));
        escrow.setTreasury(operator);
        vm.expectRevert(_unauthorized(operator, role));
        escrow.setTier1MaxReward(1);
        vm.expectRevert(_unauthorized(operator, role));
        escrow.setReviewWindow(1 days);
        vm.stopPrank();
    }

    function test_access_pauseRequiresPauser() public {
        bytes32 role = escrow.PAUSER_ROLE();
        vm.expectRevert(_unauthorized(admin, role));
        vm.prank(admin);
        escrow.pause();
        vm.prank(pauser);
        escrow.pause();
        vm.expectRevert(_unauthorized(operator, role));
        vm.prank(operator);
        escrow.unpause();
    }

    // --- admin -------------------------------------------------------------------------------

    function test_admin_setters() public {
        address newTreasury = makeAddr("newTreasury");
        vm.startPrank(admin);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.FeeUpdated(1000);
        escrow.setFeeBps(1000);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.FeeTooHigh.selector, 1001));
        escrow.setFeeBps(1001);

        vm.expectEmit(address(escrow));
        emit MissionEscrow.TreasuryUpdated(newTreasury);
        escrow.setTreasury(newTreasury);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        escrow.setTreasury(address(0));

        vm.expectEmit(address(escrow));
        emit MissionEscrow.Tier1MaxRewardUpdated(1);
        escrow.setTier1MaxReward(1);

        vm.expectEmit(address(escrow));
        emit MissionEscrow.ReviewWindowUpdated(1 days);
        escrow.setReviewWindow(1 days);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidReviewWindow.selector, 1));
        escrow.setReviewWindow(1);
        vm.stopPrank();

        assertEq(escrow.feeBps(), 1000);
        assertEq(escrow.treasury(), newTreasury);
        assertEq(escrow.tier1MaxReward(), 1);
        assertEq(escrow.reviewWindow(), 1 days);
    }

    function test_admin_reviewWindowChangeOnlyAffectsNewSubmissions() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        uint64 original = escrow.getSubmission(sid).reviewDeadline;
        vm.prank(admin);
        escrow.setReviewWindow(14 days);
        assertEq(escrow.getSubmission(sid).reviewDeadline, original);
    }

    // --- lifecycle ---------------------------------------------------------------------------

    function test_lifecycle_accountingBalances() public {
        uint256 id = _create();
        uint256 s1 = _record(id, alice, keccak256("a"));
        uint256 s2 = _record(id, bob, keccak256("b"));
        uint256 s3 = _record(id, carol, keccak256("c"));

        vm.prank(funder);
        escrow.acceptSubmission(s1);
        vm.prank(operator);
        escrow.rejectSubmission(s2, "off-location");
        vm.warp(block.timestamp + REVIEW + 1);
        escrow.finalize(s3);

        uint256 funderBefore = token.balanceOf(funder);
        vm.warp(_deadline() + 1);
        escrow.refund(id);

        uint256 fee = _fee(REWARD);
        assertEq(token.balanceOf(alice), REWARD - fee);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(carol), REWARD - fee);
        assertEq(token.balanceOf(treasury), 2 * fee);
        assertEq(token.balanceOf(funder), funderBefore + REWARD); // bob's freed slot
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzz_createAndCancelReturnsEverything(uint128 reward, uint32 slots) public {
        reward = uint128(bound(reward, 1, 1_000e6));
        slots = uint32(bound(slots, 1, 1_000));
        uint256 before = token.balanceOf(funder);
        vm.startPrank(funder);
        uint256 id = escrow.createMission(reward, slots, _deadline(), T1, SPEC);
        escrow.cancelMission(id);
        vm.stopPrank();
        assertEq(token.balanceOf(funder), before);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}
