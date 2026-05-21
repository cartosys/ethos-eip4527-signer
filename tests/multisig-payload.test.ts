/**
 * Tests for the Safe multisig EIP-4527 reference example.
 *
 * Covers:
 *   - buildMultisigPayload: domain integrity, SafeTx hash correctness, sign-data encoding
 *   - decodeNestedCalldata: ERC20 identification, ETH transfer, unknown selector
 *   - decodeSafeTransaction + decodeMultisigUrPayload: round-trip fidelity
 *   - encodeToCbor + encodeToUr: CBOR structure, UR prefix, determinism
 *   - validateMultisigPayload: all warning codes, no-warning happy path
 *   - renderHumanReadable: all key sections present, nested action details
 *   - Fixture snapshot: cborHex, urString, safeTxHash, nestedCalldata match
 */

import { describe, it, expect } from "vitest";
import {
  buildMultisigPayload,
  encodeToCbor,
  encodeToUr,
  decodeSafeTransaction,
  decodeMultisigUrPayload,
  decodeNestedCalldata,
  validateMultisigPayload,
  renderHumanReadable,
  SAFE_TX_TYPES,
  SAFE_OPERATION_CALL,
  SAFE_OPERATION_DELEGATECALL,
  DEMO_PARAMS,
  DEMO_ERC20_CALLDATA,
  type SafeMultisigParams,
  type SafeMultisigResult,
} from "../examples/multisig-payload";
import fixture from "../fixtures/multisig-payload.json";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const FIXED_REQUEST_ID = new Uint8Array([
  0x05, 0xce, 0x8a, 0x46, 0x13, 0x57, 0x9b, 0xdf,
  0x05, 0xce, 0x8a, 0x46, 0x13, 0x57, 0x9b, 0xdf,
]);

const BASE_PARAMS: SafeMultisigParams = {
  chainId: 1,
  safeAddress: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  owners: [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ],
  threshold: 2,
  nonce: 14,
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  value: "0",
  data: DEMO_ERC20_CALLDATA,
  operation: SAFE_OPERATION_CALL,
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nestedTokenSymbol: "USDC",
  nestedTokenDecimals: 6,
  requestId: FIXED_REQUEST_ID,
  origin: "ethos-eip4527-signer",
};

// ─── buildMultisigPayload ─────────────────────────────────────────────────────

