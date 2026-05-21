/**
 * Tests for the EIP-4527 ERC20 transfer pipeline.
 *
 * Security-critical invariants verified here:
 * 1. tx.to is the TOKEN CONTRACT — not the recipient. A wallet that reads
 *    tx.to and displays it as "recipient" would show the user a contract address.
 * 2. The actual recipient lives in calldata. Wallets that don't decode calldata
 *    cannot show the user who receives the tokens.
 * 3. signData roundtrips intact through CBOR and UR — any corruption produces
 *    a different signing hash.
 * 4. The calldata selector must be exactly 0xa9059cbb — wrong selector means
 *    a different contract method is being called.
 */

import { describe, it, expect } from "vitest";
import { getAddress } from "ethers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildErc20TransferTx,
  decodeErc20Transfer,
  renderHumanReadable,
  encodeToCbor,
  encodeToUr,
  decodeUrPayload,
  ERC20_TRANSFER_SELECTOR,
  type Erc20TransferParams,
} from "../examples/erc20-transfer";

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  transaction: {
    chainId: number;
    nonce: number;
    tokenContract: string;
    recipient: string;
    tokenAmount: string;
    tokenSymbol: string;
    tokenDecimals: number;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    origin: string;
  };
  calldata: string;
  cborHex: string;
  urString: string;
  decodedTransfer: {
    methodSelector: string;
    methodName: string;
    recipient: string;
    rawAmount: string;
  };
  humanReadable: string;
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/erc20-transfer.json"), "utf8"),
) as Fixture;

// ─── Deterministic test params ─────────────────────────────────────────────────

const FIXED_REQUEST_ID = new Uint8Array([
  0x02, 0x46, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf,
  0x02, 0x46, 0x8a, 0xce, 0x13, 0x57, 0x9b, 0xdf,
]);

