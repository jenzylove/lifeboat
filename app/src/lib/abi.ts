import { parseAbi } from 'viem';

// Client copies of the Lifeboat ABIs (engine/src/keeper.ts is server only).
export const ACCOUNT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function keeperPaused() view returns (bool)',
  'function vaults() view returns (address[])',
  'function allowedVault(address) view returns (bool)',
  'function positionOf(address vault) view returns (uint256 shares, uint256 assets, uint256 withdrawableAssets)',
  'function deposit(address vault, uint256 amount) returns (uint256)',
  'function exit(address vault, bytes32 decisionHash, string reason) returns (uint256, uint256)',
  'function withdraw(uint256 amount)',
  'function ownerRedeemAll(address vault) returns (uint256)',
  'function setKeeperPaused(bool paused)',
]);
export const FACTORY_ABI = parseAbi([
  'function create(address[] vaults) returns (address)',
  'function accountOf(address owner) view returns (address)',
  'function predict(address owner) view returns (address)',
]);
export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
export const VAULT_ABI = parseAbi(['function name() view returns (string)']);
