# The open-source EVM transaction interpreter and signer for ethOS
# dGEN1 Airgap

Open infrastructure for transparent air-gapped transaction signing.

`dGEN1 Airgap` is an open-source transaction inspection and signing pipeline designed for QR-based crypto workflows, offline wallets, and hardware signing devices.

The project focuses on one core problem:

> Helping humans safely understand what they are about to sign.

---

# Vision

Modern crypto signing UX is still dangerously opaque.

Users routinely sign:
- unreadable calldata
- malicious approvals
- phishing payloads
- blind swaps
- unsafe contract interactions

dGEN1 Airgap aims to provide a modular, auditable, and transport-agnostic architecture for:

- QR transaction transport
- UR/CBOR decoding
- transaction normalization
- human-readable inspection
- secure offline signing

The system is intentionally designed to work in:
- air-gapped environments
- hardware wallet ecosystems
- mobile signing flows
- offline-first security models

---

# Project Goals

## V1 Goals

The first version of the project focuses on executable examples proving the complete signing pipeline:

```text
QR
→ Decode
→ Parse
→ Normalize
→ Inspect
→ Sign
```

---

# EIP-4527

[EIP-4527](https://eips.ethereum.org/EIPS/eip-4527) defines a standard for QR-based Ethereum signing transport between a watch-only application and an air-gapped signer.

The core encoding stack:

```
Transaction fields
  → ethers v6 RLP serialization  (sign-data bytes)
  → CBOR map with integer keys   (eth-sign-request)
  → Bytewords encoding           (BC-UR payload)
  → ur:eth-sign-request/...      (UR string)
  → QR code                      (camera-scannable)
```

This project provides the first open reference implementation of that pipeline in TypeScript, with deterministic tests and a spec companion in `docs/`.

---

# Dependencies

| Package | Role |
|---------|------|
| `ethers` v6 | Canonical EIP-1559 RLP serialization via `Transaction.from()` |
| `cbor-x` | CBOR encode/decode with integer-keyed `Map` support |
| `@ngraveio/bc-ur` | BC-UR `UR`, `UREncoder`, `URDecoder` |
| `qrcode` | Terminal ASCII QR output |
| `zod` | Runtime schema validation for transaction envelopes |
| `tsx` (dev) | Run TypeScript examples without a build step |

---

# Installation

```bash
# npm
npm install

# pnpm (recommended)
pnpm install
```

---

# Commands

```bash
# Run the ETH transfer example — prints breakdown, CBOR hex, UR string, and QR
npm run example
# or
pnpm run example

# Run all unit tests
npm run test
# or
pnpm test
```

---

# Expected Output

Running `npm run example` produces:

```
─── EIP-1559 Transfer ───────────────────────────
  Chain:                 ethereum (chainId: 1)
  Type:                  eip1559
  Nonce:                 5
  To:                    0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  Value:                 1.000000 ETH (1000000000000000000 wei)
  Gas Limit:             21000
  Max Fee/Gas:           30 gwei
  Max Priority Fee/Gas:  1.5 gwei
─────────────────────────────────────────────────

CBOR hex:
  d90103a501500123456789abcdef0123456789abcdef025832...

UR string:
  ur:eth-sign-request/taadaxonadgdadcnfeioldpysnws...

QR payload (terminal render):
  [QR art rendered in terminal]
```

---

# Folder Structure

```
src/              Library source — public API exported via index.ts
  actions.ts        HumanReadableAction types
  chains.ts         Supported chain definitions
  errors.ts         DgenError interface
  payload.ts        EIP-4527 payload types
  signer.ts         SignerRequest / SignerResponse interfaces
  transaction.ts    TransactionEnvelope and TransactionMetadata
  index.ts          Public API barrel

examples/         Runnable reference examples
  eth-transfer.ts   Full EIP-4527 ETH transfer pipeline (build → CBOR → UR → QR)
  transfer.ts       Minimal TransactionEnvelope stub

tests/            Vitest unit tests — mirror src/ and examples/ structure
  validation.test.ts    Zod schema validation tests
  eth-transfer.test.ts  EIP-4527 pipeline tests (48 tests)

docs/             Spec companion — implementation notes and UX standards
  eip4527-implementation-notes.md
  qr-encoding.md
  signing-ux-standards.md
```