describe("buildMultisigPayload", () => {
  it("returns the correct safeTxHash for DEMO_PARAMS", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.safeTxHash).toBe(fixture.safeTxHash);
  });

  it("safeTxHash is deterministic — same params produce same hash", () => {
    const r1 = buildMultisigPayload(BASE_PARAMS);
    const r2 = buildMultisigPayload(BASE_PARAMS);
    expect(r1.safeTxHash).toBe(r2.safeTxHash);
  });

  it("domain.verifyingContract === safeAddress", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.typedData.domain.verifyingContract).toBe(BASE_PARAMS.safeAddress);
  });

  it("domain.chainId matches params", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.typedData.domain.chainId).toBe(BASE_PARAMS.chainId);
  });

  it("primaryType is SafeTx", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.typedData.primaryType).toBe("SafeTx");
  });

  it("message fields match params", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { message } = result.typedData;
    expect(message.to).toBe(BASE_PARAMS.to);
    expect(message.value).toBe(BASE_PARAMS.value);
    expect(message.data).toBe(BASE_PARAMS.data);
    expect(message.operation).toBe(BASE_PARAMS.operation);
    expect(message.nonce).toBe(BASE_PARAMS.nonce);
  });

  it("signRequest.dataType is 2 (typed data)", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.signRequest.dataType).toBe(2);
  });

  it("signRequest.requestId matches provided bytes", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(Array.from(result.signRequest.requestId)).toEqual(Array.from(FIXED_REQUEST_ID));
  });

  it("signRequest.origin matches params", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.signRequest.origin).toBe("ethos-eip4527-signer");
  });

  it("signData is JSON-encoded SafeTypedData as UTF-8", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const jsonStr = new TextDecoder().decode(result.signRequest.signData);
    const parsed: unknown = JSON.parse(jsonStr);
    expect(parsed).toMatchObject({ primaryType: "SafeTx" });
  });

  it("nestedAction.type is erc20_transfer for ERC20 calldata", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.nestedAction.type).toBe("erc20_transfer");
  });

  it("nestedAction.decoded.recipient matches the calldata recipient", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.nestedAction.decoded?.recipient).toBe(
      "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    );
  });

  it("nestedAction.decoded.rawAmount matches the calldata amount", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    expect(result.nestedAction.decoded?.rawAmount).toBe("5000000000");
  });

  it("different nonce produces different safeTxHash", () => {
    const r1 = buildMultisigPayload(BASE_PARAMS);
    const r2 = buildMultisigPayload({ ...BASE_PARAMS, nonce: BASE_PARAMS.nonce + 1 });
    expect(r1.safeTxHash).not.toBe(r2.safeTxHash);
  });

  it("different chainId produces different safeTxHash (replay protection)", () => {
    const r1 = buildMultisigPayload(BASE_PARAMS);
    const r2 = buildMultisigPayload({ ...BASE_PARAMS, chainId: 137 });
    expect(r1.safeTxHash).not.toBe(r2.safeTxHash);
  });

  it("different safeAddress produces different safeTxHash", () => {
    const r1 = buildMultisigPayload(BASE_PARAMS);
    const r2 = buildMultisigPayload({
      ...BASE_PARAMS,
      safeAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    });
    expect(r1.safeTxHash).not.toBe(r2.safeTxHash);
  });

  it("throws DgenError for invalid safeAddress", () => {
    expect(() =>
      buildMultisigPayload({ ...BASE_PARAMS, safeAddress: "not-an-address" }),
    ).toThrow();
  });

  it("throws DgenError for invalid to address", () => {
    expect(() =>
      buildMultisigPayload({ ...BASE_PARAMS, to: "0xinvalid" }),
    ).toThrow();
  });

  it("throws DgenError for invalid owner address", () => {
    expect(() =>
      buildMultisigPayload({
        ...BASE_PARAMS,
        owners: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "invalid"],
      }),
    ).toThrow();
  });

  it("thrown error is recoverable (bad address is user input error)", () => {
    let caughtError: unknown = null;
    try {
      buildMultisigPayload({ ...BASE_PARAMS, safeAddress: "not-an-address" });
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect((caughtError as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("generates a random requestId when none provided", () => {
    const r1 = buildMultisigPayload({ ...BASE_PARAMS, requestId: undefined });
    const r2 = buildMultisigPayload({ ...BASE_PARAMS, requestId: undefined });
    expect(Array.from(r1.signRequest.requestId)).not.toEqual(
      Array.from(r2.signRequest.requestId),
    );
  });
});

// ─── decodeNestedCalldata ─────────────────────────────────────────────────────

describe("decodeNestedCalldata", () => {
  it("identifies empty data as eth_transfer", () => {
    const result = decodeNestedCalldata("0x");
    expect(result.type).toBe("eth_transfer");
    expect(result.decoded).toBeNull();
  });

  it("identifies empty string as eth_transfer", () => {
    const result = decodeNestedCalldata("");
    expect(result.type).toBe("eth_transfer");
  });

  it("identifies ERC20 transfer calldata by selector", () => {
    const result = decodeNestedCalldata(DEMO_ERC20_CALLDATA);
    expect(result.type).toBe("erc20_transfer");
    expect(result.decoded).not.toBeNull();
  });

  it("ERC20 decoded recipient is checksummed", () => {
    const result = decodeNestedCalldata(DEMO_ERC20_CALLDATA);
    expect(result.decoded?.recipient).toBe("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
  });

  it("ERC20 decoded rawAmount matches expected", () => {
    const result = decodeNestedCalldata(DEMO_ERC20_CALLDATA);
    expect(result.decoded?.rawAmount).toBe("5000000000");
  });

  it("returns unknown for unrecognized selector", () => {
    // exactInputSingle selector — not ERC20
    const result = decodeNestedCalldata(
      "0x414bf389000000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(result.type).toBe("unknown");
    expect(result.decoded).toBeNull();
  });

  it("returns unknown for ERC20 selector with truncated data (too short)", () => {
    // Only the selector, no params
    const result = decodeNestedCalldata("0xa9059cbb");
    expect(result.type).toBe("unknown");
  });

  it("returns unknown for data without 0x prefix", () => {
    const result = decodeNestedCalldata("a9059cbb");
    expect(result.type).toBe("unknown");
  });

  it("rawCalldata is preserved in the result", () => {
    const result = decodeNestedCalldata(DEMO_ERC20_CALLDATA);
    expect(result.rawCalldata).toBe(DEMO_ERC20_CALLDATA);
  });
});

// ─── decodeSafeTransaction ────────────────────────────────────────────────────

describe("decodeSafeTransaction", () => {
  it("round-trips SafeTypedData through UTF-8 JSON encoding", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const decoded = decodeSafeTransaction(result.signRequest.signData);
    expect(decoded.primaryType).toBe("SafeTx");
    expect(decoded.domain.verifyingContract).toBe(BASE_PARAMS.safeAddress);
    expect(decoded.domain.chainId).toBe(BASE_PARAMS.chainId);
  });

  it("decoded message.to matches original", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const decoded = decodeSafeTransaction(result.signRequest.signData);
    expect(decoded.message.to).toBe(BASE_PARAMS.to);
  });

  it("decoded message.nonce matches original", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const decoded = decodeSafeTransaction(result.signRequest.signData);
    expect(decoded.message.nonce).toBe(BASE_PARAMS.nonce);
  });

  it("throws DgenError (non-recoverable) for invalid JSON", () => {
    const badBytes = new TextEncoder().encode("not json");
    let caught: unknown = null;
    try {
      decodeSafeTransaction(badBytes);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws DgenError (non-recoverable) for JSON missing SafeTx type", () => {
    const badData = new TextEncoder().encode(JSON.stringify({ primaryType: "NotSafeTx" }));
    let caught: unknown = null;
    try {
      decodeSafeTransaction(badData);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });
});

// ─── encodeToCbor + encodeToUr + decodeMultisigUrPayload ─────────────────────

describe("CBOR + UR pipeline", () => {
  it("CBOR output is a Uint8Array", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const cbor = encodeToCbor(result.signRequest);
    expect(cbor).toBeInstanceOf(Uint8Array);
  });

  it("CBOR is deterministic for the same inputs", () => {
    const r1 = buildMultisigPayload(BASE_PARAMS);
    const r2 = buildMultisigPayload(BASE_PARAMS);
    const cbor1 = Buffer.from(encodeToCbor(r1.signRequest)).toString("hex");
    const cbor2 = Buffer.from(encodeToCbor(r2.signRequest)).toString("hex");
    expect(cbor1).toBe(cbor2);
  });

  it("UR string starts with ur:eth-sign-request/", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const cbor = encodeToCbor(result.signRequest);
    const ur = encodeToUr(cbor);
    expect(ur.startsWith("ur:eth-sign-request/")).toBe(true);
  });

  it("UR is deterministic for the same inputs", () => {
    const r1 = buildMultisigPayload(BASE_PARAMS);
    const r2 = buildMultisigPayload(BASE_PARAMS);
    const ur1 = encodeToUr(encodeToCbor(r1.signRequest));
    const ur2 = encodeToUr(encodeToCbor(r2.signRequest));
    expect(ur1).toBe(ur2);
  });

  it("decodeMultisigUrPayload round-trips the SafeTypedData", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const cbor = encodeToCbor(result.signRequest);
    const ur = encodeToUr(cbor);
    const decoded = decodeMultisigUrPayload(ur);
    expect(decoded.primaryType).toBe("SafeTx");
    expect(decoded.domain.verifyingContract).toBe(BASE_PARAMS.safeAddress);
    expect(decoded.message.nonce).toBe(BASE_PARAMS.nonce);
  });

  it("decodeMultisigUrPayload preserves the nested calldata", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const cbor = encodeToCbor(result.signRequest);
    const ur = encodeToUr(cbor);
    const decoded = decodeMultisigUrPayload(ur);
    expect(decoded.message.data).toBe(DEMO_ERC20_CALLDATA);
  });

  it("decodeMultisigUrPayload throws for malformed UR", () => {
    expect(() => decodeMultisigUrPayload("not-a-ur-string")).toThrow();
  });

  it("decodeMultisigUrPayload throws for wrong UR type", () => {
    // A valid UR but wrong type prefix — just check it throws
    expect(() => decodeMultisigUrPayload("ur:bytes/axaeaaaxaeaa")).toThrow();
  });
});

