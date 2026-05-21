/**
 * EIP-4527 Safe Multisig Transaction Reference Example
 *
 * Demonstrates signing a Gnosis Safe (Safe{Wallet}) multisig transaction using
 * EIP-712 typed structured data, transported via EIP-4527 QR encoding.
 *
 * Multisig architecture overview:
 *   A Safe is an on-chain smart contract wallet that requires M-of-N owner
 *   signatures before executing any transaction. Owners are EOAs (or nested Safes).
 *   When a transaction is proposed:
 *     1. An off-chain hash (SafeTx hash) is computed from the transaction fields
 *     2. Each owner signs this hash using EIP-712 typed data
 *     3. Once M signatures are collected, any account can call `execTransaction`
 *        on the Safe contract, supplying the concatenated signatures
 *
 * Security considerations demonstrated here:
 *   1. DELEGATECALL (operation=1) is extremely dangerous — the called contract runs
 *      in the Safe's context and can modify its storage, change its implementation,
 *      or drain its funds. Always surface this prominently.
 *   2. The nested calldata in `data` must be decoded to show what is REALLY being
 *      executed — an opaque hex blob misleads signers about the true action.
 *   3. Replay protection: the SafeTx hash commits to the chainId and the Safe
 *      address (via the domain) and the nonce. A Safe on a different chain or at
 *      a different address produces a different hash, even with identical tx fields.
 *   4. Non-zero refundReceiver or gasToken can be used to drain the Safe's ETH or
 *      ERC20 balances as gas reimbursements, independent of the intended tx action.
 *   5. threshold=0 or threshold > owners.length means the Safe is bricked —
 *      no quorum can ever be reached.
 *
 * Safe domain (differs from Permit2 and other EIP-712 protocols):
 *   - NO "name" field
 *   - NO "version" field
 *   - Only: { chainId, verifyingContract: safeAddress }
 *
 * Sign-data format (data-type: 2):
 *   JSON-encoded SafeTypedData (domain + SafeTx typed data) as UTF-8 bytes.
 *   Allows the receiving signer to parse fields and display the action to the user.
 *
 * Full pipeline:
 *   Build SafeTx → compute EIP-712 hash → JSON → UTF-8 → CBOR (data-type: 2) → UR → QR
 *
 * Future extensibility:
 *   - Batched actions: extend NestedAction to a NestedAction[] array (Safe multiSend)
 *   - Safe modules: add moduleAddress field and decode module-specific calldata
 *   - EIP-4337 UserOperations: use op.callData as nested data, adjust domain
 *   - Session keys: extend SafeMultisigParams with session key validation fields
 *   - Policy engines: run validateMultisigPayload through a policy checker before signing
 *   - Simulation: add a simulationResult field populated by tenderly/alchemy before display
 */

import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { TypedDataEncoder, Interface } from "ethers";
import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import { UR, URDecoder } from "@ngraveio/bc-ur";
import { z } from "zod";
import type { DgenError } from "../src/index";

// Import shared UR/QR pipeline — operates on CBOR bytes, reusable for any data-type.
import { encodeToUr, generateQrPayload } from "./eth-transfer";
// Import ERC20 decoding utilities for nested calldata interpretation.
import {
  decodeErc20Transfer,
  ERC20_TRANSFER_SELECTOR,
  type DecodedErc20Transfer,
} from "./erc20-transfer";

export { encodeToUr, generateQrPayload };
export type { DecodedErc20Transfer };

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

// ─── Safe EIP-712 type definitions ───────────────────────────────────────────

/**
 * EIP-712 type definitions for Safe's SafeTx struct.
 *
 * Field order matches the Gnosis Safe ABI exactly — reordering produces a
 * different type hash and a different final signature. Do not reorder.
 *
 * The `data` field is encoded as `bytes` — EIP-712 hashes it with keccak256,
 * so two transactions with different calldata always produce different hashes.
 *
 * IMPORTANT: The Safe domain does NOT include "name" or "version".
 * Adding those fields produces an incorrect domain separator.
 */
