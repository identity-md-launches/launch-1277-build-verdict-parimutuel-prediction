import type { Address, Hex } from "viem";
export interface ChainConfig {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  expectedBlockSeconds: number;
  deployment?: {
    block: bigint;
    markets: Address;
    oracle: Address;
    burnVault: Address;
    token: Address;
    intake: Address;
    codeHashes: Record<"markets" | "oracle" | "burnVault", Hex>;
  };
}
// All network-specific facts live here. A new deployment requires only another entry.
// Ethereum is a data chain only: no Verdict mainnet deployment is configured.
export const CHAINS: Record<number, ChainConfig> = {
  11155111: {
    chainId: 11155111,
    name: "Sepolia",
    testnet: true,
    rpcUrls: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.ethpandaops.io",
      "https://sepolia.rpc.sentio.xyz",
    ],
    explorer: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    expectedBlockSeconds: 12,
    deployment: {
      block: 11888875n,
      markets: "0xc59c442a7a574561962e4687d4f6477ef88ff61f",
      oracle: "0xf9e8362469be9944e7e79732bcea9bcecb4ae25d",
      burnVault: "0x7e78b90c257d77863426966ca7c1328e20620eda",
      token: "0x44a1cd38474fb1748400e7deb5f8d786cce3f89a",
      intake: "0x1397434cd35e8a9c8ac312a61d3a285eb31dea56",
      codeHashes: {
        markets:
          "0xbdca7d383d8ca5076c7f0fb498fdf911b4dc4f4600db0ce3fe6b8965cb4f5a79",
        oracle:
          "0xf4281aeb0470b395873c171511d96cc99b92a7e2101a539a71e4a2e3f32dfbd8",
        burnVault:
          "0x19735bdf4d52c6f889cfd85f70fad899c9f4372c41ff8aa853bf043831e21b36",
      },
    },
  },
  1: {
    chainId: 1,
    name: "Ethereum",
    testnet: false,
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    explorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    expectedBlockSeconds: 12,
  },
};
export const DEPLOYED_CHAINS = Object.values(CHAINS).filter(
  (c) => c.deployment,
);
export const DEFAULT_CHAIN = DEPLOYED_CHAINS[0];
export const LINKS = {
  siteLabel: "verdict",
  site: "https://verdict.sites.imd.fun",
  github:
    "https://github.com/identity-md-launches/launch-1277-build-verdict-parimutuel-prediction",
  imd: "https://imd.fun",
  jobs: "https://explorer.imd.fun/jobs/",
  social: "https://x.com/VerdictIMD",
};
