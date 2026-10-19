// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {PersonhoodRegistry} from "./PersonhoodRegistry.sol";

/// @title MissionEscrow
/// @notice Holds stablecoin rewards for Seenit real-world missions and pays verified contributors.
/// @dev Flow:
///      1. A funder (AI agent wallet or human) calls `createMission`, escrowing reward * maxSubmissions.
///      2. After off-chain checks (in-app capture, GPS, timestamp, AI vision), the backend VERIFIER
///         calls `recordSubmission`, anchoring the media hash on-chain and reserving one slot.
///      3. The funder or verifier can `approve` (pay now) or `reject` (free the slot) the submission
///         until its review deadline. After that, anyone can `finalize` it and the contributor is paid,
///         so an unresponsive funder cannot hold a contributor's reward hostage.
///      4. The funder can `closeMission` at any time; anyone can close it after the deadline.
///         Unused slots are refunded to the funder.
contract MissionEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint64 public constant MIN_REVIEW_WINDOW = 1 hours;
    uint64 public constant MAX_REVIEW_WINDOW = 14 days;

    enum MissionStatus {
        None,
        Open,
        Closed
    }

    enum SubmissionStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    struct Mission {
        address funder;
        uint8 minTier;
        MissionStatus status;
        uint64 deadline;
        uint32 maxSubmissions;
        uint32 pending;
        uint32 approved;
        uint128 reward;
        /// @dev Hash of the off-chain mission spec (location, radius, instructions, output schema).
        bytes32 specHash;
    }

    struct Submission {
        uint256 missionId;
        address contributor;
        SubmissionStatus status;
        uint64 reviewDeadline;
        bytes32 mediaHash;
    }

    IERC20 public immutable rewardToken;
    PersonhoodRegistry public immutable registry;

    /// @notice Missions paying more than this per submission need Tier 2 (Self Protocol).
    uint128 public tier1MaxReward;
    /// @notice Time the funder has to reject a recorded submission before it can be finalized.
    uint64 public reviewWindow;

    uint256 public nextMissionId = 1;
    uint256 public nextSubmissionId = 1;

    mapping(uint256 missionId => Mission) private _missions;
    mapping(uint256 submissionId => Submission) private _submissions;
    mapping(uint256 missionId => mapping(address contributor => bool)) public hasSubmitted;
    mapping(bytes32 mediaHash => bool) public mediaHashUsed;

    event MissionCreated(
        uint256 indexed missionId,
        address indexed funder,
        uint128 reward,
        uint32 maxSubmissions,
        uint64 deadline,
        uint8 minTier,
        bytes32 specHash
    );
    event MissionClosed(uint256 indexed missionId, uint256 refund);
    event SubmissionRecorded(
        uint256 indexed submissionId,
        uint256 indexed missionId,
        address indexed contributor,
        bytes32 mediaHash,
        uint64 reviewDeadline
    );
    event SubmissionApproved(
        uint256 indexed submissionId, uint256 indexed missionId, address indexed contributor
    );
    event SubmissionRejected(uint256 indexed submissionId, uint256 indexed missionId, bytes32 reason);
    event Tier1MaxRewardUpdated(uint128 value);
    event ReviewWindowUpdated(uint64 value);

    error ZeroAddress();
    error ZeroReward();
    error ZeroSubmissions();
    error DeadlineInPast(uint64 deadline);
    error InvalidTier(uint8 tier);
    error TransferShortfall(uint256 expected, uint256 received);
    error MissionNotOpen(uint256 missionId);
    error MissionExpired(uint256 missionId);
    error MissionFull(uint256 missionId);
    error UnknownMission(uint256 missionId);
    error InsufficientPersonhood(address contributor, uint8 required);
    error AlreadySubmitted(uint256 missionId, address contributor);
    error MediaHashAlreadyUsed(bytes32 mediaHash);
    error ZeroMediaHash();
    error FunderCannotSubmit();
    error NotPending(uint256 submissionId);
    error NotFunderOrVerifier();
    error ReviewWindowOver(uint256 submissionId);
    error ReviewWindowActive(uint256 submissionId);
    error InvalidReviewWindow(uint64 value);
    error CannotCloseYet(uint256 missionId);

    constructor(
        IERC20 rewardToken_,
        PersonhoodRegistry registry_,
        address admin,
        address verifier,
        uint128 tier1MaxReward_,
        uint64 reviewWindow_
    ) {
        if (address(rewardToken_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        if (admin == address(0) || verifier == address(0)) revert ZeroAddress();
        if (reviewWindow_ < MIN_REVIEW_WINDOW || reviewWindow_ > MAX_REVIEW_WINDOW) {
            revert InvalidReviewWindow(reviewWindow_);
        }
        rewardToken = rewardToken_;
        registry = registry_;
        tier1MaxReward = tier1MaxReward_;
        reviewWindow = reviewWindow_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(VERIFIER_ROLE, verifier);
    }

    // ---------------------------------------------------------------------------------------------
    // Funder actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Create a mission and escrow `reward * maxSubmissions` of the reward token.
    /// @param minTier Requested minimum personhood tier. Raised to Tier 2 automatically when the
    ///        reward exceeds `tier1MaxReward`, and never lower than Tier 1.
    function createMission(
        uint128 reward,
        uint32 maxSubmissions,
        uint64 deadline,
        uint8 minTier,
        bytes32 specHash
    ) external whenNotPaused nonReentrant returns (uint256 missionId) {
        if (reward == 0) revert ZeroReward();
        if (maxSubmissions == 0) revert ZeroSubmissions();
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);
        if (minTier > registry.MAX_TIER()) revert InvalidTier(minTier);

        uint8 requiredTier = minTier < registry.TIER_PASSPORT() ? registry.TIER_PASSPORT() : minTier;
        if (reward > tier1MaxReward) requiredTier = registry.TIER_SELF();

        uint256 total = uint256(reward) * maxSubmissions;

        missionId = nextMissionId++;
        _missions[missionId] = Mission({
            funder: msg.sender,
            minTier: requiredTier,
            status: MissionStatus.Open,
            deadline: deadline,
            maxSubmissions: maxSubmissions,
            pending: 0,
            approved: 0,
            reward: reward,
            specHash: specHash
        });

        uint256 before = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), total);
        uint256 received = rewardToken.balanceOf(address(this)) - before;
        if (received != total) revert TransferShortfall(total, received);

        emit MissionCreated(missionId, msg.sender, reward, maxSubmissions, deadline, requiredTier, specHash);
    }

    /// @notice Close a mission and refund every slot that is neither approved nor pending.
    ///         The funder can close any time; anyone can close after the deadline (refund still goes
    ///         to the funder). Pending submissions stay resolvable; if later rejected, their reward is
    ///         refunded to the funder too.
    function closeMission(uint256 missionId) external nonReentrant {
        Mission storage m = _missions[missionId];
        if (m.status != MissionStatus.Open) revert MissionNotOpen(missionId);
        if (msg.sender != m.funder && block.timestamp <= m.deadline) revert CannotCloseYet(missionId);

        uint32 unused = m.maxSubmissions - m.approved - m.pending;
        m.status = MissionStatus.Closed;
        // Shrink capacity so it always equals approved + pending from here on.
        m.maxSubmissions = m.approved + m.pending;

        uint256 refund = uint256(m.reward) * unused;
        if (refund > 0) rewardToken.safeTransfer(m.funder, refund);
        emit MissionClosed(missionId, refund);
    }

    // ---------------------------------------------------------------------------------------------
    // Verifier actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Anchor a verified capture on-chain and reserve a reward slot for `contributor`.
    /// @param mediaHash Hash of the original captured media (before privacy blurring).
    function recordSubmission(uint256 missionId, address contributor, bytes32 mediaHash)
        external
        onlyRole(VERIFIER_ROLE)
        whenNotPaused
        returns (uint256 submissionId)
    {
        Mission storage m = _missions[missionId];
        if (m.status == MissionStatus.None) revert UnknownMission(missionId);
        if (m.status != MissionStatus.Open) revert MissionNotOpen(missionId);
        if (block.timestamp > m.deadline) revert MissionExpired(missionId);
        if (m.pending + m.approved >= m.maxSubmissions) revert MissionFull(missionId);
        if (contributor == address(0)) revert ZeroAddress();
        if (contributor == m.funder) revert FunderCannotSubmit();
        if (mediaHash == bytes32(0)) revert ZeroMediaHash();
        if (mediaHashUsed[mediaHash]) revert MediaHashAlreadyUsed(mediaHash);
        if (hasSubmitted[missionId][contributor]) revert AlreadySubmitted(missionId, contributor);
        if (!registry.hasTier(contributor, m.minTier)) revert InsufficientPersonhood(contributor, m.minTier);

        mediaHashUsed[mediaHash] = true;
        hasSubmitted[missionId][contributor] = true;
        m.pending += 1;

        uint64 reviewDeadline = uint64(block.timestamp) + reviewWindow;
        submissionId = nextSubmissionId++;
        _submissions[submissionId] = Submission({
            missionId: missionId,
            contributor: contributor,
            status: SubmissionStatus.Pending,
            reviewDeadline: reviewDeadline,
            mediaHash: mediaHash
        });

        emit SubmissionRecorded(submissionId, missionId, contributor, mediaHash, reviewDeadline);
    }

    // ---------------------------------------------------------------------------------------------
    // Resolution
    // ---------------------------------------------------------------------------------------------

    /// @notice Approve a pending submission and pay the contributor. Funder or verifier only.
    function approve(uint256 submissionId) external nonReentrant {
        Submission storage s = _submissions[submissionId];
        if (s.status != SubmissionStatus.Pending) revert NotPending(submissionId);
        _requireFunderOrVerifier(_missions[s.missionId]);
        _pay(submissionId, s);
    }

    /// @notice Reject a pending submission before its review deadline. Funder or verifier only.
    ///         On an open mission the slot becomes available again; on a closed mission the
    ///         reward is refunded to the funder.
    /// @dev The contributor stays marked as having submitted, and the media hash stays used.
    function reject(uint256 submissionId, bytes32 reason) external nonReentrant {
        Submission storage s = _submissions[submissionId];
        if (s.status != SubmissionStatus.Pending) revert NotPending(submissionId);
        Mission storage m = _missions[s.missionId];
        _requireFunderOrVerifier(m);
        if (block.timestamp > s.reviewDeadline) revert ReviewWindowOver(submissionId);

        s.status = SubmissionStatus.Rejected;
        m.pending -= 1;

        if (m.status == MissionStatus.Closed) {
            m.maxSubmissions -= 1;
            rewardToken.safeTransfer(m.funder, m.reward);
        }
        emit SubmissionRejected(submissionId, s.missionId, reason);
    }

    /// @notice Pay a pending submission once its review window has passed without rejection.
    ///         Callable by anyone (usually the contributor or a backend keeper).
    function finalize(uint256 submissionId) external nonReentrant {
        Submission storage s = _submissions[submissionId];
        if (s.status != SubmissionStatus.Pending) revert NotPending(submissionId);
        if (block.timestamp <= s.reviewDeadline) revert ReviewWindowActive(submissionId);
        _pay(submissionId, s);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    function setTier1MaxReward(uint128 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tier1MaxReward = value;
        emit Tier1MaxRewardUpdated(value);
    }

    /// @notice Applies to submissions recorded after the change only.
    function setReviewWindow(uint64 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value < MIN_REVIEW_WINDOW || value > MAX_REVIEW_WINDOW) revert InvalidReviewWindow(value);
        reviewWindow = value;
        emit ReviewWindowUpdated(value);
    }

    /// @notice Pausing blocks new missions and new submissions. Approvals, rejections,
    ///         finalization and refunds keep working so escrowed funds are never frozen.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getMission(uint256 missionId) external view returns (Mission memory) {
        return _missions[missionId];
    }

    function getSubmission(uint256 submissionId) external view returns (Submission memory) {
        return _submissions[submissionId];
    }

    /// @notice Tokens still held for this mission (unused slots + pending submissions).
    function escrowedFor(uint256 missionId) external view returns (uint256) {
        Mission storage m = _missions[missionId];
        return uint256(m.reward) * (m.maxSubmissions - m.approved);
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    function _pay(uint256 submissionId, Submission storage s) private {
        Mission storage m = _missions[s.missionId];
        s.status = SubmissionStatus.Approved;
        m.pending -= 1;
        m.approved += 1;
        rewardToken.safeTransfer(s.contributor, m.reward);
        emit SubmissionApproved(submissionId, s.missionId, s.contributor);
    }

    function _requireFunderOrVerifier(Mission storage m) private view {
        if (msg.sender != m.funder && !hasRole(VERIFIER_ROLE, msg.sender)) revert NotFunderOrVerifier();
    }
}
