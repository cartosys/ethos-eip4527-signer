/**
 * EIP-4527 Malformed QR Corpus Example
 *
 * Defensive parsing reference: intentionally generates malformed payloads
 * across the full QR signing pipeline and demonstrates safe, typed rejection.
 *
 * QR-based attack surfaces in wallet signing workflows:
 *   1. Truncated URs — scanner reads partial QR before the code is fully printed.
 *      A wallet that does not bounds-check may read garbage as valid signing data.
 *   2. CBOR structural corruption — a malicious QR code embeds a structurally valid
 *      CBOR sequence that encodes a map missing required fields, using wrong key types,
 *      or encoding signData as null. Without field-level validation the wallet signs
 *      an undefined or empty payload.
 *   3. Oversized payloads — feeding extremely large CBOR can exhaust memory or cause
 *      unbounded allocation in a fragment reconstruction loop.
 *   4. Fragment replay / index manipulation — an attacker replays fragments with
 *      impossible sequence numbers (e.g., "fragment 5 of 3") attempting to confuse
 *      the reconstruction state machine.
 *   5. Invalid UTF-8 in EIP-712 sign-data — for data-type:2 payloads, sign-data is
 *      expected to be UTF-8 JSON. Injecting invalid byte sequences can crash naive
 *      decoders that assume all bytes are valid UTF-8.
 *   6. Schema-valid but semantically wrong EIP-712 — correctly encoded JSON that
 *      omits primaryType or provides an empty domain can cause a wallet to compute
 *      a signature over a hash that does not match any on-chain typed data.
 *   7. Wrong UR type prefix — substituting the UR type string can route the payload
 *      to an unexpected decoder, potentially bypassing field validation.
 *
 * Defensive parsing principles applied here:
 *   - All validators return a Result type; they never throw to the caller.
 *   - All generators are pure and deterministic (no random, no Date.now).
 *   - Size limits are enforced before any parsing begins.
 *   - All error messages are sanitized (no untrusted data embedded in rendered output
 *     beyond a known-safe truncated excerpt).
 *   - Fragment count is capped to prevent infinite reconstruction loops.
 *   - CBOR decoding is wrapped in try/catch; structural flaws → typed error.
 *   - JSON parsing is wrapped in try/catch; invalid UTF-8 → typed error before parse.
 *
 * Full pipeline each case exercises:
 *   (malformed input) → validateQrPayload → classifyMalformedPayload → renderHumanReadableError
 */

import { fileURLToPath } from "node:url";
import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import { UR, UREncoder, URDecoder } from "@ngraveio/bc-ur";
import { z } from "zod";
import type { DgenError } from "../src/index";
import { buildTransferTx, encodeToCbor, encodeToUr, DEMO_PARAMS } from "./eth-transfer";

export { encodeToUr };

// ─── Safety limits ────────────────────────────────────────────────────────────

/**
 * Maximum characters in a single-part UR string.
 * The largest legitimate fixture (multisig) is ~1800 chars.
 * 4096 gives 2× headroom while preventing memory exhaustion from crafted payloads.
 */
export const MAX_UR_CHARS = 4096;

/**
 * Maximum bytes for a decoded CBOR payload.
 * Prevents unbounded allocation before parsing begins.
 */
export const MAX_CBOR_BYTES = 2048;

/**
 * Maximum bytes for the sign-data field inside a CBOR payload.
 * Limits content that is further parsed (UTF-8 decode, JSON parse, ABI decode).
 */
export const MAX_SIGN_DATA_BYTES = 1024;

/**
 * Maximum fragments in an animated (multi-part) UR sequence.
 * Prevents an infinite-loop attack via a crafted seqLen value.
 */
export const MAX_FRAGMENT_COUNT = 100;

// ─── EIP-4527 CBOR field keys ─────────────────────────────────────────────────

const EIP4527_KEY = {
  REQUEST_ID: 1,
  SIGN_DATA: 2,
  DATA_TYPE: 3,
  CHAIN_ID: 4,
  ORIGIN: 7,
} as const;

// ─── Typed error classes ──────────────────────────────────────────────────────

/**
 * Thrown when a UR string fails to parse or has a wrong type prefix.
 * Attackers can exploit lax UR parsing to route payloads to unintended decoders.
 */
export class MalformedUrError extends Error {
  readonly code: string;
  readonly recoverable = false as const;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MalformedUrError";
    this.code = code;
  }
}

/**
 * Thrown when CBOR bytes are not a valid CBOR map or are missing required fields.
 * CBOR is a binary format; bit-flip attacks produce structurally valid but semantically
 * wrong CBOR that naive decoders may partially accept.
 */
export class InvalidCborError extends Error {
  readonly code: string;
  readonly recoverable = false as const;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidCborError";
    this.code = code;
  }
}

/**
 * Thrown when a multi-part UR fragment has an impossible or inconsistent sequence number.
 * Fragment index manipulation (e.g., seq 5 of 3) can confuse state machines that do not
 * bounds-check the seqNum against seqLen.
 */
export class InvalidFragmentError extends Error {
  readonly code: string;
  readonly recoverable = false as const;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidFragmentError";
    this.code = code;
  }
}

/**
 * Thrown when a payload exceeds the defined size limits.
 * Oversized payloads are a denial-of-service vector: a wallet allocating an unbounded
 * buffer for fragment reconstruction can be crashed by a crafted animated QR.
 */
