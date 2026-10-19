// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";

contract PersonhoodRegistryTest is Test {
    PersonhoodRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal attester = makeAddr("attester");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    bytes32 internal constant N1 = keccak256("passport-nullifier-alice");
    bytes32 internal constant N2 = keccak256("self-nullifier-alice");

    uint8 internal constant T1 = 1;
    uint8 internal constant T2 = 2;

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new PersonhoodRegistry(admin, attester);
    }

    function _expiry() internal view returns (uint64) {
        return uint64(block.timestamp + 365 days);
    }

    // --- constructor -------------------------------------------------------------------------

    function test_constructor_setsRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), attester));
        assertFalse(registry.hasRole(registry.ATTESTER_ROLE(), admin));
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        new PersonhoodRegistry(address(0), attester);
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        new PersonhoodRegistry(admin, address(0));
    }

    // --- attest ------------------------------------------------------------------------------

    function test_attest_tier1() public {
        uint64 exp = _expiry();
        vm.expectEmit(address(registry));
        emit PersonhoodRegistry.Attested(alice, T1, N1, exp);
        vm.prank(attester);
        registry.attest(alice, T1, N1, exp);

        assertEq(registry.tierOf(alice), T1);
        assertTrue(registry.hasTier(alice, T1));
        assertFalse(registry.hasTier(alice, T2));
        assertEq(registry.nullifierOwner(N1), alice);
        PersonhoodRegistry.Attestation memory a = registry.attestationOf(alice, T1);
        assertEq(a.nullifier, N1);
        assertEq(a.expiresAt, exp);
        assertFalse(a.revoked);
    }

    function test_attest_bothTiers_highestWins() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, _expiry());
        registry.attest(alice, T2, N2, _expiry());
        vm.stopPrank();
        assertEq(registry.tierOf(alice), T2);
        assertTrue(registry.hasTier(alice, T1));
    }

    function test_attest_renewSameNullifier() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, _expiry());
        uint64 later = uint64(block.timestamp + 730 days);
        registry.attest(alice, T1, N1, later);
        vm.stopPrank();
        assertEq(registry.attestationOf(alice, T1).expiresAt, later);
    }

    function test_attest_onlyAttester() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, registry.ATTESTER_ROLE()
            )
        );
        vm.prank(alice);
        registry.attest(alice, T1, N1, _expiry());
    }

    function test_attest_revertsOnInvalidTier() public {
        vm.startPrank(attester);
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.InvalidTier.selector, 0));
        registry.attest(alice, 0, N1, _expiry());
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.InvalidTier.selector, 3));
        registry.attest(alice, 3, N1, _expiry());
        vm.stopPrank();
    }

    function test_attest_revertsOnZeroInputs() public {
        vm.startPrank(attester);
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        registry.attest(address(0), T1, N1, _expiry());
        vm.expectRevert(PersonhoodRegistry.ZeroNullifier.selector);
        registry.attest(alice, T1, bytes32(0), _expiry());
        vm.stopPrank();
    }

    function test_attest_revertsOnPastExpiry() public {
        uint64 now_ = uint64(block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.ExpiryInPast.selector, now_));
        vm.prank(attester);
        registry.attest(alice, T1, N1, now_);
    }

    /// One identity, one account: the core anti-Sybil rule.
    function test_attest_nullifierCannotBindToSecondAccount() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, _expiry());
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherAccount.selector, N1, alice)
        );
        registry.attest(bob, T1, N1, _expiry());
        vm.stopPrank();
    }

    function test_attest_accountCannotSwapNullifierWithinTier() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, _expiry());
        bytes32 other = keccak256("other");
        vm.expectRevert(
            abi.encodeWithSelector(
                PersonhoodRegistry.TierAlreadyHasDifferentNullifier.selector, alice, T1, N1
            )
        );
        registry.attest(alice, T1, other, _expiry());
        vm.stopPrank();
    }

    // --- expiry ------------------------------------------------------------------------------

    function test_expiredAttestation_doesNotCount() public {
        vm.prank(attester);
        registry.attest(alice, T2, N2, uint64(block.timestamp + 1 days));
        assertEq(registry.tierOf(alice), T2);
        vm.warp(block.timestamp + 1 days);
        assertEq(registry.tierOf(alice), 0);
        assertFalse(registry.hasTier(alice, T1));
    }

    function test_expiredTier2_fallsBackToTier1() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, uint64(block.timestamp + 10 days));
        registry.attest(alice, T2, N2, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        vm.warp(block.timestamp + 2 days);
        assertEq(registry.tierOf(alice), T1);
    }

    function test_hasTier_zeroAlwaysTrue() public view {
        assertTrue(registry.hasTier(bob, 0));
    }

    // --- revoke ------------------------------------------------------------------------------

    function test_revoke() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, _expiry());
        vm.expectEmit(address(registry));
        emit PersonhoodRegistry.Revoked(alice, T1, N1);
        registry.revoke(alice, T1);
        vm.stopPrank();
        assertEq(registry.tierOf(alice), 0);
        assertTrue(registry.attestationOf(alice, T1).revoked);
    }

    function test_revoke_nullifierStaysBurned() public {
        vm.startPrank(attester);
        registry.attest(alice, T1, N1, _expiry());
        registry.revoke(alice, T1);

        // Same identity cannot move to a fresh wallet...
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherAccount.selector, N1, alice)
        );
        registry.attest(bob, T1, N1, _expiry());
        // ...nor be re-attested on the banned account.
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.AttestationRevoked.selector, alice, T1));
        registry.attest(alice, T1, N1, _expiry());
        vm.stopPrank();
    }

    function test_revoke_reverts() public {
        vm.startPrank(attester);
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.NoAttestation.selector, alice, T1));
        registry.revoke(alice, T1);
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.InvalidTier.selector, 0));
        registry.revoke(alice, 0);
        registry.attest(alice, T1, N1, _expiry());
        registry.revoke(alice, T1);
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.AttestationRevoked.selector, alice, T1));
        registry.revoke(alice, T1);
        vm.stopPrank();
    }

    function test_revoke_onlyAttester() public {
        vm.prank(attester);
        registry.attest(alice, T1, N1, _expiry());
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, registry.ATTESTER_ROLE()
            )
        );
        vm.prank(admin);
        registry.revoke(alice, T1);
    }

    function test_adminCanRotateAttester() public {
        address newAttester = makeAddr("newAttester");
        vm.startPrank(admin);
        registry.grantRole(registry.ATTESTER_ROLE(), newAttester);
        registry.revokeRole(registry.ATTESTER_ROLE(), attester);
        vm.stopPrank();

        vm.prank(newAttester);
        registry.attest(alice, T1, N1, _expiry());

        vm.expectRevert();
        vm.prank(attester);
        registry.attest(bob, T1, keccak256("bob"), _expiry());
    }

    // --- fuzz --------------------------------------------------------------------------------

    function testFuzz_nullifierUniqueAcrossAccounts(address a, address b, bytes32 n) public {
        vm.assume(a != address(0) && b != address(0) && a != b && n != bytes32(0));
        vm.startPrank(attester);
        registry.attest(a, T1, n, _expiry());
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherAccount.selector, n, a)
        );
        registry.attest(b, T2, n, _expiry());
        vm.stopPrank();
        assertEq(registry.nullifierOwner(n), a);
    }

    function testFuzz_expiryBoundary(uint32 ttl) public {
        vm.assume(ttl > 0);
        vm.prank(attester);
        registry.attest(alice, T1, N1, uint64(block.timestamp) + ttl);
        vm.warp(block.timestamp + ttl - 1);
        assertEq(registry.tierOf(alice), T1);
        vm.warp(block.timestamp + 1);
        assertEq(registry.tierOf(alice), 0);
    }
}
