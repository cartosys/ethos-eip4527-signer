/**
 * Tests for the EIP-4527 Permit2 EIP-712 typed data signing pipeline.
 *
 * Security-critical invariants verified here:
 * 1. sign-data contains JSON-encoded EIP-712 typed data, not raw bytes — a signer
 *    that cannot parse JSON cannot display the approval fields to the user.
 * 2. The domain has NO "version" field — Permit2 contract does not include it.
 *    An incorrect domain produces a different signing hash (wrong approval).
 * 3. The signing hash must match TypedDataEncoder output — any deviation means a
 *    different message is being signed than what is displayed.
 * 4. data-type in the CBOR is 2 (typed-data), not 1 (transaction) — mistyping this
 *    tells the signer to interpret the payload incorrectly.
 * 5. analyzePermit2 must surface unlimited approvals and expired permits — missing
 *    these warnings leaves users blind to critical signing risks.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TypedDataEncoder } from "ethers";
import {
  buildPermit2Payload,
  encodeToCbor,
  encodeToUr,
  decodePermit2Payload,
  decodePermit2UrPayload,
  analyzePermit2,
  renderHumanReadable,
  PERMIT2_ADDRESS,
  PERMIT2_TYPES,
  type Permit2Params,
  type Permit2TypedData,
} from "../examples/permit2";

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  params: {
    chainId: number;
    tokenContract: string;
    tokenSymbol: string;
    tokenDecimals: number;
    spender: string;
    amount: string;
    expiration: number;
    nonce: number;
    sigDeadline: string;
    origin: string;
  };
  signingHash: string;
  cborHex: string;
  urString: string;
  decodedTypedData: {
    primaryType: string;
    domain: { name: string; chainId: number; verifyingContract: string };
    message: {
      details: { token: string; amount: string; expiration: number; nonce: number };
      spender: string;
      sigDeadline: string;
    };
  };
  humanReadable: string;
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/permit2.json"), "utf8"),
) as Fixture;

// ─── Deterministic test params ─────────────────────────────────────────────────

const FIXED_REQUEST_ID = new Uint8Array([
  0x03, 0x57, 0x9b, 0xdf, 0x13, 0xce, 0x8a, 0x46,
  0x03, 0x57, 0x9b, 0xdf, 0x13, 0xce, 0x8a, 0x46,
]);

const BASE_PARAMS: Permit2Params = {
  chainId: 1,
  tokenContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  spender: "0x1111111254EEB25477B68fb85Ed929f73A960582",
  amount: "1000000000",
  expiration: 1798761600,
  nonce: 0,
  sigDeadline: "1798761600",
  requestId: FIXED_REQUEST_ID,
  origin: "ethos-eip4527-signer",
} as const;

// ─── buildPermit2Payload ──────────────────────────────────────────────────────

describe("buildPermit2Payload", () => {
  it("produces identical results for identical inputs", () => {
    const r1 = buildPermit2Payload(BASE_PARAMS);
    const r2 = buildPermit2Payload(BASE_PARAMS);
    expect(r1.signingHash).toBe(r2.signingHash);
    expect(r1.signRequest.signData).toEqual(r2.signRequest.signData);
    expect(r1.typedData).toEqual(r2.typedData);
  });

  it("dataType is 2 — signals EIP-712 typed data, not a raw transaction", () => {
    // A signer that reads data-type must know to parse sign-data as JSON, not as RLP.
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    expect(signRequest.dataType).toBe(2);
  });

  it("domain.name is exactly 'Permit2' — wrong name produces a different hash", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(typedData.domain.name).toBe("Permit2");
  });

  it("domain has no 'version' field — Permit2 contract omits it intentionally", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(Object.keys(typedData.domain)).not.toContain("version");
  });

  it("domain.verifyingContract is the canonical Permit2 address", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(typedData.domain.verifyingContract).toBe(PERMIT2_ADDRESS);
  });

  it("message.details.token matches the token contract param", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(typedData.message.details.token).toBe(BASE_PARAMS.tokenContract);
  });

  it("message.details.amount matches the amount param", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(typedData.message.details.amount).toBe(BASE_PARAMS.amount);
  });

  it("message.spender matches the spender param", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(typedData.message.spender).toBe(BASE_PARAMS.spender);
  });

  it("primaryType is 'PermitSingle'", () => {
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    expect(typedData.primaryType).toBe("PermitSingle");
  });

  it("signingHash matches TypedDataEncoder.hash output", () => {
    // The signing hash is the ground truth — this test verifies that
    // our hash computation matches the canonical ethers v6 implementation.
    const { typedData, signingHash } = buildPermit2Payload(BASE_PARAMS);
    const expected = TypedDataEncoder.hash(
      typedData.domain,
      PERMIT2_TYPES,
      typedData.message,
    );
    expect(signingHash).toBe(expected);
  });

  it("sign-data is valid UTF-8 JSON that round-trips to the typed data", () => {
    const { typedData, signRequest } = buildPermit2Payload(BASE_PARAMS);
    const json = new TextDecoder().decode(signRequest.signData);
    const parsed = JSON.parse(json) as Permit2TypedData;
    expect(parsed.domain.name).toBe(typedData.domain.name);
    expect(parsed.message.spender).toBe(typedData.message.spender);
    expect(parsed.message.details.amount).toBe(typedData.message.details.amount);
  });

  it("signRequest.chainId matches params.chainId", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    expect(signRequest.chainId).toBe(1);
  });

  it("signRequest.origin matches params.origin", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    expect(signRequest.origin).toBe("ethos-eip4527-signer");
  });

  it("throws a recoverable DgenError for an invalid token contract address", () => {
    let caught: unknown;
    try {
      buildPermit2Payload({ ...BASE_PARAMS, tokenContract: "not-an-address" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("throws a recoverable DgenError for an invalid spender address", () => {
    let caught: unknown;
    try {
      buildPermit2Payload({ ...BASE_PARAMS, spender: "0xBAD" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe("INVALID_ADDRESS");
    expect((caught as { recoverable: boolean }).recoverable).toBe(true);
  });

  it("different amounts produce different signing hashes", () => {
    const r1 = buildPermit2Payload(BASE_PARAMS);
    const r2 = buildPermit2Payload({ ...BASE_PARAMS, amount: "999999999" });
    expect(r1.signingHash).not.toBe(r2.signingHash);
  });

  it("different spenders produce different signing hashes", () => {
    const r1 = buildPermit2Payload(BASE_PARAMS);
    const r2 = buildPermit2Payload({
      ...BASE_PARAMS,
      spender: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(r1.signingHash).not.toBe(r2.signingHash);
  });

  it("different chainIds produce different signing hashes", () => {
    const r1 = buildPermit2Payload(BASE_PARAMS);
    const r2 = buildPermit2Payload({ ...BASE_PARAMS, chainId: 137 });
    expect(r1.signingHash).not.toBe(r2.signingHash);
  });
});

// ─── decodePermit2Payload ─────────────────────────────────────────────────────

describe("decodePermit2Payload", () => {
  it("round-trips the typed data through sign-data bytes", () => {
    const { typedData, signRequest } = buildPermit2Payload(BASE_PARAMS);
    const decoded = decodePermit2Payload(signRequest.signData);
    expect(decoded.domain.name).toBe(typedData.domain.name);
    expect(decoded.domain.chainId).toBe(typedData.domain.chainId);
    expect(decoded.message.spender).toBe(typedData.message.spender);
    expect(decoded.message.details.amount).toBe(typedData.message.details.amount);
    expect(decoded.message.details.expiration).toBe(typedData.message.details.expiration);
    expect(decoded.primaryType).toBe("PermitSingle");
  });

  it("reconstructed signing hash matches the original", () => {
    const { signingHash, signRequest } = buildPermit2Payload(BASE_PARAMS);
    const decoded = decodePermit2Payload(signRequest.signData);
    const reconstructed = TypedDataEncoder.hash(decoded.domain, PERMIT2_TYPES, decoded.message);
    expect(reconstructed).toBe(signingHash);
  });

  it("throws PAYLOAD_DECODE_FAILED for non-JSON bytes", () => {
    const bad = new TextEncoder().encode("not-json{{");
    let caught: unknown;
    try {
      decodePermit2Payload(bad);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("PAYLOAD_DECODE_FAILED");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
  });

  it("throws PAYLOAD_INVALID when domain name is not 'Permit2'", () => {
    const { typedData, signRequest } = buildPermit2Payload(BASE_PARAMS);
    const json = new TextDecoder().decode(signRequest.signData);
    const mutated = json.replace('"name":"Permit2"', '"name":"WrongName"');
    const bad = new TextEncoder().encode(mutated);
    let caught: unknown;
    try {
      decodePermit2Payload(bad);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe("PAYLOAD_INVALID");
    expect((caught as { recoverable: boolean }).recoverable).toBe(false);
    // Suppress unused variable warning
    void typedData;
  });

  it("throws PAYLOAD_INVALID when primaryType is missing or wrong", () => {
    const json = JSON.stringify({
      domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2_ADDRESS },
      types: PERMIT2_TYPES,
      message: { details: { token: BASE_PARAMS.tokenContract, amount: "0", expiration: 0, nonce: 0 }, spender: BASE_PARAMS.spender, sigDeadline: "0" },
      primaryType: "Wrong",
    });
    const bad = new TextEncoder().encode(json);
    expect(() => decodePermit2Payload(bad)).toThrow();
  });

  it("is deterministic — same sign-data always produces the same decoded result", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const d1 = decodePermit2Payload(signRequest.signData);
    const d2 = decodePermit2Payload(signRequest.signData);
    expect(d1).toEqual(d2);
  });
});

// ─── CBOR + UR pipeline ───────────────────────────────────────────────────────

describe("encodeToCbor + encodeToUr + decodePermit2UrPayload", () => {
  it("UR string starts with ur:eth-sign-request/", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const ur = encodeToUr(encodeToCbor(signRequest));
    expect(ur.startsWith("ur:eth-sign-request/")).toBe(true);
  });

  it("CBOR encode is deterministic for the same inputs", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const c1 = encodeToCbor(signRequest);
    const c2 = encodeToCbor(signRequest);
    expect(Buffer.from(c1).toString("hex")).toBe(Buffer.from(c2).toString("hex"));
  });

  it("UR encode is deterministic for the same CBOR", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(encodeToUr(cbor)).toBe(encodeToUr(cbor));
  });

  it("UR decode restores the typed data", () => {
    const { typedData, signRequest } = buildPermit2Payload(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const decoded = decodePermit2UrPayload(ur);
    expect(decoded.domain.name).toBe(typedData.domain.name);
    expect(decoded.message.spender).toBe(typedData.message.spender);
    expect(decoded.message.details.amount).toBe(typedData.message.details.amount);
  });

  it("signing hash survives the full UR roundtrip", () => {
    const { signingHash, signRequest } = buildPermit2Payload(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    const decoded = decodePermit2UrPayload(ur);
    const reconstructed = TypedDataEncoder.hash(decoded.domain, PERMIT2_TYPES, decoded.message);
    expect(reconstructed).toBe(signingHash);
  });

  it("throws for a malformed UR string", () => {
    expect(() => decodePermit2UrPayload("not-a-ur")).toThrow();
  });

  it("throws for a wrong UR type", () => {
    expect(() => decodePermit2UrPayload("ur:bytes/taadmhaebbsrazehf")).toThrow();
  });
});

// ─── analyzePermit2 ───────────────────────────────────────────────────────────

describe("analyzePermit2", () => {
  const FIXED_NOW = 1700000000; // 2023-11-14 — before all test expiration dates

  it("returns no warnings for a normal permit", () => {
    // Use an expiration 180 days out — non-zero amount, valid spender, not expired, not long
    const nearExpiration = FIXED_NOW + 180 * 24 * 3600;
    const { typedData } = buildPermit2Payload({ ...BASE_PARAMS, expiration: nearExpiration });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    expect(warnings).toHaveLength(0);
  });

  it("warns UNLIMITED_APPROVAL for uint160 max amount", () => {
    const UINT160_MAX = (2n ** 160n - 1n).toString();
    const { typedData } = buildPermit2Payload({ ...BASE_PARAMS, amount: UINT160_MAX });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("UNLIMITED_APPROVAL");
  });

  it("warns ZERO_AMOUNT for a zero-token approval", () => {
    const { typedData } = buildPermit2Payload({ ...BASE_PARAMS, amount: "0" });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("ZERO_AMOUNT");
  });

  it("warns EXPIRED_PERMIT when expiration is in the past", () => {
    const pastExpiration = FIXED_NOW - 1;
    const { typedData } = buildPermit2Payload({ ...BASE_PARAMS, expiration: pastExpiration });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("EXPIRED_PERMIT");
  });

  it("warns LONG_EXPIRATION when expiration is more than 1 year away", () => {
    // BASE_PARAMS.expiration is 2027-01-01, far beyond 1 year from FIXED_NOW (2023-11-14)
    const { typedData } = buildPermit2Payload(BASE_PARAMS);
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("LONG_EXPIRATION");
  });

  it("does NOT warn LONG_EXPIRATION for expiration exactly 364 days away", () => {
    const nearExpiration = FIXED_NOW + 364 * 24 * 3600;
    const { typedData } = buildPermit2Payload({ ...BASE_PARAMS, expiration: nearExpiration });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).not.toContain("LONG_EXPIRATION");
    expect(codes).not.toContain("EXPIRED_PERMIT");
  });

  it("warns ZERO_ADDRESS_SPENDER for the zero address", () => {
    const { typedData } = buildPermit2Payload({
      ...BASE_PARAMS,
      spender: "0x0000000000000000000000000000000000000000",
    });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("ZERO_ADDRESS_SPENDER");
  });

  it("can return multiple warnings simultaneously", () => {
    const UINT160_MAX = (2n ** 160n - 1n).toString();
    const { typedData } = buildPermit2Payload({
      ...BASE_PARAMS,
      amount: UINT160_MAX,
      expiration: FIXED_NOW - 1, // expired
    });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("UNLIMITED_APPROVAL");
    expect(codes).toContain("EXPIRED_PERMIT");
  });

  it("all warnings have non-empty message strings", () => {
    const UINT160_MAX = (2n ** 160n - 1n).toString();
    const { typedData } = buildPermit2Payload({
      ...BASE_PARAMS,
      amount: UINT160_MAX,
      spender: "0x0000000000000000000000000000000000000000",
    });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    for (const w of warnings) {
      expect(w.message.length).toBeGreaterThan(0);
    }
  });

  it("expired warning message includes the expiration ISO timestamp", () => {
    const pastExpiration = 1699999999; // a specific timestamp before FIXED_NOW
    const { typedData } = buildPermit2Payload({ ...BASE_PARAMS, expiration: pastExpiration });
    const { warnings } = analyzePermit2(typedData, FIXED_NOW);
    const expiredWarn = warnings.find((w) => w.code === "EXPIRED_PERMIT");
    expect(expiredWarn).toBeDefined();
    expect(expiredWarn?.message).toContain(new Date(pastExpiration * 1000).toISOString());
  });
});

// ─── renderHumanReadable ──────────────────────────────────────────────────────

describe("renderHumanReadable", () => {
  const NO_WARNINGS: never[] = [];

  it("includes the token symbol", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("USDC");
  });

  it("includes the token contract address", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain(BASE_PARAMS.tokenContract);
  });

  it("includes the spender address", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain(BASE_PARAMS.spender);
  });

  it("includes the formatted token amount", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    // 1000000000 raw / 10^6 = 1000.000000 USDC
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("1000.000000");
  });

  it("displays UNLIMITED for uint160 max amount", () => {
    const UINT160_MAX = (2n ** 160n - 1n).toString();
    const result = buildPermit2Payload({ ...BASE_PARAMS, amount: UINT160_MAX });
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("UNLIMITED");
  });

  it("includes the signing hash", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain(result.signingHash);
  });

  it("includes the expiration ISO timestamp", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    const output = renderHumanReadable(result, NO_WARNINGS);
    expect(output).toContain("2027-01-01T00:00:00.000Z");
  });

  it("includes the network chainId", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("chainId: 1");
  });

  it("mentions Permit2 protocol", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, NO_WARNINGS)).toContain("Permit2");
  });

  it("includes warning codes when warnings are present", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    const warnings = [
      {
        code: "UNLIMITED_APPROVAL" as const,
        message: "Grants unlimited approval",
      },
    ];
    const output = renderHumanReadable(result, warnings);
    expect(output).toContain("UNLIMITED_APPROVAL");
    expect(output).toContain("Grants unlimited approval");
  });

  it("does not include warning section when no warnings", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    const output = renderHumanReadable(result, NO_WARNINGS);
    expect(output).not.toContain("Security Warnings");
  });
});

// ─── Fixture snapshot consistency ────────────────────────────────────────────

describe("fixture snapshot", () => {
  it("signing hash matches the checked-in fixture", () => {
    const { signingHash } = buildPermit2Payload(BASE_PARAMS);
    expect(signingHash).toBe(FIXTURE.signingHash);
  });

  it("CBOR hex matches the checked-in fixture", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    expect(Buffer.from(cbor).toString("hex")).toBe(FIXTURE.cborHex);
  });

  it("UR string matches the checked-in fixture", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const cbor = encodeToCbor(signRequest);
    const ur = encodeToUr(cbor);
    expect(ur).toBe(FIXTURE.urString);
  });

  it("decoded typed data domain matches the fixture", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const decoded = decodePermit2Payload(signRequest.signData);
    expect(decoded.domain.name).toBe(FIXTURE.decodedTypedData.domain.name);
    expect(decoded.domain.chainId).toBe(FIXTURE.decodedTypedData.domain.chainId);
    expect(decoded.domain.verifyingContract).toBe(FIXTURE.decodedTypedData.domain.verifyingContract);
  });

  it("decoded typed data message matches the fixture", () => {
    const { signRequest } = buildPermit2Payload(BASE_PARAMS);
    const decoded = decodePermit2Payload(signRequest.signData);
    expect(decoded.message.spender).toBe(FIXTURE.decodedTypedData.message.spender);
    expect(decoded.message.details.amount).toBe(FIXTURE.decodedTypedData.message.details.amount);
    expect(decoded.message.details.expiration).toBe(FIXTURE.decodedTypedData.message.details.expiration);
    expect(decoded.message.sigDeadline).toBe(FIXTURE.decodedTypedData.message.sigDeadline);
  });

  it("human-readable output matches the checked-in fixture", () => {
    const result = buildPermit2Payload(BASE_PARAMS);
    expect(renderHumanReadable(result, [])).toBe(FIXTURE.humanReadable);
  });
});
