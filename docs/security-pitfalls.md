# Security Pitfalls in EIP-4527 Signing

## Overview

This document catalogs known attack surfaces, parser risks, and semantic deception techniques that apply to EIP-4527 QR-based signing workflows. It is written for wallet implementers, security auditors, and protocol integrators.

EIP-4527 is a transport protocol. It defines how a signing request moves from a watch app to a signer device. It does not define what constitutes a *valid* or *safe* transaction. Every risk listed here is a consequence of parsing, rendering, or approving content that the EIP-4527 protocol faithfully delivered but that the signer's application layer failed to handle correctly.

For UX guidance on rendering the human-readable confirmation, see `ux-recommendations.md`. For animated QR transport parameters, see `animated-qr-timing.md`.

---

## Attack Surface Map

```
Watch App                     QR Channel              Signer Device
──────────────────            ──────────────           ──────────────────────
[Malicious dApp]  →  payload  →  [Attacker QR]  →  camera  →  [Parser]
[Compromised UI]  →  payload  ─────────────────────────────→  [Decoder]
[Legitimate app]  →  payload  →  [Replay]       →  camera  →  [Decoder]
                                                              [Renderer]
                                                              [User ← manipulated]
                                                              [Signing key]
```

Attacks occur at three layers:
1. **Transport layer**: Malformed or manipulated QR frames before the signer can parse them
2. **Parse layer**: Valid QR, valid CBOR, invalid or adversarial payload structure
3. **Semantic layer**: Valid payload structure, misleading content that looks legitimate to the user

---

## Transport Layer Attacks

### Truncated UR injection

**Attack**: An attacker presents a QR code containing a partially-formed UR string. The signer's scanner captures a frame and attempts to parse it.

**Risk**: If the UR parser does not validate the bytewords checksum before returning any decoded bytes, a truncated input can decode to a prefix of a real payload. A decoder that processes fragments eagerly before full reconstruction could be tricked into acting on partial data.

**Mitigation**: Only call `isComplete()` → decode after the fountain code decoder confirms reconstruction. Never peek at partial buffer contents. The bytewords checksum (last 4 bytes of the decoded message) must pass before the payload is handed to any higher-level parser.

### Oversized fragment injection

**Attack**: A malicious watch app generates a `seqLen` of 10 000 or more. The signer begins allocating reconstruction buffers proportional to fragment count.

**Risk**: Memory exhaustion on constrained hardware (hardware wallets, embedded signers). A signer with 256 KB RAM that allocates per-fragment buffers for 10 000 fragments will OOM before reconstruction begins.

**Mitigation**: Check `seqLen` from the first received fragment against a hard maximum before allocating any buffers. Reject immediately. The recommended limit is `seqLen > 500` for mobile and `seqLen > 100` for hardware wallet firmware (see `animated-qr-timing.md`).

### Frame replay across devices

**Attack**: An attacker captures all QR frames before the legitimate signer does and replays them to a different signer device that holds a different key.

**Risk**: If the different key happens to control funds, the attacker obtains a signature from a device the user didn't intend to use. More commonly, this is used to determine what the watch app is requesting without possessing a key.

**Mitigation**: The `address` field (CBOR key 6) binds the request to a specific signing key. A signer must verify that the address in the request matches the loaded key before displaying the confirmation UI. A `request-id` registry (short-lived, in-memory) prevents the same request from appearing twice on the same device. See `animated-qr-timing.md` for request-id invalidation timing.

### Corrupt checksum bypass

**Attack**: An attacker modifies the payload bytes but recalculates the bytewords checksum to match the modified content, producing a structurally valid but semantically modified UR.

**Risk**: The fountain code decoder will accept the frame as structurally valid. The modification would need to preserve internal CBOR structure to reach the signing screen — a significantly harder constraint.

**Mitigation**: The `signData` field must be validated against the transaction it claims to represent. For EIP-1559 transactions, the first byte must be `0x02`; the RLP structure must parse correctly; the chain ID inside the RLP must match the `chain-id` CBOR field. For EIP-712, the `safeTxHash` in the message must be recomputed from the message fields and verified to match.

---

## Parse Layer Attacks

### CBOR integer key confusion

