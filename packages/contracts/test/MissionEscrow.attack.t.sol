// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {EscrowBase} from "./Base.t.sol";
import {ReentrantERC20} from "./mocks/MockERC20.sol";

/// @notice Adversarial scenarios: reentrancy, privilege abuse, Sybil and replay attempts.
contract MissionEscrowAttackTest is EscrowBase {
    ReentrantERC20 internal rToken;
    MissionEscrow internal rEscrow;

    function setUp() public override {
        super.setUp();
        rToken = new ReentrantERC20();
        rEscrow = new MissionEscrow(_config(IERC20(address(rToken))));
        rToken.mint(funder, 1_000e6);
        vm.prank(funder);
        rToken.approve(address(rEscrow), type(uint256).max);
    }

    // --- reentrancy --------------------------------------------------------------------------

    function _rMission() internal returns (uint256 id, uint256 sid) {
        vm.prank(funder);
        id = rEscrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
        vm.prank(operator);
        sid = rEscrow.recordSubmission(id, alice, keccak256("r-alice"));
    }

    function _expectReentrancyBlocked() internal {
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_reentrancy_acceptIntoAccept() public {
        (, uint256 sid) = _rMission();
        uint256 balBefore = rToken.balanceOf(address(rEscrow));
        rToken.arm(address(rEscrow), abi.encodeCall(MissionEscrow.acceptSubmission, (sid)));
        _expectReentrancyBlocked();
        vm.prank(funder);
        rEscrow.acceptSubmission(sid);
        // whole transaction rolled back: nothing paid, still pending
        assertEq(rToken.balanceOf(alice), 0);
        assertEq(rToken.balanceOf(address(rEscrow)), balBefore);
        assertEq(uint8(rEscrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Pending));
    }

    function test_reentrancy_acceptIntoFinalize() public {
        (, uint256 sid) = _rMission();
        vm.warp(block.timestamp + REVIEW + 1);
        rToken.arm(address(rEscrow), abi.encodeCall(MissionEscrow.finalize, (sid)));
        _expectReentrancyBlocked();
        vm.prank(funder);
        rEscrow.acceptSubmission(sid);
        assertEq(rToken.balanceOf(alice), 0);
    }

    function test_reentrancy_finalizeIntoFinalize() public {
        (, uint256 sid) = _rMission();
        vm.warp(block.timestamp + REVIEW + 1);
        rToken.arm(address(rEscrow), abi.encodeCall(MissionEscrow.finalize, (sid)));
        _expectReentrancyBlocked();
        rEscrow.finalize(sid);
        assertEq(rToken.balanceOf(alice), 0);
    }

    function test_reentrancy_cancelIntoCancel() public {
        (uint256 id,) = _rMission();
        uint256 funderBefore = rToken.balanceOf(funder);
        rToken.arm(address(rEscrow), abi.encodeCall(MissionEscrow.cancelMission, (id)));
        _expectReentrancyBlocked();
        vm.prank(funder);
        rEscrow.cancelMission(id);
        assertEq(rToken.balanceOf(funder), funderBefore);
        assertEq(uint8(rEscrow.getMission(id).status), uint8(MissionEscrow.MissionStatus.Open));
    }

    function test_reentrancy_refundIntoRefund() public {
        (uint256 id,) = _rMission();
        vm.warp(_deadline() + 1);
        rToken.arm(address(rEscrow), abi.encodeCall(MissionEscrow.refund, (id)));
        _expectReentrancyBlocked();
        rEscrow.refund(id);
        assertEq(uint8(rEscrow.getMission(id).status), uint8(MissionEscrow.MissionStatus.Open));
    }

    function test_reentrancy_rejectRefundIntoAccept() public {
        (uint256 id, uint256 sid) = _rMission();
        vm.prank(funder);
        rEscrow.cancelMission(id); // reject will now refund the funder via token.transfer
        rToken.arm(address(rEscrow), abi.encodeCall(MissionEscrow.acceptSubmission, (sid)));
        _expectReentrancyBlocked();
        vm.prank(funder);
        rEscrow.rejectSubmission(sid, "");
        assertEq(uint8(rEscrow.getSubmission(sid).status), uint8(MissionEscrow.SubmissionStatus.Pending));
    }

    function test_reentrancy_tokenWithoutAttackStillWorks() public {
        (, uint256 sid) = _rMission();
        vm.prank(funder);
        rEscrow.acceptSubmission(sid);
        assertEq(rToken.balanceOf(alice), REWARD - _fee(REWARD));
    }

    // --- privilege abuse ---------------------------------------------------------------------

    function test_attack_otherFunderCannotResolve() public {
        address funder2 = makeAddr("funder2");
        _fund(funder2, 100e6);
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder2);
        escrow.createMission(REWARD, 1, _deadline(), T1, SPEC); // funder2 is a funder, just not of `id`

        vm.startPrank(funder2);
        vm.expectRevert(MissionEscrow.NotFunderOrOperator.selector);
        escrow.acceptSubmission(sid);
        vm.expectRevert(MissionEscrow.NotFunderOrOperator.selector);
        escrow.rejectSubmission(sid, "");
        vm.expectRevert(MissionEscrow.NotFunder.selector);
        escrow.cancelMission(id);
        vm.stopPrank();
    }

    function test_attack_funderCannotRecordOwnSubmissions() public {
        uint256 id = _create();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, funder, escrow.OPERATOR_ROLE()
            )
        );
        vm.prank(funder);
        escrow.recordSubmission(id, alice, keccak256("a"));
    }

    function test_attack_operatorCannotPayUnverifiedWallet() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotVerified.selector, mallory, T1));
        _record(id, mallory, keccak256("m"));
    }

    function test_attack_operatorCannotGrantRoles() public {
        bytes32 role = escrow.OPERATOR_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                operator,
                escrow.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(operator);
        escrow.grantRole(role, mallory);
    }

    function test_attack_funderCannotDodgePaymentByCancelling() public {
        uint256 id = _create();
        uint256 sid = _record(id, alice, keccak256("a"));
        vm.prank(funder);
        escrow.cancelMission(id);
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(alice);
        escrow.finalize(sid);
        assertEq(token.balanceOf(alice), REWARD - _fee(REWARD));
    }

    // --- Sybil / replay ----------------------------------------------------------------------

    function test_attack_sybilSecondWalletStaysUnverified() public {
        // alice tries to bind her passport nullifier to a second wallet
        address aliceAlt = makeAddr("aliceAlt");
        vm.expectRevert(
            abi.encodeWithSelector(
                PersonhoodRegistry.NullifierBoundToOtherWallet.selector, keccak256("alice"), alice
            )
        );
        vm.prank(attester);
        registry.attest(aliceAlt, PersonhoodRegistry.Provider.HumanPassport, keccak256("alice"), _deadline());

        uint256 id = _create();
        _record(id, alice, keccak256("a"));
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.NotVerified.selector, aliceAlt, T1));
        _record(id, aliceAlt, keccak256("a2"));
    }

    function test_attack_mediaReplayAfterRejection() public {
        uint256 id = _create();
        bytes32 media = keccak256("same-video");
        uint256 sid = _record(id, alice, media);
        vm.prank(funder);
        escrow.rejectSubmission(sid, "");
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MediaHashAlreadyUsed.selector, media));
        _record(id, bob, media);
    }

    function test_attack_mediaReplayAcrossMissions() public {
        uint256 id1 = _create();
        uint256 id2 = _create();
        bytes32 media = keccak256("same-photo");
        _record(id1, alice, media);
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.MediaHashAlreadyUsed.selector, media));
        _record(id2, alice, media);
    }
}
