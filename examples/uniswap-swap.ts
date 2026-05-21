/**
 * EIP-4527 Uniswap V3 Swap Reference Example
 *
 * Demonstrates signing an exactInputSingle swap on Uniswap V3 SwapRouter.
 * Uses realistic ABI-encoded calldata rather than mocked values.
 *
 * Key wallet security challenges this example addresses:
 *   1. tx.to is the ROUTER, not WETH or USDC — a wallet showing only tx.to
 *      misleads users into thinking they are sending funds to an unknown contract.
 *   2. tokenIn/tokenOut live inside calldata — without decoding, the user cannot
 *      verify they are approving the swap they intend.
 *   3. amountOutMinimum = 0 (no slippage protection) makes the trade sandwichable.
 *      The renderer surfaces this as a critical warning.
 *   4. Deadlines protect against stale trades being executed hours later in
 *      unfavorable market conditions — the renderer shows them explicitly.
 *   5. MEV bots front-run swaps with 0 amountOutMinimum in the same block.
 *      Slippage tolerance is the primary protection a user has against MEV.
 *
 * Swap pipeline:
 *   Build params → ABI encode calldata → ethers RLP → CBOR → UR → QR
 *
 * Future extensibility points:
 *   - exactInput (multi-hop): replace single-token params with path bytes encoding
 *   - Uniswap V4 hooks: extend SwapDetails with hook address and data
 *   - Universal Router: decode multicall actions array, each action a sub-command
 *   - Permit2 + swap: combine permit signature with swap in a single multicall
 *   - Aggregators (1inch, Paraswap): extend KNOWN_ROUTERS and add a path type union
 */

import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Transaction, getBytes, Interface } from "ethers";
import { z } from "zod";
import type { TransactionEnvelope, DgenError } from "../src/index";

// Import and re-export the shared EIP-4527 pipeline — identical for data-type 1.
import {
  encodeToCbor,
  encodeToUr,
  decodeUrPayload,
  generateQrPayload,
  type Eip4527SignRequest,
} from "./eth-transfer";

export { encodeToCbor, encodeToUr, decodeUrPayload, generateQrPayload };

// ─── Router constants ─────────────────────────────────────────────────────────

/**
 * Uniswap V3 SwapRouter (V1) — includes `deadline` in ExactInputSingleParams.
 * Deployed at the same address on Ethereum mainnet, Optimism, Arbitrum, Polygon, etc.
 */
export const UNISWAP_V3_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

/**
 * WETH9 — the canonical Wrapped Ether contract.
 * Used as tokenIn when the user sends native ETH; the router wraps it internally.
 */
export const WETH9_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/**
 * Known router addresses (lowercase) → human-readable protocol name.
 * Extend this map when adding support for new routers.
 * Any router not in this list triggers an UNKNOWN_ROUTER warning.
 */
export const KNOWN_ROUTERS: Readonly<Record<string, string>> = {
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 SwapRouter",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3 SwapRouter02",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Uniswap Universal Router",
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2 Router02",
};

/**
 * Standard Uniswap V3 fee tiers (in hundredths of a basis point).
 *   100  =  0.01%  (stable pairs, e.g. USDC/DAI)
 *   500  =  0.05%  (correlated pairs, e.g. ETH/USDC)
 *   3000 =  0.30%  (standard, e.g. ETH/DAI)
 *   10000 = 1.00%  (exotic, e.g. ETH/shitcoin)
 * Any fee outside these values triggers UNUSUAL_FEE_TIER.
 * Any fee > 10000 triggers the higher-severity EXCESSIVE_FEE_TIER.
 */
export const STANDARD_FEE_TIERS: ReadonlySet<number> = new Set([100, 500, 3000, 10000]);

// ─── ABI + selector ───────────────────────────────────────────────────────────