**Attack**: A malicious payload uses string keys (`"2"`, `"sign-data"`) instead of integer keys for CBOR fields, exploiting wallets that accept either form.

**Risk**: A wallet that falls back to string key lookup after missing the integer key will accept a payload where string-keyed `"sign-data"` differs from integer-keyed `2`. If the signer displays data from one source and signs data from the other, the signed bytes do not correspond to the displayed transaction.

**Mitigation**: Require integer keys strictly. Reject any CBOR payload where required fields are not present as integer keys. Do not implement string key fallback. The EIP-4527 spec is unambiguous: map integer keys 1–7.

### Sign data type confusion

**Attack**: The `data-type` field (CBOR key 3) is set to `1` (transaction bytes), but the `sign-data` field contains EIP-712 bytes, or vice versa.

**Risk**: The signer renders the transaction using the wrong decoder. If a wallet renders EIP-712 bytes as an EIP-1559 transaction, it may parse garbage and display corrupt field values — or worse, crash before the user sees anything. If it renders transaction bytes as EIP-712, it may silently succeed with a malformed but parseable output.

**Mitigation**: Validate `signData` structure against `dataType`. For `dataType = 1`: first byte must be `0x02` (type-2) or `0x01` (type-1) or `>= 0xc0` (legacy RLP). For `dataType = 2`: attempt EIP-712 JSON decode and validate the `primaryType` field. If structure does not match the declared type, reject before rendering.

### Chain ID mismatch

**Attack**: The `chain-id` CBOR field (key 4) claims chain 1 (Ethereum mainnet), but the `signData` bytes contain chain ID 137 (Polygon). A signer that trusts the CBOR chain-id without checking the RLP chain-id will display "Ethereum Mainnet" while signing a Polygon transaction.

**Risk**: The signed transaction is valid on Polygon, not on Ethereum. An attacker can use this to make a mainnet user sign a transaction intended for a chain where the attacker controls a receiver address.

**Mitigation**: For EIP-1559 and legacy transactions: decode the RLP chain ID and compare it to CBOR key 4. They must match. If they differ, reject with a chain mismatch error — do not offer a "use the transaction's chain ID" override, as the discrepancy is a sign of tampering.

### Oversized sign data

**Attack**: The `sign-data` field contains a megabyte-scale payload. The signer allocates a buffer and begins parsing.

**Risk**: Memory exhaustion or denial of service. A hardware wallet that copies the sign data into a fixed buffer may overflow.

**Mitigation**: Check `signData` length before any parsing. Hard limits:
- Hardware wallet: 10 KB
- Mobile wallet: 100 KB  
- Desktop wallet: 1 MB (implement a warning above 50 KB — legitimate transactions are almost never this large)

Reject before decoding with a specific error message, not a generic crash.

### Deeply nested CBOR

**Attack**: The `sign-data` field contains CBOR with pathological nesting depth (1000+ levels) to exhaust the parser's call stack.

**Risk**: Stack overflow in recursive CBOR parsers. Hardware wallet firmware with limited stack space is particularly vulnerable.

**Mitigation**: Set a CBOR nesting depth limit of 10–20 levels. Reject before recursion begins. Most EIP-4527 payloads have nesting depth ≤ 5.

---

## Semantic Layer Attacks

These attacks use structurally valid payloads to deceive the user or the wallet's rendering logic.

### Approval phishing via ERC20 transfer display

**Attack**: A malicious watch app constructs a transaction with:
- `to`: a legitimate-looking address (e.g., `0xdAC17F958D2ee523a2206206994597C13D831ec7` — USDT contract)
- `value`: 0
- `data`: `0x095ea7b3` (the `approve()` selector) with spender = attacker address, amount = MaxUint256

The calldata selector `0x095ea7b3` is not `0xa9059cbb` (transfer). A wallet that only decodes `transfer` but shows all calldata interactions as "Token Transfer" will display a safe-looking confirmation for an unlimited approval.

**Mitigation**: Decode the selector for every interaction. Distinguish `transfer`, `approve`, `transferFrom`, `increaseAllowance`, `permit`, and unknown selectors. An unknown selector must be displayed as "Unknown Method — 0x095ea7b3" with a warning that the signer cannot interpret this interaction.

### Calldata obfuscation via proxy contracts

