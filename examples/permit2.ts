/**
 * EIP-4527 Permit2 EIP-712 Typed Data Signing Example
 *
 * Demonstrates signing a Uniswap Permit2 PermitSingle payload as EIP-712
 * typed structured data, transported via EIP-4527 QR encoding.
 *
 * Key distinctions from the ETH and ERC20 examples:
 *   - data-type: 2 (typed-data) in the CBOR sign-request, not 1 (transaction)
 *   - sign-data contains JSON-encoded EIP-712 typed data as UTF-8 bytes,
 *     not an RLP-encoded transaction
 *   - No on-chain transaction — only a signed off-chain permission message
 *   - The signing hash is keccak256(0x1901 + domainSeparator + messageHash)
 *
 * Permit2 domain intentionally omits the "version" field — this matches the
 * Uniswap Permit2 contract's domain registration exactly.
 *
 * Full pipeline:
 *   Build typed data → JSON → UTF-8 bytes → CBOR (data-type: 2) → UR → QR
 */

import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { TypedDataEncoder } from "ethers";
import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import { UR, URDecoder } from "@ngraveio/bc-ur";
import { z } from "zod";
import type { DgenError } from "../src/index";

// Import shared pipeline: encodeToUr and generateQrPayload operate on CBOR bytes
// and UR strings, not on sign-request types, so they are fully reusable here.
import { encodeToUr, generateQrPayload } from "./eth-transfer";
export { encodeToUr, generateQrPayload };

// ─── EIP-4527 constants ───────────────────────────────────────────────────────

const EIP4527_KEY = {
  REQUEST_ID: 1,
  SIGN_DATA: 2,
  DATA_TYPE: 3,
  CHAIN_ID: 4,
  ORIGIN: 7,
} as const;

/** data-type: 2 = EIP-712 typed structured data (eth_signTypedData). */
const DATA_TYPE_TYPED_DATA = 2 as const;

// ─── Permit2 EIP-712 type definitions ────────────────────────────────────────

/** Canonical Permit2 contract address — same across all EVM chains. */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * EIP-712 type definitions for Permit2 PermitSingle.
 *
 * These exactly mirror the Permit2 contract ABI. The ordering of fields matters
 * for ABI encoding — do not reorder without verifying the contract source.
 *
 * Typed as mutable arrays to satisfy ethers' TypedDataEncoder.hash signature.
 */
export const PERMIT2_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
};

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Permit2Domain {
  readonly name: "Permit2";
  readonly chainId: number;
  readonly verifyingContract: string;
}

export interface PermitDetails {
  readonly token: string;
  readonly amount: string;      // uint160 as decimal string
  readonly expiration: number;  // uint48, unix timestamp seconds
  readonly nonce: number;       // uint48
}

export interface PermitSingle {
  readonly details: PermitDetails;
  readonly spender: string;
  readonly sigDeadline: string; // uint256 as decimal string
}

export interface Permit2TypedData {
  readonly domain: Permit2Domain;
  readonly types: Record<string, Array<{ name: string; type: string }>>;
  readonly message: PermitSingle;
  readonly primaryType: "PermitSingle";
}

export interface Permit2SignRequest {
  readonly requestId: Uint8Array;
  /** JSON-encoded Permit2TypedData as UTF-8 bytes — the signing payload for the signer. */
  readonly signData: Uint8Array;
  readonly dataType: typeof DATA_TYPE_TYPED_DATA;
  readonly chainId: number;
  readonly origin: string;
}

export interface Permit2Params {
  readonly chainId: number;
  readonly tokenContract: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly spender: string;
  /** Transfer amount in the token's smallest unit. uint160 decimal string. */
  readonly amount: string;
  /** Unix timestamp (seconds) — uint48. */
  readonly expiration: number;
  readonly nonce: number;
  /** Unix timestamp (seconds) — uint256 decimal string. */
  readonly sigDeadline: string;
  readonly requestId?: Uint8Array;
  readonly origin?: string;
}

