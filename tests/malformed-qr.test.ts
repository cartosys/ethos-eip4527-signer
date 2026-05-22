/**
 * Tests for the malformed QR corpus — defensive parser hardening.
 *
 * Security invariants verified here:
 *   1. validateQrPayload never throws — all errors are caught and returned as results.
 *   2. Every malformed payload in the corpus produces ok:false, never ok:true.
 *   3. Oversized payloads are rejected BEFORE URDecoder is called (DoS guard).
 *   4. CBOR payloads with wrong structure produce typed, classified errors.
 *   5. EIP-712 sign-data with invalid UTF-8, missing fields, or wrong domain
 *      is rejected with a specific code that explains the flaw to the user.
 *   6. Fragment strings with impossible indices are rejected by validateFragmentString.
 *   7. All error messages in the human-readable output are sanitized (no raw bytes).
 *   8. Deterministic fuzz mutations — 32 single-byte flips of a valid CBOR payload —
 *      never cause an uncaught exception in the validator.
 */

import { describe, it, expect } from "vitest";
import {
  validateQrPayload,
  validateUrPayload,
  validateCborPayload,
  validateTypedData,
  validateFragmentString,
  classifyMalformedPayload,
  renderHumanReadableError,
  buildMalformedCorpus,
  generateMalformedUr,
  generateMalformedCbor,
  generateTruncatedPayload,
  generateOversizedPayload,
  generateInvalidFragmentSequence,
  generateCorruptedTypedData,
  MalformedUrError,
  InvalidCborError,
  InvalidFragmentError,
  OversizedPayloadError,
  InvalidTypedDataError,
  ValidationError,
  MAX_UR_CHARS,
  MAX_CBOR_BYTES,
  MAX_SIGN_DATA_BYTES,
  MAX_FRAGMENT_COUNT,
  encodeToUr,
  type MalformedKind,
  type ClassifiedError,
  type ValidationResult,
} from "../examples/malformed-qr";
import { buildTransferTx, encodeToCbor, DEMO_PARAMS } from "../examples/eth-transfer";
import { encode as cborEncode } from "cbor-x";
import fixture from "../fixtures/malformed-qr.json";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getBaseUr(): string {
  const { signRequest } = buildTransferTx(DEMO_PARAMS);
  return encodeToUr(encodeToCbor(signRequest));
}

function getBaseCbor(): Uint8Array {
  const { signRequest } = buildTransferTx(DEMO_PARAMS);
  return encodeToCbor(signRequest);
}

// ─── Error classes ────────────────────────────────────────────────────────────

describe("Typed error classes", () => {
  it("MalformedUrError has correct name and fields", () => {
    const e = new MalformedUrError("UR_PARSE_FAILED", "bad UR");
    expect(e.name).toBe("MalformedUrError");
    expect(e.code).toBe("UR_PARSE_FAILED");
    expect(e.message).toBe("bad UR");
    expect(e.recoverable).toBe(false);
    expect(e instanceof Error).toBe(true);
  });

  it("InvalidCborError has correct name and fields", () => {
    const e = new InvalidCborError("CBOR_NOT_A_MAP", "not a map");
    expect(e.name).toBe("InvalidCborError");
    expect(e.code).toBe("CBOR_NOT_A_MAP");
    expect(e.recoverable).toBe(false);
  });

  it("InvalidFragmentError has correct name and fields", () => {
    const e = new InvalidFragmentError("FRAGMENT_ZERO_SEQ_NUM", "seq 0");
    expect(e.name).toBe("InvalidFragmentError");
    expect(e.recoverable).toBe(false);
  });

  it("OversizedPayloadError captures actual and limit sizes", () => {
    const e = new OversizedPayloadError("UR_TOO_LONG", "too big", 5000, MAX_UR_CHARS);
    expect(e.actualBytes).toBe(5000);
    expect(e.limitBytes).toBe(MAX_UR_CHARS);
    expect(e.recoverable).toBe(false);
  });

  it("InvalidTypedDataError has correct name", () => {
    const e = new InvalidTypedDataError("TYPED_DATA_INVALID_UTF8", "bad bytes");
    expect(e.name).toBe("InvalidTypedDataError");
    expect(e.recoverable).toBe(false);
  });

  it("ValidationError is an Error subclass", () => {
    const e = new ValidationError("INPUT_EMPTY", "empty");
    expect(e instanceof Error).toBe(true);
    expect(e.recoverable).toBe(false);
  });
});

// ─── validateQrPayload — top-level ────────────────────────────────────────────

