/**
 * EIP-4527 ERC20 Token Transfer Example
 *
 * Extends the ETH transfer corpus example with ERC20-specific concerns:
 *   - The tx.to is the TOKEN CONTRACT, not the recipient
 *   - The tx.value is 0 (no ETH sent)
 *   - The recipient and amount live inside ABI-encoded calldata
 *
 * Shared pipeline functions (encodeToCbor, encodeToUr, decodeUrPayload,
 * generateQrPayload) are imported from eth-transfer to avoid duplication.
 * Only ERC20-specific logic lives here.
 *
 * Full pipeline:
 *   Build → ABI encode calldata → ethers RLP → CBOR → UR → QR
 */

import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Transaction, getBytes, Interface } from "ethers";
import type { TransactionEnvelope } from "../src/index";
import type { DgenError } from "../src/index";

// Import the shared EIP-4527 pipeline from the ETH transfer example.
// These functions operate on any Eip4527SignRequest — ERC20 is no different at that layer.
import {
  encodeToCbor,
  encodeToUr,
  decodeUrPayload,
  generateQrPayload,
  type Eip4527SignRequest,
} from "./eth-transfer";

// Re-export the shared pipeline so callers only need to import from this file.
export { encodeToCbor, encodeToUr, decodeUrPayload, generateQrPayload };

// ─── ERC20 ABI constants ──────────────────────────────────────────────────────

/**
 * keccak256("transfer(address,uint256)") truncated to 4 bytes.
 * Every ERC20-compatible transfer call must start with this selector.
 * Any other selector means the calldata is not a transfer.
 */
export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

/** Minimal ABI fragment — only the transfer function is needed for encode/decode. */
const ERC20_ABI = ["function transfer(address to, uint256 amount) returns (bool)"] as const;

/** Singleton Interface — ethers computes the function selector from the ABI text. */
const ERC20_INTERFACE = new Interface(ERC20_ABI);

// ─── Public types ─────────────────────────────────────────────────────────────

/** Parameters for building an ERC20 transfer transaction. */
export interface Erc20TransferParams {
  readonly chainId: number;
  readonly nonce: number;
  /**
   * Address of the ERC20 token contract.
   * This becomes tx.to — NOT the recipient of the tokens.
   */
  readonly tokenContract: string;
  /**
   * Address that receives the tokens.
   * Encoded inside calldata via ABI encoding — never appears directly in tx.to.
   */
  readonly recipient: string;
  /** Transfer amount in the token's smallest unit (e.g., for USDC: 1 USDC = 1_000_000). */
  readonly tokenAmount: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;           // wei, decimal string
  readonly maxPriorityFeePerGas: string;   // wei, decimal string
  readonly requestId?: Uint8Array;         // 16 bytes; random if omitted
  readonly origin?: string;
}

/** ERC20-specific token details, separate from the raw TransactionEnvelope. */
export interface Erc20TokenDetails {
  readonly tokenContract: string;
  readonly recipient: string;
  readonly tokenAmount: string;   // raw units, decimal string
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
}

/**
 * Decoded ERC20 transfer calldata.
 * The recipient and amount are extracted from ABI-encoded bytes — not from tx-level fields.
 */
export interface DecodedErc20Transfer {
  /** First 4 bytes of calldata: "0xa9059cbb" */
  readonly methodSelector: string;
  /** Full canonical signature: "transfer(address,uint256)" */
  readonly methodName: string;
  /** EIP-55 checksummed recipient address decoded from calldata. */
  readonly recipient: string;
  /** Transfer amount in smallest token unit, as decimal string. */
  readonly rawAmount: string;
}

