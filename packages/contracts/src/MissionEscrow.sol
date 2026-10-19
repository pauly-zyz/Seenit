// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PersonhoodRegistry} from "./PersonhoodRegistry.sol";

/// @title MissionEscrow
/// @notice Holds stablecoin rewards for Seenit real-world missions and pays verified contributors.
/// @dev Flow:
///      1. A funder calls `createMission`, escrowing rewardPerCapture * maxCaptures.
///      2. After off-chain checks (in-app capture, GPS, timestamp, AI vision), the backend OPERATOR
///         calls `recordSubmission`, anchoring the media hash on-chain and reserving a slot.
///      3. The funder or operator calls `acceptSubmission` (pays now) or `rejectSubmission` (frees the
///         slot) before the review deadline. After it, anyone can `finalize` and the contributor is
///         paid, so an unresponsive funder cannot hold a reward hostage.
///      4. The funder can `cancelMission` any time; anyone can `refund` after the deadline. Unused
///         slots go back to the funder. Pending submissions stay resolvable.
///      Every payout splits the reward into contributor payout + platform fee (bps, snapshotted per
///      mission at creation, capped at MAX_FEE_BPS).
///
///      Pausing blocks create / record / accept / reject (stops a compromised operator key).
///      cancel / refund / finalize keep working so escrowed funds are never frozen.
contract MissionEscrow is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint16 public constant MAX_FEE_BPS = 1_000; // 10%
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint64 public constant MIN_REVIEW_WINDOW = 1 hours;
    uint64 public constant MAX_REVIEW_WINDOW = 14 days;

    enum MissionStatus {
        None,
        Open,
        Cancelled,
        Refunded
    }

    enum SubmissionStatus {
        None,
        Pending,
        Accepted,
        Rejected
    }

    struct Mission {
        address funder;
        uint128 rewardPerCapture;
        uint32 maxCaptures;
        uint32 pending;
        uint32 accepted;
        uint64 deadline;
        uint16 feeBps;
        uint8 minTier;
        MissionStatus status;
        /// @dev Hash of the off-chain mission spec (location, radius, instructions, output schema).
        bytes32 specHash;
    }

    struct Submission {
        uint256 missionId;
        address contributor;
        uint64 recordedAt;
        uint64 reviewDeadline;
        SubmissionStatus status;
        bytes32 mediaHash;
    }

    /// @dev Grouped constructor arguments (avoids stack-too-deep and keeps deploy scripts readable).
    struct Config {
        IERC20 rewardToken;
        PersonhoodRegistry registry;
        address admin;
        uint48 adminDelay;
        address operator;
        address pauser;
        address treasury;
        uint16 feeBps;
        uint128 tier1MaxReward;
        uint64 reviewWindow;
    }

    IERC20 public immutable rewardToken;
    PersonhoodRegistry public immutable registry;

    address public treasury;
    /// @notice Fee for new missions. Existing missions keep the fee they were created with.
    uint16 public feeBps;
    /// @notice Missions paying more than this per capture require Tier 2 (Self).
    uint128 public tier1MaxReward;
    /// @notice Time the funder has to reject a recorded submission before anyone can finalize it.
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
        uint128 rewardPerCapture,
        uint32 maxCaptures,
        uint64 deadline,
        uint8 minTier,
        uint16 feeBps,
        bytes32 specHash
    );
    event MissionCancelled(uint256 indexed missionId, uint256 refunded);
    event MissionRefunded(uint256 indexed missionId, uint256 refunded);
    event SubmissionRecorded(
        uint256 indexed submissionId,
        uint256 indexed missionId,
        address indexed contributor,
        bytes32 mediaHash,
        uint64 reviewDeadline
    );
    event SubmissionAccepted(
        uint256 indexed submissionId,
        uint256 indexed missionId,
        address indexed contributor,
        uint256 payout,
        uint256 fee,
        bool finalized
    );
    event SubmissionRejected(
        uint256 indexed submissionId, uint256 indexed missionId, bytes32 reason, uint256 refunded
    );
    event FeeUpdated(uint16 feeBps);
    event TreasuryUpdated(address treasury);
    event Tier1MaxRewardUpdated(uint128 value);
    event ReviewWindowUpdated(uint64 value);

    error ZeroAddress();
    error ZeroReward();
    error ZeroCaptures();
    error DeadlineInPast(uint64 deadline);
    error InvalidTier(uint8 tier);
    error FeeTooHigh(uint16 feeBps);
    error InvalidReviewWindow(uint64 value);
    error TransferShortfall(uint256 expected, uint256 received);
    error UnknownMission(uint256 missionId);
    error MissionNotOpen(uint256 missionId);
    error MissionExpired(uint256 missionId);
    error MissionFull(uint256 missionId);
    error DeadlineNotReached(uint256 missionId);
    error NotFunder();
    error NotFunderOrOperator();
    error FunderCannotSubmit();
    error ZeroMediaHash();
    error MediaHashAlreadyUsed(bytes32 mediaHash);
    error AlreadySubmitted(uint256 missionId, address contributor);
    error NotVerified(address contributor, uint8 minTier);
    error NotPending(uint256 submissionId);
    error ReviewWindowOver(uint256 submissionId);
    error ReviewWindowActive(uint256 submissionId);

    constructor(Config memory c) AccessControlDefaultAdminRules(c.adminDelay, c.admin) {
        if (address(c.rewardToken) == address(0) || address(c.registry) == address(0)) revert ZeroAddress();
        if (c.operator == address(0) || c.pauser == address(0) || c.treasury == address(0)) {
            revert ZeroAddress();
        }
        if (c.feeBps > MAX_FEE_BPS) revert FeeTooHigh(c.feeBps);
        _checkReviewWindow(c.reviewWindow);

        rewardToken = c.rewardToken;
        registry = c.registry;
        treasury = c.treasury;
        feeBps = c.feeBps;
        tier1MaxReward = c.tier1MaxReward;
        reviewWindow = c.reviewWindow;

        _grantRole(OPERATOR_ROLE, c.operator);
        _grantRole(PAUSER_ROLE, c.pauser);
    }

    // ---------------------------------------------------------------------------------------------
    // Funder actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Create a mission and escrow `rewardPerCapture * maxCaptures` of the reward token.
    /// @param minTier Requested minimum personhood tier. Never below Tier 1; raised to Tier 2 when
    ///        `rewardPerCapture > tier1MaxReward`.
    function createMission(
        uint128 rewardPerCapture,
        uint32 maxCaptures,
        uint64 deadline,
        uint8 minTier,
        bytes32 specHash
    ) external whenNotPaused nonReentrant returns (uint256 missionId) {
        if (rewardPerCapture == 0) revert ZeroReward();
        if (maxCaptures == 0) revert ZeroCaptures();
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);
        if (minTier > registry.MAX_TIER()) revert InvalidTier(minTier);

        uint8 tier = requiredTier(rewardPerCapture, minTier);
        uint256 total = uint256(rewardPerCapture) * maxCaptures;

        // Effects
        missionId = nextMissionId++;
        _missions[missionId] = Mission({
            funder: msg.sender,
            rewardPerCapture: rewardPerCapture,
            maxCaptures: maxCaptures,
            pending: 0,
            accepted: 0,
            deadline: deadline,
            feeBps: feeBps,
            minTier: tier,
            status: MissionStatus.Open,
            specHash: specHash
        });
        emit MissionCreated(
            missionId, msg.sender, rewardPerCapture, maxCaptures, deadline, tier, feeBps, specHash
        );

        // Interaction (balance check rejects fee-on-transfer / rebasing tokens)
        uint256 before = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), total);
        uint256 received = rewardToken.balanceOf(address(this)) - before;
        if (received != total) revert TransferShortfall(total, received);
    }

    /// @notice Cancel a mission. Unused slots are refunded to the funder immediately.
    function cancelMission(uint256 missionId) external nonReentrant {
        Mission storage m = _openMission(missionId);
        if (msg.sender != m.funder) revert NotFunder();
        uint256 refunded = _closeAndCollectUnused(m, MissionStatus.Cancelled);
        emit MissionCancelled(missionId, refunded);
        _send(m.funder, refunded);
    }

    /// @notice After the deadline, anyone can return the unused slots to the funder.
    function refund(uint256 missionId) external nonReentrant {
        Mission storage m = _openMission(missionId);
        if (block.timestamp <= m.deadline) revert DeadlineNotReached(missionId);
        uint256 refunded = _closeAndCollectUnused(m, MissionStatus.Refunded);
        emit MissionRefunded(missionId, refunded);
        _send(m.funder, refunded);
    }

    // ---------------------------------------------------------------------------------------------
    // Operator actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Anchor a verified capture on-chain and reserve a reward slot for `contributor`.
    /// @param mediaHash SHA-256 of the original captured media (before privacy blurring).
    function recordSubmission(uint256 missionId, address contributor, bytes32 mediaHash)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        returns (uint256 submissionId)
    {
        Mission storage m = _openMission(missionId);
        if (block.timestamp > m.deadline) revert MissionExpired(missionId);
        if (m.pending + m.accepted >= m.maxCaptures) revert MissionFull(missionId);
        if (contributor == address(0)) revert ZeroAddress();
        if (contributor == m.funder) revert FunderCannotSubmit();
        if (mediaHash == bytes32(0)) revert ZeroMediaHash();
        if (mediaHashUsed[mediaHash]) revert MediaHashAlreadyUsed(mediaHash);
        if (hasSubmitted[missionId][contributor]) revert AlreadySubmitted(missionId, contributor);
        if (!registry.isVerified(contributor, m.minTier)) revert NotVerified(contributor, m.minTier);

        mediaHashUsed[mediaHash] = true;
        hasSubmitted[missionId][contributor] = true;
        m.pending += 1;

        uint64 reviewDeadline = uint64(block.timestamp) + reviewWindow;
        submissionId = nextSubmissionId++;
        _submissions[submissionId] = Submission({
            missionId: missionId,
            contributor: contributor,
            recordedAt: uint64(block.timestamp),
            reviewDeadline: reviewDeadline,
            status: SubmissionStatus.Pending,
            mediaHash: mediaHash
        });

        emit SubmissionRecorded(submissionId, missionId, contributor, mediaHash, reviewDeadline);
    }

    // ---------------------------------------------------------------------------------------------
    // Resolution
    // ---------------------------------------------------------------------------------------------

    /// @notice Accept a pending submission and pay the contributor (minus the platform fee).
    function acceptSubmission(uint256 submissionId) external whenNotPaused nonReentrant {
        Submission storage s = _pendingSubmission(submissionId);
        _requireFunderOrOperator(_missions[s.missionId]);
        _pay(submissionId, s, false);
    }

    /// @notice Reject a pending submission before its review deadline. On an open mission before its
    ///         deadline the slot becomes available again; otherwise the reward is refunded to the funder.
    /// @dev The contributor stays marked as having submitted, and the media hash stays used.
    function rejectSubmission(uint256 submissionId, bytes32 reason) external whenNotPaused nonReentrant {
        Submission storage s = _pendingSubmission(submissionId);
        Mission storage m = _missions[s.missionId];
        _requireFunderOrOperator(m);
        if (block.timestamp > s.reviewDeadline) revert ReviewWindowOver(submissionId);

        s.status = SubmissionStatus.Rejected;
        m.pending -= 1;

        uint256 refunded;
        if (m.status != MissionStatus.Open || block.timestamp > m.deadline) {
            // Slot can't be reused any more: shrink capacity and refund now.
            m.maxCaptures -= 1;
            refunded = m.rewardPerCapture;
        }
        emit SubmissionRejected(submissionId, s.missionId, reason, refunded);
        _send(m.funder, refunded);
    }

    /// @notice Pay a pending submission once its review window has passed without rejection.
    ///         Callable by anyone (usually the contributor or a backend keeper), even while paused.
    function finalize(uint256 submissionId) external nonReentrant {
        Submission storage s = _pendingSubmission(submissionId);
        if (block.timestamp <= s.reviewDeadline) revert ReviewWindowActive(submissionId);
        _pay(submissionId, s, true);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @notice Fee for missions created from now on. Capped at MAX_FEE_BPS.
    function setFeeBps(uint16 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value > MAX_FEE_BPS) revert FeeTooHigh(value);
        feeBps = value;
        emit FeeUpdated(value);
    }

    function setTreasury(address value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value == address(0)) revert ZeroAddress();
        treasury = value;
        emit TreasuryUpdated(value);
    }

    function setTier1MaxReward(uint128 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tier1MaxReward = value;
        emit Tier1MaxRewardUpdated(value);
    }

    /// @notice Applies to submissions recorded after the change only.
    function setReviewWindow(uint64 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkReviewWindow(value);
        reviewWindow = value;
        emit ReviewWindowUpdated(value);
    }

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
        return uint256(m.rewardPerCapture) * (m.maxCaptures - m.accepted);
    }

    /// @notice What a contributor receives per accepted capture, and the platform fee taken.
    function quotePayout(uint256 missionId) public view returns (uint256 payout, uint256 fee) {
        Mission storage m = _missions[missionId];
        fee = (uint256(m.rewardPerCapture) * m.feeBps) / BPS_DENOMINATOR;
        payout = m.rewardPerCapture - fee;
    }

    /// @notice Tier rule shared with packages/shared `requiredTier()`.
    function requiredTier(uint128 rewardPerCapture, uint8 requested) public view returns (uint8) {
        if (rewardPerCapture > tier1MaxReward) return registry.TIER_SELF();
        uint8 floor = registry.TIER_PASSPORT();
        return requested < floor ? floor : requested;
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    function _pay(uint256 submissionId, Submission storage s, bool finalized) private {
        Mission storage m = _missions[s.missionId];
        (uint256 payout, uint256 fee) = quotePayout(s.missionId);

        // Effects
        s.status = SubmissionStatus.Accepted;
        m.pending -= 1;
        m.accepted += 1;
        emit SubmissionAccepted(submissionId, s.missionId, s.contributor, payout, fee, finalized);

        // Interactions
        rewardToken.safeTransfer(s.contributor, payout);
        if (fee > 0) rewardToken.safeTransfer(treasury, fee);
    }

    /// @dev Marks the mission closed, shrinks capacity to accepted + pending, returns the refund.
    function _closeAndCollectUnused(Mission storage m, MissionStatus status) private returns (uint256) {
        uint32 unused = m.maxCaptures - m.accepted - m.pending;
        m.status = status;
        m.maxCaptures = m.accepted + m.pending;
        return uint256(m.rewardPerCapture) * unused;
    }

    function _send(address to, uint256 amount) private {
        if (amount > 0) rewardToken.safeTransfer(to, amount);
    }

    function _openMission(uint256 missionId) private view returns (Mission storage m) {
        m = _missions[missionId];
        if (m.status == MissionStatus.None) revert UnknownMission(missionId);
        if (m.status != MissionStatus.Open) revert MissionNotOpen(missionId);
    }

    function _pendingSubmission(uint256 submissionId) private view returns (Submission storage s) {
        s = _submissions[submissionId];
        if (s.status != SubmissionStatus.Pending) revert NotPending(submissionId);
    }

    function _requireFunderOrOperator(Mission storage m) private view {
        if (msg.sender != m.funder && !hasRole(OPERATOR_ROLE, msg.sender)) revert NotFunderOrOperator();
    }

    function _checkReviewWindow(uint64 value) private pure {
        if (value < MIN_REVIEW_WINDOW || value > MAX_REVIEW_WINDOW) revert InvalidReviewWindow(value);
    }
}
