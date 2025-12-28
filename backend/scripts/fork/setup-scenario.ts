import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// Base mainnet addresses (fallbacks align with your existing .env)
const WETH = process.env.WETH_ADDRESS || "0x4200000000000000000000000000000000000006";
const USDC = process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AAVE_POOL = process.env.AAVE_POOL || process.env.AAVE_POOL_ADDRESS || "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_ORACLE = process.env.AAVE_ORACLE || "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156";
const PROTOCOL_DATA_PROVIDER = process.env.AAVE_PROTOCOL_DATA_PROVIDER || "0xC4Fcf9893072d61Cc2899C0054877Cb752587981";

// Local hardhat node RPC + test key
const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const TEST_PK = process.env.FORK_TEST_PK || process.env.TEST_PK || "";

// Optional script knobs
const ETH_DEPOSIT = process.env.FORK_TEST_ETH_DEPOSIT || "1.0"; // ETH to wrap into WETH
const TARGET_HF_BPS = process.env.FORK_TEST_TARGET_HF_BPS || "10200"; // default 1.02 * 10000
const SECOND_BORROW_BPS = process.env.FORK_TEST_SECOND_BORROW_BPS || ""; // e.g. "10080" for ~1.008

// Minimal ABIs
const wethAbi = [
  "function deposit() payable",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];
const erc20Abi = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];
const poolAbi = [
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)",
  "function borrow(address asset,uint256 amount,uint256 interestRateMode,uint16 referralCode,address onBehalfOf)"
];
const oracleAbi = [
  "function getAssetPrice(address asset) view returns (uint256)"
];
const dataProviderAbi = [
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals,uint256 reserveFactor,uint256 baseLTVasCollateral,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 debtCeiling,uint8 eModeCategory,bool isPaused,bool isActive,bool isFrozen)"
];

function formatUsdE8(x: bigint): string {
  // display with 2 decimals from 1e8 scaling
  const s = x.toString().padStart(3, "0");
  const i = s.length - 8;
  const whole = i > 0 ? s.slice(0, i) : "0";
  const frac = i > 0 ? s.slice(i, i + 2) : s.padStart(8, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

async function computeBorrowAmountUsdc6(
  wethWei: bigint,
  priceWeth_e8: bigint,
  priceUsdc_e8: bigint,
  ltBps: bigint,
  targetHFbps: bigint
): Promise<bigint> {
  // HF ≈ (collateral_value_usd * LTbps) / debt_value_usd
  // collateral_value_usd_e8 = priceWeth * amountWethWei / 1e18
  const collateralUsd_e8 = (priceWeth_e8 * wethWei) / BigInt(10 ** 18);
  const debtUsd_e8 = (collateralUsd_e8 * ltBps) / targetHFbps;
  let amountUsdc6 = (debtUsd_e8 * BigInt(10 ** 6)) / priceUsdc_e8;
  // safety margin so HF > 1.0 by a hair
  amountUsdc6 = (amountUsdc6 * BigInt(99)) / BigInt(100);
  return amountUsdc6;
}

async function main() {
  if (!TEST_PK) {
    console.error("FORK_TEST_PK (or TEST_PK) is required in .env to run the fork setup.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(TEST_PK, provider);
  console.log("Using test wallet:", wallet.address);

  const weth = new ethers.Contract(WETH, wethAbi, wallet);
  const usdc = new ethers.Contract(USDC, erc20Abi, wallet);
  const pool = new ethers.Contract(AAVE_POOL, poolAbi, wallet);
  const oracle = new ethers.Contract(AAVE_ORACLE, oracleAbi, wallet);
  const dataProvider = new ethers.Contract(PROTOCOL_DATA_PROVIDER, dataProviderAbi, wallet);

  // 1) Wrap ETH -> WETH
  console.log(`\n[1/6] Wrapping ETH -> WETH: ${ETH_DEPOSIT} ETH`);
  const depTx = await weth.deposit({ value: ethers.parseEther(ETH_DEPOSIT) });
  await depTx.wait();
  const wethBal = await weth.balanceOf(wallet.address);
  console.log("WETH balance:", ethers.formatEther(wethBal));

  // 2) Approve & supply WETH to Aave v3 Pool
  console.log("\n[2/6] Approving Aave Pool for WETH...");
  await (await weth.approve(AAVE_POOL, wethBal)).wait();
  console.log("Supplying WETH to Aave v3 Pool...");
  await (await pool.supply(WETH, wethBal, wallet.address, 0)).wait();

  // 3) Read prices & liquidation threshold
  console.log("\n[3/6] Reading Aave Oracle prices (1e8) and WETH liquidationThreshold (bps)...");
  const priceWeth_e8 = BigInt(await oracle.getAssetPrice(WETH));
  const priceUsdc_e8 = BigInt(await oracle.getAssetPrice(USDC));
  const cfg = await dataProvider.getReserveConfigurationData(WETH);
  const ltBps = BigInt(cfg.liquidationThreshold);
  console.log(
    `WETH=${formatUsdE8(priceWeth_e8)} USD (1e8), USDC=${formatUsdE8(priceUsdc_e8)} USD (1e8), LTbps=${ltBps}`
  );

  // 4) Compute & borrow (target HF ≈ TARGET_HF_BPS)
  console.log("\n[4/6] Computing initial USDC borrow for target HF bps:", TARGET_HF_BPS);
  const targetHFbps = BigInt(TARGET_HF_BPS);
  const amountUsdc6 = await computeBorrowAmountUsdc6(
    BigInt(wethBal),
    priceWeth_e8,
    priceUsdc_e8,
    ltBps,
    targetHFbps
  );
  console.log(`Borrowing ~${amountUsdc6.toString()} USDC (6d)`);
  await (await pool.borrow(USDC, amountUsdc6, 2, 0, wallet.address)).wait();
  const usdcBal1 = await usdc.balanceOf(wallet.address);
  console.log("USDC balance after initial borrow:", usdcBal1.toString());

  // 5) Optional: second small borrow to push HF closer to 1.005–1.01
  if (SECOND_BORROW_BPS) {
    console.log("\n[5/6] Performing optional second borrow to tighten HF, target bps:", SECOND_BORROW_BPS);
    const secondTarget = BigInt(SECOND_BORROW_BPS);
    const amountUsdc6b = await computeBorrowAmountUsdc6(
      BigInt(wethBal),
      priceWeth_e8,
      priceUsdc_e8,
      ltBps,
      secondTarget
    );
    // only borrow the delta beyond the first borrow
    const delta = amountUsdc6b > amountUsdc6 ? (amountUsdc6b - amountUsdc6) : BigInt(0);
    if (delta > BigInt(0)) {
      console.log(`Second borrow delta: ${delta.toString()} USDC (6d)`);
      await (await pool.borrow(USDC, delta, 2, 0, wallet.address)).wait();
    } else {
      console.log("Second borrow skipped (delta <= 0)");
    }
    const usdcBal2 = await usdc.balanceOf(wallet.address);
    console.log("USDC balance after second borrow:", usdcBal2.toString());
  } else {
    console.log("\n[5/6] Skipping second borrow (FORK_TEST_SECOND_BORROW_BPS not set)");
  }

  console.log("\n[6/6] Setup complete.");
  console.log("Next steps:");
  console.log("  • Start bot with PYTH_ENABLED=true (Pyth WS) and all RPCs pointing to http://127.0.0.1:8545");
  console.log("  • Ensure USE_FLASHBLOCKS=false and EXECUTE=false for safe testing");
  console.log("  • Watch /metrics for predictive/price-trigger counters and min HF movements");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