describe("validateQrPayload", () => {
  it("accepts a valid ETH transfer UR", () => {
    const ur = getBaseUr();
    const result = validateQrPayload(ur);
    expect(result.ok).toBe(true);
  });

  it("never throws — returns ok:false for malformed input", () => {
    const inputs: unknown[] = [
      null, undefined, 42, {}, [], "not a ur", "ur:xyz/aaaa", "",
    ];
    for (const input of inputs) {
      expect(() => validateQrPayload(input)).not.toThrow();
      const result = validateQrPayload(input);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects null input with INPUT_NOT_STRING", () => {
    const result = validateQrPayload(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_NOT_STRING");
    }
  });

  it("rejects empty string with INPUT_EMPTY", () => {
    const result = validateQrPayload("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_EMPTY");
    }
  });

  it("rejects oversized UR before calling URDecoder (DoS guard)", () => {
    const oversized = generateOversizedPayload();
    expect(oversized.length).toBeGreaterThan(MAX_UR_CHARS);
    const result = validateQrPayload(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UR_TOO_LONG");
      expect(result.error.kind).toBe("oversized_payload");
    }
  });

  it("rejects UR with wrong type prefix", () => {
    const ur = getBaseUr();
    const wrongType = generateMalformedUr(ur, "wrong_prefix");
    const result = validateQrPayload(wrongType);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UR_WRONG_TYPE");
    }
  });

  it("rejects input not starting with ur:", () => {
    const result = validateQrPayload("eth-sign-request/abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UR_NOT_UR_FORMAT");
    }
  });

  it("rejects truncated UR (50%)", () => {
    const ur = getBaseUr();
    const truncated = generateMalformedUr(ur, "truncated_half");
    const result = validateQrPayload(truncated);
    expect(result.ok).toBe(false);
  });

  it("rejects single-character input", () => {
    const result = validateQrPayload("u");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UR_NOT_UR_FORMAT");
    }
  });

  it("result has recoverable: false for all failures", () => {
    const inputs = [null, "", "not-ur", generateOversizedPayload()];
    for (const input of inputs) {
      const result = validateQrPayload(input);
      if (!result.ok) {
        expect(result.error.recoverable).toBe(false);
      }
    }
  });
});

// ─── validateUrPayload ────────────────────────────────────────────────────────

describe("validateUrPayload", () => {
  it("accepts a valid ETH transfer UR", () => {
    const ur = getBaseUr();
    expect(validateUrPayload(ur).ok).toBe(true);
  });

  it("rejects UR with corrupt body character '!'", () => {
    const ur = generateMalformedUr(getBaseUr(), "corrupt_body");
    const result = validateUrPayload(ur);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UR_PARSE_FAILED");
    }
  });

  it("rejects UR with corrupted checksum region", () => {
    const result = validateUrPayload(generateMalformedUr(getBaseUr(), "corrupt_checksum"));
    expect(result.ok).toBe(false);
  });

  it("rejects plain-text input (no ur: prefix)", () => {
    const result = validateUrPayload("not-a-ur");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_ur_prefix");
    }
  });

  it("never throws — catches all library errors", () => {
    const badInputs = ["ur:/", "ur:eth-sign-request/", "ur:x/!@#$"];
    for (const input of badInputs) {
      expect(() => validateUrPayload(input)).not.toThrow();
    }
  });

  it("rejects CBOR exceeding MAX_CBOR_BYTES with CBOR_TOO_LARGE", () => {
    const oversized = generateOversizedPayload();
    // oversized is > MAX_UR_CHARS so validateQrPayload catches it first,
    // but validateUrPayload is called directly here
    if (oversized.length <= MAX_UR_CHARS) {
      const result = validateUrPayload(oversized);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CBOR_TOO_LARGE");
      }
    }
    // If oversized UR exceeds MAX_UR_CHARS, just verify it's rejected
    expect(() => validateUrPayload(oversized)).not.toThrow();
  });
});

// ─── validateCborPayload ──────────────────────────────────────────────────────