// ─── validateMultisigPayload ──────────────────────────────────────────────────

describe("validateMultisigPayload", () => {
  it("returns no warnings for a normal Safe transaction", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    expect(warnings).toHaveLength(0);
  });

  it("warns DELEGATECALL when operation === 1", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      operation: SAFE_OPERATION_DELEGATECALL,
    });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "DELEGATECALL")).toBe(true);
  });

  it("DELEGATECALL warning message mentions storage context", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      operation: SAFE_OPERATION_DELEGATECALL,
    });
    const { warnings } = validateMultisigPayload(result);
    const w = warnings.find((x) => x.code === "DELEGATECALL");
    expect(w?.message).toContain("storage context");
  });

  it("warns ZERO_THRESHOLD when threshold === 0", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, threshold: 0 });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "ZERO_THRESHOLD")).toBe(true);
  });

  it("warns INVALID_THRESHOLD when threshold exceeds owner count", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, threshold: 4 }); // 4 > 3 owners
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "INVALID_THRESHOLD")).toBe(true);
  });

  it("does not warn INVALID_THRESHOLD when threshold === owners.length", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, threshold: 3 }); // 3 === 3 owners
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "INVALID_THRESHOLD")).toBe(false);
  });

  it("warns HIGH_SAFE_TX_GAS when safeTxGas > 500000", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, safeTxGas: "600000" });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "HIGH_SAFE_TX_GAS")).toBe(true);
  });

  it("does not warn HIGH_SAFE_TX_GAS when safeTxGas === 500000", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, safeTxGas: "500000" });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "HIGH_SAFE_TX_GAS")).toBe(false);
  });

  it("warns HIGH_BASE_GAS when baseGas > 100000", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, baseGas: "100001" });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "HIGH_BASE_GAS")).toBe(true);
  });

  it("warns GAS_TOKEN_SET when gasToken is non-zero", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      gasToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "GAS_TOKEN_SET")).toBe(true);
  });

  it("warns DANGEROUS_REFUND_RECEIVER when refundReceiver is non-zero", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      refundReceiver: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "DANGEROUS_REFUND_RECEIVER")).toBe(true);
  });

  it("warns UNKNOWN_NESTED_CALLDATA for unrecognized selector", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      // exactInputSingle selector — not recognized
      data: "0x414bf389000000000000000000000000000000000000000000000000000000000000000000",
    });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "UNKNOWN_NESTED_CALLDATA")).toBe(true);
  });

  it("does not warn UNKNOWN_NESTED_CALLDATA for empty data (eth transfer)", () => {
    const result = buildMultisigPayload({ ...BASE_PARAMS, data: "0x" });
    const { warnings } = validateMultisigPayload(result);
    expect(warnings.some((w) => w.code === "UNKNOWN_NESTED_CALLDATA")).toBe(false);
  });

  it("DELEGATECALL appears before threshold warnings in output order", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      operation: SAFE_OPERATION_DELEGATECALL,
      threshold: 0,
    });
    const { warnings } = validateMultisigPayload(result);
    const delegatecallIdx = warnings.findIndex((w) => w.code === "DELEGATECALL");
    const zeroThresholdIdx = warnings.findIndex((w) => w.code === "ZERO_THRESHOLD");
    expect(delegatecallIdx).toBeLessThan(zeroThresholdIdx);
  });
});

