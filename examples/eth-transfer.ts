/**
 * EIP-4527 Ethereum ETH Transfer Example
 *
 * Demonstrates the complete QR signing pipeline:
 *   Build → Serialize (ethers v6) → CBOR (EIP-4527 eth-sign-request) → UR → QR
 *
 * All values are deterministic when a fixed requestId is supplied,
 * making this file safe to use as a unit-test fixture.
 *
 * Functions are pure and stateless — safe to import and test without side effects.
 * The main() runner only executes when this file is the direct entry point.
 */

import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Transaction, getBytes } from "ethers";
import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import { UR, UREncoder, URDecoder } from "@ngraveio/bc-ur";
import QRCode from "qrcode";
import type { TransactionEnvelope } from "../src/index";
import type { DgenError } from "../src/index";

// ─── EIP-4527 constants ───────────────────────────────────────────────────────

/**
 * Integer map keys defined by the EIP-4527 CDDL schema for eth-sign-request.
 * Keys are integers (not strings) — CBOR encodes them as major type 0.
 */
const EIP4527_KEY = {
  REQUEST_ID: 1,
  SIGN_DATA: 2,
  DATA_TYPE: 3,
  CHAIN_ID: 4,
  ORIGIN: 7,
} as const;

/**
 * data-type: 1 = unsigned transaction bytes.
 * Distinct from typed-data (2) and raw-bytes (3).
 */
const DATA_TYPE_TRANSACTION = 1 as const;

// ─── Public types ─────────────────────────────────────────────────────────────

/** Input parameters for an EIP-1559 native ETH transfer. */
export interface EthTransferParams {
  readonly chainId: number;
  readonly nonce: number;
  readonly to: string;
  readonly value: string;                  // wei, decimal string — never coerce to number
  readonly gasLimit: string;
  readonly maxFeePerGas: string;           // wei, decimal string
  readonly maxPriorityFeePerGas: string;   // wei, decimal string
  /**
   * 16-byte UUID identifying this signing request.
   * Pass a fixed value for deterministic output in tests.
   * Omit to generate a random UUID at runtime.
   */
  readonly requestId?: Uint8Array;
  readonly origin?: string;
}

/** The EIP-4527 eth-sign-request payload, ready for CBOR encoding. */
export interface Eip4527SignRequest {
  readonly requestId: Uint8Array;
  /** RLP-encoded unsigned EIP-1559 transaction — the bytes a signer hashes to produce sig input. */
  readonly signData: Uint8Array;
  readonly dataType: typeof DATA_TYPE_TRANSACTION;
  readonly chainId: number;
  readonly origin: string;
}

// ─── Pipeline functions ───────────────────────────────────────────────────────

/**
 * Build a TransactionEnvelope (for human display) and an Eip4527SignRequest
 * (for CBOR encoding) from typed EIP-1559 transfer parameters.
 *
 * Throws DgenError (recoverable) for an invalid to-address.
 */
export function buildTransferTx(params: EthTransferParams): {
  readonly envelope: TransactionEnvelope;
  readonly signRequest: Eip4527SignRequest;
} {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.to)) {
    const err: DgenError = {
      code: "INVALID_ADDRESS",
      message: `Invalid Ethereum address: ${params.to}`,
      recoverable: true,
    };
    throw err;
  }

  // Construct the transaction via ethers v6 to get canonical EIP-1559 RLP serialization.
  // All numeric fields use BigInt — never Number — to prevent precision loss on large values.
  const ethTx = Transaction.from({
    type: 2, // EIP-1559
    chainId: BigInt(params.chainId),
    nonce: params.nonce,
    maxFeePerGas: BigInt(params.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(params.maxPriorityFeePerGas),
    gasLimit: BigInt(params.gasLimit),
    to: params.to,
    value: BigInt(params.value),
    data: "0x",
  });

  // unsignedSerialized = "0x02" + RLP([chainId, nonce, maxPriorityFee, maxFee, gasLimit, to, value, data, accessList])
  // The 0x02 prefix identifies this as an EIP-1559 typed transaction.
  const signData = getBytes(ethTx.unsignedSerialized);

  const envelope: TransactionEnvelope = {
    chain: "ethereum",
    chainId: params.chainId,
    nonce: params.nonce,
    to: params.to,
    value: params.value,
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
    dataType: DATA_TYPE_TRANSACTION,
    chainId: params.chainId,
    origin: params.origin ?? "ethos-eip4527-signer",
  };

  return { envelope, signRequest };
}