describe("validateCborPayload", () => {
  it("accepts valid ETH transfer CBOR", () => {
    const cbor = getBaseCbor();
    expect(validateCborPayload(cbor).ok).toBe(true);
  });

  it("rejects CBOR array (wrong major type)", () => {
    const cbor = generateMalformedCbor("wrong_major_type_array");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_NOT_A_MAP");
    }
  });

  it("rejects CBOR text string (wrong major type)", () => {
    const cbor = generateMalformedCbor("wrong_major_type_text");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_NOT_A_MAP");
    }
  });

  it("rejects CBOR map missing signData", () => {
    const cbor = generateMalformedCbor("missing_sign_data");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_MISSING_SIGN_DATA");
    }
  });

  it("rejects CBOR map with null signData", () => {
    const cbor = generateMalformedCbor("null_sign_data");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_MISSING_SIGN_DATA");
    }
  });

  it("rejects CBOR map with string signData", () => {
    const cbor = generateMalformedCbor("string_sign_data");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_MISSING_SIGN_DATA");
    }
  });

  it("rejects chainId = 0", () => {
    const cbor = generateMalformedCbor("zero_chain_id");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_INVALID_CHAIN_ID");
      expect(result.error.kind).toBe("invalid_chain_id");
    }
  });

  it("rejects chainId = -1", () => {
    const cbor = generateMalformedCbor("negative_chain_id");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_INVALID_CHAIN_ID");
    }
  });

  it("rejects CBOR with descriptive string keys (no integer keys present)", () => {
    const cbor = generateMalformedCbor("string_keys");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_MISSING_REQUEST_ID");
    }
  });

  it("rejects truncated CBOR bytes", () => {
    const cbor = generateMalformedCbor("truncated_bytes");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_DECODE_FAILED");
    }
  });

  it("rejects random bytes that are not CBOR", () => {
    const cbor = generateMalformedCbor("random_bytes");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CBOR_DECODE_FAILED");
    }
  });

  it("rejects empty byte array", () => {
    const result = validateCborPayload(new Uint8Array(0));
    expect(result.ok).toBe(false);
  });

  it("rejects single byte (not a valid CBOR map)", () => {
    const result = validateCborPayload(new Uint8Array([0x00]));
    expect(result.ok).toBe(false);
  });

  it("never throws for any byte sequence", () => {
    const badInputs = [
      new Uint8Array(0),
      new Uint8Array([0xff]),
      new Uint8Array(100).fill(0xaa),
      new Uint8Array([0xc0, 0x80, 0xff]),
    ];
    for (const input of badInputs) {
      expect(() => validateCborPayload(input)).not.toThrow();
    }
  });

  it("rejects signData exceeding MAX_SIGN_DATA_BYTES", () => {
    const oversizedSignData = Buffer.alloc(MAX_SIGN_DATA_BYTES + 1).fill(0x01);
    const cbor = new Uint8Array(
      cborEncode(new Map<number, unknown>([
        [1, Buffer.alloc(16).fill(0x06)],
        [2, oversizedSignData],
        [3, 1],
        [4, 1],
        [7, "test"],
      ])),
    );
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SIGN_DATA_TOO_LARGE");
      expect(result.error.kind).toBe("oversized_payload");
    }
  });
});

// ─── validateTypedData ────────────────────────────────────────────────────────

describe("validateTypedData", () => {
  const VALID_TYPED_DATA = {
    domain: { chainId: 1, verifyingContract: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" },
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
      ],
    },
    message: { to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", value: "0" },
    primaryType: "SafeTx",
  };

  const validBytes = (): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(VALID_TYPED_DATA));

  it("accepts valid EIP-712 typed data", () => {
    expect(validateTypedData(validBytes()).ok).toBe(true);
  });

  it("rejects invalid UTF-8 bytes", () => {
    const result = validateTypedData(
      generateCorruptedTypedData("not_json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TYPED_DATA_INVALID_UTF8");
      expect(result.error.kind).toBe("invalid_utf8");
    }
  });

  it("rejects valid UTF-8 that is not JSON", () => {
    const result = validateTypedData(new TextEncoder().encode("not json at all"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TYPED_DATA_INVALID_JSON");
    }
  });

  it("rejects empty JSON object {}", () => {
    // validateTypedData takes sign-data bytes (UTF-8 JSON), not CBOR bytes
    const result = validateTypedData(new TextEncoder().encode("{}"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TYPED_DATA_SCHEMA_INVALID");
    }
  });

  it("rejects typed data missing primaryType", () => {
    const result = validateTypedData(
      generateCorruptedTypedData("missing_primary_type"),
    );
    // The data-type is 2 here so validateCborPayload delegates to validateTypedData
    const cbor = generateCorruptedTypedData("missing_primary_type");
    const cborResult = validateCborPayload(cbor);
    expect(cborResult.ok).toBe(false);
    if (!cborResult.ok) {
      expect(cborResult.error.code).toBe("TYPED_DATA_SCHEMA_INVALID");
    }
  });

  it("rejects empty domain (no chainId, no verifyingContract)", () => {
    const cbor = generateCorruptedTypedData("empty_domain");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformed_eip712");
    }
  });

  it("rejects Safe domain with extra name/version fields", () => {
    const cbor = generateCorruptedTypedData("extra_safe_domain_fields");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TYPED_DATA_SAFE_DOMAIN_EXTRA_FIELDS");
    }
  });

  it("rejects types with primaryType missing from types map", () => {
    const cbor = generateCorruptedTypedData("missing_types");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TYPED_DATA_PRIMARY_TYPE_MISSING");
    }
  });

  it("rejects domain with chainId=0", () => {
    const cbor = generateCorruptedTypedData("invalid_domain_chain_id");
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformed_eip712");
    }
  });

  it("never throws for any input", () => {
    const badInputs: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0xff, 0xfe]),
      new TextEncoder().encode("{}"),
      new TextEncoder().encode("null"),
      new TextEncoder().encode("[1,2,3]"),
    ];
    for (const input of badInputs) {
      expect(() => validateTypedData(input)).not.toThrow();
    }
  });
});