// ─── renderHumanReadable ──────────────────────────────────────────────────────

describe("renderHumanReadable", () => {
  it("contains the Safe address", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
  });

  it("contains the network and chainId", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("ethereum (chainId: 1)");
  });

  it("contains threshold display", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("2 of 3 owner(s) required");
  });

  it("contains the nonce", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("14");
  });

  it("contains ERC20 Transfer action label", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("ERC20 Transfer");
  });

  it("contains the token contract address", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    // USDC contract
    expect(rendered).toContain("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("contains the decoded ERC20 recipient", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
  });

  it("contains the formatted token amount with symbol", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("5000.000000 USDC");
  });

  it("shows CALL for operation=0", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("CALL");
    expect(rendered).not.toContain("DELEGATECALL");
  });

  it("shows DELEGATECALL for operation=1", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      operation: SAFE_OPERATION_DELEGATECALL,
    });
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("DELEGATECALL");
  });

  it("contains the safeTxHash", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain(fixture.safeTxHash);
  });

  it("shows zero gas price as no reimbursement", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("0 (no reimbursement)");
  });

  it("shows gas token as ETH (native) for zero address", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("ETH (native)");
  });

  it("shows refund receiver as None (tx.origin) for zero address", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("None (tx.origin)");
  });

  it("shows threshold notice at the end", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("2 owner signature(s) are collected");
  });

  it("includes warning section when warnings present", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      operation: SAFE_OPERATION_DELEGATECALL,
    });
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("Security Warnings");
    expect(rendered).toContain("WARN DELEGATECALL");
  });

  it("does not include warning section when no warnings", () => {
    const result = buildMultisigPayload(BASE_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).not.toContain("Security Warnings");
  });

  it("shows Native ETH Transfer for empty data", () => {
    const result = buildMultisigPayload({
      ...BASE_PARAMS,
      data: "0x",
      value: "1000000000000000000",
    });
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toContain("Native ETH Transfer");
    expect(rendered).toContain("1.000000 ETH");
  });
});