/**
 * Encode an EIP-4527 sign request as CBOR.
 *
 * The CBOR map uses integer keys as specified in the EIP-4527 CDDL schema.
 * Using a Map (not a plain object) preserves integer key types in the CBOR output.
 * Byte fields (requestId, signData) are encoded as CBOR byte strings (major type 2).
 */
export function encodeToCbor(req: Eip4527SignRequest): Uint8Array {
  const cborMap = new Map<number, unknown>([
    [EIP4527_KEY.REQUEST_ID, Buffer.from(req.requestId)],
    [EIP4527_KEY.SIGN_DATA, Buffer.from(req.signData)],
    [EIP4527_KEY.DATA_TYPE, req.dataType],
    [EIP4527_KEY.CHAIN_ID, req.chainId],
    [EIP4527_KEY.ORIGIN, req.origin],
  ]);

  // cbor-x encodes a Map as a CBOR map, preserving key types.
  // Return a copy (not the Buffer reference) for immutability.
  return new Uint8Array(cborEncode(cborMap));
}

/**
 * Encode a CBOR payload as a single-part UR string.
 *
 * UR type: "eth-sign-request" (EIP-4527).
 * Single-part is appropriate for payloads under ~500 bytes.
 * For larger payloads use UREncoder directly with a fragment size for animated QR.
 *
 * Returns a lowercase UR string: "ur:eth-sign-request/<bytewords>".
 */
export function encodeToUr(cbor: Uint8Array): string {
  const ur = new UR(Buffer.from(cbor), "eth-sign-request");
  // encodeSinglePart produces a single-fragment UR — no animated QR required.
  return UREncoder.encodeSinglePart(ur);
}

/**
 * Decode a single-part UR string back to an Eip4527SignRequest.
 *
 * Throws DgenError for malformed or non-eth-sign-request URs.
 * For animated (multi-part) UR, collect all fragments and use URDecoder directly.
 */
export function decodeUrPayload(urString: string): Eip4527SignRequest {
  let ur: UR;
  try {
    // URDecoder.decode handles single-part UR directly.
    ur = URDecoder.decode(urString);
  } catch {
    const err: DgenError = {
      code: "UR_INVALID",
      message: "Malformed UR string — failed to decode",
      recoverable: false,
    };
    throw err;
  }

  if (ur.type !== "eth-sign-request") {
    const err: DgenError = {
      code: "UR_WRONG_TYPE",
      message: `Expected UR type "eth-sign-request", got "${ur.type}"`,
      recoverable: false,
    };
    throw err;
  }

  // cbor-x decodes CBOR maps with integer keys into plain JS objects.
  // Integer keys become numeric property names (accessible via String(key)).
  const decoded: unknown = cborDecode(ur.cbor);

  const requestId = getMapField(decoded, EIP4527_KEY.REQUEST_ID);
  const signData = getMapField(decoded, EIP4527_KEY.SIGN_DATA);
  const chainId = getMapField(decoded, EIP4527_KEY.CHAIN_ID);
  const origin = getMapField(decoded, EIP4527_KEY.ORIGIN);

  if (!(requestId instanceof Uint8Array)) {
    throw makeDgenError("UR_DECODE_FIELD", "requestId field is missing or not bytes", false);
  }
  if (!(signData instanceof Uint8Array)) {
    throw makeDgenError("UR_DECODE_FIELD", "signData field is missing or not bytes", false);
  }
  if (typeof chainId !== "number") {
    throw makeDgenError("UR_DECODE_FIELD", "chainId field is missing or not a number", false);
  }
  if (typeof origin !== "string") {
    throw makeDgenError("UR_DECODE_FIELD", "origin field is missing or not a string", false);
  }

  return {
    requestId: new Uint8Array(requestId),
    signData: new Uint8Array(signData),
    dataType: DATA_TYPE_TRANSACTION,
    chainId,
    origin,
  };
}