/**
 * Minimal ABI for Uniswap V3 SwapRouter exactInputSingle.
 *
 * Struct field order in ExactInputSingleParams:
 *   [0] tokenIn         address  — input token (WETH9 if ETH swap)
 *   [1] tokenOut        address  — output token
 *   [2] fee             uint24   — pool fee tier (500, 3000, 10000)
 *   [3] recipient       address  — receives amountOut tokens
 *   [4] deadline        uint256  — tx reverts after this unix timestamp
 *   [5] amountIn        uint256  — exact input amount (in tokenIn smallest units)
 *   [6] amountOutMinimum uint256 — minimum acceptable output (slippage floor)
 *   [7] sqrtPriceLimitX96 uint160 — price impact limit; 0 = no limit
 *
 * Calldata layout (260 bytes total):
 *   [  0–  3]  4 bytes — function selector (0x414bf389)
 *   [  4– 35] 32 bytes — tokenIn (ABI-padded address)
 *   [ 36– 67] 32 bytes — tokenOut
 *   [ 68– 99] 32 bytes — fee (uint24, padded)
 *   [100–131] 32 bytes — recipient
 *   [132–163] 32 bytes — deadline
 *   [164–195] 32 bytes — amountIn
 *   [196–227] 32 bytes — amountOutMinimum
 *   [228–259] 32 bytes — sqrtPriceLimitX96
 */
const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
] as const;

const SWAP_ROUTER_INTERFACE = new Interface(SWAP_ROUTER_ABI);

/** 4-byte selector for exactInputSingle. Computed by ethers from the ABI above. */
export const EXACT_INPUT_SINGLE_SELECTOR: string =
  SWAP_ROUTER_INTERFACE.getFunction("exactInputSingle")!.selector;

/**
 * Minimum calldata length for exactInputSingle in hex characters (including "0x"):
 *   4 selector bytes + 8 × 32 param bytes = 260 bytes → 520 hex chars + "0x" = 522.
 */
export const EXACT_INPUT_SINGLE_MIN_LENGTH = 522;

// ─── Public types ─────────────────────────────────────────────────────────────

/** Full parameters for an exactInputSingle Uniswap V3 swap. */
export interface UniswapSwapParams {
  readonly chainId: number;
  readonly nonce: number;
  /** Uniswap V3 SwapRouter address (tx.to). */
  readonly router: string;
  /** Input token address. Use WETH9_ADDRESS when the user sends native ETH. */
  readonly tokenIn: string;
  readonly tokenInSymbol: string;
  readonly tokenInDecimals: number;
  readonly tokenOut: string;
  readonly tokenOutSymbol: string;
  readonly tokenOutDecimals: number;
  /**
   * Uniswap V3 pool fee tier in hundredths of a basis point.
   * Standard values: 100, 500, 3000, 10000.
   */
  readonly fee: number;
  /** Address that receives the amountOut tokens. */
  readonly recipient: string;
  /** Unix timestamp (seconds) after which the transaction reverts. uint256 decimal string. */
  readonly deadline: string;
  /** Exact amount of tokenIn to spend. uint256 decimal string. */
  readonly amountIn: string;
  /** Minimum acceptable output. Zero = no slippage protection = sandwichable. uint256 decimal string. */
  readonly amountOutMinimum: string;
  /** Price impact ceiling. "0" disables the limit (most common). uint160 decimal string. */
  readonly sqrtPriceLimitX96?: string;
  /**
   * Native ETH sent as tx.value when tokenIn is WETH9.
   * The router wraps this ETH into WETH before executing the swap.
   * When tokenIn is a non-ETH ERC20, this must be "0" or omitted.
   */
  readonly ethValue?: string;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly requestId?: Uint8Array;
  readonly origin?: string;
}

/** Decoded fields extracted from raw exactInputSingle calldata. */
export interface DecodedSwapCalldata {
  readonly methodSelector: string;    // "0x414bf389"
  readonly methodName: string;        // "exactInputSingle"
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly fee: number;
  readonly recipient: string;
  readonly deadline: string;
  readonly amountIn: string;
  readonly amountOutMinimum: string;
  readonly sqrtPriceLimitX96: string;
}

