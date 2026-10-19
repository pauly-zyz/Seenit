// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";

/// @notice Deploys PersonhoodRegistry + MissionEscrow. All inputs come from the environment
///         (see .env.example). REWARD_TOKEN_ADDRESS must be the official stablecoin address
///         for the target network, taken from the Robinhood Chain docs.
///
/// forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --account <keystore>
contract Deploy is Script {
    function run() external returns (PersonhoodRegistry registry, MissionEscrow escrow) {
        address token = vm.envAddress("REWARD_TOKEN_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address attester = vm.envAddress("ATTESTER_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        uint128 tier1MaxReward = uint128(vm.envUint("TIER1_MAX_REWARD"));
        uint64 reviewWindow = uint64(vm.envOr("REVIEW_WINDOW_SECONDS", uint256(3 days)));

        require(token.code.length > 0, "REWARD_TOKEN_ADDRESS has no code on this chain");

        vm.startBroadcast();
        registry = new PersonhoodRegistry(admin, attester);
        escrow = new MissionEscrow(IERC20(token), registry, admin, verifier, tier1MaxReward, reviewWindow);
        vm.stopBroadcast();

        console2.log("PersonhoodRegistry:", address(registry));
        console2.log("MissionEscrow:     ", address(escrow));
    }
}