export const SAFE_TX_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

/** Known Safe contract versions for identification (not part of the domain). */
export const KNOWN_SAFE_VERSIONS = ["1.0.0", "1.1.1", "1.2.0", "1.3.0", "1.4.0", "1.4.1"] as const;

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Safe operation type.
 *   0 = CALL        — normal external call, safe
 *   1 = DELEGATECALL — called contract runs in Safe's storage context, dangerous
 *
 * DELEGATECALL is used by Safe modules and multiSend, but should always be
 * flagged for manual review — a malicious target can drain or brick the Safe.
 */
export type SafeOperation = 0 | 1;
export const SAFE_OPERATION_CALL = 0 as const;
export const SAFE_OPERATION_DELEGATECALL = 1 as const;

/** Full parameters for building a Safe multisig transaction payload. */
export interface SafeMultisigParams {
  readonly chainId: number;
  /** Address of the deployed Safe proxy contract. */
  readonly safeAddress: string;
  /** Current on-chain owner list — used for threshold display and validation. */
  readonly owners: readonly string[];
  /** Number of owner signatures required to execute this transaction. */
  readonly threshold: number;
  /**
   * Safe nonce — prevents replay attacks. Each Safe transaction increments
   * the nonce; a previously-signed nonce cannot be reused.
   */
  readonly nonce: number;
  /** Target address (tx.to inside the Safe execution context). */
  readonly to: string;
  /** ETH value sent to `to` during execution. "0" for token-only calls. */
  readonly value: string;
  /** Calldata for the nested call (ABI-encoded). "0x" for native ETH transfers. */
  readonly data: string;
  /**
   * 0 = CALL, 1 = DELEGATECALL.
   * DELEGATECALL runs the target's code in the Safe's storage context — always warn.
   */
  readonly operation: SafeOperation;
  /** Gas forwarded to the nested call. 0 = use all available gas. */
  readonly safeTxGas: string;
  /** Additional gas for the Safe overhead (included in the gas reimbursement). */
  readonly baseGas: string;
  /** Gas price used for refund calculation. 0 = no refund. */
  readonly gasPrice: string;
  /**
   * ERC20 token used for gas reimbursement. Zero address = ETH (no reimbursement in practice).
   * Non-zero gasToken enables gas reimbursement in that token — verify the token is legitimate.
   */
  readonly gasToken: string;
  /**
   * Address receiving the gas reimbursement. Zero address = tx.origin (the relayer).
   * Non-zero refundReceiver is a common phishing vector — always warn.
   */
  readonly refundReceiver: string;
  /** Optional token metadata for rendering nested ERC20 transfers. */
  readonly nestedTokenSymbol?: string;
  readonly nestedTokenDecimals?: number;
  readonly requestId?: Uint8Array;
  readonly origin?: string;
}

/** Safe EIP-712 domain (no name, no version — Safe-specific). */
export interface SafeDomain {
  readonly chainId: number;
  readonly verifyingContract: string;
}

/** The SafeTx message struct for EIP-712 hashing and display. */
export interface SafeTxMessage {
  readonly to: string;
  readonly value: string;          // uint256 decimal string
  readonly data: string;           // hex string
  readonly operation: SafeOperation;
  readonly safeTxGas: string;      // uint256 decimal string
  readonly baseGas: string;        // uint256 decimal string
  readonly gasPrice: string;       // uint256 decimal string
  readonly gasToken: string;       // address
  readonly refundReceiver: string; // address
  readonly nonce: number;          // uint256 (safe integer in practice)
}

/** The full EIP-712 typed data structure stored in sign-data. */
export interface SafeTypedData {
  readonly domain: SafeDomain;
  readonly types: Record<string, Array<{ name: string; type: string }>>;
  readonly message: SafeTxMessage;
  readonly primaryType: "SafeTx";
}