/** High-level swap context used for rendering and security analysis. */
export interface UniswapSwapDetails {
  readonly router: string;
  /** Human-readable router name, or null for unrecognized routers. */
  readonly routerName: string | null;
  readonly tokenIn: string;
  readonly tokenInSymbol: string;
  readonly tokenInDecimals: number;
  readonly tokenOut: string;
  readonly tokenOutSymbol: string;
  readonly tokenOutDecimals: number;
  readonly amountIn: string;
  readonly amountOutMinimum: string;
  readonly fee: number;
  /** Formatted fee percentage string, e.g. "0.05%". */
  readonly feePct: string;
  /**
   * True when the user sends native ETH (tokenIn = WETH9, tx.value = amountIn).
   * The router wraps ETH internally — the user's mental model is "spending ETH".
   */
  readonly isEthInput: boolean;
  /** Native ETH value sent with the transaction. "0" for ERC20 inputs. */
  readonly ethValue: string;
}

/** All outputs from buildUniswapSwapTx — sufficient for encode, render, and analysis. */
export interface UniswapSwapResult {
  readonly envelope: TransactionEnvelope;
  readonly signRequest: Eip4527SignRequest;
  readonly calldata: string;
  readonly decoded: DecodedSwapCalldata;
  readonly swapDetails: UniswapSwapDetails;
}

export type SwapWarningCode =
  | "ZERO_AMOUNT_OUT_MINIMUM"  // 100% slippage tolerance — sandwich attack risk
  | "EXPIRED_DEADLINE"          // deadline <= now — tx would revert immediately
  | "UNKNOWN_ROUTER"            // not in KNOWN_ROUTERS whitelist
  | "ZERO_RECIPIENT"            // recipient is zero address — output tokens burned
  | "UNUSUAL_FEE_TIER"          // fee not in STANDARD_FEE_TIERS
  | "EXCESSIVE_FEE_TIER"        // fee > 10000 — 1% exceeds Uniswap protocol max
  | "ETH_VALUE_MISMATCH";       // tx.value != amountIn when tokenIn is WETH9

export interface SwapWarning {
  readonly code: SwapWarningCode;
  readonly message: string;
}

// ─── Zod validation schema ────────────────────────────────────────────────────

const DecodedSwapCalldataSchema = z.object({
  methodSelector: z.string().startsWith("0x"),
  methodName: z.string().min(1),
  tokenIn: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "tokenIn must be a valid address"),
  tokenOut: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "tokenOut must be a valid address"),
  fee: z.number().int().min(0).max(1_000_000),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "recipient must be a valid address"),
  deadline: z.string().regex(/^\d+$/, "deadline must be a decimal integer string"),
  amountIn: z.string().regex(/^\d+$/, "amountIn must be a decimal integer string"),
  amountOutMinimum: z.string().regex(/^\d+$/, "amountOutMinimum must be a decimal integer string"),
  sqrtPriceLimitX96: z.string().regex(/^\d+$/, "sqrtPriceLimitX96 must be a decimal integer string"),
});

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Build an exactInputSingle Uniswap V3 swap transaction for EIP-4527 signing.
 *
 * Key invariants callers can verify:
 *   result.envelope.to === params.router         (tx routes to the router)
 *   result.calldata.startsWith("0x414bf389")     (exactInputSingle selector)
 *   result.decoded.amountIn === params.amountIn  (no amount mutation)
 *   result.signRequest.signData[0] === 0x02      (EIP-1559 type prefix)
 *
 * Throws DgenError (recoverable: true) for invalid address params.
 */