export class OversizedPayloadError extends Error {
  readonly code: string;
  readonly recoverable = false as const;
  readonly actualBytes: number;
  readonly limitBytes: number;
  constructor(code: string, message: string, actualBytes: number, limitBytes: number) {
    super(message);
    this.name = "OversizedPayloadError";
    this.code = code;
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Thrown when sign-data (data-type:2) contains invalid UTF-8, invalid JSON,
 * or a JSON structure that does not match the EIP-712 schema.
 * A wallet that skips typed-data validation and signs the raw bytes may sign
 * a hash that the user cannot inspect.
 */
export class InvalidTypedDataError extends Error {
  readonly code: string;
  readonly recoverable = false as const;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidTypedDataError";
    this.code = code;
  }
}

/**
 * General-purpose validation error for cases not covered by the above.
 */
export class ValidationError extends Error {
  readonly code: string;
  readonly recoverable = false as const;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

/** Classification of each malformed payload category. */
export type MalformedKind =
  | "truncated_ur"
  | "malformed_cbor"
  | "invalid_ur_prefix"
  | "corrupted_fragment_ordering"
  | "duplicate_fragments"
  | "invalid_checksum"
  | "oversized_payload"
  | "invalid_utf8"
  | "malformed_transaction"
  | "invalid_chain_id"
  | "malformed_calldata"
  | "malformed_eip712"
  | "malformed_qr_chunk_metadata";

/** A classified validation failure, safe to display and log. */
export interface ClassifiedError {
  readonly kind: MalformedKind;
  readonly code: string;
  readonly message: string;
  readonly recoverable: false;
  readonly originalError: unknown;
}

/** Discriminated result type — validators return, never throw. */
export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ClassifiedError };

/**
 * A single entry in the malformed corpus.
 * payloadType distinguishes strings (UR, fragment) from binary (cbor_hex).
 */
export interface MalformedCase {
  readonly id: string;
  readonly kind: MalformedKind;
  readonly description: string;
  /** UR string, fragment string, or hex-encoded CBOR bytes depending on payloadType. */
  readonly payload: string;
  readonly payloadType: "ur" | "cbor_hex" | "fragment";
  readonly expectedErrorCode: string;
  readonly humanReadable: string;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

/**
 * Minimal EIP-712 typed data schema.
 * Validates structural presence, not semantic correctness.
 * Semantic checks (correct primaryType fields, non-empty types) are layered on top.
 */
/**
 * Strict EIP-712 domain schema.
 * `.strict()` rejects any extra fields beyond the four recognized domain fields.
 * This catches Safe-specific corruption where "name" or "version" are added to
 * a domain that must be exactly { chainId, verifyingContract } — extra fields
 * change the domain separator and break on-chain signature verification.
 */
const Eip712DomainSchema = z.object({
  chainId: z.number().int().min(1).optional(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  name: z.string().optional(),
  version: z.string().optional(),
}).strict().refine(
  (d) => d.chainId !== undefined || d.verifyingContract !== undefined,
  { message: "EIP-712 domain must contain at least chainId or verifyingContract" },
);

const Eip712TypedDataSchema = z.object({
  domain: Eip712DomainSchema,
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  message: z.record(z.string(), z.unknown()),
  primaryType: z.string().min(1, "primaryType must not be empty"),
});

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generate a deterministically corrupted UR string from a valid base.
 *
 * @param baseUr A valid UR string (used as the starting point for corruption).
 * @param variant Specifies which corruption to apply.
 *
 * Variants:
 *   "truncated_half"    — drop the second half; triggers UR parse failure
 *   "truncated_1char"   — keep only the first character; guaranteed parse failure
 *   "wrong_prefix"      — replace "eth-sign-request" with "btc-psbt"
 *   "no_ur_prefix"      — strip "ur:" entirely; plain text that is not a UR
 *   "corrupt_body"      — replace a character in the bytewords body with '!'
 *                         (invalid bytewords character → parse error)
 *   "corrupt_checksum"  — flip the last 4 characters to 'aaaa'
 *                         (checksum mismatch → URDecoder rejects)
 *   "empty"             — empty string
 */
export type MalformedUrVariant =
  | "truncated_half"
  | "truncated_1char"
  | "wrong_prefix"
  | "no_ur_prefix"
  | "corrupt_body"
  | "corrupt_checksum"
  | "empty";

export function generateMalformedUr(baseUr: string, variant: MalformedUrVariant): string {
  // Find where the bytewords body starts (after the type prefix and slash)
  const prefixEnd = baseUr.indexOf("/") + 1;

  switch (variant) {
    case "truncated_half":
      return baseUr.slice(0, Math.floor(baseUr.length / 2));
    case "truncated_1char":
      return baseUr.slice(0, 1);
    case "wrong_prefix":
      return baseUr.replace("ur:eth-sign-request/", "ur:btc-psbt/");
    case "no_ur_prefix":
      // Strip "ur:" so it looks like a plain string, not a UR
      return baseUr.replace("ur:", "");
    case "corrupt_body": {
      // Replace the 10th character of the bytewords body with '!'
      // '!' is not in the bytewords alphabet → deterministic parse failure
      const pos = prefixEnd + 10;
      if (pos >= baseUr.length) return baseUr.slice(0, prefixEnd) + "!";
      return baseUr.slice(0, pos) + "!" + baseUr.slice(pos + 1);
    }
    case "corrupt_checksum": {
      // Bytewords: last 8 chars of the body = 4 checksum words (4 bytes CRC32).
      // Replacing them breaks the checksum while leaving the type prefix intact.
      if (baseUr.length < prefixEnd + 8) return baseUr + "aaaa";
      return baseUr.slice(0, baseUr.length - 8) + "yyyyyyyy";
    }
    case "empty":
      return "";
  }
}

/**
 * Malformed CBOR variants — each produces CBOR bytes that are structurally wrong
 * for the EIP-4527 eth-sign-request format.
 *
 * CBOR corruption risks:
 *   - A CBOR array decodes successfully as CBOR but is not a map → field access fails.
 *   - A map with string keys (e.g., "2") is valid CBOR but not EIP-4527 (integer keys required).
 *   - A null signData is valid CBOR but causes a null-dereference when the wallet tries
 *     to hash the signing payload.
 *   - Zero chainId (0) is valid CBOR but is not a valid Ethereum chain.
 */
export type MalformedCborVariant =
  | "wrong_major_type_array"
  | "wrong_major_type_text"
  | "missing_sign_data"
  | "null_sign_data"
  | "string_sign_data"
  | "zero_chain_id"
  | "negative_chain_id"
  | "string_keys"
  | "truncated_bytes"
  | "random_bytes";

const FIXED_REQUEST_ID = new Uint8Array([
  0x06, 0xba, 0xdc, 0x0f, 0xfe, 0xed, 0xfa, 0xce,
  0x06, 0xba, 0xdc, 0x0f, 0xfe, 0xed, 0xfa, 0xce,
]);

const FIXED_SIGN_DATA = new Uint8Array([
  0x02, 0xf8, 0x6c, 0x05, 0x85, 0x06, 0xfc, 0x23,
  0xac, 0x00, 0x83, 0x01, 0x86, 0xa0, 0x94, 0xd8,
]);

export function generateMalformedCbor(variant: MalformedCborVariant): Uint8Array {
  const reqId = Buffer.from(FIXED_REQUEST_ID);
  const signData = Buffer.from(FIXED_SIGN_DATA);

  switch (variant) {
    case "wrong_major_type_array":
      // Encodes as a CBOR array — no map keys, no field access possible
      return new Uint8Array(cborEncode([1, signData, 1, 1, "ethos-eip4527-signer"]));

    case "wrong_major_type_text":
      // Encodes as a CBOR text string — not a map at all
      return new Uint8Array(cborEncode("not-a-map"));

    case "missing_sign_data":
      // Map with requestId, dataType, chainId, origin — but no signData (key 2)
      return new Uint8Array(
        cborEncode(new Map<number, unknown>([
          [EIP4527_KEY.REQUEST_ID, reqId],
          // key 2 intentionally omitted
          [EIP4527_KEY.DATA_TYPE, 1],
          [EIP4527_KEY.CHAIN_ID, 1],
          [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
        ])),
      );

    case "null_sign_data":
      // signData present but null — causes null-dereference when the wallet hashes it
      return new Uint8Array(
        cborEncode(new Map<number, unknown>([
          [EIP4527_KEY.REQUEST_ID, reqId],
          [EIP4527_KEY.SIGN_DATA, null],
          [EIP4527_KEY.DATA_TYPE, 1],
          [EIP4527_KEY.CHAIN_ID, 1],
          [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
        ])),
      );

    case "string_sign_data":
      // signData is a text string, not bytes — type assertion fails
      return new Uint8Array(
        cborEncode(new Map<number, unknown>([
          [EIP4527_KEY.REQUEST_ID, reqId],
          [EIP4527_KEY.SIGN_DATA, "this is not bytes"],
          [EIP4527_KEY.DATA_TYPE, 1],
          [EIP4527_KEY.CHAIN_ID, 1],
          [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
        ])),
      );

    case "zero_chain_id":
      // chainId=0 is not a valid Ethereum network — signing with chainId=0 produces
      // a transaction that will not be accepted by any mainnet or testnet node
      return new Uint8Array(
        cborEncode(new Map<number, unknown>([
          [EIP4527_KEY.REQUEST_ID, reqId],
          [EIP4527_KEY.SIGN_DATA, signData],
          [EIP4527_KEY.DATA_TYPE, 1],
          [EIP4527_KEY.CHAIN_ID, 0],
          [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
        ])),
      );

    case "negative_chain_id":
      // Negative chainId is nonsensical — chainId is uint in the Ethereum spec
      return new Uint8Array(
        cborEncode(new Map<number, unknown>([
          [EIP4527_KEY.REQUEST_ID, reqId],
          [EIP4527_KEY.SIGN_DATA, signData],
          [EIP4527_KEY.DATA_TYPE, 1],
          [EIP4527_KEY.CHAIN_ID, -1],
          [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
        ])),
      );

    case "string_keys":
      // Uses descriptive string keys instead of the required integer keys.
      // EIP-4527 CDDL specifies integer keys (1=requestId, 2=signData, etc.).
      // A decoder looking for integer key 1 will not find "request-id" — the
      // payload appears to have no required fields even though data is present.
      return new Uint8Array(
        cborEncode({
          "request-id": reqId,
          "sign-data": signData,
          "data-type": 1,
          "chain-id": 1,
          "origin": "ethos-eip4527-signer",
        }),
      );

    case "truncated_bytes": {
      // Take a valid CBOR encoding and cut it in half — results in a broken CBOR stream
      const valid = cborEncode(new Map<number, unknown>([
        [EIP4527_KEY.REQUEST_ID, reqId],
        [EIP4527_KEY.SIGN_DATA, signData],
        [EIP4527_KEY.DATA_TYPE, 1],
        [EIP4527_KEY.CHAIN_ID, 1],
        [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
      ]));
      return new Uint8Array(Buffer.from(valid).slice(0, Math.floor(valid.length / 2)));
    }

    case "random_bytes":
      // Not CBOR at all — deterministic "random" bytes that fail any CBOR parse
      return new Uint8Array([
        0xff, 0xfe, 0x00, 0x01, 0xde, 0xad, 0xbe, 0xef,
        0xca, 0xfe, 0xba, 0xbe, 0x13, 0x37, 0xc0, 0xde,
      ]);
  }
}

/**
 * Truncate a payload string to exactly `keepChars` characters.
 * Used to simulate partial QR scanner reads.
 */
export function generateTruncatedPayload(input: string, keepChars: number): string {
  return input.slice(0, Math.max(0, keepChars));
}

/**
 * Generate a UR string that exceeds MAX_UR_CHARS by embedding a large signData payload.
 *
 * DoS risk: wallets that allocate a buffer sized to the claimed payload length
 * before validating it can be crashed via this vector.
 * Defensive fix: check `payload.length > MAX_UR_CHARS` before calling URDecoder.
 */
export function generateOversizedPayload(): string {
  // 2200 bytes of signData → CBOR ≈ 2230 bytes → UR ≈ 4500+ chars (> MAX_UR_CHARS=4096)
  const oversizedSignData = Buffer.alloc(2200).fill(0xab);
  const oversizedCbor = cborEncode(new Map<number, unknown>([
    [EIP4527_KEY.REQUEST_ID, Buffer.from(FIXED_REQUEST_ID)],
    [EIP4527_KEY.SIGN_DATA, oversizedSignData],
    [EIP4527_KEY.DATA_TYPE, 1],
    [EIP4527_KEY.CHAIN_ID, 1],
    [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
  ]));
  const ur = new UR(Buffer.from(oversizedCbor), "eth-sign-request");
  return UREncoder.encodeSinglePart(ur);
}

/**
 * Generate fragment strings with malformed sequence metadata.
 *
 * Fragment reconstruction risks:
 *   - seqNum > seqLen (impossible: "fragment 5 of 3") — state machines that trust
 *     this value without bounds-checking will read out-of-bounds indices.
 *   - seqNum = 0 (invalid: fountain codes are 1-indexed) — off-by-one errors in
 *     decoders that assume 0-based indexing.
 *   - Mismatched seqLen across fragments — causes reconstruction to never complete.
 *
 * Note: these strings cannot be parsed by URDecoder.decode() (single-part only).
 * Use URDecoder.receivePart() for multi-part; these test its rejection behavior.
 */
export function generateInvalidFragmentSequence(): readonly string[] {
  // Build a real multi-part UR to get valid fragment structure, then corrupt indices
  const cbor = new Uint8Array(generateMalformedCbor("string_sign_data"));
  const ur = new UR(Buffer.from(cbor), "eth-sign-request");
  const encoder = new UREncoder(ur, 40); // small fragment size → multiple parts
  const validFragments = encoder.encodeWhole();

  // Fragment with seqNum > seqLen (impossible index)
  const firstValid = validFragments[0] ?? "ur:eth-sign-request/1-1/taadax";
  // Replace "1-N" sequence component with "5-3" (fragment 5 of only 3)
  const impossibleIndex = firstValid.replace(
    /ur:eth-sign-request\/\d+-\d+\//,
    "ur:eth-sign-request/5-3/",
  );

  // Fragment with seqNum = 0 (invalid for 1-indexed fountain codes)
  const zeroIndex = firstValid.replace(
    /ur:eth-sign-request\/\d+-\d+\//,
    "ur:eth-sign-request/0-3/",
  );

  // Duplicate of fragment 1 delivered three times — simulates stuck QR scanner
  const duplicate1 = validFragments[0] ?? firstValid;

  return [impossibleIndex, zeroIndex, duplicate1, duplicate1, duplicate1];
}

/**
 * Generate CBOR where signData is EIP-712 JSON with specific structural flaws.
 *
 * EIP-712 signing risks:
 *   - Missing primaryType: the wallet hashes a struct it cannot identify.
 *   - Empty domain: no chainId and no verifyingContract → hash is the same on
 *     every chain and every contract address → trivial replay attacks.
 *   - Extra domain fields for Safe: Safe's domain must NOT include "name" or
 *     "version". A payload that adds these changes the domain separator, causing
 *     the signer's hash to differ from what the Safe contract verifies on-chain.
 *   - Wrong types array: mismatched types produce a different type hash, making
 *     the recovered signature fail on-chain even if the wallet accepts it.
 */
export type CorruptedTypedDataVariant =
  | "missing_primary_type"
  | "empty_domain"
  | "invalid_domain_chain_id"
  | "missing_types"
  | "extra_safe_domain_fields"
  | "not_json"
  | "empty_json_object";

export function generateCorruptedTypedData(variant: CorruptedTypedDataVariant): Uint8Array {
  const buildCbor = (signDataBytes: Buffer): Uint8Array =>
    new Uint8Array(
      cborEncode(new Map<number, unknown>([
        [EIP4527_KEY.REQUEST_ID, Buffer.from(FIXED_REQUEST_ID)],
        [EIP4527_KEY.SIGN_DATA, signDataBytes],
        [EIP4527_KEY.DATA_TYPE, 2], // data-type 2 = EIP-712 typed data
        [EIP4527_KEY.CHAIN_ID, 1],
        [EIP4527_KEY.ORIGIN, "ethos-eip4527-signer"],
      ])),
    );

  const baseTypedData = {
    domain: { chainId: 1, verifyingContract: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" },
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "nonce", type: "uint256" },
      ],
    },
    message: { to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", value: "0", nonce: 1 },
    primaryType: "SafeTx",
  };

  switch (variant) {
    case "missing_primary_type": {
      const { primaryType: _drop, ...withoutPrimaryType } = baseTypedData;
      void _drop;
      return buildCbor(Buffer.from(JSON.stringify(withoutPrimaryType)));
    }

    case "empty_domain":
      // No chainId, no verifyingContract → hash is identical across all chains/contracts
      return buildCbor(
        Buffer.from(JSON.stringify({ ...baseTypedData, domain: {} })),
      );

    case "invalid_domain_chain_id":
      // chainId=0 in domain — not a valid Ethereum chain
      return buildCbor(
        Buffer.from(JSON.stringify({ ...baseTypedData, domain: { chainId: 0 } })),
      );

    case "missing_types":
      // No types array → the struct hash cannot be computed
      return buildCbor(
        Buffer.from(JSON.stringify({ ...baseTypedData, types: {} })),
      );

    case "extra_safe_domain_fields":
      // Safe's domain must be exactly { chainId, verifyingContract }.
      // Adding "name" and "version" changes the domain separator, making the
      // wallet's computed hash differ from what execTransaction verifies on-chain.
      return buildCbor(
        Buffer.from(
          JSON.stringify({
            ...baseTypedData,
            domain: {
              ...baseTypedData.domain,
              name: "Safe",       // WRONG: Safe domain has no name
              version: "1.4.1",  // WRONG: Safe domain has no version
            },
          }),
        ),
      );

    case "not_json":
      // Invalid UTF-8 bytes (not even parseable text, let alone JSON)
      // 0xC0 0x80 are "overlong" UTF-8 sequences rejected by strict UTF-8 decoders
      return buildCbor(Buffer.from([0xc0, 0x80, 0xff, 0xfe, 0x00, 0x01]));

    case "empty_json_object":
      return buildCbor(Buffer.from("{}"));
  }
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Top-level QR payload validator.
 *
 * Entry point for wallet implementations: takes any input (string from QR scanner)
 * and returns a typed Result. Never throws — all errors are caught and classified.
 *
 * Validation sequence (stops at first failure):
 *   1. Input must be a non-empty string
 *   2. Length must be <= MAX_UR_CHARS (DoS guard before any parsing)
 *   3. Must start with "ur:" prefix
 *   4. UR type must be "eth-sign-request"
 *   5. CBOR bytes must not exceed MAX_CBOR_BYTES
 *   6. CBOR must decode to a map with required fields
 *   7. If data-type === 2: sign-data must be valid EIP-712 typed data
 */
export function validateQrPayload(input: unknown): ValidationResult {
  try {
    if (typeof input !== "string") {
      throw new ValidationError("INPUT_NOT_STRING", "QR payload must be a string");
    }
    if (input.length === 0) {
      throw new ValidationError("INPUT_EMPTY", "QR payload is empty");
    }
    // Check length BEFORE calling URDecoder — URDecoder may allocate based on payload size
    if (input.length > MAX_UR_CHARS) {
      throw new OversizedPayloadError(
        "UR_TOO_LONG",
        `UR string length ${input.length} exceeds limit of ${MAX_UR_CHARS} characters`,
        input.length,
        MAX_UR_CHARS,
      );
    }
    return validateUrPayload(input);
  } catch (e: unknown) {
    return { ok: false, error: classifyMalformedPayload(e) };
  }
}

/**
 * Validate a UR string: prefix, type, CBOR structure, and field types.
 *
 * Throws typed errors (never returns an error object directly) so classifyMalformedPayload
 * can inspect the thrown error class and determine the kind.
 */
export function validateUrPayload(urString: string): ValidationResult {
  try {
    if (!urString.startsWith("ur:")) {
      throw new MalformedUrError(
        "UR_NOT_UR_FORMAT",
        `Input does not start with "ur:": ${sanitizeExcerpt(urString)}`,
      );
    }

    let ur: UR;
    try {
      ur = URDecoder.decode(urString);
    } catch {
      throw new MalformedUrError(
        "UR_PARSE_FAILED",
        `UR string failed to parse: ${sanitizeExcerpt(urString)}`,
      );
    }

    if (ur.type !== "eth-sign-request") {
      throw new MalformedUrError(
        "UR_WRONG_TYPE",
        `Expected UR type "eth-sign-request", got "${sanitizeExcerpt(ur.type)}"`,
      );
    }

    // Check CBOR size before decoding to prevent large allocations
    if (ur.cbor.length > MAX_CBOR_BYTES) {
      throw new OversizedPayloadError(
        "CBOR_TOO_LARGE",
        `CBOR payload ${ur.cbor.length} bytes exceeds limit of ${MAX_CBOR_BYTES} bytes`,
        ur.cbor.length,
        MAX_CBOR_BYTES,
      );
    }

    return validateCborPayload(new Uint8Array(ur.cbor));
  } catch (e: unknown) {
    return { ok: false, error: classifyMalformedPayload(e) };
  }
}

/**
 * Validate CBOR bytes as an EIP-4527 eth-sign-request map.
 *
 * CBOR structural validation:
 *   - Must decode without error (catches truncated/corrupt bytes)
 *   - Must be a map or object (not an array, number, string, etc.)
 *   - Must have requestId (key 1) as bytes
 *   - Must have signData (key 2) as bytes within MAX_SIGN_DATA_BYTES
 *   - Must have chainId (key 4) as integer >= 1
 */
export function validateCborPayload(cbor: Uint8Array): ValidationResult {
  try {
    let decoded: unknown;
    try {
      decoded = cborDecode(cbor);
    } catch {
      throw new InvalidCborError("CBOR_DECODE_FAILED", "CBOR bytes failed to decode");
    }

    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new InvalidCborError(
        "CBOR_NOT_A_MAP",
        `CBOR decoded to ${Array.isArray(decoded) ? "an array" : typeof decoded}, expected a map`,
      );
    }

    const requestId = getMapField(decoded, EIP4527_KEY.REQUEST_ID);
    const signData = getMapField(decoded, EIP4527_KEY.SIGN_DATA);
    const dataType = getMapField(decoded, EIP4527_KEY.DATA_TYPE);
    const chainId = getMapField(decoded, EIP4527_KEY.CHAIN_ID);

    if (!(requestId instanceof Uint8Array)) {
      throw new InvalidCborError(
        "CBOR_MISSING_REQUEST_ID",
        "CBOR map is missing required field requestId (key 1) or it is not bytes",
      );
    }

    if (!(signData instanceof Uint8Array)) {
      throw new InvalidCborError(
        "CBOR_MISSING_SIGN_DATA",
        "CBOR map is missing required field signData (key 2) or it is not bytes",
      );
    }

    if (signData.length > MAX_SIGN_DATA_BYTES) {
      throw new OversizedPayloadError(
        "SIGN_DATA_TOO_LARGE",
        `signData is ${signData.length} bytes, exceeds limit of ${MAX_SIGN_DATA_BYTES} bytes`,
        signData.length,
        MAX_SIGN_DATA_BYTES,
      );
    }

    if (typeof chainId !== "number" || !Number.isInteger(chainId) || chainId < 1) {
      throw new InvalidCborError(
        "CBOR_INVALID_CHAIN_ID",
        `chainId must be a positive integer, got: ${JSON.stringify(chainId)}`,
      );
    }

    // For data-type:2 (EIP-712 typed data), sign-data must be valid typed data JSON
    if (dataType === 2) {
      const typedDataResult = validateTypedData(signData);
      if (!typedDataResult.ok) return typedDataResult;
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: classifyMalformedPayload(e) };
  }
}

/**
 * Validate EIP-712 typed data bytes (sign-data from a data-type:2 payload).
 *
 * Sequence:
 *   1. Decode bytes as UTF-8 (catches invalid byte sequences)
 *   2. Parse as JSON (catches structural encoding errors)
 *   3. Validate against Eip712TypedDataSchema (catches missing fields)
 *   4. Verify primaryType exists in types (catches type hash mismatches)
 */
export function validateTypedData(signData: Uint8Array): ValidationResult {
  try {
    let jsonStr: string;
    try {
      // TextDecoder with fatal:true throws on invalid UTF-8 byte sequences
      jsonStr = new TextDecoder("utf-8", { fatal: true }).decode(signData);
    } catch {
      throw new InvalidTypedDataError(
        "TYPED_DATA_INVALID_UTF8",
        "signData bytes are not valid UTF-8 — cannot decode as EIP-712 JSON",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new InvalidTypedDataError(
        "TYPED_DATA_INVALID_JSON",
        "signData is valid UTF-8 but is not valid JSON",
      );
    }

    const result = Eip712TypedDataSchema.safeParse(parsed);
    if (!result.success) {
      throw new InvalidTypedDataError(
        "TYPED_DATA_SCHEMA_INVALID",
        `EIP-712 schema validation failed: ${result.error.issues[0]?.message ?? "unknown"}`,
      );
    }

    const { domain, types, primaryType } = result.data;
    if (!(primaryType in types)) {
      throw new InvalidTypedDataError(
        "TYPED_DATA_PRIMARY_TYPE_MISSING",
        `primaryType "${primaryType}" is not defined in types — struct hash cannot be computed`,
      );
    }

    // Safe-specific domain check: Safe's EIP-712 domain must be exactly
    // { chainId, verifyingContract } — no name, no version.
    // Adding name or version changes the domain separator, making the wallet's
    // computed hash differ from what execTransaction verifies on-chain.
    if (primaryType === "SafeTx" && (domain.name !== undefined || domain.version !== undefined)) {
      throw new InvalidTypedDataError(
        "TYPED_DATA_SAFE_DOMAIN_EXTRA_FIELDS",
        `Safe domain must not include "name" or "version" — these fields change the domain separator`,
      );
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: classifyMalformedPayload(e) };
  }
}

/**
 * Validate a multi-part UR fragment string.
 *
 * Checks that the sequence component (seqNum/seqLen) is internally consistent
 * before feeding the fragment to URDecoder.receivePart(). This prevents state
 * machine confusion from impossible indices.
 *
 * Fragment index manipulation risk:
 *   A fragment claiming to be "5 of 3" with seqNum=5 and seqLen=3 would cause a
 *   decoder that allocates a fragment buffer of size seqLen to write to index 4,
 *   which is out-of-bounds.
 */
export function validateFragmentString(fragment: string): ValidationResult {
  try {
    if (!fragment.startsWith("ur:")) {
      throw new InvalidFragmentError("FRAGMENT_NOT_UR", "Fragment is not a UR string");
    }

    // Multi-part UR format: ur:<type>/<seqNum>-<seqLen>/<bytewords>
    const seqMatch = /ur:[^/]+\/(\d+)-(\d+)\//.exec(fragment);
    if (seqMatch === null) {
      // Single-part UR — no sequence component
      return validateUrPayload(fragment);
    }

    const seqNum = parseInt(seqMatch[1] ?? "0", 10);
    const seqLen = parseInt(seqMatch[2] ?? "0", 10);

    if (seqLen === 0) {
      throw new InvalidFragmentError(
        "FRAGMENT_ZERO_SEQ_LEN",
        "Fragment seqLen is 0 — no valid UR can have zero fragments",
      );
    }

    if (seqLen > MAX_FRAGMENT_COUNT) {
      throw new OversizedPayloadError(
        "FRAGMENT_COUNT_EXCEEDED",
        `Fragment seqLen ${seqLen} exceeds maximum of ${MAX_FRAGMENT_COUNT}`,
        seqLen,
        MAX_FRAGMENT_COUNT,
      );
    }

    // seqNum=0 is always invalid (fountain codes are 1-indexed).
    if (seqNum === 0) {
      throw new InvalidFragmentError(
        "FRAGMENT_ZERO_SEQ_NUM",
        "Fragment seqNum is 0 — fountain codes are 1-indexed",
      );
    }

    // seqNum > seqLen is impossible for deterministic (non-rateless) multi-part URs.
    // Rateless fountain codes can legitimately exceed seqLen for redundancy, but
    // a wallet operating in strict mode should reject implausible indices to prevent
    // state-machine confusion from crafted fragments.
    if (seqNum > seqLen) {
      throw new InvalidFragmentError(
        "FRAGMENT_INDEX_OUT_OF_RANGE",
        `Fragment seqNum ${seqNum} exceeds seqLen ${seqLen} — implausible fragment index`,
      );
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: classifyMalformedPayload(e) };
  }
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Map any caught error to a typed ClassifiedError.
 *
 * Handles:
 *   1. Our own typed error classes (exact kind mapping)
 *   2. Generic Error instances from bc-ur / cbor-x / TextDecoder
 *   3. Non-Error throws (strings, nulls, etc.) — mapped to "malformed_cbor"
 *
 * Sanitization: error messages from third-party libraries may contain untrusted
 * path fragments or byte sequences. We include them only after truncation.
 */
export function classifyMalformedPayload(error: unknown): ClassifiedError {
  if (error instanceof MalformedUrError) {
    const kind: MalformedKind = urCodeToKind(error.code);
    return { kind, code: error.code, message: error.message, recoverable: false, originalError: error };
  }

  if (error instanceof InvalidCborError) {
    const kind: MalformedKind =
      error.code === "CBOR_INVALID_CHAIN_ID" ? "invalid_chain_id" : "malformed_cbor";
    return { kind, code: error.code, message: error.message, recoverable: false, originalError: error };
  }

  if (error instanceof InvalidFragmentError) {
    const kind: MalformedKind =
      error.code === "FRAGMENT_INDEX_OUT_OF_RANGE"
        ? "corrupted_fragment_ordering"
        : "malformed_qr_chunk_metadata";
    return { kind, code: error.code, message: error.message, recoverable: false, originalError: error };
  }

  if (error instanceof OversizedPayloadError) {
    return {
      kind: "oversized_payload",
      code: error.code,
      message: error.message,
      recoverable: false,
      originalError: error,
    };
  }

  if (error instanceof InvalidTypedDataError) {
    const kind: MalformedKind =
      error.code === "TYPED_DATA_INVALID_UTF8" ? "invalid_utf8" : "malformed_eip712";
    return { kind, code: error.code, message: error.message, recoverable: false, originalError: error };
  }

  if (error instanceof ValidationError) {
    return {
      kind: "malformed_cbor",
      code: error.code,
      message: error.message,
      recoverable: false,
      originalError: error,
    };
  }

  if (error instanceof Error) {
    // Third-party library errors (bc-ur, cbor-x) — infer kind from message
    const msg = error.message.toLowerCase();
    if (msg.includes("cbor") || msg.includes("decode")) {
      return { kind: "malformed_cbor", code: "CBOR_LIBRARY_ERROR", message: sanitizeExcerpt(error.message), recoverable: false, originalError: error };
    }
    if (msg.includes("ur") || msg.includes("checksum") || msg.includes("byteword")) {
      return { kind: "invalid_checksum", code: "UR_LIBRARY_ERROR", message: sanitizeExcerpt(error.message), recoverable: false, originalError: error };
    }
    return {
      kind: "malformed_cbor",
      code: "UNKNOWN_PARSE_ERROR",
      message: sanitizeExcerpt(error.message),
      recoverable: false,
      originalError: error,
    };
  }

  return {
    kind: "malformed_cbor",
    code: "NON_ERROR_THROW",
    message: "An unknown non-Error value was thrown during validation",
    recoverable: false,
    originalError: error,
  };
}

// ─── Renderer ────────────────────────────────────────────────────────────────

/**
 * Render a classified error as a human-readable rejection notice.
 *
 * Sanitization requirements:
 *   - No untrusted bytes from the payload appear in the output.
 *   - Error messages from the classifier are safe (derived from our typed errors).
 *   - The "Reason" field includes only the sanitized classifier message.
 */
export function renderHumanReadableError(classified: ClassifiedError): string {
  const title = kindToTitle(classified.kind);
  const notice = kindToSecurityNotice(classified.kind);
  const action = kindToRecommendedAction(classified.kind);

  return [
    "─── QR Payload Validation Failed ─────────────────",
    `  Error Type:            ${title}`,
    `  Error Code:            ${classified.code}`,
    `  Reason:                ${classified.message}`,
    "  ─── Security Notice ────────────────────────────",
    `  ${notice}`,
    "  ─── Recommended Action ─────────────────────────",
    `  ${action}`,
    "─────────────────────────────────────────────────",
  ].join("\n");
}

// ─── Corpus builder ───────────────────────────────────────────────────────────

/**
 * Build the complete malformed QR corpus.
 *
 * All cases are deterministic — no randomness, no I/O. Safe to call in tests
 * and as a fixture generator.
 */
export function buildMalformedCorpus(): readonly MalformedCase[] {
  // Build a real, valid base payload to corrupt
  const { signRequest } = buildTransferTx(DEMO_PARAMS);
  const baseCbor = encodeToCbor(signRequest);
  const baseUr = encodeToUr(baseCbor);

  const makeCase = (
    id: string,
    kind: MalformedKind,
    description: string,
    payload: string,
    payloadType: MalformedCase["payloadType"],
    expectedErrorCode: string,
  ): MalformedCase => {
    const result =
      payloadType === "cbor_hex"
        ? validateCborPayload(new Uint8Array(Buffer.from(payload, "hex")))
        : payloadType === "fragment"
        ? validateFragmentString(payload)
        : validateQrPayload(payload);

    const humanReadable = result.ok
      ? "─── Validation passed (unexpected) ───────────────\n─────────────────────────────────────────────────"
      : renderHumanReadableError(result.error);

    return { id, kind, description, payload, payloadType, expectedErrorCode, humanReadable };
  };

  const fragments = generateInvalidFragmentSequence();

  return [
    makeCase(
      "truncated_ur_half",
      "truncated_ur",
      "Valid UR truncated to 50% of its length — simulates a partial QR scan",
      generateMalformedUr(baseUr, "truncated_half"),
      "ur",
      "UR_PARSE_FAILED",
    ),
    makeCase(
      "truncated_ur_1char",
      "truncated_ur",
      "UR truncated to a single character — no recoverable data remains",
      generateMalformedUr(baseUr, "truncated_1char"),
      "ur",
      "UR_NOT_UR_FORMAT",
    ),
    makeCase(
      "wrong_ur_prefix",
      "invalid_ur_prefix",
      "UR type prefix changed to 'btc-psbt' — wrong decoder would be invoked",
      generateMalformedUr(baseUr, "wrong_prefix"),
      "ur",
      "UR_WRONG_TYPE",
    ),
    makeCase(
      "no_ur_prefix",
      "invalid_ur_prefix",
      "UR prefix stripped entirely — input looks like plain text, not a UR",
      generateMalformedUr(baseUr, "no_ur_prefix"),
      "ur",
      "UR_NOT_UR_FORMAT",
    ),
    makeCase(
      "corrupt_ur_body",
      "invalid_checksum",
      "Invalid character '!' injected into bytewords body — not in bytewords alphabet",
      generateMalformedUr(baseUr, "corrupt_body"),
      "ur",
      "UR_PARSE_FAILED",
    ),
    makeCase(
      "corrupt_ur_checksum",
      "invalid_checksum",
      "Last 8 characters of bytewords replaced to corrupt the CRC32 checksum",
      generateMalformedUr(baseUr, "corrupt_checksum"),
      "ur",
      "UR_PARSE_FAILED",
    ),
    makeCase(
      "cbor_array_not_map",
      "malformed_cbor",
      "CBOR encodes an array instead of a map — field key lookup is impossible",
      Buffer.from(generateMalformedCbor("wrong_major_type_array")).toString("hex"),
      "cbor_hex",
      "CBOR_NOT_A_MAP",
    ),
    makeCase(
      "cbor_missing_sign_data",
      "malformed_cbor",
      "CBOR map missing required key 2 (signData) — wallet would sign nothing",
      Buffer.from(generateMalformedCbor("missing_sign_data")).toString("hex"),
      "cbor_hex",
      "CBOR_MISSING_SIGN_DATA",
    ),
    makeCase(
      "cbor_null_sign_data",
      "malformed_cbor",
      "signData field is CBOR null — null-dereference when wallet hashes it",
      Buffer.from(generateMalformedCbor("null_sign_data")).toString("hex"),
      "cbor_hex",
      "CBOR_MISSING_SIGN_DATA",
    ),
    makeCase(
      "cbor_zero_chain_id",
      "invalid_chain_id",
      "chainId = 0 is not a valid Ethereum chain — tx would be unroutable",
      Buffer.from(generateMalformedCbor("zero_chain_id")).toString("hex"),
      "cbor_hex",
      "CBOR_INVALID_CHAIN_ID",
    ),
    makeCase(
      "cbor_negative_chain_id",
      "invalid_chain_id",
      "chainId = -1 is nonsensical — chainId is uint in the Ethereum spec",
      Buffer.from(generateMalformedCbor("negative_chain_id")).toString("hex"),
      "cbor_hex",
      "CBOR_INVALID_CHAIN_ID",
    ),
    makeCase(
      "cbor_string_keys",
      "malformed_cbor",
      "CBOR map uses string keys ('2') instead of required integer keys (2)",
      Buffer.from(generateMalformedCbor("string_keys")).toString("hex"),
      "cbor_hex",
      "CBOR_MISSING_REQUEST_ID",
    ),
    makeCase(
      "cbor_truncated_bytes",
      "malformed_cbor",
      "CBOR bytes cut in half mid-stream — cannot complete decode",
      Buffer.from(generateMalformedCbor("truncated_bytes")).toString("hex"),
      "cbor_hex",
      "CBOR_DECODE_FAILED",
    ),
    makeCase(
      "cbor_random_bytes",
      "malformed_cbor",
      "Payload is random bytes that are not CBOR at all",
      Buffer.from(generateMalformedCbor("random_bytes")).toString("hex"),
      "cbor_hex",
      "CBOR_DECODE_FAILED",
    ),
    makeCase(
      "oversized_payload",
      "oversized_payload",
      `UR payload exceeds MAX_UR_CHARS=${MAX_UR_CHARS} — DoS via memory exhaustion`,
      generateOversizedPayload(),
      "ur",
      "UR_TOO_LONG",
    ),
    makeCase(
      "eip712_missing_primary_type",
      "malformed_eip712",
      "EIP-712 JSON missing primaryType — struct hash is uncomputable",
      Buffer.from(generateCorruptedTypedData("missing_primary_type")).toString("hex"),
      "cbor_hex",
      "TYPED_DATA_SCHEMA_INVALID",
    ),
    makeCase(
      "eip712_empty_domain",
      "malformed_eip712",
      "EIP-712 domain is empty — no chainId or verifyingContract means trivial replay",
      Buffer.from(generateCorruptedTypedData("empty_domain")).toString("hex"),
      "cbor_hex",
      "TYPED_DATA_SCHEMA_INVALID",
    ),
    makeCase(
      "eip712_invalid_domain_chain_id",
      "malformed_eip712",
      "EIP-712 domain has chainId=0 — hash is valid CBOR but semantically wrong",
      Buffer.from(generateCorruptedTypedData("invalid_domain_chain_id")).toString("hex"),
      "cbor_hex",
      "TYPED_DATA_SCHEMA_INVALID",
    ),
    makeCase(
      "eip712_missing_types",
      "malformed_eip712",
      "EIP-712 types is empty — no type definition means primaryType has no struct hash",
      Buffer.from(generateCorruptedTypedData("missing_types")).toString("hex"),
      "cbor_hex",
      "TYPED_DATA_PRIMARY_TYPE_MISSING",
    ),
    makeCase(
      "eip712_extra_safe_domain_fields",
      "malformed_eip712",
      "Safe EIP-712 domain includes name/version — changes domain separator, breaking on-chain verification",
      Buffer.from(generateCorruptedTypedData("extra_safe_domain_fields")).toString("hex"),
      "cbor_hex",
      "TYPED_DATA_SAFE_DOMAIN_EXTRA_FIELDS",
    ),
    makeCase(
      "eip712_invalid_utf8",
      "invalid_utf8",
      "signData (data-type:2) contains invalid UTF-8 byte sequences — cannot decode to JSON",
      Buffer.from(generateCorruptedTypedData("not_json")).toString("hex"),
      "cbor_hex",
      "TYPED_DATA_INVALID_UTF8",
    ),
    makeCase(
      "fragment_impossible_index",
      "corrupted_fragment_ordering",
      "Fragment claims to be '5 of 3' — seqNum exceeds seqLen, implausible index",
      fragments[0] ?? "ur:eth-sign-request/5-3/taadax",
      "fragment",
      "FRAGMENT_INDEX_OUT_OF_RANGE",
    ),
    makeCase(
      "fragment_zero_seq_num",
      "malformed_qr_chunk_metadata",
      "Fragment seqNum is 0 — fountain codes are 1-indexed",
      fragments[1] ?? "ur:eth-sign-request/0-3/taadax",
      "fragment",
      "FRAGMENT_ZERO_SEQ_NUM",
    ),
  ];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getMapField(decoded: unknown, key: number): unknown {
  if (decoded instanceof Map) return decoded.get(key);
  if (typeof decoded === "object" && decoded !== null) {
    return (decoded as Record<string, unknown>)[String(key)];
  }
  return undefined;
}

/**
 * Truncate a string to at most 60 characters for safe inclusion in error messages.
 * Prevents untrusted payload bytes from being embedded in rendered output.
 */
function sanitizeExcerpt(s: string): string {
  if (s.length <= 60) return s;
  return `${s.slice(0, 57)}...`;
}

function urCodeToKind(code: string): MalformedKind {
  if (code === "UR_WRONG_TYPE") return "invalid_ur_prefix";
  if (code === "UR_PARSE_FAILED" || code === "UR_LIBRARY_ERROR") return "invalid_checksum";
  if (code === "UR_NOT_UR_FORMAT") return "invalid_ur_prefix";
  return "truncated_ur";
}

function kindToTitle(kind: MalformedKind): string {
  const titles: Record<MalformedKind, string> = {
    truncated_ur: "Truncated UR Payload",
    malformed_cbor: "Malformed CBOR Structure",
    invalid_ur_prefix: "Invalid UR Type Prefix",
    corrupted_fragment_ordering: "Corrupted Fragment Ordering",
    duplicate_fragments: "Duplicate Fragment Detected",
    invalid_checksum: "Invalid UR Checksum",
    oversized_payload: "Oversized Payload",
    invalid_utf8: "Invalid UTF-8 Encoding",
    malformed_transaction: "Malformed Transaction",
    invalid_chain_id: "Invalid Chain ID",
    malformed_calldata: "Malformed Calldata",
    malformed_eip712: "Malformed EIP-712 Typed Data",
    malformed_qr_chunk_metadata: "Malformed QR Chunk Metadata",
  };
  return titles[kind];
}

function kindToSecurityNotice(kind: MalformedKind): string {
  const notices: Record<MalformedKind, string> = {
    truncated_ur: "Truncated payloads may indicate a partial QR scan or deliberate tampering.",
    malformed_cbor: "Malformed CBOR may indicate corruption or an attempt to confuse the parser.",
    invalid_ur_prefix: "Wrong UR type could route this payload to an unintended decoder.",
    corrupted_fragment_ordering: "Fragment sequence corruption prevents safe payload reconstruction.",
    duplicate_fragments: "Duplicate fragments may indicate a replay attempt or stuck scanner.",
    invalid_checksum: "Checksum failure indicates the payload was corrupted in transit.",
    oversized_payload: "Oversized payloads may be an attempt to exhaust wallet memory.",
    invalid_utf8: "Invalid byte sequences in typed data prevent safe display to the signer.",
    malformed_transaction: "The signing payload is not a valid Ethereum transaction.",
    invalid_chain_id: "An invalid chain ID would produce a transaction unroutable to any network.",
    malformed_calldata: "The nested calldata cannot be decoded — the true action is unknown.",
    malformed_eip712: "Malformed EIP-712 data cannot be safely hashed or displayed.",
    malformed_qr_chunk_metadata: "Invalid chunk metadata may confuse fragment reconstruction.",
  };
  return notices[kind];
}

function kindToRecommendedAction(kind: MalformedKind): string {
  if (kind === "truncated_ur" || kind === "invalid_checksum") {
    return "Reject payload and ask the sender to display a new QR code.";
  }
  if (kind === "oversized_payload") {
    return "Reject payload. Do not allocate memory for reconstruction. Request a new QR.";
  }
  if (kind === "duplicate_fragments") {
    return "Reset the fragment decoder and ask the sender to re-display the animated QR.";
  }
  return "Reject payload and request a new QR code from a trusted source.";
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const corpus = buildMalformedCorpus();

  const { signRequest } = buildTransferTx(DEMO_PARAMS);
  const baseCbor = encodeToCbor(signRequest);
  const baseUr = encodeToUr(baseCbor);

  const output = {
    meta: {
      description: "Malformed QR corpus for EIP-4527 defensive parser testing",
      maxUrChars: MAX_UR_CHARS,
      maxCborBytes: MAX_CBOR_BYTES,
      maxSignDataBytes: MAX_SIGN_DATA_BYTES,
      maxFragmentCount: MAX_FRAGMENT_COUNT,
      caseCount: corpus.length,
    },
    baseUrString: baseUr,
    baseCborHex: Buffer.from(baseCbor).toString("hex"),
    corpus,
  };

  console.log(JSON.stringify(output, null, 2));
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error("Example failed:", err);
    process.exit(1);
  });
}