/**
 * Render a human-readable breakdown of the transaction envelope.
 *
 * ETH and gwei values are computed using BigInt arithmetic to avoid
 * floating-point precision loss on large wei amounts.
 */
export function renderHumanReadable(envelope: TransactionEnvelope): string {
  const toEth = (wei: string): string => {
    const weiBI = BigInt(wei);
    const whole = weiBI / 10n ** 18n;
    const frac = (weiBI % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
    return `${whole}.${frac} ETH`;
  };

  const toGwei = (wei: string): string => {
    const weiBI = BigInt(wei);
    const whole = weiBI / 10n ** 9n;
    const frac = (weiBI % 10n ** 9n).toString().padStart(9, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac} gwei` : `${whole} gwei`;
  };

  return [
    "─── EIP-1559 Transfer ───────────────────────────",
    `  Chain:                 ${envelope.chain} (chainId: ${envelope.chainId ?? "?"})`,
    `  Type:                  ${envelope.type ?? "unknown"}`,
    `  Nonce:                 ${envelope.nonce ?? "?"}`,
    `  To:                    ${envelope.to ?? "(none)"}`,
    `  Value:                 ${envelope.value ? `${toEth(envelope.value)} (${envelope.value} wei)` : "(none)"}`,
    `  Gas Limit:             ${envelope.gasLimit ?? "?"}`,
    `  Max Fee/Gas:           ${envelope.maxFeePerGas ? toGwei(envelope.maxFeePerGas) : "?"}`,
    `  Max Priority Fee/Gas:  ${envelope.maxPriorityFeePerGas ? toGwei(envelope.maxPriorityFeePerGas) : "?"}`,
    "─────────────────────────────────────────────────",
  ].join("\n");
}

/**
 * Generate a terminal QR code string from a UR string.
 *
 * UR is uppercased before encoding. QR alphanumeric mode ([A-Z0-9$%*+\-./:])
 * covers all uppercase UR characters, producing a more compact QR than binary mode.
 */
export async function generateQrPayload(urString: string): Promise<string> {
  return QRCode.toString(urString.toUpperCase(), { type: "terminal" });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract a value from a decoded CBOR map regardless of whether cbor-x returned
 * a plain object (integer keys coerced to string) or a Map (integer keys preserved).
 */
function getMapField(decoded: unknown, key: number): unknown {
  if (decoded instanceof Map) return decoded.get(key);
  if (typeof decoded === "object" && decoded !== null) {
    return (decoded as Record<string, unknown>)[String(key)];
  }
  return undefined;
}

function makeDgenError(code: string, message: string, recoverable: boolean): DgenError {
  return { code, message, recoverable };
}

// ─── Demo parameters (deterministic) ─────────────────────────────────────────

/** Fixed params for the interactive demo and for test baseline comparison. */
export const DEMO_PARAMS: EthTransferParams = {
  chainId: 1,
  nonce: 5,
  to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  value: "1000000000000000000",       // 1 ETH
  gasLimit: "21000",
  maxFeePerGas: "30000000000",        // 30 gwei
  maxPriorityFeePerGas: "1500000000", // 1.5 gwei
  requestId: new Uint8Array([
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
  ]),
  origin: "ethos-eip4527-signer",
} as const;

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { envelope, signRequest } = buildTransferTx(DEMO_PARAMS);
  const cbor = encodeToCbor(signRequest);
  const ur = encodeToUr(cbor);
  const qr = await generateQrPayload(ur);

  console.log(renderHumanReadable(envelope));
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

// Guard: only run main() when this file is the direct entry point, not when imported.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error("Example failed:", err);
    process.exit(1);
  });
}