export function buildUniswapSwapTx(params: UniswapSwapParams): UniswapSwapResult {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.router)) {
    throw makeDgenError("INVALID_ADDRESS", `Invalid router address: ${params.router}`, true);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.tokenIn)) {
    throw makeDgenError("INVALID_ADDRESS", `Invalid tokenIn address: ${params.tokenIn}`, true);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.tokenOut)) {
    throw makeDgenError("INVALID_ADDRESS", `Invalid tokenOut address: ${params.tokenOut}`, true);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.recipient)) {
    throw makeDgenError("INVALID_ADDRESS", `Invalid recipient address: ${params.recipient}`, true);
  }

  const sqrtPriceLimitX96 = params.sqrtPriceLimitX96 ?? "0";
  const ethValue = params.ethValue ?? "0";

  // ABI-encode the exactInputSingle call.
  // Layout: 4-byte selector + 8 × 32-byte ABI-encoded struct fields = 260 bytes.
  const calldata = SWAP_ROUTER_INTERFACE.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.fee,
      recipient: params.recipient,
      deadline: BigInt(params.deadline),
      amountIn: BigInt(params.amountIn),
      amountOutMinimum: BigInt(params.amountOutMinimum),
      sqrtPriceLimitX96: BigInt(sqrtPriceLimitX96),
    },
  ]);

  // Build the EIP-1559 transaction.
  // tx.to = router (not tokenIn or tokenOut)
  // tx.value = ethValue when sending native ETH (router wraps it into WETH)
  const ethTx = Transaction.from({
    type: 2,
    chainId: BigInt(params.chainId),
    nonce: params.nonce,
    maxFeePerGas: BigInt(params.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(params.maxPriorityFeePerGas),
    gasLimit: BigInt(params.gasLimit),
    to: params.router,
    value: BigInt(ethValue),
    data: calldata,
  });

  const signData = getBytes(ethTx.unsignedSerialized);

  const envelope: TransactionEnvelope = {
    chain: "ethereum",
    chainId: params.chainId,
    nonce: params.nonce,
    to: params.router,
    value: ethValue,
    data: calldata,
    gasLimit: params.gasLimit,
    maxFeePerGas: params.maxFeePerGas,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    type: "eip1559",
  };

  const requestId = params.requestId ?? new Uint8Array(randomBytes(16));

  const signRequest: Eip4527SignRequest = {
    requestId,
    signData,
    dataType: 1,
    chainId: params.chainId,
    origin: params.origin ?? "ethos-eip4527-signer",
  };

  // Decode the calldata we just encoded as a consistency check.
  const decoded = decodeSwapCalldata(calldata);

  const routerKey = params.router.toLowerCase();
  const routerName = KNOWN_ROUTERS[routerKey] ?? null;

  const isEthInput =
    ethValue !== "0" && params.tokenIn.toLowerCase() === WETH9_ADDRESS.toLowerCase();

  const swapDetails: UniswapSwapDetails = {
    router: params.router,
    routerName,
    tokenIn: params.tokenIn,
    tokenInSymbol: params.tokenInSymbol,
    tokenInDecimals: params.tokenInDecimals,
    tokenOut: params.tokenOut,
    tokenOutSymbol: params.tokenOutSymbol,
    tokenOutDecimals: params.tokenOutDecimals,
    amountIn: params.amountIn,
    amountOutMinimum: params.amountOutMinimum,
    fee: params.fee,
    feePct: formatFeePct(params.fee),
    isEthInput,
    ethValue,
  };

  return { envelope, signRequest, calldata, decoded, swapDetails };
}

/**
 * Decode exactInputSingle calldata into typed fields.
 *
 * Validates the selector and minimum length before decoding.
 * All thrown errors are DgenError with recoverable: false — malformed calldata
 * is not a transient condition.
 *
 * After decoding, passes fields through a Zod schema to verify structural
 * correctness (valid addresses, decimal strings, bounded fee).
 */
