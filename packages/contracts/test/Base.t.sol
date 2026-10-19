// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Shared deployment + actors for escrow tests.
abstract contract EscrowBase is Test {
    MockERC20 internal token;
    PersonhoodRegistry internal registry;
    MissionEscrow internal escrow;

    address internal admin = makeAddr("admin");
    address internal attester = makeAddr("attester");
    address internal operator = makeAddr("operator");
    address internal pauser = makeAddr("pauser");
    address internal treasury = makeAddr("treasury");
    address internal funder = makeAddr("funder");
    address internal alice = makeAddr("alice"); // tier 1
    address internal bob = makeAddr("bob"); // tier 1
    address internal carol = makeAddr("carol"); // tier 2
    address internal mallory = makeAddr("mallory"); // unverified
    address internal stranger = makeAddr("stranger");

    uint48 internal constant ADMIN_DELAY = 2 days;
    uint16 internal constant FEE_BPS = 500; // 5%
    uint128 internal constant TIER1_MAX = 5e6; // 5 USD (6 decimals)
    uint64 internal constant REVIEW = 3 days;
    uint128 internal constant REWARD = 2e6;
    uint32 internal constant SLOTS = 3;
    bytes32 internal constant SPEC = keccak256("spec");

    uint8 internal constant T1 = 1;
    uint8 internal constant T2 = 2;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        token = new MockERC20();
        registry = new PersonhoodRegistry(admin, ADMIN_DELAY, attester);
        escrow = new MissionEscrow(_config(IERC20(address(token))));

        uint64 exp = uint64(block.timestamp + 365 days);
        vm.startPrank(attester);
        registry.attest(alice, PersonhoodRegistry.Provider.HumanPassport, keccak256("alice"), exp);
        registry.attest(bob, PersonhoodRegistry.Provider.HumanPassport, keccak256("bob"), exp);
        registry.attest(carol, PersonhoodRegistry.Provider.Self, keccak256("carol"), exp);
        vm.stopPrank();

        _fund(funder, 1_000_000e6);
    }

    function _config(IERC20 t) internal view returns (MissionEscrow.Config memory) {
        return MissionEscrow.Config({
            rewardToken: t,
            registry: registry,
            admin: admin,
            adminDelay: ADMIN_DELAY,
            operator: operator,
            pauser: pauser,
            treasury: treasury,
            feeBps: FEE_BPS,
            tier1MaxReward: TIER1_MAX,
            reviewWindow: REVIEW
        });
    }

    function _fund(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(escrow), type(uint256).max);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function _create() internal returns (uint256) {
        vm.prank(funder);
        return escrow.createMission(REWARD, SLOTS, _deadline(), T1, SPEC);
    }

    function _record(uint256 missionId, address who, bytes32 media) internal returns (uint256) {
        vm.prank(operator);
        return escrow.recordSubmission(missionId, who, media);
    }

    function _fee(uint256 reward) internal pure returns (uint256) {
        return (reward * FEE_BPS) / 10_000;
    }
}