/** EIP-4527 sign request with data-type: 2 for EIP-712 typed data. */
export interface MultisigSignRequest {
  readonly requestId: Uint8Array;
  /** JSON-encoded SafeTypedData as UTF-8 bytes — the signing payload. */
  readonly signData: Uint8Array;
  readonly dataType: typeof DATA_TYPE_TYPED_DATA;
  readonly chainId: number;
  readonly origin: string;
}

/** Result of decoding the nested calldata in the SafeTx `data` field. */
export type NestedActionType = "erc20_transfer" | "eth_transfer" | "unknown";

export interface NestedAction {
  readonly type: NestedActionType;
  readonly rawCalldata: string;
  readonly decoded: DecodedErc20Transfer | null;
}

/** All outputs from buildMultisigPayload. */
export interface SafeMultisigResult {
  readonly typedData: SafeTypedData;
  readonly signRequest: MultisigSignRequest;
  readonly safeTxHash: string;
  readonly nestedAction: NestedAction;
  readonly params: SafeMultisigParams;
}

export type MultisigWarningCode =
  | "DELEGATECALL"               // operation=1 runs in Safe's storage context — critical
  | "HIGH_SAFE_TX_GAS"           // safeTxGas unusually high
  | "HIGH_BASE_GAS"              // baseGas high — affects gas reimbursement
  | "DANGEROUS_REFUND_RECEIVER"  // non-zero refundReceiver can drain ETH
  | "UNKNOWN_NESTED_CALLDATA"    // couldn't identify the nested action
  | "INVALID_THRESHOLD"          // threshold > owners.length — quorum impossible
  | "ZERO_THRESHOLD"             // threshold = 0 — anyone can execute
  | "GAS_TOKEN_SET";             // non-zero gasToken — gas reimbursement in ERC20

export interface MultisigWarning {
  readonly code: MultisigWarningCode;
  readonly message: string;
}

// ─── Zod validation schema ────────────────────────────────────────────────────

const SafeTxMessageSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "to must be a valid address"),
  value: z.string().regex(/^\d+$/, "value must be a decimal integer string"),
  data: z.string(),
  operation: z.union([z.literal(0), z.literal(1)]),
  safeTxGas: z.string().regex(/^\d+$/, "safeTxGas must be a decimal integer string"),
  baseGas: z.string().regex(/^\d+$/, "baseGas must be a decimal integer string"),
  gasPrice: z.string().regex(/^\d+$/, "gasPrice must be a decimal integer string"),
  gasToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "gasToken must be a valid address"),
  refundReceiver: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "refundReceiver must be a valid address"),
  nonce: z.number().int().min(0),
});

