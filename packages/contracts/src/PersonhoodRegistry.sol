// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PersonhoodRegistry
/// @notice On-chain record of proof-of-personhood checks done off-chain by the Seenit backend.
/// @dev Tier 1 = Human Passport (Unique Humanity Score), Tier 2 = Self Protocol (NFC passport + ZK).
///      Each identity nullifier can be bound to exactly one account, forever. Revoking an
///      attestation does not free its nullifier, so a banned identity cannot re-register
///      under a new wallet.
contract PersonhoodRegistry is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    uint8 public constant TIER_NONE = 0;
    uint8 public constant TIER_PASSPORT = 1;
    uint8 public constant TIER_SELF = 2;
    uint8 public constant MAX_TIER = TIER_SELF;

    struct Attestation {
        bytes32 nullifier;
        uint64 expiresAt;
        bool revoked;
    }

    /// @notice account => tier => attestation
    mapping(address account => mapping(uint8 tier => Attestation)) private _attestations;

    /// @notice nullifier => account it is permanently bound to
    mapping(bytes32 nullifier => address account) public nullifierOwner;

    event Attested(address indexed account, uint8 indexed tier, bytes32 indexed nullifier, uint64 expiresAt);
    event Revoked(address indexed account, uint8 indexed tier, bytes32 indexed nullifier);

    error InvalidTier(uint8 tier);
    error ZeroAddress();
    error ZeroNullifier();
    error ExpiryInPast(uint64 expiresAt);
    error NullifierBoundToOtherAccount(bytes32 nullifier, address boundTo);
    error TierAlreadyHasDifferentNullifier(address account, uint8 tier, bytes32 existing);
    error AttestationRevoked(address account, uint8 tier);
    error NoAttestation(address account, uint8 tier);

    constructor(address admin, address attester) {
        if (admin == address(0) || attester == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, attester);
    }

    /// @notice Record (or renew) a personhood attestation for `account` at `tier`.
    /// @param nullifier Provider-specific unique identity hash. Must never have been used by another account.
    /// @param expiresAt Unix time after which the attestation no longer counts.
    function attest(address account, uint8 tier, bytes32 nullifier, uint64 expiresAt)
        external
        onlyRole(ATTESTER_ROLE)
    {
        if (account == address(0)) revert ZeroAddress();
        if (tier == TIER_NONE || tier > MAX_TIER) revert InvalidTier(tier);
        if (nullifier == bytes32(0)) revert ZeroNullifier();
        if (expiresAt <= block.timestamp) revert ExpiryInPast(expiresAt);

        address boundTo = nullifierOwner[nullifier];
        if (boundTo != address(0) && boundTo != account) {
            revert NullifierBoundToOtherAccount(nullifier, boundTo);
        }

        Attestation storage a = _attestations[account][tier];
        if (a.revoked) revert AttestationRevoked(account, tier);
        if (a.nullifier != bytes32(0) && a.nullifier != nullifier) {
            revert TierAlreadyHasDifferentNullifier(account, tier, a.nullifier);
        }

        nullifierOwner[nullifier] = account;
        a.nullifier = nullifier;
        a.expiresAt = expiresAt;

        emit Attested(account, tier, nullifier, expiresAt);
    }

    /// @notice Revoke an attestation (e.g. after fraud). The nullifier stays bound to the account.
    function revoke(address account, uint8 tier) external onlyRole(ATTESTER_ROLE) {
        if (tier == TIER_NONE || tier > MAX_TIER) revert InvalidTier(tier);
        Attestation storage a = _attestations[account][tier];
        if (a.nullifier == bytes32(0)) revert NoAttestation(account, tier);
        if (a.revoked) revert AttestationRevoked(account, tier);
        a.revoked = true;
        emit Revoked(account, tier, a.nullifier);
    }

    /// @notice Highest tier `account` currently holds (0 if none). A revoked tier at any level
    ///         does not hide a valid tier at another level.
    function tierOf(address account) public view returns (uint8) {
        for (uint8 tier = MAX_TIER; tier > TIER_NONE; --tier) {
            if (_isValid(_attestations[account][tier])) return tier;
        }
        return TIER_NONE;
    }

    /// @notice True when `account` holds a valid attestation at `minTier` or above.
    function hasTier(address account, uint8 minTier) external view returns (bool) {
        if (minTier == TIER_NONE) return true;
        return tierOf(account) >= minTier;
    }

    function attestationOf(address account, uint8 tier) external view returns (Attestation memory) {
        return _attestations[account][tier];
    }

    function _isValid(Attestation storage a) private view returns (bool) {
        return a.nullifier != bytes32(0) && !a.revoked && a.expiresAt > block.timestamp;
    }
}