**Attack**: The `to` address is a proxy or router contract. The actual recipient and operation are embedded in calldata at a position the wallet's decoder does not parse.

**Risk**: The user approves a transaction targeting a "known" address (e.g., a Uniswap router) without understanding that the calldata routes funds to an attacker.

**Mitigation**: Explicitly note when the target is a proxy or router and the full execution path cannot be verified. Display: "Transaction to known router — full execution path not verified. Confirm recipient in your watch app."

Do not attempt to recursively decode nested calldata beyond the first level without a reliable ABI source. Presenting a partial decode as complete is more dangerous than admitting the limit.

### EIP-712 type shadowing

**Attack**: A malicious domain defines a type named `Transfer` whose structure is identical to a Permit but with different semantics — for example, where a field named `amount` is actually denominated in a different token unit.

**Risk**: The user sees a familiar-looking type name and approves without inspecting the domain's verifyingContract.

**Mitigation**: Display the full domain separator, including `verifyingContract`, prominently. The domain contract is the authoritative source of type semantics — two identical type structures from different contracts have completely different meanings. Users must be able to verify the contract address before approving.

### Safe domain separator manipulation

**Attack**: A malicious Safe payload includes `name` and `version` fields in the EIP-712 domain, which changes the domain separator. The transaction appears legitimate (correct `safeAddress`, correct `chainId`) but the `safeTxHash` is computed over a different domain than the Safe contract expects.