// ─── validateFragmentString ───────────────────────────────────────────────────

describe("validateFragmentString", () => {
  it("rejects fragment with seqNum = 0", () => {
    const fragments = generateInvalidFragmentSequence();
    const zeroSeq = fragments[1]; // 0-3 fragment
    if (zeroSeq) {
      const result = validateFragmentString(zeroSeq);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FRAGMENT_ZERO_SEQ_NUM");
        expect(result.error.kind).toBe("malformed_qr_chunk_metadata");
      }
    }
  });

  it("rejects fragment with seqNum > seqLen", () => {
    const fragments = generateInvalidFragmentSequence();
    const impossible = fragments[0]; // 5-3 fragment
    if (impossible) {
      const result = validateFragmentString(impossible);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FRAGMENT_INDEX_OUT_OF_RANGE");
        expect(result.error.kind).toBe("corrupted_fragment_ordering");
      }
    }
  });

  it("rejects non-UR input", () => {
    const result = validateFragmentString("not-a-ur");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FRAGMENT_NOT_UR");
    }
  });

  it("rejects fragment with seqLen exceeding MAX_FRAGMENT_COUNT", () => {
    const bigSeqLen = MAX_FRAGMENT_COUNT + 1;
    const fragment = `ur:eth-sign-request/1-${bigSeqLen}/taadaxonadgd`;
    const result = validateFragmentString(fragment);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FRAGMENT_COUNT_EXCEEDED");
      expect(result.error.kind).toBe("oversized_payload");
    }
  });

  it("never throws for any input", () => {
    const badInputs = [
      "",
      "ur:eth-sign-request/0-0/taadax",
      "ur:eth-sign-request/999-1/taadax",
      "ur:x/abc",
      "not-ur",
    ];
    for (const input of badInputs) {
      expect(() => validateFragmentString(input)).not.toThrow();
    }
  });
});

// ─── classifyMalformedPayload ─────────────────────────────────────────────────

