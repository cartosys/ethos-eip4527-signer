# EIP-4527 Implementation Notes

## What EIP-4527 Is

EIP-4527 defines a QR-based data transport for Ethereum signing requests between a "watch-only" application (a phone, browser, or desktop) and an air-gapped signer (a hardware wallet, offline device, or QR-scanner wallet).

The core premise: the offline signer has no network access. The only data channel is a camera. The signing request is encoded as a QR code (or sequence of animated QR frames), scanned by the signer, decoded, displayed, signed, and the resulting signature re-encoded as a QR for the watch app to scan back.

EIP-4527 standardizes the encoding — without it, every wallet pair needs custom protocol support.

---

## The `eth-sign-request` Structure

EIP-4527 defines a CBOR-encoded UR type called `eth-sign-request`. The CBOR payload is a **map with integer keys** (not string keys) as specified by the CDDL schema below.

```
eth-sign-request = (
  request-id: bytes,          ; key 1 — 16-byte UUID for request correlation
  sign-data: bytes,           ; key 2 — the bytes to be signed (see below)
  data-type: int,             ; key 3 — 1=transaction, 2=typed-data, 3=raw-bytes
  ? chain-id: int,            ; key 4 — EIP-155 chain ID (optional but strongly recommended)
  ? derivation-path: crypto-keypath, ; key 5 — HD path (optional)
  ? address: bytes,           ; key 6 — 20-byte expected signing address (optional)
  ? origin: text,             ; key 7 — human-readable source app name (optional)
)
```

### Key-by-key notes

| Key | Field | Notes |
|-----|-------|-------|
| 1 | `request-id` | UUID as 16 raw bytes. Used to correlate a response to a request. Do not use a string UUID — CBOR bytes, not text. |
| 2 | `sign-data` | For `data-type=1`: the RLP-encoded **unsigned** EIP-1559 transaction (the bytes the hardware wallet will hash with keccak256 to get the signing digest). |
| 3 | `data-type` | Integer. `1` = transaction bytes, `2` = EIP-712 typed data, `3` = raw bytes to sign without hashing. Never omit this field. |
| 4 | `chain-id` | Integer. Strongly recommended even though technically optional. A missing chain-id means the signer cannot prevent cross-chain replay. |
| 5 | `derivation-path` | HD wallet key path as `crypto-keypath`. Useful when the signer manages multiple keys. |
| 6 | `address` | The 20-byte address the app expects to sign. Lets the signer reject if the wrong key is selected. |
| 7 | `origin` | Human-readable app name displayed by the signer. Use a stable, recognizable identifier. |

---

## How `sign-data` Is Constructed

For an EIP-1559 (type 2) transaction, `sign-data` is the **EIP-2718 serialization of the unsigned transaction**:

```
sign-data = 0x02 || RLP([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data, access_list])
```

- The leading `0x02` byte is the EIP-2718 transaction type prefix.
- The RLP list contains all transaction fields **without** the signature fields (v, r, s).
- This is the input to `keccak256()` that produces the signing digest. The signer applies keccak256 to these bytes and signs the result.

**With ethers v6:**
```typescript
import { Transaction, getBytes } from "ethers";

const tx = Transaction.from({
  type: 2,
  chainId: 1n,
  nonce: 5,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_500_000_000n,
  gasLimit: 21_000n,
  to: "0xd8dA...",
  value: 1_000_000_000_000_000_000n,
  data: "0x",
});

const signData = getBytes(tx.unsignedSerialized); // Uint8Array starting with 0x02
```

Verify: `signData[0] === 0x02`. If it's `0x01`, you have an EIP-2930 transaction. If it starts with `0xf8` or similar, it's a legacy transaction.

---

## CBOR Encoding Decisions

### Integer keys, not string keys

The EIP-4527 CDDL uses integer map keys. This matters: a CBOR map with integer key `2` is **not** the same as one with string key `"2"`. Any implementation that accidentally uses string keys will fail to interoperate with wallets that follow the spec.

**How to verify your CBOR:** decode the bytes and check that the keys are integers. In cbor-x:

```typescript
import { decode } from "cbor-x";
const decoded = decode(cborBytes);
// If decoded is { "1": ..., "2": ..., "7": ... } with string keys → wrong
// If decoded is Map { 1 => ..., 2 => ..., 7 => ... } with integer keys → correct
```

To produce integer-keyed maps with cbor-x, pass a JavaScript `Map<number, unknown>`. If you pass a plain object `{ "1": ..., "2": ... }`, the keys become CBOR strings.

### Byte fields vs hex strings

`request-id` and `sign-data` are CBOR byte strings (major type 2), not hex-encoded text strings. A 32-byte value encoded as bytes takes 33 bytes in CBOR (1 header + 32 data). The same value as a hex string takes 67 bytes (1 header + 2 chars/byte + `0x` prefix). Compact binary encoding matters for QR capacity.

---

## UR Type String

The UR type for EIP-4527 is `eth-sign-request`. BC-UR type strings must:
- Be all lowercase
- Contain only `[a-z0-9-]`
- Not start or end with a hyphen

A single-part UR looks like:
```
ur:eth-sign-request/<bytewords-encoded-cbor>
```

A multi-part fragment looks like:
```
ur:eth-sign-request/<seqNum>-<total>/<checksum>/<bytewords-fragment>
```

---

## Common Implementation Pitfalls

### 1. Number overflow for value fields

`value`, `maxFeePerGas`, `maxPriorityFeePerGas`, and `gasLimit` can exceed `Number.MAX_SAFE_INTEGER` (2^53 - 1 ≈ 9 × 10^15 wei ≈ 9000 ETH). Any code that coerces these to JavaScript `number` is silently wrong for large transfers or high-fee environments.

**Always use BigInt:**
```typescript
const value = BigInt("1000000000000000000"); // 1 ETH — safe
const value = Number("1000000000000000000"); // 1e18 — precision lost above 9007199254740992
```

### 2. Wrong CBOR key type

Passing a plain object instead of a `Map` to the CBOR encoder produces string keys. The resulting bytes are syntactically valid CBOR but semantically wrong per the spec. Use `new Map<number, unknown>([[1, requestId], [2, signData], ...])`.

### 3. Missing `chain-id`

Omitting `chain-id` (key 4) from the CBOR map creates a signing request that is valid on every EVM chain simultaneously. A user signing an "Ethereum mainnet" transaction could be signing a valid Polygon or BSC transaction. Always include `chain-id`.

### 4. Signing the encoded bytes, not the hash

For `data-type=1`, the hardware wallet is expected to apply `keccak256` to `sign-data` before signing. Some implementations accidentally call ECDSA on the raw `sign-data` bytes. If you control both sides, clarify the expected digest function.

### 5. UR type case sensitivity

Wallet scanners reject URs where the type does not match exactly. `ETH-SIGN-REQUEST`, `eth_sign_request`, and `Eth-Sign-Request` are all wrong. The type must be `eth-sign-request` (lowercase, hyphens).

When generating a QR code, the UR string is uppercased for the QR payload (`UR:ETH-SIGN-REQUEST/...`) because QR alphanumeric mode covers `[A-Z0-9$%*+-./:]`. The decoder must lowercase the type before comparison.