/** All outputs from buildErc20TransferTx — sufficient for encode, render, and test. */
export interface Erc20TransferResult {
  readonly envelope: TransactionEnvelope;
  readonly signRequest: Eip4527SignRequest;
  readonly calldata: string;
  readonly decoded: DecodedErc20Transfer;
  readonly tokenDetails: Erc20TokenDetails;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Build an ERC20 transfer transaction, producing everything needed for
 * the EIP-4527 signing pipeline and human-readable display.
 *
 * Key invariants verified by callers:
 *   result.envelope.to   === params.tokenContract  (tx routes to the contract)
 *   result.envelope.value === "0"                  (no ETH transferred)
 *   result.calldata[0:10] === "0xa9059cbb"          (ERC20 transfer selector)
 */
export function buildErc20TransferTx(params: Erc20TransferParams): Erc20TransferResult {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.tokenContract)) {
    throw makeDgenError(
      "INVALID_ADDRESS",
      `Invalid token contract address: ${params.tokenContract}`,
      true,
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.recipient)) {
    throw makeDgenError(
      "INVALID_ADDRESS",
      `Invalid recipient address: ${params.recipient}`,
      true,
    );
  }

  // ABI-encode the transfer(address,uint256) call.
  // Layout (68 bytes total):
  //   [0:4]   4 bytes  — function selector 0xa9059cbb
  //   [4:36]  32 bytes — ABI-padded recipient address (12 zero bytes + 20 addr bytes)
  //   [36:68] 32 bytes — ABI-padded uint256 amount (big-endian, 32 bytes)
  const calldata = ERC20_INTERFACE.encodeFunctionData("transfer", [
    params.recipient,
    BigInt(params.tokenAmount),
  ]);

  // Build the EIP-1559 transaction.
  // tx.to = token contract; tx.value = 0; tx.data = ABI calldata.
  const ethTx = Transaction.from({
    type: 2,
    chainId: BigInt(params.chainId),
    nonce: params.nonce,
    maxFeePerGas: BigInt(params.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(params.maxPriorityFeePerGas),
    gasLimit: BigInt(params.gasLimit),
    to: params.tokenContract,
    value: 0n,
    data: calldata,
  });

  const signData = getBytes(ethTx.unsignedSerialized);

  const envelope: TransactionEnvelope = {
    chain: "ethereum",
    chainId: params.chainId,
    nonce: params.nonce,
    to: params.tokenContract,
    value: "0",
    data: calldata,
    gasLimit: params.gasLimit,
    maxFeePerGas: params.maxFeePerGas,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    type: "eip1559",
  };

  const requestId: Uint8Array =
    params.requestId ?? new Uint8Array(randomBytes(16));

  const signRequest: Eip4527SignRequest = {
    requestId,
    signData,
    dataType: 1,
    chainId: params.chainId,
    origin: params.origin ?? "ethos-eip4527-signer",
  };

  const tokenDetails: Erc20TokenDetails = {
    tokenContract: params.tokenContract,
    recipient: params.recipient,
    tokenAmount: params.tokenAmount,
    tokenSymbol: params.tokenSymbol,
    tokenDecimals: params.tokenDecimals,
  };

  // Decode the calldata we just encoded as a consistency check.
  const decoded = decodeErc20Transfer(calldata);

  return { envelope, signRequest, calldata, decoded, tokenDetails };
}

/**
 * Decode ERC20 transfer calldata into typed fields.
 *
 * Validates the selector and argument length before decoding.
 * All thrown errors are DgenError with recoverable: false — malformed calldata
 * is not a transient condition.
 *
 * ABI calldata layout for transfer(address,uint256):
 *   bytes  0– 3:  0xa9059cbb                          (4-byte selector)
 *   bytes  4–35:  000...000<20-byte-address>           (32-byte ABI-encoded address)
 *   bytes 36–67:  000...000<big-endian uint256>        (32-byte ABI-encoded amount)
 */
export function decodeErc20Transfer(calldata: string): DecodedErc20Transfer {
  if (!calldata.startsWith("0x")) {
    throw makeDgenError(
      "CALLDATA_INVALID",
      "Calldata must be a hex string starting with 0x",
      false,
    );
  }

  // 0x (2) + selector (8) + address arg (64) + uint256 arg (64) = 138 chars minimum
  if (calldata.length < 138) {
    throw makeDgenError(
      "CALLDATA_TOO_SHORT",
      `Calldata too short: need ≥138 chars for transfer(), got ${calldata.length}`,
      false,
    );
  }

  // First 4 bytes after 0x (characters 2–9) must be the ERC20 transfer selector.
  const selector = `0x${calldata.slice(2, 10).toLowerCase()}`;
  if (selector !== ERC20_TRANSFER_SELECTOR) {
    throw makeDgenError(
      "CALLDATA_WRONG_SELECTOR",
      `Expected ERC20 transfer selector ${ERC20_TRANSFER_SELECTOR}, got ${selector}`,
      false,
    );
  }

  try {
    // ethers ABI-decodes the arguments, returning checksummed address and bigint amount.
    const decoded = ERC20_INTERFACE.decodeFunctionData("transfer", calldata);
    const recipient = decoded[0] as string;
    const rawAmount = (decoded[1] as bigint).toString();

    return {
      methodSelector: ERC20_TRANSFER_SELECTOR,
      methodName: "transfer(address,uint256)",
      recipient,
      rawAmount,
    };
  } catch {
    throw makeDgenError(
      "CALLDATA_DECODE_FAILED",
      "ABI decode failed for transfer(address,uint256) calldata",
      false,
    );
  }
}

