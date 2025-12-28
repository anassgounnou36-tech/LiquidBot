#!/usr/bin/env tsx
/**
 * Fork Test Seed Position Script
 * 
 * Seeds a near-threshold Aave v3 position on Base in a local fork for testing.
 * Creates a position with Health Factor ≈ 1.02 to validate bot's predictive path
 * using real Pyth WS updates while the bot reads from a local forked chain.
 * 
 * USAGE:
 * ------
 * 1. Start a local Base fork:
 *    anvil --fork-url https://base-mainnet.g.alchemy.com/v2/YOUR_KEY \
 *          --chain-id 8453 --block-time 2 --port 8545
 * 
 * 2. Edit .env in backend directory:
 *    RPC_URL=http://127.0.0.1:8545
 *    WS_RPC_URL=ws://127.0.0.1:8545
 *    USE_FLASHBLOCKS=false
 *    FORK_TEST_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *    (This is anvil's default test key #0 with 10000 ETH pre-funded)
 * 
 * 3. Run this script:
 *    npm run fork:seed
 *    or
 *    tsx backend/scripts/fork-test-seed-position.ts
 * 
 * WHAT IT DOES:
 * -------------
 * - Wraps ETH into WETH using WETH9 contract
 * - Approves Aave v3 Pool to spend WETH
 * - Supplies WETH as collateral to Aave
 * - Queries Aave Oracle for WETH and USDC prices (1e8 base units)
 * - Queries Protocol Data Provider for WETH liquidationThreshold (bps)
 * - Computes USDC borrow amount targeting HF ≈ 1.02
 * - Borrows USDC with interestRateMode=2 (variable rate)
 * - Logs all steps and amounts clearly
 * 
 * NOTES:
 * ------
 * - This is a standalone setup helper, does not modify bot runtime
 * - Use this to create test positions before running the bot in fork mode
 * - The created position will be visible to the bot via on-chain queries
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Aave V3 Base mainnet addresses
const AAVE_POOL_ADDRESS = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const AAVE_PROTOCOL_DATA_PROVIDER = '0xC4Fcf9893072d61Cc2899C0054877Cb752587981';
const AAVE_ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';

// Token addresses on Base
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Constants for calculations
const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;
const ORACLE_DECIMALS = 8; // Aave Oracle uses 1e8 base units
const TARGET_HF_NUMERATOR = 100n; // Target HF = 1.02 = 102/100
const TARGET_HF_DENOMINATOR = 102n;

// ABIs (minimal interfaces)
const WETH_ABI = [
  'function deposit() payable',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

const PROTOCOL_DATA_PROVIDER_ABI = [
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
];

const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) view returns (uint256)',
];

/**
 * Format token amount with proper decimals
 */
function formatAmount(amount: bigint, decimals: number, symbol: string): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0');
  const displayDecimals = Math.min(decimals, 6);
  return `${whole}.${fractionStr.slice(0, displayDecimals)} ${symbol}`;
}

/**
 * Main execution function
 */
