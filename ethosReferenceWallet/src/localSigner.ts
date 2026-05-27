import { ethers } from 'ethers';

export interface LocalSignerInput {
  to?: string;
  from?: string;
  value?: string;
  nonce?: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  data?: string;
  chainId?: number;
}

export interface SigningResult {
  signedTx: string;
  signerAddress: string;
  elapsedMs: number;
}

// DEV ONLY — Hardhat well-known account #0. Public test key, never use in production.
const DEV_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export async function signLocally(tx: LocalSignerInput): Promise<SigningResult> {
  const start = Date.now();
  try {
    const wallet = new ethers.Wallet(DEV_PRIVATE_KEY);

    const ethersTx: ethers.TransactionRequest = {
      to:                   tx.to,
      nonce:                tx.nonce,
      value:                tx.value   !== undefined ? BigInt(tx.value)   : undefined,
      gasLimit:             tx.gasLimit !== undefined ? BigInt(tx.gasLimit) : undefined,
      maxFeePerGas:         tx.maxFeePerGas         !== undefined ? BigInt(tx.maxFeePerGas)         : undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas !== undefined ? BigInt(tx.maxPriorityFeePerGas) : undefined,
      data:                 tx.data ?? '0x',
      chainId:              tx.chainId !== undefined ? BigInt(tx.chainId) : 1n,
      type:                 2,
    };

    const signedTx = await wallet.signTransaction(ethersTx);
    return { signedTx, signerAddress: wallet.address, elapsedMs: Date.now() - start };
  } catch (e) {
    throw {
      code: 'SIGNING_FAILED',
      message: e instanceof Error ? e.message : 'Unknown signing error',
      recoverable: false,
    };
  }
}
