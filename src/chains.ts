export type SupportedChain =
  | "ethereum"
  | "arbitrum"
  | "optimism"
  | "base"
  | "polygon"
  | "solana";

export interface ChainInfo {
  id: number;
  name: string;
  symbol: string;
}

export const CHAINS: Record<string, ChainInfo> = {
  ethereum: {
    id: 1,
    name: "Ethereum",
    symbol: "ETH"
  }
};