// ─── SAFE_TX_TYPES constant ───────────────────────────────────────────────────

describe("SAFE_TX_TYPES", () => {
  it("has exactly 10 fields in SafeTx", () => {
    expect(SAFE_TX_TYPES["SafeTx"]).toHaveLength(10);
  });

  it("first field is 'to' of type 'address'", () => {
    expect(SAFE_TX_TYPES["SafeTx"]![0]).toEqual({ name: "to", type: "address" });
  });

  it("includes 'data' field as 'bytes'", () => {
    const dataField = SAFE_TX_TYPES["SafeTx"]!.find((f) => f.name === "data");
    expect(dataField?.type).toBe("bytes");
  });

  it("includes 'operation' field as 'uint8'", () => {
    const opField = SAFE_TX_TYPES["SafeTx"]!.find((f) => f.name === "operation");
    expect(opField?.type).toBe("uint8");
  });

  it("last field is 'nonce' of type 'uint256'", () => {
    const fields = SAFE_TX_TYPES["SafeTx"]!;
    expect(fields[fields.length - 1]).toEqual({ name: "nonce", type: "uint256" });
  });
});

// ─── Fixture snapshot ─────────────────────────────────────────────────────────

describe("Fixture snapshot", () => {
  it("DEMO_ERC20_CALLDATA matches fixture", () => {
    expect(DEMO_ERC20_CALLDATA).toBe(fixture.nestedCalldata);
  });

  it("safeTxHash matches fixture", () => {
    const result = buildMultisigPayload(DEMO_PARAMS);
    expect(result.safeTxHash).toBe(fixture.safeTxHash);
  });

  it("cborHex matches fixture", () => {
    const result = buildMultisigPayload(DEMO_PARAMS);
    const cbor = encodeToCbor(result.signRequest);
    expect(Buffer.from(cbor).toString("hex")).toBe(fixture.cborHex);
  });

  it("urString matches fixture", () => {
    const result = buildMultisigPayload(DEMO_PARAMS);
    const cbor = encodeToCbor(result.signRequest);
    const ur = encodeToUr(cbor);
    expect(ur).toBe(fixture.urString);
  });

  it("humanReadable matches fixture", () => {
    const result = buildMultisigPayload(DEMO_PARAMS);
    const { warnings } = validateMultisigPayload(result);
    const rendered = renderHumanReadable(result, warnings);
    expect(rendered).toBe(fixture.humanReadable);
  });

  it("nested decoded recipient matches fixture", () => {
    const result = buildMultisigPayload(DEMO_PARAMS);
    expect(result.nestedAction.decoded?.recipient).toBe(fixture.decodedNested.recipient);
  });

  it("nested decoded rawAmount matches fixture", () => {
    const result = buildMultisigPayload(DEMO_PARAMS);
    expect(result.nestedAction.decoded?.rawAmount).toBe(fixture.decodedNested.rawAmount);
  });

  it("fixture safeTxHash starts with 0x and is 66 chars", () => {
    expect(fixture.safeTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("fixture urString starts with ur:eth-sign-request/", () => {
    expect(fixture.urString.startsWith("ur:eth-sign-request/")).toBe(true);
  });
});