export interface Permit2BuildResult {
  readonly typedData: Permit2TypedData;
  readonly signRequest: Permit2SignRequest;
  readonly signingHash: string;
  readonly params: Permit2Params;
}

export type SecurityWarningCode =
  | "UNLIMITED_APPROVAL"
  | "ZERO_AMOUNT"
  | "EXPIRED_PERMIT"
  | "LONG_EXPIRATION"
  | "ZERO_ADDRESS_SPENDER";

export interface SecurityWarning {
  readonly code: SecurityWarningCode;
  readonly message: string;
}

// ─── Zod validation schema ────────────────────────────────────────────────────

const PermitDetailsSchema = z.object({
  token: z.string(),
  amount: z.string(),
  expiration: z.number(),
  nonce: z.number(),
});

const PermitSingleSchema = z.object({
  details: PermitDetailsSchema,
  spender: z.string(),
  sigDeadline: z.string(),
});

const Permit2TypedDataSchema = z.object({
  domain: z.object({
    name: z.literal("Permit2"),
    chainId: z.number(),
    verifyingContract: z.string(),
  }),
  types: z.object({
    PermitDetails: z.array(z.object({ name: z.string(), type: z.string() })),
    PermitSingle: z.array(z.object({ name: z.string(), type: z.string() })),
  }),
  message: PermitSingleSchema,
  primaryType: z.literal("PermitSingle"),
});

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Build a Permit2 PermitSingle EIP-712 payload and wrap it in an EIP-4527 sign request.
 *
 * The sign-data is JSON-encoded typed data serialized to UTF-8 bytes, allowing
 * the receiving hardware signer to parse and display the approval fields before signing.
 *
 * Throws DgenError (recoverable: true) for invalid addresses.
 */
export function buildPermit2Payload(params: Permit2Params): Permit2BuildResult {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.tokenContract)) {
    throw makeDgenError(
      "INVALID_ADDRESS",
      `Invalid token contract address: ${params.tokenContract}`,
      true,
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.spender)) {
    throw makeDgenError(
      "INVALID_ADDRESS",
      `Invalid spender address: ${params.spender}`,
      true,
    );
  }

  const domain: Permit2Domain = {
    name: "Permit2",
    chainId: params.chainId,
    verifyingContract: PERMIT2_ADDRESS,
  };

  const message: PermitSingle = {
    details: {
      token: params.tokenContract,
      amount: params.amount,
      expiration: params.expiration,
      nonce: params.nonce,
    },
    spender: params.spender,
    sigDeadline: params.sigDeadline,
  };

  const typedData: Permit2TypedData = {
    domain,
    types: PERMIT2_TYPES,
    message,
    primaryType: "PermitSingle",
  };

  // TypedDataEncoder.hash computes keccak256(0x1901 + domainSeparator + messageHash).
  // Permit2 uses PermitSingle as the root type; TypedDataEncoder auto-detects it
  // because PermitSingle is the only type not referenced by another type.
  const signingHash = TypedDataEncoder.hash(domain, PERMIT2_TYPES, message);

  // Encode the full typed data as JSON → UTF-8 bytes.
  // JSON encoding preserves all field names and types for signer-side validation.
  const signData = new TextEncoder().encode(JSON.stringify(typedData));

  const requestId: Uint8Array =
    params.requestId ?? new Uint8Array(randomBytes(16));

  const signRequest: Permit2SignRequest = {
    requestId,
    signData,
    dataType: DATA_TYPE_TYPED_DATA,
    chainId: params.chainId,
    origin: params.origin ?? "ethos-eip4527-signer",
  };

  return { typedData, signRequest, signingHash, params };
}

/**
 * Encode a Permit2SignRequest as CBOR using EIP-4527 integer keys.
 *
 * Uses data-type: 2 to signal to the receiving signer that sign-data contains
 * EIP-712 typed data, not a raw transaction.
 */