export function decodeSwapCalldata(calldata: string): DecodedSwapCalldata {
  if (!calldata.startsWith("0x")) {
    throw makeDgenError(
      "CALLDATA_INVALID",
      "Calldata must be a hex string starting with 0x",
      false,
    );
  }

  // 4 selector + 8 × 32 params = 260 bytes → "0x" + 520 hex chars = 522 chars minimum.
  if (calldata.length < EXACT_INPUT_SINGLE_MIN_LENGTH) {
    throw makeDgenError(
      "CALLDATA_TOO_SHORT",
      `Calldata too short for exactInputSingle: need ≥${EXACT_INPUT_SINGLE_MIN_LENGTH} chars, got ${calldata.length}`,
      false,
    );
  }

  const selector = `0x${calldata.slice(2, 10).toLowerCase()}`;
  if (selector !== EXACT_INPUT_SINGLE_SELECTOR) {
    throw makeDgenError(
      "CALLDATA_WRONG_SELECTOR",
      `Expected exactInputSingle selector ${EXACT_INPUT_SINGLE_SELECTOR}, got ${selector}`,
      false,
    );
  }

  let rawDecoded: ReturnType<typeof SWAP_ROUTER_INTERFACE.decodeFunctionData>;
  try {
    rawDecoded = SWAP_ROUTER_INTERFACE.decodeFunctionData("exactInputSingle", calldata);
  } catch {
    throw makeDgenError(
      "CALLDATA_DECODE_FAILED",
      "ABI decode failed for exactInputSingle calldata",
      false,
    );
  }

  // Extract struct fields from the decoded Result by index.
  // ethers v6 Result supports numeric index access on tuple parameters.
  const p = rawDecoded[0] as { readonly [k: number]: unknown };

  const raw: DecodedSwapCalldata = {
    methodSelector: EXACT_INPUT_SINGLE_SELECTOR,
    methodName: "exactInputSingle",
    tokenIn: String(p[0]),
    tokenOut: String(p[1]),
    fee: Number(p[2] as bigint),
    recipient: String(p[3]),
    deadline: (p[4] as bigint).toString(),
    amountIn: (p[5] as bigint).toString(),
    amountOutMinimum: (p[6] as bigint).toString(),
    sqrtPriceLimitX96: (p[7] as bigint).toString(),
  };

  // Validate structural correctness before returning.
  const validated = DecodedSwapCalldataSchema.safeParse(raw);
  if (!validated.success) {
    throw makeDgenError(
      "CALLDATA_INVALID_FIELDS",
      `Decoded calldata failed schema validation: ${validated.error.message}`,
      false,
    );
  }

  return validated.data as DecodedSwapCalldata;
}

/**
 * Analyze a swap result for security-relevant conditions.
 *
 * @param result - Output of buildUniswapSwapTx.
 * @param now - Unix timestamp (seconds) for deadline comparisons. Defaults to current time.
 *              Supply a fixed value in tests for deterministic results.
 */
export function validateSwapPayload(
  result: UniswapSwapResult,
  now: number = Math.floor(Date.now() / 1000),
): { readonly warnings: readonly SwapWarning[] } {
  const { decoded, swapDetails, envelope } = result;
  const warnings: SwapWarning[] = [];

  // amountOutMinimum = 0 means the user accepts any output, including 1 wei.
  // This is the canonical sandwich attack setup — MEV bots will front-run the swap,
  // push the price, and back-run it, extracting essentially the full input value.
  if (BigInt(decoded.amountOutMinimum) === 0n) {
    warnings.push({
      code: "ZERO_AMOUNT_OUT_MINIMUM",
      message:
        "amountOutMinimum is 0 — no slippage protection. MEV bots can sandwich this swap and extract your entire input value.",
    });
  }

  // A stale deadline means the transaction will revert on-chain, wasting gas.
  // More importantly, a user may sign a transaction with a future deadline that
  // later becomes stale — the QR may be scanned and broadcast at an unfavorable time.
  if (BigInt(decoded.deadline) <= BigInt(now)) {
    warnings.push({
      code: "EXPIRED_DEADLINE",
      message: `Swap deadline expired at ${new Date(Number(decoded.deadline) * 1000).toISOString()}. This transaction will revert on-chain.`,
    });
  }

  // Unknown routers should prompt manual review. Malicious routers can steal tokens
  // by returning incorrect amountOut values or by routing through malicious pools.
  if (swapDetails.routerName === null) {
    warnings.push({
      code: "UNKNOWN_ROUTER",
      message: `Router ${swapDetails.router} is not a recognized Uniswap protocol router. Verify before signing.`,
    });
  }

  // Sending tokens to the zero address permanently burns them.
  if (decoded.recipient === "0x0000000000000000000000000000000000000000") {
    warnings.push({
      code: "ZERO_RECIPIENT",
      message: "Recipient is the zero address — output tokens will be permanently burned.",
    });
  }

  // Uniswap V3 standard fee tiers: 100, 500, 3000, 10000.
  // Any other fee indicates a non-standard pool that may have reduced liquidity or be malicious.
  if (decoded.fee > 10000) {
    warnings.push({
      code: "EXCESSIVE_FEE_TIER",
      message: `Fee tier ${decoded.fee} exceeds the Uniswap protocol maximum of 10000 (1%). This is not a valid Uniswap V3 pool.`,
    });
  } else if (!STANDARD_FEE_TIERS.has(decoded.fee)) {
    warnings.push({
      code: "UNUSUAL_FEE_TIER",
      message: `Fee tier ${decoded.fee} is not a standard Uniswap V3 tier (100, 500, 3000, 10000). Verify the pool exists.`,
    });
  }

  // If the user sends native ETH but tx.value !== amountIn, the excess ETH is either
  // refunded (if router supports refundETH) or permanently locked in the contract.
  if (
    swapDetails.isEthInput &&
    envelope.value !== undefined &&
    envelope.value !== decoded.amountIn
  ) {
    warnings.push({
      code: "ETH_VALUE_MISMATCH",
      message: `tx.value (${envelope.value} wei) does not match amountIn (${decoded.amountIn} wei). Excess ETH may be lost.`,
    });
  }

  return { warnings };
}