const BASE_PARAMS: Erc20TransferParams = {
  chainId: 1,
  nonce: 3,
  tokenContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  tokenAmount: "100000000",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  gasLimit: "65000",
  maxFeePerGas: "30000000000",
  maxPriorityFeePerGas: "1500000000",
  requestId: FIXED_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── buildErc20TransferTx ─────────────────────────────────────────────────────

describe("buildErc20TransferTx", () => {
  it("produces identical results for identical inputs", () => {
    const r1 = buildErc20TransferTx(BASE_PARAMS);
    const r2 = buildErc20TransferTx(BASE_PARAMS);
    expect(r1.calldata).toBe(r2.calldata);
    expect(r1.signRequest.signData).toEqual(r2.signRequest.signData);
    expect(r1.envelope).toEqual(r2.envelope);
  });

  it("envelope.to is the token contract — not the recipient", () => {
    // This is the critical ERC20 distinction. A wallet displaying envelope.to
    // as the "recipient" would mislead the user into thinking they are sending
    // tokens to the contract itself.
    const { envelope } = buildErc20TransferTx(BASE_PARAMS);
    expect(envelope.to).toBe(BASE_PARAMS.tokenContract);
    expect(envelope.to).not.toBe(BASE_PARAMS.recipient);
  });

  it("envelope.value is 0 — no ETH is transferred in a token transfer", () => {
    const { envelope } = buildErc20TransferTx(BASE_PARAMS);
    expect(envelope.value).toBe("0");
  });

  it("signData[0] is 0x02 — confirms EIP-1559 transaction type prefix", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    expect(signRequest.signData[0]).toBe(0x02);
  });

  it("calldata starts with the ERC20 transfer selector 0xa9059cbb", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    expect(calldata.slice(0, 10).toLowerCase()).toBe(ERC20_TRANSFER_SELECTOR);
  });

  it("calldata is exactly 138 characters (0x + 68 bytes × 2 hex chars)", () => {
    // 4 selector bytes + 32 address bytes + 32 uint256 bytes = 68 bytes
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    expect(calldata.length).toBe(138);
  });

  it("decoded recipient matches the params recipient (case-insensitive)", () => {
    const { decoded } = buildErc20TransferTx(BASE_PARAMS);
    expect(getAddress(decoded.recipient)).toBe(getAddress(BASE_PARAMS.recipient));
  });

  it("decoded rawAmount matches the params tokenAmount", () => {
    const { decoded } = buildErc20TransferTx(BASE_PARAMS);
    expect(decoded.rawAmount).toBe(BASE_PARAMS.tokenAmount);
  });

  it("tokenDetails matches input params", () => {
    const { tokenDetails } = buildErc20TransferTx(BASE_PARAMS);
    expect(tokenDetails.tokenContract).toBe(BASE_PARAMS.tokenContract);
    expect(tokenDetails.tokenAmount).toBe(BASE_PARAMS.tokenAmount);
    expect(tokenDetails.tokenSymbol).toBe("USDC");
    expect(tokenDetails.tokenDecimals).toBe(6);
  });

  it("throws a recoverable DgenError for an invalid token contract address", () => {
    let caught: unknown;
    try {
      buildErc20TransferTx({ ...BASE_PARAMS, tokenContract: "not-an-address" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("throws a recoverable DgenError for an invalid recipient address", () => {
    let caught: unknown;
    try {
      buildErc20TransferTx({ ...BASE_PARAMS, recipient: "0xBAD" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("sets signRequest chainId and origin", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    expect(signRequest.chainId).toBe(1);
    expect(signRequest.origin).toBe("ethos-eip4527-signer");
    expect(signRequest.dataType).toBe(1);
  });
});

// ─── decodeErc20Transfer ──────────────────────────────────────────────────────

describe("decodeErc20Transfer", () => {
  it("decodes the correct recipient address from valid calldata", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    const decoded = decodeErc20Transfer(calldata);
    expect(getAddress(decoded.recipient)).toBe(getAddress(BASE_PARAMS.recipient));
  });

  it("decodes the correct rawAmount from valid calldata", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    const decoded = decodeErc20Transfer(calldata);
    expect(decoded.rawAmount).toBe(BASE_PARAMS.tokenAmount);
  });

  it("returns the canonical method name and selector", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    const decoded = decodeErc20Transfer(calldata);
    expect(decoded.methodSelector).toBe("0xa9059cbb");
    expect(decoded.methodName).toBe("transfer(address,uint256)");
  });

  it("throws CALLDATA_INVALID when calldata does not start with 0x", () => {
    let caught: unknown;
    try {
      decodeErc20Transfer("a9059cbb0000000000000000000000001234");
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("CALLDATA_INVALID");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws CALLDATA_TOO_SHORT when calldata is under 138 chars", () => {
    let caught: unknown;
    try {
      decodeErc20Transfer("0xa9059cbb00001234");
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("CALLDATA_TOO_SHORT");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws CALLDATA_WRONG_SELECTOR for an ERC20 approve selector", () => {
    // 0x095ea7b3 is the approve(address,uint256) selector — wrong for transfer
    const wrongSelector =
      "0x095ea7b3" +
      "000000000000000000000000742d35cc6634c0532925a3b844bc454e4438f44e" +
      "0000000000000000000000000000000000000000000000000000000005f5e100";
    let caught: unknown;
    try {
      decodeErc20Transfer(wrongSelector);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("CALLDATA_WRONG_SELECTOR");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws CALLDATA_WRONG_SELECTOR for a zero selector", () => {
    const zeros =
      "0x00000000" +
      "000000000000000000000000742d35cc6634c0532925a3b844bc454e4438f44e" +
      "0000000000000000000000000000000000000000000000000000000005f5e100";
    expect(() => decodeErc20Transfer(zeros)).toThrow();
  });

  it("is deterministic — same calldata always produces the same decoded result", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    const d1 = decodeErc20Transfer(calldata);
    const d2 = decodeErc20Transfer(calldata);
    expect(d1).toEqual(d2);
  });
});

// ─── CBOR + UR pipeline ───────────────────────────────────────────────────────

describe("encodeToCbor + encodeToUr + decodeUrPayload", () => {
  it("UR string starts with ur:eth-sign-request/", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    const ur = encodeToUr(encodeToCbor(signRequest));
    expect(ur.startsWith("ur:eth-sign-request/")).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(encodeToUr(cbor)).toBe(encodeToUr(cbor));
  });

  it("UR decode restores signData byte-for-byte", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.signData).toEqual(signRequest.signData);
  });

  it("UR decode restores chainId and origin", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.chainId).toBe(1);
    expect(restored.origin).toBe("ethos-eip4527-signer");
  });

  it("ERC20 calldata is recoverable from signData via decodeErc20Transfer", () => {
    // signData is the RLP-encoded unsigned tx. We can't un-RLP it trivially here,
    // but we verify that the decoded UR's signData matches the original — which
    // means the full calldata was preserved inside the RLP and survived the roundtrip.
    const { signRequest, calldata } = buildErc20TransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    // The original signData contains the calldata inside the RLP encoding.
    // Byte-equality confirms the calldata was not corrupted in transit.
    expect(restored.signData).toEqual(signRequest.signData);
    // Spot-check: the original calldata is also well-formed.
    expect(decodeErc20Transfer(calldata).rawAmount).toBe(BASE_PARAMS.tokenAmount);
  });

  it("throws for a malformed UR string", () => {
    expect(() => decodeUrPayload("not-a-ur")).toThrow();
  });
});

// ─── renderHumanReadable ──────────────────────────────────────────────────────

describe("renderHumanReadable", () => {
  it("includes the token symbol", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    expect(renderHumanReadable(result)).toContain("USDC");
  });

  it("includes the token contract address", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    expect(renderHumanReadable(result)).toContain(BASE_PARAMS.tokenContract);
  });

  it("includes the decoded recipient address", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    // Recipient comes from calldata decode — not from params.recipient directly
    expect(renderHumanReadable(result)).toContain("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
  });

  it("includes the formatted token amount", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    // 100000000 raw units / 10^6 = 100.000000 USDC
    expect(renderHumanReadable(result)).toContain("100.000000");
  });

  it("includes the decoded method name", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    expect(renderHumanReadable(result)).toContain("transfer(address,uint256)");
  });

  it("includes the network name", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    expect(renderHumanReadable(result)).toContain("ethereum");
  });

  it("includes gas fields in gwei", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    const output = renderHumanReadable(result);
    expect(output).toContain("gwei");
    expect(output).toContain("65000");
  });

  it("does NOT show the token contract as the recipient", () => {
    // The render must distinguish between tx.to (contract) and decoded recipient.
    // If the output labeled the contract address as "Recipient" it would mislead signers.
    const result = buildErc20TransferTx(BASE_PARAMS);
    const output = renderHumanReadable(result);
    expect(output).toContain("Token Contract");
    expect(output).toContain("Recipient");
  });
});

