// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import {LifeboatFactory} from "../src/LifeboatFactory.sol";
import {LifeboatAccount} from "../src/LifeboatAccount.sol";

/// Fork tests against real Base mainnet USDC and real Morpho vaults.
contract LifeboatForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant STEAKHOUSE = 0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183;
    address constant GAUNTLET = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61;
    address constant MOONWELL = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca;

    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address mallory = makeAddr("mallory");
    LifeboatFactory factory;
    LifeboatAccount acct;

    function setUp() public {
        vm.createSelectFork("base");
        factory = new LifeboatFactory(keeper, USDC);
        address[] memory v = new address[](2);
        v[0] = STEAKHOUSE;
        v[1] = GAUNTLET;
        vm.prank(alice);
        acct = LifeboatAccount(factory.create(v));
        deal(USDC, alice, 1_000e6);
        vm.prank(alice);
        IERC20(USDC).transfer(address(acct), 1_000e6);
    }

    function test_createSetsOwnerKeeperAndPredicts() public view {
        assertEq(acct.owner(), alice);
        assertEq(acct.keeper(), keeper);
        assertEq(factory.predict(alice), address(acct));
        assertTrue(acct.allowedVault(STEAKHOUSE));
        assertFalse(acct.allowedVault(MOONWELL));
    }

    function test_cannotCreateTwiceOrReinitialize() public {
        address[] memory v = new address[](0);
        vm.prank(alice);
        vm.expectRevert(LifeboatFactory.AlreadyHasAccount.selector);
        factory.create(v);
        vm.expectRevert();
        acct.initialize(mallory, mallory, USDC, v);
    }

    function test_keeperDepositExitMove() public {
        vm.prank(keeper);
        acct.deposit(STEAKHOUSE, type(uint256).max);
        (, uint256 assets,) = acct.positionOf(STEAKHOUSE);
        assertApproxEqAbs(assets, 1_000e6, 2);
        assertEq(IERC20(USDC).balanceOf(address(acct)), 0);

        vm.prank(keeper);
        acct.move(STEAKHOUSE, GAUNTLET, keccak256("decision"), "feed frozen, curator silent 30 min");
        (, uint256 assetsOld,) = acct.positionOf(STEAKHOUSE);
        (, uint256 assetsNew,) = acct.positionOf(GAUNTLET);
        assertLe(assetsOld, 1); // only rounding dust left behind
        assertApproxEqAbs(assetsNew, 1_000e6, 3);
    }

    function test_keeperCannotTouchDisallowedVaultOrTakeMoney() public {
        vm.startPrank(keeper);
        vm.expectRevert(LifeboatAccount.VaultNotAllowed.selector);
        acct.deposit(MOONWELL, 1e6);
        vm.expectRevert(LifeboatAccount.NotOwner.selector);
        acct.withdraw(1e6);
        vm.expectRevert(LifeboatAccount.NotOwner.selector);
        acct.sweep(USDC);
        vm.expectRevert(LifeboatAccount.NotOwner.selector);
        acct.setVault(MOONWELL, true);
        vm.expectRevert(LifeboatAccount.NotOwner.selector);
        acct.ownerRedeemAll(STEAKHOUSE);
        vm.stopPrank();
    }

    function test_strangerCannotDoAnything() public {
        vm.startPrank(mallory);
        vm.expectRevert(LifeboatAccount.NotAuthorized.selector);
        acct.deposit(STEAKHOUSE, 1e6);
        vm.expectRevert(LifeboatAccount.NotAuthorized.selector);
        acct.exit(STEAKHOUSE, bytes32(0), "");
        vm.expectRevert(LifeboatAccount.NotOwner.selector);
        acct.withdraw(1);
        vm.stopPrank();
    }

    function test_ownerAlwaysGetsOut() public {
        vm.prank(keeper);
        acct.deposit(STEAKHOUSE, 600e6);
        vm.startPrank(alice);
        acct.setKeeperPaused(true);
        acct.ownerRedeemAll(STEAKHOUSE);
        acct.withdraw(type(uint256).max);
        vm.stopPrank();
        assertApproxEqAbs(IERC20(USDC).balanceOf(alice), 1_000e6, 2);
    }

    function test_pausedKeeperBlocked() public {
        vm.prank(alice);
        acct.setKeeperPaused(true);
        vm.prank(keeper);
        vm.expectRevert(LifeboatAccount.Paused.selector);
        acct.deposit(STEAKHOUSE, 1e6);
    }

    function test_exitAllowedEvenAfterOwnerDisallows() public {
        vm.prank(keeper);
        acct.deposit(STEAKHOUSE, type(uint256).max);
        vm.prank(alice);
        acct.setVault(STEAKHOUSE, false);
        vm.prank(keeper);
        acct.exit(STEAKHOUSE, bytes32(0), "drill");
        assertApproxEqAbs(IERC20(USDC).balanceOf(address(acct)), 1_000e6, 2);
    }

    function test_wrongAssetVaultRejected() public {
        // a non USDC ERC4626: use the Steakhouse vault share token itself is not a vault of vault shares; pick WETH vault
        address wethVault = 0xa0E430870c4604CcfC7B38Ca7845B1FF653D0ff1; // Moonwell Flagship ETH (Base)
        vm.prank(alice);
        vm.expectRevert(LifeboatAccount.WrongAsset.selector);
        acct.setVault(wethVault, true);
    }
}