/**
 * Render a human-readable Uniswap swap breakdown for display before signing.
 *
 * Designed for air-gapped hardware wallets and QR-based signing devices.
 * Displays the true swap intent (tokenIn, tokenOut, slippage floor) rather than
 * the raw tx fields (router address, calldata hex).
 *
 * BigInt arithmetic throughout — no floating-point on token amounts.
 */
export function renderHumanReadable(
  result: UniswapSwapResult,
  warnings: readonly SwapWarning[],
): string {
  const { envelope, decoded, swapDetails } = result;

  // Determine how to display the input side:
  // If isEthInput, the user sends ETH (even though tokenIn = WETH in calldata).
  const inputSymbol = swapDetails.isEthInput ? "ETH" : swapDetails.tokenInSymbol;
  const inputDecimals = swapDetails.tokenInDecimals;

  const amountInFormatted = formatTokenAmount(decoded.amountIn, inputDecimals, inputSymbol);
  const amountOutFormatted = formatTokenAmount(
    decoded.amountOutMinimum,
    swapDetails.tokenOutDecimals,
    swapDetails.tokenOutSymbol,
  );

  // Route display: ETH → USDC (use ETH not WETH when isEthInput for clarity)
  const routeIn = swapDetails.isEthInput ? "ETH" : swapDetails.tokenInSymbol;
  const routeOut = swapDetails.tokenOutSymbol;

  const slippageProtection =
    BigInt(decoded.amountOutMinimum) === 0n ? "DISABLED — sandwich attack risk" : "Enabled";

  const deadlineIso = new Date(Number(decoded.deadline) * 1000).toISOString();

  const routerDisplay = swapDetails.routerName
    ? `${swapDetails.routerName} (${swapDetails.router})`
    : swapDetails.router;

  const lines = [
    "─── Uniswap V3 Swap ──────────────────────────────",
    `  Swap:                  ${amountInFormatted}`,
    `  For at least:          ${amountOutFormatted}`,
    `  Protocol:              ${swapDetails.routerName ?? "Unknown Router"}`,
    `  Route:                 ${routeIn} → ${routeOut}`,
    `  Router:                ${routerDisplay}`,
    `  Recipient:             ${decoded.recipient}`,
    `  Fee Tier:              ${swapDetails.feePct} (${decoded.fee})`,
    `  Slippage Protection:   ${slippageProtection}`,
    `  Deadline:              ${deadlineIso}`,
    `  Network:               ${envelope.chain} (chainId: ${envelope.chainId ?? "?"})`,
    `  Gas Limit:             ${envelope.gasLimit ?? "?"}`,
    `  Max Fee/Gas:           ${envelope.maxFeePerGas ? toGwei(envelope.maxFeePerGas) : "?"}`,
    `  Max Priority Fee/Gas:  ${envelope.maxPriorityFeePerGas ? toGwei(envelope.maxPriorityFeePerGas) : "?"}`,
    "  ─── Security Notice ────────────────────────────",
    "  If market price moves before execution, output may differ from estimate.",
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

const FEE_TIER_DISPLAY: Readonly<Record<number, string>> = {
  100: "0.01%",
  500: "0.05%",
  3000: "0.30%",
  10000: "1.00%",
};

/** Format a Uniswap fee tier integer into a human-readable percentage string. */
function formatFeePct(fee: number): string {
  return FEE_TIER_DISPLAY[fee] ?? `${(fee / 10000).toFixed(4).replace(/0+$/, "")}%`;
}

/**
 * Format a token amount from its smallest unit into human-readable form using BigInt.
 * Fractional display is capped at 6 decimal places for readability on hardware displays —
 * the same convention eth-transfer.ts uses for ETH (slice(0, 6) on the 18-digit fraction).
 */
function formatTokenAmount(rawAmount: string, decimals: number, symbol: string): string {
  const DISPLAY_DECIMALS = 6;
  const raw = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fullFrac = (raw % divisor).toString().padStart(decimals, "0");
  const frac = decimals > DISPLAY_DECIMALS ? fullFrac.slice(0, DISPLAY_DECIMALS) : fullFrac;
  return `${whole}.${frac} ${symbol}`;
}

/** Convert wei to a human-readable gwei string using BigInt to avoid precision loss. */
function toGwei(wei: string): string {
  const weiBI = BigInt(wei);
  const whole = weiBI / 10n ** 9n;
  const frac = (weiBI % 10n ** 9n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} gwei` : `${whole} gwei`;
}

// ─── Demo parameters (deterministic) ─────────────────────────────────────────

const DEMO_REQUEST_ID = new Uint8Array([
  0x04, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf, 0x02,
  0x04, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf, 0x02,
]);

export const DEMO_PARAMS: UniswapSwapParams = {
  chainId: 1,
  nonce: 7,
  router: UNISWAP_V3_SWAP_ROUTER,
  tokenIn: WETH9_ADDRESS,
  tokenInSymbol: "WETH",
  tokenInDecimals: 18,
  tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum mainnet
  tokenOutSymbol: "USDC",
  tokenOutDecimals: 6,
  fee: 500,                                              // 0.05% — standard ETH/USDC tier
  recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  deadline: "1798761600",                                // 2027-01-01T00:00:00.000Z
  amountIn: "500000000000000000",                        // 0.5 ETH (18 decimals)
  amountOutMinimum: "1450000000",                        // 1450 USDC (6 decimals)
  sqrtPriceLimitX96: "0",                                // no price limit
  ethValue: "500000000000000000",                        // msg.value = amountIn (ETH input)
  gasLimit: "210000",
  maxFeePerGas: "30000000000",                           // 30 gwei
  maxPriorityFeePerGas: "1500000000",                    // 1.5 gwei
  requestId: DEMO_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = buildUniswapSwapTx(DEMO_PARAMS);
  const { signRequest, calldata, decoded, swapDetails } = result;
  const { warnings } = validateSwapPayload(result);

  const cbor = encodeToCbor(signRequest);
  const ur = encodeToUr(cbor);
  const qr = await generateQrPayload(ur);

  console.log(renderHumanReadable(result, warnings));
  console.log();
  console.log("Selector:", decoded.methodSelector);
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
  console.log();
  console.log("Swap details:");
  console.log(`  Router: ${swapDetails.routerName ?? "Unknown"} (${swapDetails.router})`);
  console.log(`  isEthInput: ${String(swapDetails.isEthInput)}`);
  console.log(`  Fee: ${swapDetails.feePct}`);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error("Example failed:", err);
    process.exit(1);
  });
}
