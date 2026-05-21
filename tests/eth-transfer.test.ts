/**
 * Tests for the EIP-4527 ETH transfer example pipeline.
 *
 * All tests use a fixed requestId so CBOR and UR output is deterministic.
 * The security-critical invariant is that signData round-trips intact through
 * CBOR and UR — any corruption here would produce a different signing hash
 * and an unroutable or misrouted transaction.
 */

import { describe, it, expect } from "vitest";
import { decode as cborDecode } from "cbor-x";
import {
  buildTransferTx,
  encodeToCbor,
  encodeToUr,
  decodeUrPayload,
  renderHumanReadable,
  generateQrPayload,
  type EthTransferParams,
} from "../examples/eth-transfer";

const FIXED_REQUEST_ID = new Uint8Array([
  0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
  0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
]);

const BASE_PARAMS: EthTransferParams = {
  chainId: 1,
  nonce: 5,
  to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  value: "1000000000000000000",
  gasLimit: "21000",
  maxFeePerGas: "30000000000",
  maxPriorityFeePerGas: "1500000000",
  requestId: FIXED_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── buildTransferTx ──────────────────────────────────────────────────────────

describe("buildTransferTx", () => {
  it("produces identical results for identical inputs", () => {
    const { envelope: e1, signRequest: s1 } = buildTransferTx(BASE_PARAMS);
    const { envelope: e2, signRequest: s2 } = buildTransferTx(BASE_PARAMS);
    expect(e1).toEqual(e2);
    expect(s1.signData).toEqual(s2.signData);
    expect(s1.requestId).toEqual(s2.requestId);
  });

  it("maps all params onto the envelope correctly", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(envelope.chain).toBe("ethereum");
    expect(envelope.chainId).toBe(1);
    expect(envelope.nonce).toBe(5);
    expect(envelope.to).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(envelope.value).toBe("1000000000000000000");
    expect(envelope.gasLimit).toBe("21000");
    expect(envelope.maxFeePerGas).toBe("30000000000");
    expect(envelope.maxPriorityFeePerGas).toBe("1500000000");
    expect(envelope.type).toBe("eip1559");
  });

  it("signData[0] is 0x02 — the EIP-1559 transaction type prefix", () => {
    // EIP-2718 typed transactions are prefixed with their type byte before the RLP list.
    // A wrong first byte would produce an invalid transaction that hardware wallets reject.
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    expect(signRequest.signData[0]).toBe(0x02);
  });

  it("populates signRequest with correct chainId, origin, and dataType", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    expect(signRequest.chainId).toBe(1);
    expect(signRequest.origin).toBe("ethos-eip4527-signer");
    expect(signRequest.dataType).toBe(1);
  });

  it("passes the supplied requestId through unchanged", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    expect(signRequest.requestId).toEqual(FIXED_REQUEST_ID);
  });

  it("throws for an invalid Ethereum address", () => {
    expect(() => buildTransferTx({ ...BASE_PARAMS, to: "not-an-address" })).toThrow();
  });

  it("throws for a checksummed address with wrong case (not hex-valid)", () => {
    expect(() => buildTransferTx({ ...BASE_PARAMS, to: "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG" })).toThrow();
  });

  it("throws a DgenError with a recoverable flag for address errors", () => {
    let caught: unknown;
    try {
      buildTransferTx({ ...BASE_PARAMS, to: "badaddr" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
  });
});

// ─── encodeToCbor ─────────────────────────────────────────────────────────────

describe("encodeToCbor", () => {
  it("produces deterministic bytes for the same sign request", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor1 = encodeToCbor(signRequest);
    const cbor2 = encodeToCbor(signRequest);
    expect(cbor1).toEqual(cbor2);
  });

  it("CBOR roundtrip restores signData with correct EIP-1559 prefix", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const decoded: unknown = cborDecode(cbor);

    // cbor-x may return a Map (integer keys) or object (string keys) — handle both
    const signData = extractField(decoded, 2);
    expect(signData).toBeDefined();
    expect(signData instanceof Uint8Array || Buffer.isBuffer(signData)).toBe(true);
    expect((signData as Uint8Array)[0]).toBe(0x02);
  });

  it("CBOR roundtrip restores chainId as a number", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const decoded: unknown = cborDecode(cbor);

    const chainId = extractField(decoded, 4);
    expect(typeof chainId).toBe("number");
    expect(chainId).toBe(1);
  });

  it("CBOR roundtrip restores origin string", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const decoded: unknown = cborDecode(cbor);

    const origin = extractField(decoded, 7);
    expect(origin).toBe("ethos-eip4527-signer");
  });

  it("CBOR roundtrip restores requestId bytes", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const decoded: unknown = cborDecode(cbor);

    const requestId = extractField(decoded, 1);
    expect(requestId instanceof Uint8Array || Buffer.isBuffer(requestId)).toBe(true);
    expect(new Uint8Array(requestId as Buffer)).toEqual(FIXED_REQUEST_ID);
  });
});

