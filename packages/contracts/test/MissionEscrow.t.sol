// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {MockERC20, FeeOnTransferERC20} from "./mocks/MockERC20.sol";

contract MissionEscrowTest is Test {
    MockERC20 internal token;
    PersonhoodRegistry internal registry;
    MissionEscrow internal escrow;

    address internal admin = makeAddr("admin");
    address internal attester = makeAddr("attester");
    address internal verifier = makeAddr("verifier");
    address internal funder = makeAddr("funder");
    address internal alice = makeAddr("alice"); // tier 1
    address internal bob = makeAddr("bob"); // tier 1
    address internal carol = makeAddr("carol"); // tier 2
    address internal mallory = makeAddr("mallory"); // no personhood
    address internal stranger = makeAddr("stranger");

    uint128 internal constant TIER1_MAX = 5e6; // 5 USD
    uint64 internal constant REVIEW = 3 days;
    uint128 internal constant REWARD = 2e6; // 2 USD
    uint32 internal constant SLOTS = 3;
    bytes32 internal constant SPEC = keccak256("spec");

    uint8 internal constant T1 = 1;
    uint8 internal constant T2 = 2;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockERC20();
        registry = new PersonhoodRegistry(admin, attester);
        escrow = new MissionEscrow(IERC20(address(token)), registry, admin, verifier, TIER1_MAX, REVIEW);

        uint64 exp = uint64(block.timestamp + 365 days);
        vm.startPrank(attester);
        registry.attest(alice, T1, keccak256("alice"), exp);
        registry.attest(bob, T1, keccak256("bob"), exp);
        registry.attest(carol, T2, keccak256("carol"), exp);
        vm.stopPrank();

        token.mint(funder, 1_000_000e6);
        vm.prank(funder);
        token.approve(address(escrow), type(uint256).max);
    }

    // --- helpers -----------------------------------------------------------------------------

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function _create() internal returns (uint256) {
        vm.prank(funder);
        return escrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
    }

    function _record(uint256 missionId, address who, bytes32 media) internal returns (uint256) {
        vm.prank(verifier);
        return escrow.recordSubmission(missionId, who, media);
    }

    // --- constructor -------------------------------------------------------------------------

    function test_constructor() public view {
        assertEq(address(escrow.rewardToken()), address(token));
        assertEq(address(escrow.registry()), address(registry));
        assertEq(escrow.tier1MaxReward(), TIER1_MAX);
        assertEq(escrow.reviewWindow(), REVIEW);
        assertTrue(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(escrow.hasRole(escrow.PAUSER_ROLE(), admin));
        assertTrue(escrow.hasRole(escrow.VERIFIER_ROLE(), verifier));
    }

    function test_constructor_reverts() public {
        IERC20 t = IERC20(address(token));
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(IERC20(address(0)), registry, admin, verifier, TIER1_MAX, REVIEW);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(t, PersonhoodRegistry(address(0)), admin, verifier, TIER1_MAX, REVIEW);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(t, registry, address(0), verifier, TIER1_MAX, REVIEW);
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        new MissionEscrow(t, registry, admin, address(0), TIER1_MAX, REVIEW);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidReviewWindow.selector, 59 minutes));
        new MissionEscrow(t, registry, admin, verifier, TIER1_MAX, 59 minutes);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidReviewWindow.selector, 15 days));
        new MissionEscrow(t, registry, admin, verifier, TIER1_MAX, 15 days);
    }

    // --- createMission -----------------------------------------------------------------------

    function test_createMission_escrowsFunds() public {
        uint256 before = token.balanceOf(funder);
        uint64 deadline = _deadline();
        vm.expectEmit(address(escrow));
        emit MissionEscrow.MissionCreated(1, funder, REWARD, SLOTS, deadline, T1, SPEC);
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, SLOTS, deadline, T1, SPEC);

        assertEq(id, 1);
        assertEq(escrow.nextMissionId(), 2);
        assertEq(token.balanceOf(address(escrow)), uint256(REWARD) * SLOTS);
        assertEq(token.balanceOf(funder), before - uint256(REWARD) * SLOTS);
        assertEq(escrow.escrowedFor(id), uint256(REWARD) * SLOTS);

        MissionEscrow.Mission memory m = escrow.getMission(id);
        assertEq(m.funder, funder);
        assertEq(m.reward, REWARD);
        assertEq(m.maxSubmissions, SLOTS);
        assertEq(m.deadline, deadline);
        assertEq(m.minTier, T1);
        assertEq(m.specHash, SPEC);
        assertEq(uint8(m.status), uint8(MissionEscrow.MissionStatus.Open));
    }

    function test_createMission_minTierFloorIsTier1() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), 0, SPEC);
        assertEq(escrow.getMission(id).minTier, T1);
    }

    function test_createMission_highRewardForcesTier2() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(TIER1_MAX + 1, 1, _deadline(), T1, SPEC);
        assertEq(escrow.getMission(id).minTier, T2);
    }

    function test_createMission_rewardAtCapStaysTier1() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(TIER1_MAX, 1, _deadline(), T1, SPEC);
        assertEq(escrow.getMission(id).minTier, T1);
    }

    function test_createMission_funderCanRequestTier2() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), T2, SPEC);
        assertEq(escrow.getMission(id).minTier, T2);
    }

    function test_createMission_reverts() public {
        vm.startPrank(funder);
        vm.expectRevert(MissionEscrow.ZeroReward.selector);
        escrow.createMission(0, SLOTS, _deadline(), T1, SPEC);
        vm.expectRevert(MissionEscrow.ZeroSubmissions.selector);
        escrow.createMission(REWARD, 0, _deadline(), T1, SPEC);
        uint64 now_ = uint64(block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.DeadlineInPast.selector, now_));
        escrow.createMission(REWARD, SLOTS, now_, T1, SPEC);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidTier.selector, 3));
        escrow.createMission(REWARD, SLOTS, _deadline(), 3, SPEC);
        vm.stopPrank();
    }

    function test_createMission_revertsWithoutAllowance() public {
        token.mint(stranger, 100e6);
        vm.expectRevert();
        vm.prank(stranger);
        escrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
    }

    function test_createMission_rejectsFeeOnTransferToken() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20();
        MissionEscrow e2 =
            new MissionEscrow(IERC20(address(fot)), registry, admin, verifier, TIER1_MAX, REVIEW);
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

    function test_createMission_pausedReverts() public {
        vm.prank(admin);
        escrow.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(funder);
        escrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
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
        assertEq(s.reviewDeadline, reviewDeadline);
        assertEq(uint8(s.status), uint8(MissionEscrow.SubmissionStatus.Pending));
        assertTrue(escrow.mediaHashUsed(media));
        assertTrue(escrow.hasSubmitted(id, alice));
        assertEq(escrow.getMission(id).pending, 1);
    }

    function test_record_onlyVerifier() public {
        uint256 id = _create();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, escrow.VERIFIER_ROLE()
            )
        );
        vm.prank(alice);
        escrow.recordSubmission(id, alice, keccak256("m"));
    }

    function test_record_unknownMission() public {
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.UnknownMission.selector, 42));
        _record(42, alice, keccak256("m"));
    }

    function test_record_afterDeadline() public {
        uint256 id = _create();
        vm.warp(_deadline() + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionExpired.selector, id));
        _record(id, alice, keccak256("m"));
    }

    function test_record_atDeadlineAllowed() public {
        uint256 id = _create();
        vm.warp(escrow.getMission(id).deadline);
        _record(id, alice, keccak256("m"));
    }

    function test_record_closedMission() public {
        uint256 id = _create();
        vm.prank(funder);
        escrow.closeMission(id);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, id));
        _record(id, alice, keccak256("m"));
    }

    function test_record_full() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), T1, SPEC);
        _record(id, alice, keccak256("a"));
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionFull.selector, id));
        _record(id, bob, keccak256("b"));
    }

    function test_record_requiresPersonhood() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InsufficientPersonhood.selector, mallory, T1));
        _record(id, mallory, keccak256("m"));
    }

    function test_record_tier2MissionRejectsTier1() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(TIER1_MAX + 1, 1, _deadline(), T1, SPEC);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InsufficientPersonhood.selector, alice, T2));
        _record(id, alice, keccak256("a"));
        _record(id, carol, keccak256("c"));
    }

    function test_record_expiredPersonhood() public {
        uint256 id = _create();
        vm.prank(attester);
        registry.revoke(alice, T1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InsufficientPersonhood.selector, alice, T1));
        _record(id, alice, keccak256("m"));
    }

    function test_record_oneSubmissionPerContributor() public {
        uint256 id = _create();
        _record(id, alice, keccak256("a1"));
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.AlreadySubmitted.selector, id, alice));
        _record(id, alice, keccak256("a2"));
    }

    function test_record_mediaHashGloballyUnique() public {
        uint256 id1 = _create();
        uint256 id2 = _create();
        bytes32 media = keccak256("same");
        _record(id1, alice, media);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MediaHashAlreadyUsed.selector, media));
        _record(id2, bob, media);
    }

    function test_record_misc_reverts() public {
        uint256 id = _create();
        vm.expectRevert(MissionEscrow.ZeroMediaHash.selector);
        _record(id, alice, bytes32(0));
        vm.expectRevert(MissionEscrow.ZeroAddress.selector);
        _record(id, address(0), keccak256("m"));
        vm.prank(attester);
        registry.attest(funder, T1, keccak256("funder"), uint64(block.timestamp + 1 days));
        vm.expectRevert(MissionEscrow.FunderCannotSubmit.selector);
        _record(id, funder, keccak256("m"));
    }

    function test_record_pausedReverts() public {
        uint256 id = _create();
        vm.prank(admin);
        escrow.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _record(id, alice, keccak256("m"));
    }

    // --- approve -----------------------------------------------------------------------------

    function test_approve_byFunderPays() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("m"));
        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionApproved(sid, id, alice);
        vm.prank(funder);
        escrow.approve(sid);

        assertEq(token.balanceOf(alice), REWARD);
        MissionEscrow.Mission memory m = escrow.getMission(id);
        assertEq(m.pending, 0);
        assertEq(m.approved, 1);
        assertEq(uint8(escrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Approved));
        assertEq(escrow.escrowedFor(id), uint256(REWARD) * (SLOTS - 1));
    }

    function test_approve_byVerifierPays() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("m"));
        vm.prank(verifier);
        escrow.approve(sid);
        assertEq(token.balanceOf(alice), REWARD);
    }

    function test_approve_afterReviewWindowStillAllowed() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("m"));
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(funder);
        escrow.approve(sid);
        assertEq(token.balanceOf(alice), REWARD);
    }

    function test_approve_reverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("m"));
        vm.expectRevert(MissionEscrow.NotFunderOrVerifier.selector);
        vm.prank(alice);
        escrow.approve(sid);

        vm.prank(funder);
        escrow.approve(sid);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        vm.prank(funder);
        escrow.approve(sid);

        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, 99));
        vm.prank(funder);
        escrow.approve(99);
    }

    function test_approve_worksWhilePaused() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("m"));
        vm.prank(admin);
        escrow.pause();
        vm.prank(funder);
        escrow.approve(sid);
        assertEq(token.balanceOf(alice), REWARD);
    }

    // --- reject ------------------------------------------------------------------------------

    function test_reject_freesSlot() public {
        vm.prank(funder);
        uint256 id = escrow.createMission(REWARD, 1, _deadline(), T1, SPEC);
        uint256 sid = _record(id, alice, keccak256("a"));

        vm.expectEmit(address(escrow));
        emit MissionEscrow.SubmissionRejected(sid, id, "blurry");
        vm.prank(funder);
        escrow.reject(sid, "blurry");

        assertEq(uint8(escrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Rejected));
        assertEq(escrow.getMission(id).pending, 0);
        assertEq(token.balanceOf(alice), 0);
        // Slot is free for someone else...
        _record(id, bob, keccak256("b"));
        // ...but alice cannot retry and her media hash stays burned.
        assertTrue(escrow.hasSubmitted(id, alice));
        assertTrue(escrow.mediaHashUsed(keccak256("a")));
    }

    function test_reject_byVerifier() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(verifier);
        escrow.reject(sid, "fraud");
        assertEq(uint8(escrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Rejected));
    }

    function test_reject_reverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.expectRevert(MissionEscrow.NotFunderOrVerifier.selector);
        vm.prank(stranger);
        escrow.reject(sid, "");

        vm.warp(block.timestamp + REVIEW + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.ReviewWindowOver.selector, sid));
        vm.prank(funder);
        escrow.reject(sid, "");
    }

    function test_reject_atReviewDeadlineAllowed() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(escrow.getSubmission(sid).reviewDeadline);
        vm.prank(funder);
        escrow.reject(sid, "");
    }

    function test_reject_alreadyResolved() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.approve(sid);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        vm.prank(funder);
        escrow.reject(sid, "");
    }

    // --- finalize ----------------------------------------------------------------------------

    function test_finalize_afterWindowPaysContributor() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(stranger);
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), REWARD);
        assertEq(escrow.getMission(id).approved, 1);
    }

    function test_finalize_duringWindowReverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.warp(block.timestamp + REVIEW);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.ReviewWindowActive.selector, sid));
        escrow.finalize(sid);
    }

    function test_finalize_rejectedReverts() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.reject(sid, "");
        vm.warp(block.timestamp + REVIEW + 1);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotPending.selector, sid));
        escrow.finalize(sid);
    }

    // --- closeMission ------------------------------------------------------------------------

    function test_close_byFunderRefundsUnused() public {
        uint256 id = _create();
        uint256 s1 = _record(id, alice, keccak256("a"));
        _record(id, bob, keccak256("b"));
        vm.prank(funder);
        escrow.approve(s1);

        uint256 before = token.balanceOf(funder);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.MissionClosed(id, REWARD); // 3 slots - 1 approved - 1 pending
        vm.prank(funder);
        escrow.closeMission(id);

        assertEq(token.balanceOf(funder), before + REWARD);
        MissionEscrow.Mission memory m = escrow.getMission(id);
        assertEq(uint8(m.status), uint8(MissionEscrow.MissionStatus.Closed));
        assertEq(m.maxSubmissions, 2);
        assertEq(escrow.escrowedFor(id), REWARD); // bob's pending reward
        assertEq(token.balanceOf(address(escrow)), REWARD);
    }

    function test_close_pendingCanStillBePaid() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.closeMission(id);
        vm.warp(block.timestamp + REVIEW + 1);
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), REWARD);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_close_pendingRejectedRefundsFunder() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.closeMission(id);
        uint256 before = token.balanceOf(funder);
        vm.prank(funder);
        escrow.reject(sid, "");
        assertEq(token.balanceOf(funder), before + REWARD);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(escrow.escrowedFor(id), 0);
    }

    function test_close_byStrangerOnlyAfterDeadline() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.CannotCloseYet.selector, id));
        vm.prank(stranger);
        escrow.closeMission(id);

        uint256 before = token.balanceOf(funder);
        vm.warp(_deadline() + 1);
        vm.prank(stranger);
        escrow.closeMission(id);
        assertEq(token.balanceOf(funder), before + uint256(REWARD) * SLOTS);
        assertEq(token.balanceOf(stranger), 0);
    }

    function test_close_twiceReverts() public {
        uint256 id = _create();
        vm.prank(funder);
        escrow.closeMission(id);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, id));
        vm.prank(funder);
        escrow.closeMission(id);
    }

    function test_close_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MissionNotOpen.selector, 7));
        escrow.closeMission(7);
    }

    function test_close_worksWhilePaused() public {
        uint256 id = _create();
        vm.prank(admin);
        escrow.pause();
        vm.prank(funder);
        escrow.closeMission(id);
    }

    // --- admin -------------------------------------------------------------------------------

    function test_admin_setters() public {
        vm.startPrank(admin);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.Tier1MaxRewardUpdated(1);
        escrow.setTier1MaxReward(1);
        vm.expectEmit(address(escrow));
        emit MissionEscrow.ReviewWindowUpdated(1 days);
        escrow.setReviewWindow(1 days);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.InvalidReviewWindow.selector, 1));
        escrow.setReviewWindow(1);
        vm.stopPrank();
        assertEq(escrow.tier1MaxReward(), 1);
        assertEq(escrow.reviewWindow(), 1 days);
    }

    function test_admin_onlyAdmin() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        escrow.setTier1MaxReward(1);
        vm.expectRevert();
        escrow.setReviewWindow(1 days);
        vm.expectRevert();
        escrow.pause();
        vm.stopPrank();
    }

    function test_reviewWindowChange_doesNotAffectExisting() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        uint64 original = escrow.getSubmission(sid).reviewDeadline;
        vm.prank(admin);
        escrow.setReviewWindow(14 days);
        assertEq(escrow.getSubmission(sid).reviewDeadline, original);
    }

    function test_unpause() public {
        vm.startPrank(admin);
        escrow.pause();
        escrow.unpause();
        vm.stopPrank();
        _create();
    }

    // --- full lifecycle ----------------------------------------------------------------------

    function test_lifecycle_accountingBalances() public {
        uint256 id = _create();
        uint256 s1 = _record(id, alice, keccak256("a"));
        uint256 s2 = _record(id, bob, keccak256("b"));
        uint256 s3 = _record(id, carol, keccak256("c"));

        vm.prank(funder);
        escrow.approve(s1);
        vm.prank(verifier);
        escrow.reject(s2, "off-location");
        vm.warp(block.timestamp + REVIEW + 1);
        escrow.finalize(s3);

        uint256 funderBefore = token.balanceOf(funder);
        vm.prank(funder);
        escrow.closeMission(id);

        assertEq(token.balanceOf(alice), REWARD);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(carol), REWARD);
        assertEq(token.balanceOf(funder), funderBefore + REWARD); // bob's freed slot
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // --- fuzz --------------------------------------------------------------------------------

    function testFuzz_createAndCloseRefundsEverything(uint128 reward, uint32 slots) public {
        reward = uint128(bound(reward, 1, 1_000e6));
        slots = uint32(bound(slots, 1, 1_000));
        uint256 before = token.balanceOf(funder);
        vm.startPrank(funder);
        uint256 id = escrow.createMission(reward, slots, _deadline(), T1, SPEC);
        escrow.closeMission(id);
        vm.stopPrank();
        assertEq(token.balanceOf(funder), before);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzz_tierSelection(uint128 reward, uint8 requested) public {
        reward = uint128(bound(reward, 1, 1_000e6));
        requested = uint8(bound(requested, 0, 2));
        vm.prank(funder);
        uint256 id = escrow.createMission(reward, 1, _deadline(), requested, SPEC);
        uint8 expected = requested < T1 ? T1 : requested;
        if (reward > TIER1_MAX) expected = T2;
        assertEq(escrow.getMission(id).minTier, expected);
    }
}