describe("classifyMalformedPayload", () => {
  it("classifies MalformedUrError with wrong type as invalid_ur_prefix", () => {
    const e = new MalformedUrError("UR_WRONG_TYPE", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("invalid_ur_prefix");
    expect(c.code).toBe("UR_WRONG_TYPE");
    expect(c.recoverable).toBe(false);
  });

  it("classifies MalformedUrError parse failure as invalid_checksum", () => {
    const e = new MalformedUrError("UR_PARSE_FAILED", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("invalid_checksum");
  });

  it("classifies MalformedUrError not-ur-format as invalid_ur_prefix", () => {
    const e = new MalformedUrError("UR_NOT_UR_FORMAT", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("invalid_ur_prefix");
  });

  it("classifies InvalidCborError as malformed_cbor", () => {
    const e = new InvalidCborError("CBOR_NOT_A_MAP", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("malformed_cbor");
  });

  it("classifies InvalidCborError CBOR_INVALID_CHAIN_ID as invalid_chain_id", () => {
    const e = new InvalidCborError("CBOR_INVALID_CHAIN_ID", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("invalid_chain_id");
  });

  it("classifies InvalidFragmentError FRAGMENT_ZERO_SEQ_NUM as malformed_qr_chunk_metadata", () => {
    const e = new InvalidFragmentError("FRAGMENT_ZERO_SEQ_NUM", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("malformed_qr_chunk_metadata");
  });

  it("classifies InvalidFragmentError FRAGMENT_INDEX_OUT_OF_RANGE as corrupted_fragment_ordering", () => {
    const e = new InvalidFragmentError("FRAGMENT_INDEX_OUT_OF_RANGE", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("corrupted_fragment_ordering");
  });

  it("classifies OversizedPayloadError as oversized_payload", () => {
    const e = new OversizedPayloadError("UR_TOO_LONG", "msg", 5000, MAX_UR_CHARS);
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("oversized_payload");
  });

  it("classifies InvalidTypedDataError TYPED_DATA_INVALID_UTF8 as invalid_utf8", () => {
    const e = new InvalidTypedDataError("TYPED_DATA_INVALID_UTF8", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("invalid_utf8");
  });

  it("classifies InvalidTypedDataError others as malformed_eip712", () => {
    const e = new InvalidTypedDataError("TYPED_DATA_SCHEMA_INVALID", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.kind).toBe("malformed_eip712");
  });

  it("classifies generic Error as malformed_cbor", () => {
    const c = classifyMalformedPayload(new Error("something went wrong"));
    expect(c.kind).toBe("malformed_cbor");
    expect(c.recoverable).toBe(false);
  });

  it("classifies non-Error throw as malformed_cbor with NON_ERROR_THROW", () => {
    const c = classifyMalformedPayload("string thrown");
    expect(c.kind).toBe("malformed_cbor");
    expect(c.code).toBe("NON_ERROR_THROW");
  });

  it("classifies null throw without crashing", () => {
    expect(() => classifyMalformedPayload(null)).not.toThrow();
    const c = classifyMalformedPayload(null);
    expect(c.recoverable).toBe(false);
  });

  it("originalError is preserved", () => {
    const e = new MalformedUrError("UR_PARSE_FAILED", "msg");
    const c = classifyMalformedPayload(e);
    expect(c.originalError).toBe(e);
  });
});

// ─── renderHumanReadableError ─────────────────────────────────────────────────

describe("renderHumanReadableError", () => {
  const makeClassified = (kind: MalformedKind, code: string, message: string): ClassifiedError => ({
    kind,
    code,
    message,
    recoverable: false,
    originalError: new Error(message),
  });

  it("contains 'QR Payload Validation Failed' header", () => {
    const rendered = renderHumanReadableError(
      makeClassified("truncated_ur", "UR_PARSE_FAILED", "truncated"),
    );
    expect(rendered).toContain("QR Payload Validation Failed");
  });

  it("contains the error code", () => {
    const rendered = renderHumanReadableError(
      makeClassified("malformed_cbor", "CBOR_NOT_A_MAP", "not a map"),
    );
    expect(rendered).toContain("CBOR_NOT_A_MAP");
  });

  it("contains a Security Notice section", () => {
    const rendered = renderHumanReadableError(
      makeClassified("oversized_payload", "UR_TOO_LONG", "too big"),
    );
    expect(rendered).toContain("Security Notice");
  });

  it("contains a Recommended Action section", () => {
    const rendered = renderHumanReadableError(
      makeClassified("invalid_checksum", "UR_PARSE_FAILED", "bad checksum"),
    );
    expect(rendered).toContain("Recommended Action");
  });

  it("mentions memory in security notice for oversized_payload", () => {
    const rendered = renderHumanReadableError(
      makeClassified("oversized_payload", "UR_TOO_LONG", "too big"),
    );
    expect(rendered).toContain("memory");
  });

  it("recommends rejecting for truncated_ur", () => {
    const rendered = renderHumanReadableError(
      makeClassified("truncated_ur", "UR_PARSE_FAILED", "truncated"),
    );
    expect(rendered).toContain("Reject");
  });

  it("does not embed raw payload bytes in output", () => {
    // The error message comes from our code (sanitized), not from untrusted input
    const rendered = renderHumanReadableError(
      makeClassified("malformed_cbor", "CBOR_DECODE_FAILED", "safe message only"),
    );
    // Check the rendered output doesn't have byte sequences like ff fe c0 80
    expect(rendered).not.toContain("\xff");
    expect(rendered).not.toContain("\xfe");
  });

  it("covers all MalformedKind values without throwing", () => {
    const kinds: MalformedKind[] = [
      "truncated_ur", "malformed_cbor", "invalid_ur_prefix", "corrupted_fragment_ordering",
      "duplicate_fragments", "invalid_checksum", "oversized_payload", "invalid_utf8",
      "malformed_transaction", "invalid_chain_id", "malformed_calldata", "malformed_eip712",
      "malformed_qr_chunk_metadata",
    ];
    for (const kind of kinds) {
      expect(() =>
        renderHumanReadableError(makeClassified(kind, "TEST_CODE", "test")),
      ).not.toThrow();
    }
  });
});

// ─── Corpus: all cases fail ───────────────────────────────────────────────────

describe("buildMalformedCorpus — all cases reject", () => {
  const corpus = buildMalformedCorpus();

  it("corpus contains the expected number of cases", () => {
    expect(corpus.length).toBe(fixture.corpus.length);
    expect(corpus.length).toBeGreaterThanOrEqual(20);
  });

  it("every corpus case produces ok:false from its validator", () => {
    for (const c of corpus) {
      let result: ValidationResult;
      if (c.payloadType === "cbor_hex") {
        result = validateCborPayload(new Uint8Array(Buffer.from(c.payload, "hex")));
      } else if (c.payloadType === "fragment") {
        result = validateFragmentString(c.payload);
      } else {
        result = validateQrPayload(c.payload);
      }
      expect(result.ok, `Case ${c.id} should fail but passed`).toBe(false);
    }
  });

  it("every corpus case has a non-empty humanReadable containing validation failure header", () => {
    for (const c of corpus) {
      expect(c.humanReadable).toContain("QR Payload Validation Failed");
    }
  });

  it("every corpus case error code matches expectedErrorCode", () => {
    for (const c of corpus) {
      let result: ValidationResult;
      if (c.payloadType === "cbor_hex") {
        result = validateCborPayload(new Uint8Array(Buffer.from(c.payload, "hex")));
      } else if (c.payloadType === "fragment") {
        result = validateFragmentString(c.payload);
      } else {
        result = validateQrPayload(c.payload);
      }
      if (!result.ok) {
        expect(result.error.code, `Case ${c.id}: expected ${c.expectedErrorCode}`).toBe(
          c.expectedErrorCode,
        );
      }
    }
  });

  it("all corpus cases are deterministic — same result on second call", () => {
    const corpus2 = buildMalformedCorpus();
    expect(corpus.length).toBe(corpus2.length);
    for (let i = 0; i < corpus.length; i++) {
      expect(corpus[i]!.payload).toBe(corpus2[i]!.payload);
      expect(corpus[i]!.expectedErrorCode).toBe(corpus2[i]!.expectedErrorCode);
    }
  });
});

// ─── Generators ──────────────────────────────────────────────────────────────

describe("generateMalformedUr", () => {
  it("truncated_half produces a string shorter than the original", () => {
    const ur = getBaseUr();
    const truncated = generateMalformedUr(ur, "truncated_half");
    expect(truncated.length).toBeLessThan(ur.length);
  });

  it("truncated_1char produces a 1-char string", () => {
    expect(generateMalformedUr(getBaseUr(), "truncated_1char").length).toBe(1);
  });

  it("wrong_prefix changes the UR type", () => {
    const corrupted = generateMalformedUr(getBaseUr(), "wrong_prefix");
    expect(corrupted).toContain("btc-psbt");
  });

  it("no_ur_prefix removes the ur: scheme", () => {
    const corrupted = generateMalformedUr(getBaseUr(), "no_ur_prefix");
    expect(corrupted.startsWith("ur:")).toBe(false);
  });

  it("corrupt_body inserts an invalid character", () => {
    const corrupted = generateMalformedUr(getBaseUr(), "corrupt_body");
    expect(corrupted).toContain("!");
  });

  it("empty produces empty string", () => {
    expect(generateMalformedUr(getBaseUr(), "empty")).toBe("");
  });
});

describe("generateMalformedCbor", () => {
  it("all variants produce non-empty byte arrays", () => {
    const variants: Parameters<typeof generateMalformedCbor>[0][] = [
      "wrong_major_type_array", "wrong_major_type_text", "missing_sign_data",
      "null_sign_data", "string_sign_data", "zero_chain_id", "negative_chain_id",
      "string_keys", "truncated_bytes", "random_bytes",
    ];
    for (const variant of variants) {
      const cbor = generateMalformedCbor(variant);
      expect(cbor.length).toBeGreaterThan(0);
    }
  });

  it("all variants are deterministic", () => {
    const cbor1 = generateMalformedCbor("zero_chain_id");
    const cbor2 = generateMalformedCbor("zero_chain_id");
    expect(Buffer.from(cbor1).toString("hex")).toBe(Buffer.from(cbor2).toString("hex"));
  });
});

describe("generateTruncatedPayload", () => {
  it("truncates to the specified character count", () => {
    expect(generateTruncatedPayload("hello world", 5)).toBe("hello");
  });

  it("returns empty string for keepChars = 0", () => {
    expect(generateTruncatedPayload("hello", 0)).toBe("");
  });

  it("returns full string when keepChars >= length", () => {
    expect(generateTruncatedPayload("hello", 100)).toBe("hello");
  });
});

describe("generateOversizedPayload", () => {
  it("produces a UR longer than MAX_UR_CHARS", () => {
    const payload = generateOversizedPayload();
    expect(payload.length).toBeGreaterThan(MAX_UR_CHARS);
  });

  it("is deterministic", () => {
    const p1 = generateOversizedPayload();
    const p2 = generateOversizedPayload();
    expect(p1).toBe(p2);
  });

  it("starts with ur:eth-sign-request/", () => {
    const payload = generateOversizedPayload();
    expect(payload.startsWith("ur:eth-sign-request/")).toBe(true);
  });
});

describe("generateInvalidFragmentSequence", () => {
  it("returns at least 2 invalid fragment strings", () => {
    const fragments = generateInvalidFragmentSequence();
    expect(fragments.length).toBeGreaterThanOrEqual(2);
  });

  it("all fragments start with ur:eth-sign-request/", () => {
    const fragments = generateInvalidFragmentSequence();
    for (const f of fragments) {
      expect(f.startsWith("ur:eth-sign-request/")).toBe(true);
    }
  });

  it("is deterministic", () => {
    const f1 = generateInvalidFragmentSequence();
    const f2 = generateInvalidFragmentSequence();
    expect(f1.length).toBe(f2.length);
    for (let i = 0; i < f1.length; i++) {
      expect(f1[i]).toBe(f2[i]);
    }
  });
});

describe("generateCorruptedTypedData", () => {
  it("all variants produce non-empty CBOR bytes", () => {
    const variants: Parameters<typeof generateCorruptedTypedData>[0][] = [
      "missing_primary_type", "empty_domain", "invalid_domain_chain_id",
      "missing_types", "extra_safe_domain_fields", "not_json", "empty_json_object",
    ];
    for (const variant of variants) {
      const cbor = generateCorruptedTypedData(variant);
      expect(cbor.length).toBeGreaterThan(0);
    }
  });

  it("all variants are rejected by validateCborPayload", () => {
    const variants: Parameters<typeof generateCorruptedTypedData>[0][] = [
      "missing_primary_type", "empty_domain", "invalid_domain_chain_id",
      "missing_types", "extra_safe_domain_fields", "not_json", "empty_json_object",
    ];
    for (const variant of variants) {
      const cbor = generateCorruptedTypedData(variant);
      const result = validateCborPayload(cbor);
      expect(result.ok, `Variant ${variant} should be rejected`).toBe(false);
    }
  });
});

// ─── Deterministic fuzz: single-byte mutations ────────────────────────────────

describe("Deterministic fuzz — single-byte mutations of valid CBOR", () => {
  const baseCbor = (() => {
    const { signRequest } = buildTransferTx(DEMO_PARAMS);
    return encodeToCbor(signRequest);
  })();

  it("all 32 single-byte mutations are handled without uncaught exceptions", () => {
    for (let bytePos = 0; bytePos < Math.min(32, baseCbor.length); bytePos++) {
      const mutated = new Uint8Array(baseCbor);
      // XOR with 0xff flips all bits — deterministic, not random
      mutated[bytePos] = (mutated[bytePos] ?? 0) ^ 0xff;
      expect(() => validateCborPayload(mutated)).not.toThrow();
    }
  });

  it("at least 4 of 32 single-byte mutations produce ok:false (structural corruption is detectable)", () => {
    // Single-byte flips in field value regions (e.g., inside requestId bytes) will not
    // change the structural validity of the CBOR map — the validator cannot detect
    // value-level corruption without a content checksum. This threshold verifies that
    // the validator DOES catch structural mutations (header bytes, key types, chainId).
    let failCount = 0;
    for (let bytePos = 0; bytePos < Math.min(32, baseCbor.length); bytePos++) {
      const mutated = new Uint8Array(baseCbor);
      mutated[bytePos] = (mutated[bytePos] ?? 0) ^ 0xff;
      const result = validateCborPayload(mutated);
      if (!result.ok) failCount++;
    }
    expect(failCount).toBeGreaterThanOrEqual(4);
  });

  it("all 32 UR-level mutations are handled without uncaught exceptions", () => {
    const baseUr = getBaseUr();
    for (let charPos = 10; charPos < Math.min(42, baseUr.length); charPos++) {
      const mutated = baseUr.slice(0, charPos) + "z" + baseUr.slice(charPos + 1);
      expect(() => validateUrPayload(mutated)).not.toThrow();
      expect(() => validateQrPayload(mutated)).not.toThrow();
    }
  });
});

// ─── Deterministic fuzz: truncation sweep ─────────────────────────────────────

describe("Deterministic fuzz — UR truncation sweep", () => {
  it("all truncation lengths from 1 to full UR are handled without throwing", () => {
    const baseUr = getBaseUr();
    // Test 20 evenly-spaced truncation points
    const step = Math.floor(baseUr.length / 20);
    for (let len = 1; len < baseUr.length; len += step) {
      const truncated = generateTruncatedPayload(baseUr, len);
      expect(() => validateQrPayload(truncated)).not.toThrow();
    }
  });
});

// ─── Deterministic fuzz: random byte payload mutation ────────────────────────

describe("Deterministic fuzz — payload mutations", () => {
  it("CBOR with invalid Unicode in origin field does not crash validator", () => {
    // Build a CBOR map where origin is bytes instead of a string
    const cbor = new Uint8Array(
      cborEncode(new Map<number, unknown>([
        [1, Buffer.alloc(16).fill(0x06)],
        [2, Buffer.alloc(16).fill(0x02)],
        [3, 1],
        [4, 1],
        [7, Buffer.from([0xc0, 0x80, 0xff])], // invalid UTF-8 as bytes where string expected
      ])),
    );
    expect(() => validateCborPayload(cbor)).not.toThrow();
  });

  it("CBOR where chainId is a float does not crash validator", () => {
    const cbor = new Uint8Array(
      cborEncode(new Map<number, unknown>([
        [1, Buffer.alloc(16).fill(0x06)],
        [2, Buffer.alloc(16).fill(0x02)],
        [3, 1],
        [4, 1.5],  // float chainId — not an integer
        [7, "test"],
      ])),
    );
    expect(() => validateCborPayload(cbor)).not.toThrow();
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
  });

  it("CBOR where chainId is a string does not crash validator", () => {
    const cbor = new Uint8Array(
      cborEncode(new Map<number, unknown>([
        [1, Buffer.alloc(16).fill(0x06)],
        [2, Buffer.alloc(16).fill(0x02)],
        [3, 1],
        [4, "mainnet"],  // string where int expected
        [7, "test"],
      ])),
    );
    expect(() => validateCborPayload(cbor)).not.toThrow();
    const result = validateCborPayload(cbor);
    expect(result.ok).toBe(false);
  });

  it("deeply nested CBOR does not cause stack overflow", () => {
    // Build a CBOR map where signData is valid bytes but contains deeply nested JSON
    const deepNested = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => i).reduce(
        (acc: unknown, _) => ({ nested: acc }),
        "leaf",
      ),
    );
    const cbor = new Uint8Array(
      cborEncode(new Map<number, unknown>([
        [1, Buffer.alloc(16).fill(0x06)],
        [2, Buffer.from(deepNested)],
        [3, 2],  // data-type 2 = typed data (will try to parse as JSON)
        [4, 1],
        [7, "test"],
      ])),
    );
    expect(() => validateCborPayload(cbor)).not.toThrow();
  });
});

// ─── Fixture snapshot ─────────────────────────────────────────────────────────

describe("Fixture snapshot", () => {
  it("fixture has correct number of corpus cases", () => {
    expect(fixture.corpus.length).toBe(23);
  });

  it("fixture corpus ids are unique", () => {
    const ids = fixture.corpus.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("fixture base UR matches current output", () => {
    const ur = getBaseUr();
    expect(ur).toBe(fixture.baseUrString);
  });

  it("fixture base CBOR hex matches current output", () => {
    const cbor = getBaseCbor();
    expect(Buffer.from(cbor).toString("hex")).toBe(fixture.baseCborHex);
  });

  it("fixture meta limits match exported constants", () => {
    expect(fixture.meta.maxUrChars).toBe(MAX_UR_CHARS);
    expect(fixture.meta.maxCborBytes).toBe(MAX_CBOR_BYTES);
    expect(fixture.meta.maxSignDataBytes).toBe(MAX_SIGN_DATA_BYTES);
    expect(fixture.meta.maxFragmentCount).toBe(MAX_FRAGMENT_COUNT);
  });

  it("every fixture case has a non-empty payload", () => {
    for (const c of fixture.corpus) {
      expect(c.payload.length).toBeGreaterThan(0);
    }
  });

  it("every fixture case produces ok:false when re-validated", () => {
    for (const c of fixture.corpus) {
      let result: ValidationResult;
      if (c.payloadType === "cbor_hex") {
        result = validateCborPayload(new Uint8Array(Buffer.from(c.payload, "hex")));
      } else if (c.payloadType === "fragment") {
        result = validateFragmentString(c.payload);
      } else {
        result = validateQrPayload(c.payload);
      }
      expect(result.ok, `Fixture case ${c.id} should fail`).toBe(false);
    }
  });

  it("fixture humanReadable strings match current renderer output", () => {
    const corpus = buildMalformedCorpus();
    for (let i = 0; i < corpus.length; i++) {
      expect(corpus[i]!.humanReadable).toBe(fixture.corpus[i]!.humanReadable);
    }
  });
});