**Risk**: The signed hash is accepted by no Safe contract (the Safe's domain has no `name`/`version`). This would cause the transaction to be silently dropped if submitted. However, the signature itself might be used in other exploits or presented as a legitimate authorization in off-chain contexts.

**Mitigation**: For any `primaryType == "SafeTx"`: reject if `name` or `version` are present in the domain. The Safe EIP-712 domain is `{ chainId, verifyingContract }` only. This is enforced by the Safe contracts and must be enforced by signers.

### safeTxHash forgery

**Attack**: A malicious payload presents a `safeTxHash` that does not match the transaction parameters. The signer displays the decoded parameters but signs the provided (incorrect) hash rather than recomputing it.

**Risk**: The user approves what appears to be a legitimate transaction but signs a hash that commits to different parameters. If the watch app was compromised, the actual execution could drain the Safe.

**Mitigation**: Always recompute the `safeTxHash` from the provided domain, types, and message fields using `TypedDataEncoder.hash()`. Compare the computed hash to the hash in the payload. Reject if they differ. The "Computed hash matches safeTxHash ✓" display in the UX recommendations is only valid when this check has passed.

### Unicode homoglyph spoofing in `origin`

**Attack**: The `origin` field (CBOR key 7) contains a string like `"ethеrwallet.com"` where the `е` is Cyrillic (U+0435), not Latin `e` (U+0065). The string renders identically in most fonts.

**Risk**: Users who treat the `origin` field as an authentication signal may believe they are signing a request from a trusted application.

**Mitigation**: The `origin` field is informational only. It is user-supplied metadata in the watch app payload and cannot be trusted for authentication. Display it as: "Requested by: ethеrwallet.com (unverified)". Strip or escape any non-ASCII characters from the `origin` field. Never use `origin` to gate signing behavior.

### DELEGATECALL disguised as CALL

**Attack**: A Safe transaction payload sets `operation = 1` (DELEGATECALL) in the SafeTx fields. The watch app's UI displays the transaction as a CALL to a "DeFi router" without surfacing the operation type.

**Risk**: The user signs a DELEGATECALL thinking it is a standard token interaction. The target contract executes with full access to the Safe's storage, balance, and modules.

**Mitigation**: The signer must independently decode `operation` from the `message` fields in the EIP-712 payload. It must not rely on the watch app's human-readable description. `operation = 1` must trigger a Level 3 (Danger) warning screen before any confirmation is offered.

### Replay via `request-id` collision

**Attack**: An attacker captures a legitimate signing session QR and replays it to the same signer device later. If the `request-id` has been flushed from the in-memory registry, the signer presents the same request as a new one.

**Risk**: The user approves a transaction they already approved, potentially re-submitting a nonce they have already used (which would fail on-chain) or re-signing an approval they intended to be one-time.

**Mitigation**: `request-id` registry with a 60-second TTL is insufficient for all cases. For signing requests that include a nonce: after approval, record the combination of `(chainId, fromAddress, nonce)` in a persistent store and reject any future request with the same combination. For EIP-712 permits with `deadline`: if the deadline has passed, reject the request regardless of `request-id`.

---

## Parser Hardening Requirements

### Bounds checking on all numeric fields

Every numeric field in the CBOR payload must be range-checked before use:

| Field | Valid range | Rejection condition |
|-------|------------|-------------------|
| `chain-id` (key 4) | 1 – 2^64 | ≤ 0, or non-integer |
| `data-type` (key 3) | 1 or 2 | any other value |
| seqLen (fountain) | 1 – 500 | 0, > 500 |
| seqNum (fountain) | 1 – seqLen | 0, > seqLen |

### No silent field truncation

A CBOR map field value that is longer than expected must be rejected, not silently truncated. A `request-id` that is 64 bytes instead of the expected 16 bytes is not an error in the first 16 bytes — it is a malformed payload.

### Null and missing field semantics

Treat missing and null differently:
- A missing `chain-id` (key 4 absent from the CBOR map): reject — the chain cannot be determined
- A null `chain-id` (`cbor: f6` at key 4): reject — this is structurally valid CBOR but semantically invalid
- An empty `request-id` (zero-length bytes at key 1): warn but do not reject — request-id is informational

### Error specificity

Never surface a generic "invalid payload" or "scan failed" error. Specific error codes allow watch app developers to diagnose integration issues and allow users to report reproducible failures. Every rejection must carry a machine-readable code (e.g., `CHAIN_ID_MISMATCH`, `CBOR_MISSING_SIGN_DATA`) and a human-readable description.

### No throwing from parsing paths

The parsing path from raw QR bytes to a decoded `Eip4527SignRequest` must not throw uncaught exceptions under any input. Every error must be caught, classified, and returned as a structured `ValidationResult`. An uncaught exception on a constrained device may crash the signer firmware, requiring a hardware reset — which is itself a denial-of-service vector.

---

## Supply Chain Considerations

### BC-UR library integrity

The `@ngraveio/bc-ur` library implements the fountain code encoder and decoder. It is a dependency that processes attacker-controlled input (QR frame bytes). Before shipping a production signer:

- Pin the library to a specific version with a known checksum
- Review the library's handling of malformed bytewords input — confirm it does not throw on garbage input
- Confirm the bytewords checksum is validated before bytes are returned to the caller

### CBOR library attack surface

The CBOR decoder (`cbor-x`) processes attacker-controlled bytes. Key concerns:
- Does it limit nesting depth?
- Does it allocate proportionally to input size without bounds?
- Does it support all CBOR major types, including those the EIP-4527 payload schema does not use (tags, floats, simple values)?

A CBOR library that supports floating-point numbers will parse `chain-id: 1.0` as a valid value. If the signer's type validation only checks for integer type after decoding, it may accept a chain-id that the CBOR library returned as a float. Explicitly validate that numeric fields decoded as JavaScript integers (no fractional part, no Infinity, no NaN) before use.

### QR scanning library

The camera and QR decoding library runs before any of the above defenses are active. A vulnerability in the QR scanner itself (e.g., a buffer overflow on malformed QR version tables) would occur before the signer can apply any EIP-4527-layer validation.

Prefer mature, actively-maintained QR decoding libraries with a history of security review. For hardware wallet firmware, prefer libraries with defined memory layouts and no dynamic allocation in the decoding path.

---

## Testing Against This Document

The `examples/malformed-qr.ts` file in this repository demonstrates parser hardening against a corpus of 23 malformed inputs covering:
- Truncated UR at multiple offsets
- Wrong and missing UR prefixes
- CBOR structural anomalies (array not map, missing fields, null fields, string keys)
- Oversized payloads
- Malformed EIP-712 domains
- Invalid fragment metadata

Run the corpus tests:
```bash
pnpm test -- malformed-qr
```

Add new cases to `buildMalformedCorpus()` in `examples/malformed-qr.ts` for any new attack vector identified in production. The fixture (`fixtures/malformed-qr.json`) captures expected parser behavior and will fail tests if behavior changes.
