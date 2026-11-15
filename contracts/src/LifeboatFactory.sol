// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "openzeppelin-contracts/contracts/proxy/Clones.sol";
import {LifeboatAccount} from "./LifeboatAccount.sol";

/// @notice Deploys one LifeboatAccount per owner. The keeper is fixed per factory and shown before the user signs.
contract LifeboatFactory {
    address public immutable implementation;
    address public immutable keeper;
    address public immutable asset;

    mapping(address => address) public accountOf;

    event AccountCreated(address indexed owner, address indexed account, address[] vaults);

    error AlreadyHasAccount();

    constructor(address keeper_, address asset_) {
        implementation = address(new LifeboatAccount());
        keeper = keeper_;
        asset = asset_;
    }

    function predict(address owner) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, bytes32(uint256(uint160(owner))), address(this));
    }

    /// @notice msg.sender becomes the owner. Nobody can create an account for someone else.
    function create(address[] calldata vaults) external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AlreadyHasAccount();
        account = Clones.cloneDeterministic(implementation, bytes32(uint256(uint160(msg.sender))));
        LifeboatAccount(account).initialize(msg.sender, keeper, asset, vaults);
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account, vaults);
    }
}
