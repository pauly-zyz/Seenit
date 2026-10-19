// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MissionEscrow} from "../src/MissionEscrow.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";

/// @notice Deploys PersonhoodRegistry + MissionEscrow and writes deployments/<chainId>.json.
///         Every input comes from the environment (see .env.example).
///
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --account <keystore>
///
/// REWARD_TOKEN_ADDRESS must be the official stablecoin for the target network, taken from the
/// Robinhood Chain docs. The script refuses to run on any chain but Robinhood Chain testnet unless
/// ALLOW_ANY_CHAIN=true (for local anvil runs).
contract Deploy is Script {
    uint256 internal constant ROBINHOOD_TESTNET = 46630;

    function run() external returns (PersonhoodRegistry registry, MissionEscrow escrow) {
        if (block.chainid != ROBINHOOD_TESTNET && !vm.envOr("ALLOW_ANY_CHAIN", false)) {
            revert(
                "Deploy: wrong chain (expected Robinhood Chain testnet 46630; set ALLOW_ANY_CHAIN=true to override)"
            );
        }

        address token = vm.envAddress("REWARD_TOKEN_ADDRESS");
        require(token.code.length > 0, "Deploy: REWARD_TOKEN_ADDRESS has no code on this chain");

        address admin = vm.envAddress("ADMIN_ADDRESS");
        uint48 adminDelay = uint48(vm.envOr("ADMIN_TRANSFER_DELAY", uint256(2 days)));
        address attester = vm.envAddress("ATTESTER_ADDRESS");

        MissionEscrow.Config memory config;
        config.rewardToken = IERC20(token);
        config.admin = admin;
        config.adminDelay = adminDelay;
        config.operator = vm.envAddress("OPERATOR_ADDRESS");
        config.pauser = vm.envOr("PAUSER_ADDRESS", admin);
        config.treasury = vm.envAddress("TREASURY_ADDRESS");
        config.feeBps = uint16(vm.envUint("PLATFORM_FEE_BPS"));
        config.tier1MaxReward = uint128(vm.envUint("TIER1_MAX_REWARD"));
        config.reviewWindow = uint64(vm.envOr("REVIEW_WINDOW_SECONDS", uint256(3 days)));

        vm.startBroadcast();
        registry = new PersonhoodRegistry(admin, adminDelay, attester);
        config.registry = registry;
        escrow = new MissionEscrow(config);
        vm.stopBroadcast();

        _writeDeployment(address(registry), address(escrow), token);

        console2.log("PersonhoodRegistry:", address(registry));
        console2.log("MissionEscrow:     ", address(escrow));
    }

    function _writeDeployment(address registry, address escrow, address token) internal {
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "blockNumber", block.number);
        vm.serializeAddress(key, "rewardToken", token);
        vm.serializeAddress(key, "personhoodRegistry", registry);
        string memory json = vm.serializeAddress(key, "missionEscrow", escrow);
        vm.writeJson(
            json, string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json")
        );
    }
}
