import { ethers } from 'ethers';
import { z } from 'zod';
import type { DgenError } from '../errors';

const PrivateKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export interface DevAccount {
  readonly privateKey: string;
  readonly address: string;
}

export function loadDevAccount(): DevAccount {
  const raw = process.env.DEV_PRIVATE_KEY;

  const result = PrivateKeySchema.safeParse(raw);
  if (!result.success) {
    const err: DgenError = {
      code: 'DEV_KEY_INVALID',
      message: raw === undefined
        ? 'DEV_PRIVATE_KEY is not set. Copy .env.example to .env and supply a Sepolia private key.'
        : 'DEV_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string (66 characters).',
      recoverable: false,
    };
    throw err;
  }

  const address = new ethers.Wallet(result.data).address;
  return { privateKey: result.data, address };
}