/**
 * Render a human-readable ERC20 transfer breakdown for display before signing.
 *
 * Amounts use BigInt arithmetic throughout — no floating-point coercion.
 * Displays the decoded recipient (from calldata) rather than tx.to (the contract).
 */
export function renderHumanReadable(result: Erc20TransferResult): string {
  const { envelope, decoded, tokenDetails } = result;

  return [
    "─── ERC20 Token Transfer ─────────────────────────",
    `  Method:                ${decoded.methodName}`,
    `  Network:               ${envelope.chain} (chainId: ${envelope.chainId ?? "?"})`,
    `  Type:                  ${envelope.type ?? "unknown"}`,
    `  Nonce:                 ${envelope.nonce ?? "?"}`,
    `  Token Contract:        ${tokenDetails.tokenContract}`,
    `  Recipient:             ${decoded.recipient}`,
    `  Amount:                ${toTokenAmount(decoded.rawAmount, tokenDetails.tokenDecimals, tokenDetails.tokenSymbol)}`,
    `  Gas Limit:             ${envelope.gasLimit ?? "?"}`,
    `  Max Fee/Gas:           ${envelope.maxFeePerGas ? toGwei(envelope.maxFeePerGas) : "?"}`,
    `  Max Priority Fee/Gas:  ${envelope.maxPriorityFeePerGas ? toGwei(envelope.maxPriorityFeePerGas) : "?"}`,
    "─────────────────────────────────────────────────",
  ].join("\n");
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeDgenError(code: string, message: string, recoverable: boolean): DgenError {
  return { code, message, recoverable };
}

/** Convert wei to a human-readable gwei string using BigInt to avoid precision loss. */
function toGwei(wei: string): string {
  const weiBI = BigInt(wei);
  const whole = weiBI / 10n ** 9n;
  const frac = (weiBI % 10n ** 9n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} gwei` : `${whole} gwei`;
}

/**
 * Format a raw token amount into human units using BigInt division.
 * Example: rawAmount="100000000", decimals=6, symbol="USDC" → "100.000000 USDC"
 */
function toTokenAmount(rawAmount: string, decimals: number, symbol: string): string {
  const raw = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = (raw % divisor).toString().padStart(decimals, "0");
  return `${whole}.${frac} ${symbol}`;
}

// ─── Demo parameters (deterministic) ─────────────────────────────────────────

/** Fixed requestId distinct from the ETH transfer example. */
const DEMO_REQUEST_ID = new Uint8Array([
  0x02, 0x46, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf,
  0x02, 0x46, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf,
]);

export const DEMO_PARAMS: Erc20TransferParams = {
  chainId: 1,
  nonce: 3,
  tokenContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum mainnet
  recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  tokenAmount: "100000000",   // 100 USDC (6 decimals: 100 × 10^6)
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  gasLimit: "65000",
  maxFeePerGas: "30000000000",        // 30 gwei
  maxPriorityFeePerGas: "1500000000", // 1.5 gwei
  requestId: DEMO_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = buildErc20TransferTx(DEMO_PARAMS);
  const { signRequest, calldata } = result;

  const cbor = encodeToCbor(signRequest);
  const ur = encodeToUr(cbor);
  const qr = await generateQrPayload(ur);

  console.log(renderHumanReadable(result));
  console.log();
  console.log("Calldata:");
  console.log(`  ${calldata}`);
  console.log();
  console.log("CBOR hex:");
  console.log(`  ${Buffer.from(cbor).toString("hex")}`);
  console.log();
  console.log("UR string:");
  console.log(`  ${ur}`);
  console.log();
  console.log("QR payload (terminal render):");
  console.log(qr);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error("Example failed:", err);
    process.exit(1);
  });
}