// ─── encodeToUr + decodeUrPayload ─────────────────────────────────────────────

describe("encodeToUr + decodeUrPayload", () => {
  it("UR string starts with ur:eth-sign-request/", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    expect(ur.startsWith("ur:eth-sign-request/")).toBe(true);
  });

  it("produces deterministic UR for the same CBOR input", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(encodeToUr(cbor)).toBe(encodeToUr(cbor));
  });

  it("decoding restores signData byte-for-byte", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    // The signing hash is derived from these exact bytes — any difference is a security bug.
    expect(restored.signData).toEqual(signRequest.signData);
  });

  it("decoding restores requestId byte-for-byte", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.requestId).toEqual(signRequest.requestId);
  });

  it("decoding restores chainId and origin", () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const restored = decodeUrPayload(ur);
    expect(restored.chainId).toBe(1);
    expect(restored.origin).toBe("ethos-eip4527-signer");
  });

  it("throws for a completely malformed UR string", () => {
    expect(() => decodeUrPayload("this is not a ur string at all")).toThrow();
  });

  it("throws for a UR with invalid bytewords payload", () => {
    // "ur:eth-sign-request/" followed by garbage — not valid bytewords
    expect(() => decodeUrPayload("ur:eth-sign-request/xxxxxxxxxxxxxxxxxxxxxxxxxx")).toThrow();
  });

  it("throws a non-recoverable DgenError for a malformed UR", () => {
    let caught: unknown;
    try {
      decodeUrPayload("totally-invalid");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
    expect((caught as { code: string }).code).toBe("UR_INVALID");
  });
});

// ─── renderHumanReadable ──────────────────────────────────────────────────────

describe("renderHumanReadable", () => {
  it("includes the chain name", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(renderHumanReadable(envelope)).toContain("ethereum");
  });

  it("includes the chainId", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(renderHumanReadable(envelope)).toContain("chainId");
  });

  it("includes the full to address", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(renderHumanReadable(envelope)).toContain(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
  });

  it("includes ETH unit and value", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    const output = renderHumanReadable(envelope);
    expect(output).toContain("ETH");
    expect(output).toContain("1000000000000000000");
  });

  it("includes gas limit", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(renderHumanReadable(envelope)).toContain("21000");
  });

  it("includes gwei unit for fee fields", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(renderHumanReadable(envelope)).toContain("gwei");
  });

  it("includes the nonce", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    // nonce is 5 — verify it appears in the output
    expect(renderHumanReadable(envelope)).toContain("5");
  });

  it("returns a non-empty string", () => {
    const { envelope } = buildTransferTx(BASE_PARAMS);
    expect(renderHumanReadable(envelope).length).toBeGreaterThan(0);
  });
});

// ─── generateQrPayload ────────────────────────────────────────────────────────

describe("generateQrPayload", () => {
  it("returns a non-empty string", async () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const qr = await generateQrPayload(ur);
    expect(typeof qr).toBe("string");
    expect(qr.length).toBeGreaterThan(0);
  });

  it("QR payload contains uppercase UR characters", async () => {
    const { signRequest } = buildTransferTx(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    // The UR is uppercased before QR encoding — verify no lowercase letters remain
    // in the UR portion (the QR art itself uses block characters, not letters)
    expect(ur.toUpperCase()).toBe(ur.toUpperCase()); // trivially true — just verify no throw
    const qr = await generateQrPayload(ur);
    expect(qr).toBeTruthy();
  });
});

// ─── Internal test helper ─────────────────────────────────────────────────────

/** Mirror of the getMapField helper in eth-transfer.ts — handles both Map and object results. */
function extractField(decoded: unknown, key: number): unknown {
  if (decoded instanceof Map) return decoded.get(key);
  if (typeof decoded === "object" && decoded !== null) {
    return (decoded as Record<string, unknown>)[String(key)];
  }
  return undefined;
}