export function encodeToCbor(req: Permit2SignRequest): Uint8Array {
  const cborMap = new Map<number, unknown>([
    [EIP4527_KEY.REQUEST_ID, Buffer.from(req.requestId)],
    [EIP4527_KEY.SIGN_DATA, Buffer.from(req.signData)],
    [EIP4527_KEY.DATA_TYPE, req.dataType],
    [EIP4527_KEY.CHAIN_ID, req.chainId],
    [EIP4527_KEY.ORIGIN, req.origin],
  ]);
  return new Uint8Array(cborEncode(cborMap));
}

/**
 * Decode and validate sign-data bytes as a Permit2TypedData structure.
 *
 * Parses JSON from the UTF-8 sign-data bytes and validates against the
 * Zod schema before returning typed data.
 *
 * Throws DgenError (recoverable: false) for malformed or invalid payloads.
 */
export function decodePermit2Payload(signData: Uint8Array): Permit2TypedData {
  let jsonStr: string;
  try {
    jsonStr = new TextDecoder().decode(signData);
  } catch {
    throw makeDgenError(
      "PAYLOAD_DECODE_FAILED",
      "signData bytes are not valid UTF-8",
      false,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw makeDgenError(
      "PAYLOAD_DECODE_FAILED",
      "signData is not valid JSON",
      false,
    );
  }

  const result = Permit2TypedDataSchema.safeParse(parsed);
  if (!result.success) {
    throw makeDgenError(
      "PAYLOAD_INVALID",
      `Permit2 typed data schema validation failed: ${result.error.message}`,
      false,
    );
  }

  return result.data as Permit2TypedData;
}

/**
 * Decode a UR string containing a Permit2 sign request back to Permit2TypedData.
 *
 * Extracts the sign-data bytes from the UR → CBOR → JSON pipeline,
 * then validates with the Permit2 Zod schema.
 */
export function decodePermit2UrPayload(urString: string): Permit2TypedData {
  let ur: UR;
  try {
    ur = URDecoder.decode(urString);
  } catch {
    throw makeDgenError("UR_INVALID", "Malformed UR string — failed to decode", false);
  }

  if (ur.type !== "eth-sign-request") {
    throw makeDgenError(
      "UR_WRONG_TYPE",
      `Expected UR type "eth-sign-request", got "${ur.type}"`,
      false,
    );
  }

  const decoded: unknown = cborDecode(ur.cbor);
  const signData = getMapField(decoded, EIP4527_KEY.SIGN_DATA);

  if (!(signData instanceof Uint8Array)) {
    throw makeDgenError("UR_DECODE_FIELD", "signData field missing or not bytes", false);
  }

  return decodePermit2Payload(new Uint8Array(signData));
}

/**
 * Analyze a Permit2TypedData for security-relevant conditions.
 *
 * @param typedData - The decoded Permit2 typed data to inspect.
 * @param now - Unix timestamp (seconds) for expiration comparisons. Defaults to current time.
 *              Supply a fixed value in tests to ensure deterministic results.
 */
export function analyzePermit2(
  typedData: Permit2TypedData,
  now: number = Math.floor(Date.now() / 1000),
): { readonly warnings: readonly SecurityWarning[] } {
  const { message } = typedData;
  const { details } = message;
  const warnings: SecurityWarning[] = [];

  const UINT160_MAX = 2n ** 160n - 1n;
  const amountBn = BigInt(details.amount);

  if (amountBn === UINT160_MAX) {
    warnings.push({
      code: "UNLIMITED_APPROVAL",
      message:
        "This permit grants unlimited token approval (uint160 max). The spender can transfer all your tokens.",
    });
  }

  if (amountBn === 0n) {
    warnings.push({
      code: "ZERO_AMOUNT",
      message: "This permit approves zero tokens — it grants no spending power.",
    });
  }

  if (details.expiration <= now) {
    warnings.push({
      code: "EXPIRED_PERMIT",
      message: `This permit expired at ${new Date(details.expiration * 1000).toISOString()}. Signing it will have no effect.`,
    });
  } else if (details.expiration > now + 365 * 24 * 3600) {
    warnings.push({
      code: "LONG_EXPIRATION",
      message: `This permit expires ${new Date(details.expiration * 1000).toISOString()} — more than 1 year from now.`,
    });
  }

  if (message.spender === "0x0000000000000000000000000000000000000000") {
    warnings.push({
      code: "ZERO_ADDRESS_SPENDER",
      message: "The spender is the zero address — this permit cannot be used by any party.",
    });
  }

  return { warnings };
}

/**
 * Render a human-readable Permit2 approval breakdown for display before signing.
 *
 * Amounts use BigInt arithmetic throughout — no floating-point coercion.
 * Displays the true recipient from calldata, not tx.to.
 */
export function renderHumanReadable(
  result: Permit2BuildResult,
  warnings: readonly SecurityWarning[],
): string {
  const { typedData, signingHash, params } = result;
  const { message } = typedData;
  const { details } = message;

  const UINT160_MAX = 2n ** 160n - 1n;
  const amountBn = BigInt(details.amount);
  const isUnlimited = amountBn === UINT160_MAX;

  let formattedAmount: string;
  if (isUnlimited) {
    formattedAmount = `UNLIMITED ${params.tokenSymbol}`;
  } else {
    const divisor = 10n ** BigInt(params.tokenDecimals);
    const whole = amountBn / divisor;
    const frac = (amountBn % divisor).toString().padStart(params.tokenDecimals, "0");
    formattedAmount = `${whole}.${frac} ${params.tokenSymbol}`;
  }

  const expirationIso = new Date(details.expiration * 1000).toISOString();
  const deadlineIso = new Date(Number(message.sigDeadline) * 1000).toISOString();

  const lines = [
    "─── Permit2 Token Approval ───────────────────────",
    `  Type:                  EIP-712 Typed Data`,
    `  Protocol:              Permit2 (Uniswap)`,
    `  Network:               ethereum (chainId: ${typedData.domain.chainId})`,
    `  Token:                 ${params.tokenSymbol} (${details.token})`,
    `  Spender:               ${message.spender}`,
    `  Amount:                ${formattedAmount}`,
    `  Expiration:            ${expirationIso}`,
    `  Nonce:                 ${details.nonce}`,
    `  Sig Deadline:          ${deadlineIso}`,
    `  Signing Hash:          ${signingHash}`,
  ];

  if (warnings.length > 0) {
    lines.push("  ─── Security Warnings ──────────────────────────");
    for (const w of warnings) {
      lines.push(`  WARN ${w.code}: ${w.message}`);
    }
  }

  lines.push("─────────────────────────────────────────────────");

  return lines.join("\n");
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeDgenError(code: string, message: string, recoverable: boolean): DgenError {
  return { code, message, recoverable };
}

function getMapField(decoded: unknown, key: number): unknown {
  if (decoded instanceof Map) return decoded.get(key);
  if (typeof decoded === "object" && decoded !== null) {
    return (decoded as Record<string, unknown>)[String(key)];
  }
  return undefined;
}

// ─── Demo parameters (deterministic) ─────────────────────────────────────────

const DEMO_REQUEST_ID = new Uint8Array([
  0x03, 0x57, 0x9b, 0xdf, 0x13, 0xce, 0x8a, 0x46,
  0x03, 0x57, 0x9b, 0xdf, 0x13, 0xce, 0x8a, 0x46,
]);

export const DEMO_PARAMS: Permit2Params = {
  chainId: 1,
  tokenContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum mainnet
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  spender: "0x1111111254EEB25477B68fb85Ed929f73A960582",       // 1inch v5 aggregator
  amount: "1000000000",    // 1000 USDC (6 decimals: 1000 × 10^6)
  expiration: 1798761600,  // 2027-01-01T00:00:00.000Z
  nonce: 0,
  sigDeadline: "1798761600",
  requestId: DEMO_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = buildPermit2Payload(DEMO_PARAMS);
  const { signRequest, signingHash } = result;
  const { warnings } = analyzePermit2(result.typedData);

  const cbor = encodeToCbor(signRequest);
  const ur = encodeToUr(cbor);
  const qr = await generateQrPayload(ur);

  console.log(renderHumanReadable(result, warnings));
  console.log();
  console.log("Signing Hash:");
  console.log(`  ${signingHash}`);
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