const SafeTypedDataSchema = z.object({
  domain: z.object({
    chainId: z.number().int().min(1),
    verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
  types: z.object({
    SafeTx: z.array(z.object({ name: z.string(), type: z.string() })),
  }),
  message: SafeTxMessageSchema,
  primaryType: z.literal("SafeTx"),
});

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Build a Safe multisig transaction payload ready for EIP-4527 QR signing.
 *
 * The Safe transaction hash commits to:
 *   - The Safe's address (via domain.verifyingContract)
 *   - The chain (via domain.chainId)
 *   - All transaction fields including the nested calldata (via keccak256(data))
 *   - The nonce (replay protection — each nonce can only be executed once)
 *
 * Key invariants callers can verify:
 *   result.typedData.domain.verifyingContract === params.safeAddress
 *   result.safeTxHash is reproducible from result.typedData via TypedDataEncoder.hash
 *   result.signRequest.dataType === 2 (typed-data, not transaction)
 *
 * Throws DgenError (recoverable: true) for invalid address params.
 */
export function buildMultisigPayload(params: SafeMultisigParams): SafeMultisigResult {
  for (const [name, addr] of [
    ["safeAddress", params.safeAddress],
    ["to", params.to],
    ["gasToken", params.gasToken],
    ["refundReceiver", params.refundReceiver],
  ] as const) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw makeDgenError("INVALID_ADDRESS", `Invalid ${name}: ${addr}`, true);
    }
  }

  for (const [i, owner] of params.owners.entries()) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      throw makeDgenError("INVALID_ADDRESS", `Invalid owner[${i}]: ${owner}`, true);
    }
  }

  const domain: SafeDomain = {
    chainId: params.chainId,
    verifyingContract: params.safeAddress,
  };

  const message: SafeTxMessage = {
    to: params.to,
    value: params.value,
    data: params.data,
    operation: params.operation,
    safeTxGas: params.safeTxGas,
    baseGas: params.baseGas,
    gasPrice: params.gasPrice,
    gasToken: params.gasToken,
    refundReceiver: params.refundReceiver,
    nonce: params.nonce,
  };

  const typedData: SafeTypedData = {
    domain,
    types: SAFE_TX_TYPES,
    message,
    primaryType: "SafeTx",
  };

  // TypedDataEncoder.hash computes keccak256(0x1901 || domainSeparator || structHash).
  // For the SafeTx struct, the `data` bytes field is hashed via keccak256(data)
  // before being included in the struct hash — any calldata change changes the hash.
  const safeTxHash = TypedDataEncoder.hash(domain, SAFE_TX_TYPES, message);

  // Encode the typed data as JSON → UTF-8 bytes for EIP-4527 sign-data.
  const signData = new TextEncoder().encode(JSON.stringify(typedData));

  const requestId = params.requestId ?? new Uint8Array(randomBytes(16));

  const signRequest: MultisigSignRequest = {
    requestId,
    signData,
    dataType: DATA_TYPE_TYPED_DATA,
    chainId: params.chainId,
    origin: params.origin ?? "ethos-eip4527-signer",
  };

  // Decode the nested calldata for human-readable display.
  const nestedAction = decodeNestedCalldata(params.data);

  return { typedData, signRequest, safeTxHash, nestedAction, params };
}

/**
 * Encode a MultisigSignRequest as CBOR using EIP-4527 integer keys.
 *
 * Uses data-type: 2 — signals to the receiving signer that sign-data
 * contains EIP-712 typed data, not a raw transaction.
 */