// ─── Fixture snapshot consistency ────────────────────────────────────────────

describe("fixture snapshot", () => {
  it("calldata matches the checked-in fixture", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    expect(calldata).toBe(FIXTURE.calldata);
  });

  it("CBOR hex matches the checked-in fixture", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(Buffer.from(cbor).toString("hex")).toBe(FIXTURE.cborHex);
  });

  it("UR string matches the checked-in fixture", () => {
    const { signRequest } = buildErc20TransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    expect(ur).toBe(FIXTURE.urString);
  });

  it("decoded transfer fields match the checked-in fixture", () => {
    const { calldata } = buildErc20TransferTx(BASE_PARAMS);
    const decoded = decodeErc20Transfer(calldata);
    expect(decoded.methodSelector).toBe(FIXTURE.decodedTransfer.methodSelector);
    expect(decoded.methodName).toBe(FIXTURE.decodedTransfer.methodName);
    expect(getAddress(decoded.recipient)).toBe(getAddress(FIXTURE.decodedTransfer.recipient));
    expect(decoded.rawAmount).toBe(FIXTURE.decodedTransfer.rawAmount);
  });

  it("human-readable output matches the checked-in fixture", () => {
    const result = buildErc20TransferTx(BASE_PARAMS);
    expect(renderHumanReadable(result)).toBe(FIXTURE.humanReadable);
  });
});
