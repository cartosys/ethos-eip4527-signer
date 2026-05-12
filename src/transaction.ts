export interface TransactionEnvelope {
  chain: SupportedChain;

  from?: string;
  to?: string;

  value?: string;

  nonce?: number;

  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;

  data?: string;

  chainId?: number;

  type?: "legacy" | "eip1559";

  metadata?: TransactionMetadata;
}

export interface TransactionMetadata {
  origin?: string;
  timestamp?: number;
  notes?: string[];
}