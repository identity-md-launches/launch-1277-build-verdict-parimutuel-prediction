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
    weth: Address;
    intake: Address;
    codeHashes: Record<"markets" | "oracle" | "burnVault", Hex>;
  };
}
export const CHAINS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: "Ethereum",
    testnet: false,
    rpcUrls: [
      "https://mainnet.gateway.tenderly.co",
      "https://rpc.mevblocker.io",
      "https://ethereum-rpc.publicnode.com",
    ],
    explorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    expectedBlockSeconds: 12,
    deployment: {
      block: 26172752n,
      markets: "0x279ac25fb2ef2239241c439a007f39c42f99e334",
      oracle: "0x8ce069975ae8c69bf7cb2bd225aafa43ba307931",
      burnVault: "0xb1dfe46f912543e366175201edb298263911a1aa",
      token: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
      weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      intake: "0xa43e6f75ee006411f79ac1c84120606c2330de82",
      // Runtime hashes read from the worker's Ethereum RPC; see ABI provenance.
      codeHashes: {
        markets:
          "0x369d282ee60b2e19d138dc7626d5a1450520089e44329d082bdd5a6593a79c5b",
        oracle:
          "0xde70a6c80f1b6378911213a3d0570297a4620c0e8ee9be3451e7eed577ca2355",
        burnVault:
          "0x19735bdf4d52c6f889cfd85f70fad899c9f4372c41ff8aa853bf043831e21b36",
      },
    },
  },
};
export const DEPLOYED_CHAINS = [CHAINS[1]];
export const DEFAULT_CHAIN = CHAINS[1];
export const LINKS = {
  siteLabel: "verdict",
  site: "https://verdict.sites.imd.fun",
  github:
    "https://github.com/identity-md-launches/launch-1346-deploy-repository-s-audited-verdict",
  sourceCommit: "083060a",
  imd: "https://imd.fun",
  jobs: "https://explorer.imd.fun/jobs/",
  review: "https://explorer.imd.fun/jobs/8f416162-687e-4cda-b965-c20116b36ff0",
  oracleExplorer: "https://explorer.imd.fun/oracle",
  social: "https://x.com/VerdictIMD",
};
