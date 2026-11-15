// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import {Initializable} from "openzeppelin-contracts/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title LifeboatAccount
/// @notice One account per user. The owner's USDC sits in ERC4626 vaults the owner approved.
/// The keeper (the Lifeboat agent) can only move funds between those vaults and this account.
/// Nothing the keeper can call sends value anywhere except an approved vault or this account.
/// Only the owner can take money out, at any time, with no notice.
contract LifeboatAccount is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    address public keeper;
    IERC20 public asset;
    bool public keeperPaused;

    mapping(address => bool) public allowedVault;
    address[] internal _vaults;

    event VaultAllowed(address indexed vault, bool allowed);
    event KeeperPaused(bool paused);
    event Deposited(address indexed vault, uint256 assets, uint256 shares, address indexed by);
    /// @param decisionHash keccak256 of the full published decision record
    event Exited(address indexed vault, uint256 assets, uint256 shares, address indexed by, bytes32 decisionHash, string reason);
    event Withdrawn(address indexed to, uint256 assets);

    error NotOwner();
    error NotAuthorized();
    error VaultNotAllowed();
    error WrongAsset();
    error Paused();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != owner) {
            if (msg.sender != keeper) revert NotAuthorized();
            if (keeperPaused) revert Paused();
        }
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address keeper_, address asset_, address[] calldata vaults_) external initializer {
        owner = owner_;
        keeper = keeper_;
        asset = IERC20(asset_);
        for (uint256 i; i < vaults_.length; i++) _allow(vaults_[i], true);
    }

    // ---------- owner ----------

    function setVault(address vault, bool allowed) external onlyOwner {
        _allow(vault, allowed);
    }

    function setKeeperPaused(bool paused) external onlyOwner {
        keeperPaused = paused;
        emit KeeperPaused(paused);
    }

    /// @notice Owner redeems what can be redeemed from a vault straight to themselves.
    function ownerRedeemAll(address vault) external onlyOwner nonReentrant returns (uint256 assets) {
        uint256 shares = IERC4626(vault).maxRedeem(address(this));
        if (shares == 0) return 0;
        assets = IERC4626(vault).redeem(shares, owner, address(this));
        emit Withdrawn(owner, assets);
    }

    /// @notice Owner withdraws idle USDC held by the account. Use max uint for all.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == type(uint256).max) amount = asset.balanceOf(address(this));
        asset.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// @notice Escape hatch for any token sent here, including vault shares.
    function sweep(address token) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(owner, IERC20(token).balanceOf(address(this)));
    }

    // ---------- agent (keeper or owner) ----------

    /// @notice Deposit idle USDC into an approved vault. Use max uint for everything idle.
    function deposit(address vault, uint256 amount) public onlyAgent nonReentrant returns (uint256 shares) {
        if (!allowedVault[vault]) revert VaultNotAllowed();
        if (amount == type(uint256).max) amount = asset.balanceOf(address(this));
        if (amount == 0) return 0;
        asset.forceApprove(vault, amount);
        shares = IERC4626(vault).deposit(amount, address(this));
        emit Deposited(vault, amount, shares, msg.sender);
    }

    /// @notice Pull everything withdrawable right now from a vault back into this account.
    /// Works for any vault the account holds, so an exit is never blocked by an allowlist change.
    function exit(address vault, bytes32 decisionHash, string calldata reason)
        public
        onlyAgent
        nonReentrant
        returns (uint256 assets, uint256 shares)
    {
        shares = IERC4626(vault).maxRedeem(address(this));
        if (shares > 0) assets = IERC4626(vault).redeem(shares, address(this), address(this));
        emit Exited(vault, assets, shares, msg.sender, decisionHash, reason);
    }

    /// @notice Exit one vault and park everything idle in another approved vault.
    function move(address from, address to, bytes32 decisionHash, string calldata reason)
        external
        onlyAgent
        returns (uint256 exited, uint256 sharesIn)
    {
        (exited,) = exit(from, decisionHash, reason);
        sharesIn = deposit(to, type(uint256).max);
    }

    // ---------- views ----------

    function vaults() external view returns (address[] memory) {
        return _vaults;
    }

    function positionOf(address vault) external view returns (uint256 shares, uint256 assets, uint256 withdrawableAssets) {
        shares = IERC4626(vault).balanceOf(address(this));
        assets = IERC4626(vault).convertToAssets(shares);
        withdrawableAssets = IERC4626(vault).maxWithdraw(address(this));
    }

    function _allow(address vault, bool allowed) internal {
        if (allowed) {
            if (IERC4626(vault).asset() != address(asset)) revert WrongAsset();
            if (!_known(vault)) _vaults.push(vault);
        }
        allowedVault[vault] = allowed;
        emit VaultAllowed(vault, allowed);
    }

    function _known(address vault) internal view returns (bool) {
        for (uint256 i; i < _vaults.length; i++) {
            if (_vaults[i] == vault) return true;
        }
        return false;
    }
}
