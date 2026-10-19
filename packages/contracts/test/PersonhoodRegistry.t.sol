// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    IAccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/IAccessControlDefaultAdminRules.sol";

import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";

contract PersonhoodRegistryTest is Test {
    PersonhoodRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal attester = makeAddr("attester");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    PersonhoodRegistry.Provider internal constant NONE = PersonhoodRegistry.Provider.None;
    PersonhoodRegistry.Provider internal constant PASSPORT = PersonhoodRegistry.Provider.HumanPassport;
    PersonhoodRegistry.Provider internal constant SELF = PersonhoodRegistry.Provider.Self;

    bytes32 internal constant N_PASSPORT = keccak256("passport-alice");
    bytes32 internal constant N_SELF = keccak256("self-alice");
    uint48 internal constant DELAY = 2 days;

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new PersonhoodRegistry(admin, DELAY, attester);
    }

    function _exp() internal view returns (uint64) {
        return uint64(block.timestamp + 365 days);
    }

    function _unauthorized(address who) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, who, registry.ATTESTER_ROLE()
        );
    }

    // --- constructor -------------------------------------------------------------------------

    function test_constructor_setsRoles() public view {
        assertEq(registry.defaultAdmin(), admin);
        assertEq(registry.defaultAdminDelay(), DELAY);
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), attester));
        assertFalse(registry.hasRole(registry.ATTESTER_ROLE(), admin));
    }

    function test_constructor_revertsOnZeroAttester() public {
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        new PersonhoodRegistry(admin, DELAY, address(0));
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlInvalidDefaultAdmin.selector, address(0)
            )
        );
        new PersonhoodRegistry(address(0), DELAY, attester);
    }

    // --- attest ------------------------------------------------------------------------------

    function test_attest_passportGivesTier1() public {
        uint64 exp = _exp();
        vm.expectEmit(address(registry));
        emit PersonhoodRegistry.Attested(alice, PASSPORT, 1, N_PASSPORT, exp);
        vm.prank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, exp);

        assertEq(registry.tierOf(alice), 1);
        assertTrue(registry.isVerified(alice, 1));
        assertFalse(registry.isVerified(alice, 2));
        assertEq(registry.nullifierOwner(N_PASSPORT), alice);

        PersonhoodRegistry.Attestation memory a = registry.getAttestation(alice, PASSPORT);
        assertEq(a.nullifier, N_PASSPORT);
        assertEq(a.expiresAt, exp);
        assertEq(a.attestedAt, block.timestamp);
        assertFalse(a.revoked);
    }

    function test_attest_selfGivesTier2() public {
        vm.prank(attester);
        registry.attest(alice, SELF, N_SELF, _exp());
        assertEq(registry.tierOf(alice), 2);
        assertTrue(registry.isVerified(alice, 1));
        assertTrue(registry.isVerified(alice, 2));
    }

    function test_attest_bothProviders() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        registry.attest(alice, SELF, N_SELF, _exp());
        vm.stopPrank();
        assertEq(registry.tierOf(alice), 2);
        assertEq(registry.nullifierOwner(N_PASSPORT), alice);
        assertEq(registry.nullifierOwner(N_SELF), alice);
    }

    function test_attest_renewSameNullifier() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.warp(block.timestamp + 10 days);
        uint64 later = uint64(block.timestamp + 730 days);
        registry.attest(alice, PASSPORT, N_PASSPORT, later);
        vm.stopPrank();
        PersonhoodRegistry.Attestation memory a = registry.getAttestation(alice, PASSPORT);
        assertEq(a.expiresAt, later);
        assertEq(a.attestedAt, block.timestamp);
    }

    function test_attest_reverts_onBadInput() public {
        vm.startPrank(attester);
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        registry.attest(address(0), PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(PersonhoodRegistry.InvalidProvider.selector);
        registry.attest(alice, NONE, N_PASSPORT, _exp());
        vm.expectRevert(PersonhoodRegistry.ZeroNullifier.selector);
        registry.attest(alice, PASSPORT, bytes32(0), _exp());
        uint64 now_ = uint64(block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.ExpiryInPast.selector, now_));
        registry.attest(alice, PASSPORT, N_PASSPORT, now_);
        vm.stopPrank();
    }

    function test_attest_withoutRole_reverts() public {
        vm.expectRevert(_unauthorized(admin));
        vm.prank(admin);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(_unauthorized(alice));
        vm.prank(alice);
        registry.attest(alice, SELF, N_SELF, _exp());
    }

    // --- double nullifier (anti-Sybil) -------------------------------------------------------

    function test_doubleNullifier_otherWalletRejected() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherWallet.selector, N_PASSPORT, alice)
        );
        registry.attest(bob, PASSPORT, N_PASSPORT, _exp());
        vm.stopPrank();
    }

    function test_doubleNullifier_otherWalletOtherProviderRejected() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherWallet.selector, N_PASSPORT, alice)
        );
        registry.attest(bob, SELF, N_PASSPORT, _exp());
        vm.stopPrank();
    }

    function test_doubleNullifier_walletCannotSwapNullifierForProvider() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        bytes32 other = keccak256("other");
        vm.expectRevert(
            abi.encodeWithSelector(
                PersonhoodRegistry.ProviderHasDifferentNullifier.selector, alice, PASSPORT, N_PASSPORT
            )
        );
        registry.attest(alice, PASSPORT, other, _exp());
        vm.stopPrank();
        assertEq(registry.nullifierOwner(other), address(0));
    }

    function test_doubleNullifier_revokedIdentityCannotMoveWallet() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        registry.revoke(alice, PASSPORT, "fraud");
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherWallet.selector, N_PASSPORT, alice)
        );
        registry.attest(bob, PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.AttestationRevoked.selector, alice, PASSPORT)
        );
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.stopPrank();
    }

    function testFuzz_nullifierBindsToOneWallet(
        address a,
        address b,
        bytes32 n,
        bool providerA,
        bool providerB
    ) public {
        vm.assume(a != address(0) && b != address(0) && a != b && n != bytes32(0));
        PersonhoodRegistry.Provider pa = providerA ? SELF : PASSPORT;
        PersonhoodRegistry.Provider pb = providerB ? SELF : PASSPORT;
        vm.startPrank(attester);
        registry.attest(a, pa, n, _exp());
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.NullifierBoundToOtherWallet.selector, n, a));
        registry.attest(b, pb, n, _exp());
        vm.stopPrank();
        assertEq(registry.nullifierOwner(n), a);
        assertEq(registry.tierOf(b), 0);
    }

    // --- expiry ------------------------------------------------------------------------------

    function test_expired_doesNotCount() public {
        vm.prank(attester);
        registry.attest(alice, SELF, N_SELF, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 1 days);
        assertEq(registry.tierOf(alice), 0);
        assertFalse(registry.isVerified(alice, 1));
    }

    function test_expiredSelf_fallsBackToPassport() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, uint64(block.timestamp + 10 days));
        registry.attest(alice, SELF, N_SELF, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        vm.warp(block.timestamp + 2 days);
        assertEq(registry.tierOf(alice), 1);
        assertTrue(registry.isVerified(alice, 1));
        assertFalse(registry.isVerified(alice, 2));
    }

    function testFuzz_expiryBoundary(uint32 ttl) public {
        vm.assume(ttl > 0);
        vm.prank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, uint64(block.timestamp) + ttl);
        vm.warp(block.timestamp + ttl - 1);
        assertTrue(registry.isVerified(alice, 1));
        vm.warp(block.timestamp + 1);
        assertFalse(registry.isVerified(alice, 1));
    }

    function test_isVerified_minTierZeroAlwaysTrue() public view {
        assertTrue(registry.isVerified(bob, 0));
    }

    function testFuzz_isVerified_unknownWallet(address w, uint8 minTier) public view {
        vm.assume(minTier > 0);
        assertFalse(registry.isVerified(w, minTier));
    }

    // --- revoke ------------------------------------------------------------------------------

    function test_revoke() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.expectEmit(address(registry));
        emit PersonhoodRegistry.Revoked(alice, PASSPORT, N_PASSPORT, "fraud");
        registry.revoke(alice, PASSPORT, "fraud");
        vm.stopPrank();
        assertEq(registry.tierOf(alice), 0);
        assertTrue(registry.getAttestation(alice, PASSPORT).revoked);
        assertEq(registry.nullifierOwner(N_PASSPORT), alice);
    }

    function test_revokeSelf_keepsPassport() public {
        vm.startPrank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        registry.attest(alice, SELF, N_SELF, _exp());
        registry.revoke(alice, SELF, "");
        vm.stopPrank();
        assertEq(registry.tierOf(alice), 1);
    }

    function test_revoke_reverts() public {
        vm.startPrank(attester);
        vm.expectRevert(PersonhoodRegistry.InvalidProvider.selector);
        registry.revoke(alice, NONE, "");
        vm.expectRevert(abi.encodeWithSelector(PersonhoodRegistry.NoAttestation.selector, alice, PASSPORT));
        registry.revoke(alice, PASSPORT, "");
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        registry.revoke(alice, PASSPORT, "");
        vm.expectRevert(
            abi.encodeWithSelector(PersonhoodRegistry.AttestationRevoked.selector, alice, PASSPORT)
        );
        registry.revoke(alice, PASSPORT, "");
        vm.stopPrank();
    }

    function test_revoke_withoutRole_reverts() public {
        vm.prank(attester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(_unauthorized(alice));
        vm.prank(alice);
        registry.revoke(alice, PASSPORT, "");
    }

    // --- views -------------------------------------------------------------------------------

    function test_tierForProvider() public view {
        assertEq(registry.tierForProvider(NONE), 0);
        assertEq(registry.tierForProvider(PASSPORT), 1);
        assertEq(registry.tierForProvider(SELF), 2);
    }

    // --- admin -------------------------------------------------------------------------------

    function test_admin_rotatesAttester() public {
        address newAttester = makeAddr("newAttester");
        bytes32 role = registry.ATTESTER_ROLE();
        vm.startPrank(admin);
        registry.grantRole(role, newAttester);
        registry.revokeRole(role, attester);
        vm.stopPrank();

        vm.prank(newAttester);
        registry.attest(alice, PASSPORT, N_PASSPORT, _exp());
        vm.expectRevert(_unauthorized(attester));
        vm.prank(attester);
        registry.attest(bob, PASSPORT, keccak256("bob"), _exp());
    }

    function test_admin_nonAdminCannotGrantAttester() public {
        bytes32 role = registry.ATTESTER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                attester,
                registry.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(attester);
        registry.grantRole(role, attester);
    }

    function test_admin_twoStepTransfer() public {
        address newAdmin = makeAddr("newAdmin");
        vm.prank(admin);
        registry.beginDefaultAdminTransfer(newAdmin);

        vm.prank(newAdmin);
        vm.expectRevert();
        registry.acceptDefaultAdminTransfer(); // delay not passed

        vm.warp(block.timestamp + DELAY + 1);
        vm.prank(newAdmin);
        registry.acceptDefaultAdminTransfer();
        assertEq(registry.defaultAdmin(), newAdmin);
    }
}