export function encodeToCbor(req: MultisigSignRequest): Uint8Array {
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
 * Decode and validate sign-data bytes as a SafeTypedData structure.
 *
 * Parses the JSON from UTF-8 sign-data bytes and validates against the
 * Safe Zod schema before returning typed data.
 *
 * Throws DgenError (recoverable: false) for malformed or invalid payloads.
 */
export function decodeSafeTransaction(signData: Uint8Array): SafeTypedData {
  let jsonStr: string;
  try {
    jsonStr = new TextDecoder().decode(signData);
  } catch {
    throw makeDgenError("PAYLOAD_DECODE_FAILED", "signData bytes are not valid UTF-8", false);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw makeDgenError("PAYLOAD_DECODE_FAILED", "signData is not valid JSON", false);
  }

  const result = SafeTypedDataSchema.safeParse(parsed);
  if (!result.success) {
    throw makeDgenError(
      "PAYLOAD_INVALID",
      `Safe typed data schema validation failed: ${result.error.message}`,
      false,
    );
  }

  return result.data as SafeTypedData;
}

/**
 * Decode a UR string containing a multisig sign request back to SafeTypedData.
 *
 * Extracts sign-data bytes via UR → CBOR → field, then validates with Zod.
 */
export function decodeMultisigUrPayload(urString: string): SafeTypedData {
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

  return decodeSafeTransaction(new Uint8Array(signData));
}

/**
 * Decode the nested calldata in a SafeTx `data` field.
 *
 * Attempts to identify the nested action by its selector:
 *   - "0x"  or ""  → native ETH transfer (no contract call)
 *   - 0xa9059cbb   → ERC20 transfer(address,uint256)
 *   - everything else → unknown (renderer will show raw hex with warning)
 *
 * This function is intentionally non-throwing — unknown calldata is a valid
 * state that should be surfaced to the user, not cause a decoding failure.
 */
export function decodeNestedCalldata(data: string): NestedAction {
  if (data === "0x" || data === "") {
    return { type: "eth_transfer", rawCalldata: data, decoded: null };
  }

  if (!data.startsWith("0x")) {
    return { type: "unknown", rawCalldata: data, decoded: null };
  }

  const selector = data.length >= 10 ? data.slice(0, 10).toLowerCase() : "";

  if (selector === ERC20_TRANSFER_SELECTOR && data.length >= 138) {
    try {
      const decoded = decodeErc20Transfer(data);
      return { type: "erc20_transfer", rawCalldata: data, decoded };
    } catch {
      return { type: "unknown", rawCalldata: data, decoded: null };
    }
  }

  return { type: "unknown", rawCalldata: data, decoded: null };
}

/**
 * Analyze a Safe multisig result for security-relevant conditions.
 *
 * Returns typed warnings that the renderer can surface before the user signs.
 * Warnings are ordered by severity: DELEGATECALL > threshold issues > gas issues.
 */
export function validateMultisigPayload(
  result: SafeMultisigResult,
): { readonly warnings: readonly MultisigWarning[] } {
  const { params, nestedAction } = result;
  const warnings: MultisigWarning[] = [];

  // CRITICAL: DELEGATECALL runs the target contract's bytecode in the Safe's
  // own storage context. A malicious target can overwrite owners, drain funds,
  // or upgrade the Safe's implementation. Should always be prominently warned.
  if (params.operation === SAFE_OPERATION_DELEGATECALL) {
    warnings.push({
      code: "DELEGATECALL",
      message:
        "Operation is DELEGATECALL — the target contract executes in the Safe's storage context. A malicious target can drain funds or modify Safe ownership.",
    });
  }

  // threshold = 0 means any address can reach quorum and execute — effectively
  // an unprotected wallet.
  if (params.threshold === 0) {
    warnings.push({
      code: "ZERO_THRESHOLD",
      message: "Threshold is 0 — any address can execute transactions. The Safe is unprotected.",
    });
  }

  // threshold > owners.length means the quorum can never be reached — Safe is bricked.
  if (params.threshold > params.owners.length) {
    warnings.push({
      code: "INVALID_THRESHOLD",
      message: `Threshold ${params.threshold} exceeds the number of owners (${params.owners.length}) — this transaction can never be executed.`,
    });
  }

  // safeTxGas > 500_000 is unusual for standard calls and may indicate an attempt
  // to cause out-of-gas in unexpected ways.
  if (BigInt(params.safeTxGas) > 500_000n) {
    warnings.push({
      code: "HIGH_SAFE_TX_GAS",
      message: `safeTxGas (${params.safeTxGas}) is unusually high. Verify the target call actually requires this much gas.`,
    });
  }

  // baseGas > 100_000 inflates the gas reimbursement. Combined with a malicious
  // refundReceiver, this can drain the Safe's ETH balance.
  if (BigInt(params.baseGas) > 100_000n) {
    warnings.push({
      code: "HIGH_BASE_GAS",
      message: `baseGas (${params.baseGas}) is unusually high. Verify the reimbursement calculation is correct.`,
    });
  }

  // Non-zero gasToken means gas is reimbursed in an ERC20. Combined with a malicious
  // gas price, this can drain ERC20 balances.
  if (params.gasToken !== "0x0000000000000000000000000000000000000000") {
    warnings.push({
      code: "GAS_TOKEN_SET",
      message: `Gas token is set to ${params.gasToken}. Gas will be reimbursed in this ERC20. Verify the gasPrice and token are correct.`,
    });
  }

  // Non-zero refundReceiver means the gas reimbursement goes to a specific address.
  // An attacker can set this to their own address and drain the Safe's ETH.
  if (params.refundReceiver !== "0x0000000000000000000000000000000000000000") {
    warnings.push({
      code: "DANGEROUS_REFUND_RECEIVER",
      message: `refundReceiver is ${params.refundReceiver}. Gas reimbursement will be sent to this address. Verify it is controlled by a Safe owner.`,
    });
  }

  // Non-empty, non-decoded calldata is a red flag — the signer cannot verify
  // what action they are approving.
  if (
    params.data !== "0x" &&
    params.data !== "" &&
    nestedAction.type === "unknown"
  ) {
    warnings.push({
      code: "UNKNOWN_NESTED_CALLDATA",
      message: `The nested calldata (selector: ${params.data.slice(0, 10)}) could not be decoded. You are approving an unrecognized contract call.`,
    });
  }

  return { warnings };
}

/**
 * Render a human-readable Safe multisig breakdown for display before signing.
 *
 * Shows the true execution intent (nested action, recipient, amount) rather
 * than raw tx fields. DELEGATECALL is shown prominently in the action section.
 */
export function renderHumanReadable(
  result: SafeMultisigResult,
  warnings: readonly MultisigWarning[],
): string {
  const { typedData, safeTxHash, nestedAction, params } = result;
  const { domain, message } = typedData;

  const operationLabel = params.operation === 0 ? "CALL" : "DELEGATECALL";

  // Format the nested action section
  const actionLines = formatNestedAction(nestedAction, message, params);

  // Format gas & refund section
  const gasTokenDisplay =
    message.gasToken === "0x0000000000000000000000000000000000000000"
      ? "ETH (native)"
      : message.gasToken;
  const refundDisplay =
    message.refundReceiver === "0x0000000000000000000000000000000000000000"
      ? "None (tx.origin)"
      : message.refundReceiver;

  const lines = [
    "─── Safe Multisig Transaction ────────────────────",
    `  Safe:                  ${domain.verifyingContract}`,
    `  Network:               ethereum (chainId: ${domain.chainId})`,
    `  Threshold:             ${params.threshold} of ${params.owners.length} owner(s) required`,
    `  Nonce:                 ${message.nonce}`,
    "  ─── Proposed Action ────────────────────────────",
    ...actionLines,
    `  Operation:             ${operationLabel}`,
    "  ─── Gas & Refund ───────────────────────────────",
    `  Safe Tx Gas:           ${message.safeTxGas}`,
    `  Base Gas:              ${message.baseGas}`,
    `  Gas Price:             ${message.gasPrice === "0" ? "0 (no reimbursement)" : toGwei(message.gasPrice)}`,
    `  Gas Token:             ${gasTokenDisplay}`,
    `  Refund Receiver:       ${refundDisplay}`,
    "  ─── Signing ────────────────────────────────────",
    `  Safe Tx Hash:          ${safeTxHash}`,
    "  ─── Notice ─────────────────────────────────────",
    `  This transaction executes only after ${params.threshold} owner signature(s) are collected.`,
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
    return (decoded as Record<string | number, unknown>)[String(key)];
  }
  return undefined;
}

function formatNestedAction(
  action: NestedAction,
  message: SafeTxMessage,
  params: SafeMultisigParams,
): string[] {
  const ethValueDisplay =
    message.value === "0" ? "0 ETH" : `${toEth(message.value)} ETH`;

  if (action.type === "eth_transfer") {
    return [
      `  Action:                Native ETH Transfer`,
      `  To:                    ${message.to}`,
      `  ETH Value:             ${ethValueDisplay}`,
    ];
  }

  if (action.type === "erc20_transfer" && action.decoded !== null) {
    const { decoded } = action;
    const symbol = params.nestedTokenSymbol ?? "tokens";
    const decimals = params.nestedTokenDecimals ?? 0;
    const amountDisplay =
      decimals > 0
        ? formatTokenAmount(decoded.rawAmount, decimals, symbol)
        : `${decoded.rawAmount} ${symbol} (raw units)`;

    return [
      `  Action:                ERC20 Transfer`,
      `  Token Contract:        ${message.to}`,
      `  Recipient:             ${decoded.recipient}`,
      `  Amount:                ${amountDisplay}`,
      `  ETH Value:             ${ethValueDisplay}`,
    ];
  }

  // Unknown nested calldata
  return [
    `  Action:                Unknown (unrecognized calldata)`,
    `  To:                    ${message.to}`,
    `  Calldata:              ${action.rawCalldata.slice(0, 42)}${action.rawCalldata.length > 42 ? "..." : ""}`,
    `  ETH Value:             ${ethValueDisplay}`,
  ];
}

function formatTokenAmount(rawAmount: string, decimals: number, symbol: string): string {
  const DISPLAY_DECIMALS = 6;
  const raw = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fullFrac = (raw % divisor).toString().padStart(decimals, "0");
  const frac = decimals > DISPLAY_DECIMALS ? fullFrac.slice(0, DISPLAY_DECIMALS) : fullFrac;
  return `${whole}.${frac} ${symbol}`;
}

function toEth(wei: string): string {
  const weiBI = BigInt(wei);
  const whole = weiBI / 10n ** 18n;
  const frac = (weiBI % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
}

function toGwei(wei: string): string {
  const weiBI = BigInt(wei);
  const whole = weiBI / 10n ** 9n;
  const frac = (weiBI % 10n ** 9n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} gwei` : `${whole} gwei`;
}

// ─── Demo parameters (deterministic) ─────────────────────────────────────────

/** Local ERC20 Interface for building the DEMO nested transfer calldata. */
const ERC20_DEMO_INTERFACE = new Interface([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/**
 * ERC20 calldata for the demo: transfer 5000 USDC to a recipient.
 * 5000 USDC = 5_000_000_000 raw units (6 decimals).
 * Computed at module initialization time — deterministic.
 */
export const DEMO_ERC20_CALLDATA: string = ERC20_DEMO_INTERFACE.encodeFunctionData("transfer", [
  "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  BigInt("5000000000"),
]);

const DEMO_REQUEST_ID = new Uint8Array([
  0x05, 0xce, 0x8a, 0x46, 0x13, 0x57, 0x9b, 0xdf,
  0x05, 0xce, 0x8a, 0x46, 0x13, 0x57, 0x9b, 0xdf,
]);

export const DEMO_PARAMS: SafeMultisigParams = {
  chainId: 1,
  // Safe address: Hardhat account #5, used here as a deterministic proxy address.
  safeAddress: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  // Owners: Hardhat accounts #0, #1, #2 — well-known deterministic test addresses.
  owners: [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ],
  threshold: 2,
  nonce: 14,
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum mainnet
  value: "0",                                         // no ETH sent in this call
  data: DEMO_ERC20_CALLDATA,                          // nested ERC20 transfer
  operation: SAFE_OPERATION_CALL,
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nestedTokenSymbol: "USDC",
  nestedTokenDecimals: 6,
  requestId: DEMO_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = buildMultisigPayload(DEMO_PARAMS);
  const { signRequest, safeTxHash, nestedAction } = result;
  const { warnings } = validateMultisigPayload(result);

  const cbor = encodeToCbor(signRequest);
  const ur = encodeToUr(cbor);
  const qr = await generateQrPayload(ur);

  console.log(renderHumanReadable(result, warnings));
  console.log();
  console.log("Safe Tx Hash:");
  console.log(`  ${safeTxHash}`);
  console.log();
  console.log("Nested action type:", nestedAction.type);
  if (nestedAction.decoded) {
    console.log("Nested recipient:", nestedAction.decoded.recipient);
    console.log("Nested amount:", nestedAction.decoded.rawAmount);
  }
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
