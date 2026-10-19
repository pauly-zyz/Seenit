// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/// @title PersonhoodRegistry
/// @notice On-chain record of proof-of-personhood checks done off-chain by the Seenit backend.
/// @dev Each provider maps to a fixed tier:
///        - HumanPassport (Unique Humanity Score)      -> Tier 1, low-value missions
///        - Self (NFC passport + zero-knowledge proof) -> Tier 2, all missions
///      A wallet can hold one attestation per provider. Every nullifier is bound to exactly one
///      wallet, permanently: revoking an attestation does not free its nullifier, so a banned
///      identity cannot re-register under a new wallet.
contract PersonhoodRegistry is AccessControlDefaultAdminRules {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    uint8 public constant TIER_NONE = 0;
    uint8 public constant TIER_PASSPORT = 1;
    uint8 public constant TIER_SELF = 2;
    uint8 public constant MAX_TIER = TIER_SELF;

    enum Provider {
        None,
        HumanPassport,
        Self
    }

    struct Attestation {
        bytes32 nullifier;
        uint64 attestedAt;
        uint64 expiresAt;
        bool revoked;
    }

    mapping(address wallet => mapping(Provider provider => Attestation)) private _attestations;

    /// @notice nullifier => wallet it is permanently bound to.
    mapping(bytes32 nullifier => address wallet) public nullifierOwner;

    event Attested(
        address indexed wallet,
        Provider indexed provider,
        uint8 tier,
        bytes32 indexed nullifier,
        uint64 expiresAt
    );
    event Revoked(
        address indexed wallet, Provider indexed provider, bytes32 indexed nullifier, bytes32 reason
    );

    error ZeroAddress();
    error InvalidProvider();
    error ZeroNullifier();
    error ExpiryInPast(uint64 expiresAt);
    error NullifierBoundToOtherWallet(bytes32 nullifier, address boundTo);
    error ProviderHasDifferentNullifier(address wallet, Provider provider, bytes32 existing);
    error AttestationRevoked(address wallet, Provider provider);
    error NoAttestation(address wallet, Provider provider);

    /// @param adminDelay Delay for transferring the admin role (2-step, see AccessControlDefaultAdminRules).
    constructor(address admin, uint48 adminDelay, address attester)
        AccessControlDefaultAdminRules(adminDelay, admin)
    {
        if (attester == address(0)) revert ZeroAddress();
        _grantRole(ATTESTER_ROLE, attester);
    }

    // ---------------------------------------------------------------------------------------------
    // Attester actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Record (or renew) a personhood attestation for `wallet` from `provider`.
    /// @param nullifier Provider-specific unique identity hash. Must not be bound to another wallet.
    /// @param expiresAt Unix time after which the attestation no longer counts.
    function attest(address wallet, Provider provider, bytes32 nullifier, uint64 expiresAt)
        external
        onlyRole(ATTESTER_ROLE)
    {
        if (wallet == address(0)) revert ZeroAddress();
        if (provider == Provider.None) revert InvalidProvider();
        if (nullifier == bytes32(0)) revert ZeroNullifier();
        if (expiresAt <= block.timestamp) revert ExpiryInPast(expiresAt);

        address boundTo = nullifierOwner[nullifier];
        if (boundTo != address(0) && boundTo != wallet) {
            revert NullifierBoundToOtherWallet(nullifier, boundTo);
        }

        Attestation storage a = _attestations[wallet][provider];
        if (a.revoked) revert AttestationRevoked(wallet, provider);
        if (a.nullifier != bytes32(0) && a.nullifier != nullifier) {
            revert ProviderHasDifferentNullifier(wallet, provider, a.nullifier);
        }

        nullifierOwner[nullifier] = wallet;
        a.nullifier = nullifier;
        a.attestedAt = uint64(block.timestamp);
        a.expiresAt = expiresAt;

        emit Attested(wallet, provider, tierForProvider(provider), nullifier, expiresAt);
    }

    /// @notice Revoke an attestation (e.g. after fraud). The nullifier stays bound to the wallet.
    function revoke(address wallet, Provider provider, bytes32 reason) external onlyRole(ATTESTER_ROLE) {
        if (provider == Provider.None) revert InvalidProvider();
        Attestation storage a = _attestations[wallet][provider];
        if (a.nullifier == bytes32(0)) revert NoAttestation(wallet, provider);
        if (a.revoked) revert AttestationRevoked(wallet, provider);
        a.revoked = true;
        emit Revoked(wallet, provider, a.nullifier, reason);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice True when `wallet` holds a valid attestation at `minTier` or above.
    function isVerified(address wallet, uint8 minTier) external view returns (bool) {
        if (minTier == TIER_NONE) return true;
        return tierOf(wallet) >= minTier;
    }

    /// @notice Highest tier `wallet` currently holds (0 if none). An expired or revoked
    ///         attestation from one provider does not hide a valid one from another.
    function tierOf(address wallet) public view returns (uint8) {
        if (_isValid(_attestations[wallet][Provider.Self])) return TIER_SELF;
        if (_isValid(_attestations[wallet][Provider.HumanPassport])) return TIER_PASSPORT;
        return TIER_NONE;
    }

    function getAttestation(address wallet, Provider provider) external view returns (Attestation memory) {
        return _attestations[wallet][provider];
    }

    function tierForProvider(Provider provider) public pure returns (uint8) {
        if (provider == Provider.Self) return TIER_SELF;
        if (provider == Provider.HumanPassport) return TIER_PASSPORT;
        return TIER_NONE;
    }

    function _isValid(Attestation storage a) private view returns (bool) {
        return a.nullifier != bytes32(0) && !a.revoked && a.expiresAt > block.timestamp;
    }
}