async function main() {
  console.log('═'.repeat(80));
  console.log('Fork Test: Seed Near-Threshold Aave v3 Position');
  console.log('═'.repeat(80));
  console.log();

  // Validate environment variables
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.FORK_TEST_PK;

  if (!rpcUrl) {
    throw new Error('RPC_URL not set in .env. Set to http://127.0.0.1:8545 for local fork');
  }

  if (!privateKey) {
    throw new Error('FORK_TEST_PK not set in .env. Set to a funded test private key (e.g., anvil default key)');
  }

  console.log('✓ RPC URL:', rpcUrl);
  console.log();

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const userAddress = wallet.address;

  console.log('👤 User Address:', userAddress);

  // Check initial ETH balance
  const ethBalance = await provider.getBalance(userAddress);
  console.log('💰 Initial ETH Balance:', ethers.formatEther(ethBalance), 'ETH');

  if (ethBalance < ethers.parseEther('1')) {
    throw new Error('Insufficient ETH balance. Need at least 1 ETH for testing');
  }
  console.log();

  // Contract instances
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  const aavePool = new ethers.Contract(AAVE_POOL_ADDRESS, AAVE_POOL_ABI, wallet);
  const protocolDataProvider = new ethers.Contract(
    AAVE_PROTOCOL_DATA_PROVIDER,
    PROTOCOL_DATA_PROVIDER_ABI,
    provider
  );
  const aaveOracle = new ethers.Contract(AAVE_ORACLE, AAVE_ORACLE_ABI, provider);

  // Step 1: Wrap ETH into WETH
  console.log('─'.repeat(80));
  console.log('Step 1: Wrap ETH → WETH');
  console.log('─'.repeat(80));

  const wrapAmount = ethers.parseEther('1'); // Wrap 1 ETH
  console.log('Wrapping:', ethers.formatEther(wrapAmount), 'ETH → WETH');

  const depositTx = await weth.deposit({ value: wrapAmount });
  await depositTx.wait();
  console.log('✓ Transaction:', depositTx.hash);

  const wethBalance = await weth.balanceOf(userAddress);
  console.log('✓ WETH Balance:', formatAmount(wethBalance, 18, 'WETH'));
  console.log();

  // Step 2: Approve Aave Pool to spend WETH
  console.log('─'.repeat(80));
  console.log('Step 2: Approve Aave Pool');
  console.log('─'.repeat(80));

  console.log('Approving Aave Pool to spend WETH...');
  const approveTx = await weth.approve(AAVE_POOL_ADDRESS, wethBalance);
  await approveTx.wait();
  console.log('✓ Transaction:', approveTx.hash);
  console.log();

  // Step 3: Supply WETH as collateral
  console.log('─'.repeat(80));
  console.log('Step 3: Supply WETH Collateral');
  console.log('─'.repeat(80));

  console.log('Supplying:', formatAmount(wethBalance, 18, 'WETH'));
  const supplyTx = await aavePool.supply(WETH_ADDRESS, wethBalance, userAddress, 0);
  await supplyTx.wait();
  console.log('✓ Transaction:', supplyTx.hash);
  console.log();

  // Step 4: Query oracle prices
  console.log('─'.repeat(80));
  console.log('Step 4: Query Aave Oracle Prices');
  console.log('─'.repeat(80));

  const wethPrice = await aaveOracle.getAssetPrice(WETH_ADDRESS);
  const usdcPrice = await aaveOracle.getAssetPrice(USDC_ADDRESS);

  console.log('WETH Price:', formatAmount(wethPrice, 8, 'USD'), '(1e8 base)');
  console.log('USDC Price:', formatAmount(usdcPrice, 8, 'USD'), '(1e8 base)');
  console.log();

  // Step 5: Query liquidation threshold
  console.log('─'.repeat(80));
  console.log('Step 5: Query WETH Configuration');
  console.log('─'.repeat(80));

  const reserveConfig = await protocolDataProvider.getReserveConfigurationData(WETH_ADDRESS);
  const liquidationThreshold = reserveConfig[2]; // liquidationThreshold in bps (basis points)

  console.log('WETH Decimals:', reserveConfig[0].toString());
  console.log('WETH LTV:', reserveConfig[1].toString(), 'bps');
  console.log('WETH Liquidation Threshold:', liquidationThreshold.toString(), 'bps');
  console.log('WETH Liquidation Bonus:', reserveConfig[3].toString(), 'bps');
  console.log();

  // Step 6: Calculate borrow amount for target HF ≈ 1.02
  console.log('─'.repeat(80));
  console.log('Step 6: Calculate Target Borrow Amount');
  console.log('─'.repeat(80));

  // HF = (collateral × liquidationThreshold) / debt
  // Target HF = 1.02
  // Therefore: debt = (collateral × liquidationThreshold) / 1.02

  // Collateral value in base currency (1e8 units)
  // wethBalance is in 1e18, wethPrice is in 1e8
  // collateralValue = wethBalance * wethPrice / 1e18 (results in 1e8 base units)
  const wethDecimalsDivisor = 10n ** BigInt(WETH_DECIMALS);
  const collateralValueBase = (wethBalance * wethPrice) / wethDecimalsDivisor;

  // Apply liquidation threshold (in bps, need to divide by 10000)
  const collateralAdjusted = (collateralValueBase * liquidationThreshold) / 10000n;

  // Target HF = 1.02 = 102/100
  // debt = collateralAdjusted / 1.02 = collateralAdjusted * 100 / 102
  const targetDebtBase = (collateralAdjusted * TARGET_HF_NUMERATOR) / TARGET_HF_DENOMINATOR;

  // Convert debt from base currency (1e8) to USDC amount (1e6)
  // debtUSDC = targetDebtBase * 1e6 / usdcPrice
  const usdcDecimalsMultiplier = 10n ** BigInt(USDC_DECIMALS);
  const borrowAmountUSDC = (targetDebtBase * usdcDecimalsMultiplier) / usdcPrice;

  console.log('Collateral Value (base):', formatAmount(collateralValueBase, 8, 'USD'));
  console.log('Collateral Adjusted (LT):', formatAmount(collateralAdjusted, 8, 'USD'));
  console.log('Target Debt (base):', formatAmount(targetDebtBase, 8, 'USD'));
  console.log('Borrow Amount (USDC):', formatAmount(borrowAmountUSDC, 6, 'USDC'));
  console.log();

  // Calculate expected HF
  const expectedHF = (collateralAdjusted * 10000n) / targetDebtBase;
  console.log('Expected Health Factor:', (Number(expectedHF) / 10000).toFixed(4));
  console.log();

  // Step 7: Borrow USDC with variable rate
  console.log('─'.repeat(80));
  console.log('Step 7: Borrow USDC (Variable Rate)');
  console.log('─'.repeat(80));

  console.log('Borrowing:', formatAmount(borrowAmountUSDC, 6, 'USDC'));
  console.log('Interest Rate Mode: 2 (variable)');

  const borrowTx = await aavePool.borrow(
    USDC_ADDRESS,
    borrowAmountUSDC,
    2, // interestRateMode: 2 = variable
    0, // referralCode
    userAddress
  );
  await borrowTx.wait();
  console.log('✓ Transaction:', borrowTx.hash);
  console.log();

  // Step 8: Verify final position
  console.log('─'.repeat(80));
  console.log('Step 8: Verify Final Position');
  console.log('─'.repeat(80));

  const accountData = await aavePool.getUserAccountData(userAddress);
  const [
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor,
  ] = accountData;

  console.log('Total Collateral (base):', formatAmount(totalCollateralBase, 8, 'USD'));
  console.log('Total Debt (base):', formatAmount(totalDebtBase, 8, 'USD'));
  console.log('Available Borrows (base):', formatAmount(availableBorrowsBase, 8, 'USD'));
  console.log('Current Liquidation Threshold:', currentLiquidationThreshold.toString(), 'bps');
  console.log('LTV:', ltv.toString(), 'bps');
  console.log('Health Factor:', ethers.formatUnits(healthFactor, 18));
  console.log();

  // Summary
  console.log('═'.repeat(80));
  console.log('✅ Position Successfully Created!');
  console.log('═'.repeat(80));
  console.log();
  console.log('Summary:');
  console.log('  User Address:', userAddress);
  console.log('  Collateral:', formatAmount(wethBalance, 18, 'WETH'));
  console.log('  Debt:', formatAmount(borrowAmountUSDC, 6, 'USDC'));
  console.log('  Health Factor:', ethers.formatUnits(healthFactor, 18));
  console.log();
  console.log('The bot can now detect this position via on-chain queries.');
  console.log('Monitor with Pyth WS updates while bot reads from fork at:', rpcUrl);
  console.log();
}

// Run the script
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
