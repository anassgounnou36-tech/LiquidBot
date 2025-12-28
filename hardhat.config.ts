import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const HARDHAT_FORK_URL =
  process.env.HARDHAT_FORK_URL || "https://base-mainnet.g.alchemy.com/v2/YOUR_KEY";
const HARDHAT_FORK_BLOCK = process.env.HARDHAT_FORK_BLOCK
  ? Number(process.env.HARDHAT_FORK_BLOCK)
  : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {
      chainId: 8453, // Base
      forking: {
        url: HARDHAT_FORK_URL,
        blockNumber: HARDHAT_FORK_BLOCK,
      },
      mining: { auto: true, interval: 0 },
      gas: "auto",
      gasPrice: "auto",
    },
  },
};

export default config;
