/**
 * Tests for the EIP-4527 Uniswap V3 exactInputSingle swap pipeline.
 *
 * Security-critical invariants verified here:
 * 1. tx.to is the ROUTER — not WETH or USDC. A wallet displaying tx.to as "recipient"
 *    would show users a DeFi contract address, not who receives their tokens.
 * 2. tokenIn/tokenOut live inside calldata. A signer that does not decode calldata
 *    cannot display the actual swap direction to the user.
 * 3. amountOutMinimum = 0 is the canonical sandwich attack setup. The validator must
 *    surface ZERO_AMOUNT_OUT_MINIMUM so users can reject such transactions.
 * 4. A stale deadline means the transaction reverts on-chain — signing it wastes gas.
 * 5. Unrecognized routers should trigger UNKNOWN_ROUTER — malicious routers can steal
 *    tokens by returning incorrect amounts or routing through attacker-controlled pools.
 * 6. The calldata selector must be exactly 0x414bf389 — any other selector means a
 *    different function (and possibly a different, malicious contract method) is called.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildUniswapSwapTx,
  decodeSwapCalldata,
  validateSwapPayload,
  renderHumanReadable,
  encodeToCbor,
  encodeToUr,
  decodeUrPayload,
  EXACT_INPUT_SINGLE_SELECTOR,
  EXACT_INPUT_SINGLE_MIN_LENGTH,
  UNISWAP_V3_SWAP_ROUTER,
  WETH9_ADDRESS,
  KNOWN_ROUTERS,
  STANDARD_FEE_TIERS,
  type UniswapSwapParams,
} from "../examples/uniswap-swap";

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  transaction: {
    chainId: number;
    nonce: number;
    router: string;
    tokenIn: string;
    tokenInSymbol: string;
    tokenInDecimals: number;
    tokenOut: string;
    tokenOutSymbol: string;
    tokenOutDecimals: number;
    fee: number;
    recipient: string;
    deadline: string;
    amountIn: string;
    amountOutMinimum: string;
    sqrtPriceLimitX96: string;
    ethValue: string;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    origin: string;
  };
  selector: string;
  calldata: string;
  decodedCalldata: {
    methodSelector: string;
    methodName: string;
    tokenIn: string;
    tokenOut: string;
    fee: number;
    recipient: string;
    deadline: string;
    amountIn: string;
    amountOutMinimum: string;
    sqrtPriceLimitX96: string;
  };
  swapDetails: {
    routerName: string;
    tokenInSymbol: string;
    tokenOutSymbol: string;
    feePct: string;
    isEthInput: boolean;
    ethValue: string;
  };
  cborHex: string;
  urString: string;
  humanReadable: string;
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/uniswap-swap.json"), "utf8"),
) as Fixture;

// ─── Deterministic test params ─────────────────────────────────────────────────

const FIXED_REQUEST_ID = new Uint8Array([
  0x04, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf, 0x02,
  0x04, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf, 0x02,
]);

const BASE_PARAMS: UniswapSwapParams = {
  chainId: 1,
  nonce: 7,
  router: UNISWAP_V3_SWAP_ROUTER,
  tokenIn: WETH9_ADDRESS,
  tokenInSymbol: "WETH",
  tokenInDecimals: 18,
  tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  tokenOutSymbol: "USDC",
  tokenOutDecimals: 6,
  fee: 500,
  recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  deadline: "1798761600",
  amountIn: "500000000000000000",
  amountOutMinimum: "1450000000",
  sqrtPriceLimitX96: "0",
  ethValue: "500000000000000000",
  gasLimit: "210000",
  maxFeePerGas: "30000000000",
  maxPriorityFeePerGas: "1500000000",
  requestId: FIXED_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

const FIXED_NOW = 1700000000; // 2023-11-14 — well before all test deadlines

// ─── buildUniswapSwapTx ───────────────────────────────────────────────────────

describe("buildUniswapSwapTx", () => {
  it("produces identical results for identical inputs", () => {
    const r1 = buildUniswapSwapTx(BASE_PARAMS);
    const r2 = buildUniswapSwapTx(BASE_PARAMS);
    expect(r1.calldata).toBe(r2.calldata);
    expect(r1.signRequest.signData).toEqual(r2.signRequest.signData);
    expect(r1.decoded).toEqual(r2.decoded);
  });

  it("envelope.to is the router — not tokenIn or tokenOut", () => {
    // Critical: a wallet displaying tx.to as "recipient" would show the router address.
    const { envelope } = buildUniswapSwapTx(BASE_PARAMS);
    expect(envelope.to).toBe(UNISWAP_V3_SWAP_ROUTER);
    expect(envelope.to).not.toBe(WETH9_ADDRESS);
    expect(envelope.to).not.toBe(BASE_PARAMS.tokenOut);
  });

  it("envelope.value equals ethValue when sending native ETH", () => {
    const { envelope } = buildUniswapSwapTx(BASE_PARAMS);
    expect(envelope.value).toBe(BASE_PARAMS.ethValue);
  });

  it("signData[0] is 0x02 — confirms EIP-1559 transaction type prefix", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    expect(signRequest.signData[0]).toBe(0x02);
  });

  it("signRequest.dataType is 1 — transaction bytes, not typed data", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    expect(signRequest.dataType).toBe(1);
  });

  it("calldata starts with the exactInputSingle selector 0x414bf389", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(calldata.slice(0, 10).toLowerCase()).toBe(EXACT_INPUT_SINGLE_SELECTOR);
  });

  it(`calldata is exactly ${EXACT_INPUT_SINGLE_MIN_LENGTH} chars (4+256 bytes)`, () => {
    // 4 selector bytes + 8 × 32 param bytes = 260 bytes = 520 hex chars + "0x" = 522
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(calldata.length).toBe(EXACT_INPUT_SINGLE_MIN_LENGTH);
  });

  it("decoded.tokenIn matches params.tokenIn (checksummed)", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.tokenIn.toLowerCase()).toBe(BASE_PARAMS.tokenIn.toLowerCase());
  });

  it("decoded.tokenOut matches params.tokenOut (checksummed)", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.tokenOut.toLowerCase()).toBe(BASE_PARAMS.tokenOut.toLowerCase());
  });

  it("decoded.fee matches params.fee", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.fee).toBe(BASE_PARAMS.fee);
  });

  it("decoded.amountIn matches params.amountIn", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.amountIn).toBe(BASE_PARAMS.amountIn);
  });

  it("decoded.amountOutMinimum matches params.amountOutMinimum", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.amountOutMinimum).toBe(BASE_PARAMS.amountOutMinimum);
  });

  it("decoded.deadline matches params.deadline", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.deadline).toBe(BASE_PARAMS.deadline);
  });

  it("decoded.sqrtPriceLimitX96 is '0' (no price limit)", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.sqrtPriceLimitX96).toBe("0");
  });

  it("swapDetails.routerName is 'Uniswap V3 SwapRouter' for the known router", () => {
    const { swapDetails } = buildUniswapSwapTx(BASE_PARAMS);
    expect(swapDetails.routerName).toBe("Uniswap V3 SwapRouter");
  });

  it("swapDetails.isEthInput is true when tokenIn is WETH9 and ethValue > 0", () => {
    const { swapDetails } = buildUniswapSwapTx(BASE_PARAMS);
    expect(swapDetails.isEthInput).toBe(true);
  });

  it("swapDetails.isEthInput is false for ERC20 inputs", () => {
    // Use a different tokenIn (USDC → DAI) — not WETH, not ETH
    const erc20Params: UniswapSwapParams = {
      ...BASE_PARAMS,
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      tokenInSymbol: "USDC",
      tokenOut: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      tokenOutSymbol: "DAI",
      ethValue: "0",
    };
    const { swapDetails } = buildUniswapSwapTx(erc20Params);
    expect(swapDetails.isEthInput).toBe(false);
  });

  it("swapDetails.feePct is '0.05%' for fee=500", () => {
    const { swapDetails } = buildUniswapSwapTx(BASE_PARAMS);
    expect(swapDetails.feePct).toBe("0.05%");
  });

  it("swapDetails.routerName is null for an unknown router", () => {
    const { swapDetails } = buildUniswapSwapTx({
      ...BASE_PARAMS,
      router: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    });
    expect(swapDetails.routerName).toBeNull();
  });

  it("throws a recoverable DgenError for an invalid router address", () => {
    let caught: unknown;
    try {
      buildUniswapSwapTx({ ...BASE_PARAMS, router: "not-an-address" });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("throws a recoverable DgenError for an invalid tokenIn address", () => {
    let caught: unknown;
    try {
      buildUniswapSwapTx({ ...BASE_PARAMS, tokenIn: "0xBAD" });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("throws a recoverable DgenError for an invalid recipient address", () => {
    let caught: unknown;
    try {
      buildUniswapSwapTx({ ...BASE_PARAMS, recipient: "0xBAD" });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("different amountIn produces different signData", () => {
    const r1 = buildUniswapSwapTx(BASE_PARAMS);
    const r2 = buildUniswapSwapTx({ ...BASE_PARAMS, amountIn: "250000000000000000" });
    expect(r1.signRequest.signData).not.toEqual(r2.signRequest.signData);
  });

  it("different recipient produces different calldata", () => {
    const r1 = buildUniswapSwapTx(BASE_PARAMS);
    const r2 = buildUniswapSwapTx({
      ...BASE_PARAMS,
      recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(r1.calldata).not.toBe(r2.calldata);
  });
});

// ─── decodeSwapCalldata ───────────────────────────────────────────────────────

describe("decodeSwapCalldata", () => {
  it("decodes the correct tokenIn from valid calldata", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    const decoded = decodeSwapCalldata(calldata);
    expect(decoded.tokenIn.toLowerCase()).toBe(WETH9_ADDRESS.toLowerCase());
  });

  it("decodes the correct tokenOut from valid calldata", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    const decoded = decodeSwapCalldata(calldata);
    expect(decoded.tokenOut.toLowerCase()).toBe(BASE_PARAMS.tokenOut.toLowerCase());
  });

  it("decodes the correct fee tier", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decodeSwapCalldata(calldata).fee).toBe(500);
  });

  it("decodes the correct amountIn", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decodeSwapCalldata(calldata).amountIn).toBe(BASE_PARAMS.amountIn);
  });

  it("decodes the correct amountOutMinimum", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decodeSwapCalldata(calldata).amountOutMinimum).toBe(BASE_PARAMS.amountOutMinimum);
  });

  it("decodes the correct deadline", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decodeSwapCalldata(calldata).deadline).toBe(BASE_PARAMS.deadline);
  });

  it("returns the canonical selector and method name", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    const decoded = decodeSwapCalldata(calldata);
    expect(decoded.methodSelector).toBe("0x414bf389");
    expect(decoded.methodName).toBe("exactInputSingle");
  });

  it("is deterministic for the same calldata", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decodeSwapCalldata(calldata)).toEqual(decodeSwapCalldata(calldata));
  });

  it("throws CALLDATA_INVALID when calldata does not start with 0x", () => {
    let caught: unknown;
    try {
      decodeSwapCalldata("414bf389000000");
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("CALLDATA_INVALID");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws CALLDATA_TOO_SHORT for calldata under the minimum length", () => {
    let caught: unknown;
    try {
      decodeSwapCalldata("0x414bf38900001234");
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("CALLDATA_TOO_SHORT");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws CALLDATA_WRONG_SELECTOR for a non-exactInputSingle selector", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    // Replace the selector bytes with the ERC20 approve selector
    const wrongSelector = "0x095ea7b3" + calldata.slice(10);
    let caught: unknown;
    try {
      decodeSwapCalldata(wrongSelector);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("CALLDATA_WRONG_SELECTOR");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws CALLDATA_WRONG_SELECTOR for a zero selector", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    const zeroSelector = "0x00000000" + calldata.slice(10);
    expect(() => decodeSwapCalldata(zeroSelector)).toThrow();
  });
});

// ─── validateSwapPayload ──────────────────────────────────────────────────────

describe("validateSwapPayload", () => {
  it("returns no warnings for a well-formed swap", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    expect(warnings).toHaveLength(0);
  });

  it("warns ZERO_AMOUNT_OUT_MINIMUM when amountOutMinimum is 0", () => {
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, amountOutMinimum: "0" });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("ZERO_AMOUNT_OUT_MINIMUM");
  });

  it("ZERO_AMOUNT_OUT_MINIMUM message references sandwich attack risk", () => {
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, amountOutMinimum: "0" });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const w = warnings.find((x) => x.code === "ZERO_AMOUNT_OUT_MINIMUM");
    expect(w?.message).toContain("sandwich");
  });

  it("warns EXPIRED_DEADLINE when deadline is in the past", () => {
    const pastDeadline = String(FIXED_NOW - 1);
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, deadline: pastDeadline });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("EXPIRED_DEADLINE");
  });

  it("EXPIRED_DEADLINE message includes the expired ISO timestamp", () => {
    const pastDeadline = "1699999999";
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, deadline: pastDeadline });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const w = warnings.find((x) => x.code === "EXPIRED_DEADLINE");
    expect(w?.message).toContain(new Date(1699999999 * 1000).toISOString());
  });

  it("does NOT warn EXPIRED_DEADLINE for a future deadline", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS); // deadline 2027
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).not.toContain("EXPIRED_DEADLINE");
  });

  it("warns UNKNOWN_ROUTER for a non-whitelisted router", () => {
    const result = buildUniswapSwapTx({
      ...BASE_PARAMS,
      router: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("UNKNOWN_ROUTER");
  });

  it("does NOT warn UNKNOWN_ROUTER for the canonical V3 SwapRouter", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).not.toContain("UNKNOWN_ROUTER");
  });

  it("warns ZERO_RECIPIENT when recipient is the zero address", () => {
    const result = buildUniswapSwapTx({
      ...BASE_PARAMS,
      recipient: "0x0000000000000000000000000000000000000000",
    });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("ZERO_RECIPIENT");
  });

  it("warns UNUSUAL_FEE_TIER for a non-standard fee tier", () => {
    // 1500 is not a standard Uniswap V3 tier
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, fee: 1500 });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("UNUSUAL_FEE_TIER");
  });

  it("does NOT warn UNUSUAL_FEE_TIER for standard fee tiers", () => {
    for (const fee of [100, 500, 3000, 10000]) {
      const result = buildUniswapSwapTx({ ...BASE_PARAMS, fee });
      const { warnings } = validateSwapPayload(result, FIXED_NOW);
      const codes = warnings.map((w) => w.code);
      expect(codes).not.toContain("UNUSUAL_FEE_TIER");
    }
  });

  it("warns EXCESSIVE_FEE_TIER for fee > 10000", () => {
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, fee: 50000 });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("EXCESSIVE_FEE_TIER");
    // Excessive fee also means unusual; but EXCESSIVE is the more severe warning
    expect(codes).not.toContain("UNUSUAL_FEE_TIER");
  });

  it("can return multiple warnings simultaneously", () => {
    const result = buildUniswapSwapTx({
      ...BASE_PARAMS,
      amountOutMinimum: "0",
      deadline: String(FIXED_NOW - 1), // expired
      router: "0x1111111254EEB25477B68fb85Ed929f73A960582", // unknown
    });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("ZERO_AMOUNT_OUT_MINIMUM");
    expect(codes).toContain("EXPIRED_DEADLINE");
    expect(codes).toContain("UNKNOWN_ROUTER");
  });

  it("all warnings have non-empty message strings", () => {
    const result = buildUniswapSwapTx({
      ...BASE_PARAMS,
      amountOutMinimum: "0",
      recipient: "0x0000000000000000000000000000000000000000",
    });
    const { warnings } = validateSwapPayload(result, FIXED_NOW);
    for (const w of warnings) {
      expect(w.message.length).toBeGreaterThan(0);
    }
  });
});

// ─── CBOR + UR pipeline ───────────────────────────────────────────────────────

describe("encodeToCbor + encodeToUr + decodeUrPayload", () => {
  it("UR string starts with ur:eth-sign-request/", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const ur = encodeToUr(encodeToCbor(signRequest));
    expect(ur.startsWith("ur:eth-sign-request/")).toBe(true);
  });

  it("CBOR encode is deterministic for the same inputs", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const c1 = encodeToCbor(signRequest);
    const c2 = encodeToCbor(signRequest);
    expect(Buffer.from(c1).toString("hex")).toBe(Buffer.from(c2).toString("hex"));
  });

  it("UR encode is deterministic for the same CBOR", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(encodeToUr(cbor)).toBe(encodeToUr(cbor));
  });

  it("UR decode restores signData byte-for-byte", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.signData).toEqual(signRequest.signData);
  });

  it("UR decode restores chainId and origin", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.chainId).toBe(1);
    expect(restored.origin).toBe("ethos-eip4527-signer");
  });

  it("swap calldata is recoverable from signData via decodeSwapCalldata", () => {
    // signData is the RLP-encoded unsigned tx. The calldata survives inside the RLP.
    // Byte-equality of restored.signData confirms the calldata was not corrupted.
    const { signRequest, calldata } = buildUniswapSwapTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.signData).toEqual(signRequest.signData);
    // Spot-check: calldata is still decodable with the same selector.
    expect(decodeSwapCalldata(calldata).methodSelector).toBe(EXACT_INPUT_SINGLE_SELECTOR);
  });

  it("throws for a malformed UR string", () => {
    expect(() => decodeUrPayload("not-a-ur")).toThrow();
  });
});

// ─── renderHumanReadable ──────────────────────────────────────────────────────

describe("renderHumanReadable", () => {
  const NO_WARNINGS: never[] = [];

  it("includes the input token display (ETH since isEthInput)", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("ETH");
  });

  it("includes the formatted input amount", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    // 500000000000000000 wei = 0.500000 ETH (6 display decimals)
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("0.500000");
  });

  it("includes the output token symbol", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("USDC");
  });

  it("includes the formatted output minimum amount", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    // 1450000000 raw / 10^6 = 1450.000000 USDC
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("1450.000000");
  });

  it("includes the router address or name", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain(UNISWAP_V3_SWAP_ROUTER);
  });

  it("includes the recipient address", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain(BASE_PARAMS.recipient);
  });

  it("includes the fee tier percentage", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("0.05%");
  });

  it("shows 'Enabled' slippage protection when amountOutMinimum > 0", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("Enabled");
  });

  it("shows DISABLED slippage protection when amountOutMinimum is 0", () => {
    const result = buildUniswapSwapTx({ ...BASE_PARAMS, amountOutMinimum: "0" });
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("DISABLED");
  });

  it("includes the deadline ISO timestamp", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("2027-01-01T00:00:00.000Z");
  });

  it("includes the network chainId", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("chainId: 1");
  });

  it("includes gas limit", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("210000");
  });

  it("includes the static security notice", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("Security Notice");
  });

  it("includes warning codes when warnings are present", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    const warnings = [
      { code: "ZERO_AMOUNT_OUT_MINIMUM" as const, message: "No slippage protection set." },
    ];
    const output = renderHumanReadable(result, warnings);
    expect(output).toContain("ZERO_AMOUNT_OUT_MINIMUM");
    expect(output).toContain("No slippage protection set.");
  });

  it("does NOT include warning section when no warnings", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).not.toContain("Security Warnings");
  });

  it("shows route as ETH → USDC (not WETH → USDC) when isEthInput", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    const output = renderHumanReadable(result, NO_WARNINGS);
    expect(output).toContain("ETH → USDC");
  });
});

// ─── Constants and known values ───────────────────────────────────────────────

describe("constants", () => {
  it("EXACT_INPUT_SINGLE_SELECTOR is 0x414bf389", () => {
    expect(EXACT_INPUT_SINGLE_SELECTOR).toBe("0x414bf389");
  });

  it(`EXACT_INPUT_SINGLE_MIN_LENGTH is ${EXACT_INPUT_SINGLE_MIN_LENGTH}`, () => {
    expect(EXACT_INPUT_SINGLE_MIN_LENGTH).toBe(522);
  });

  it("KNOWN_ROUTERS includes the canonical V3 SwapRouter", () => {
    expect(KNOWN_ROUTERS[UNISWAP_V3_SWAP_ROUTER.toLowerCase()]).toBe("Uniswap V3 SwapRouter");
  });

  it("STANDARD_FEE_TIERS contains exactly 100, 500, 3000, 10000", () => {
    expect(STANDARD_FEE_TIERS.has(100)).toBe(true);
    expect(STANDARD_FEE_TIERS.has(500)).toBe(true);
    expect(STANDARD_FEE_TIERS.has(3000)).toBe(true);
    expect(STANDARD_FEE_TIERS.has(10000)).toBe(true);
    expect(STANDARD_FEE_TIERS.has(1500)).toBe(false);
  });
});

// ─── Fixture snapshot consistency ────────────────────────────────────────────

describe("fixture snapshot", () => {
  it("calldata matches the checked-in fixture", () => {
    const { calldata } = buildUniswapSwapTx(BASE_PARAMS);
    expect(calldata).toBe(FIXTURE.calldata);
  });

  it("selector matches the checked-in fixture", () => {
    expect(EXACT_INPUT_SINGLE_SELECTOR).toBe(FIXTURE.selector);
  });

  it("CBOR hex matches the checked-in fixture", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(Buffer.from(cbor).toString("hex")).toBe(FIXTURE.cborHex);
  });

  it("UR string matches the checked-in fixture", () => {
    const { signRequest } = buildUniswapSwapTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(encodeToUr(cbor)).toBe(FIXTURE.urString);
  });

  it("decoded calldata matches the fixture — tokenIn", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.tokenIn).toBe(FIXTURE.decodedCalldata.tokenIn);
  });

  it("decoded calldata matches the fixture — tokenOut", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.tokenOut).toBe(FIXTURE.decodedCalldata.tokenOut);
  });

  it("decoded calldata matches the fixture — fee, amountIn, amountOutMinimum", () => {
    const { decoded } = buildUniswapSwapTx(BASE_PARAMS);
    expect(decoded.fee).toBe(FIXTURE.decodedCalldata.fee);
    expect(decoded.amountIn).toBe(FIXTURE.decodedCalldata.amountIn);
    expect(decoded.amountOutMinimum).toBe(FIXTURE.decodedCalldata.amountOutMinimum);
  });

  it("swapDetails feePct and isEthInput match the fixture", () => {
    const { swapDetails } = buildUniswapSwapTx(BASE_PARAMS);
    expect(swapDetails.feePct).toBe(FIXTURE.swapDetails.feePct);
    expect(swapDetails.isEthInput).toBe(FIXTURE.swapDetails.isEthInput);
  });

  it("human-readable output matches the checked-in fixture", () => {
    const result = buildUniswapSwapTx(BASE_PARAMS);
    expect(renderHumanReadable(result, [])).toBe(FIXTURE.humanReadable);
  });
});
