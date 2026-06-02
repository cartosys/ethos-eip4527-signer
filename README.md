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

# Dev Account Setup (Sepolia Testnet)

For manual testing against a real testnet — faucet funding, live transaction signing, etc.

**1. Generate a throwaway Sepolia key:**

```bash
# Using Foundry cast:
cast wallet new

# Or with tsx (no extra install):
tsx -e "import { ethers } from 'ethers'; const w = ethers.Wallet.createRandom(); console.log('Key:', w.privateKey); console.log('Address:', w.address);"
```

**2. Create your `.env` file:**

```bash
cp .env.example .env
# Edit .env and set DEV_PRIVATE_KEY to your new key
```

**3. Check your balance:**

```bash
pnpm check-dev-balance
```

If the balance is zero the script prints faucet links. Fund the address, then re-run to confirm.

> **Warning:** This key is for Sepolia testnet only. Never reuse it on mainnet. Never commit `.env`.

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
  erc20-transfer.ts ERC20 token transfer — ABI encode calldata, decode recipient from data field
  transfer.ts       Minimal TransactionEnvelope stub

tests/            Vitest unit tests — mirror src/ and examples/ structure
  validation.test.ts      Zod schema validation tests
  eth-transfer.test.ts    EIP-4527 ETH pipeline tests (48 tests)
  erc20-transfer.test.ts  ERC20 pipeline + fixture snapshot tests (39 tests)

fixtures/         Golden snapshots for deterministic pipeline outputs
  erc20-transfer.json

docs/             Spec companion — implementation notes and UX standards
  eip4527-implementation-notes.md
  qr-encoding.md
  signing-ux-standards.md
```

---

# ERC20 Transfer Example

## Purpose

ERC20 token transfers look very different from ETH transfers at the transaction level:

| Field | ETH Transfer | ERC20 Transfer |
|-------|-------------|----------------|
| `tx.to` | The recipient's address | The **token contract** address |
| `tx.value` | ETH amount | `0` (no ETH sent) |
| `tx.data` | `"0x"` (empty) | ABI-encoded `transfer(address,uint256)` call |

A wallet that reads `tx.to` and displays it as "recipient" will show the user a **contract address**, not who is receiving their tokens. This is a real-world source of user confusion and has enabled phishing attacks.

The ERC20 example proves the decode pipeline: ABI-encode the calldata, sign the transaction, then extract the true recipient and amount back from the calldata before displaying.

## Running the ERC20 Example

```bash
npm run erc20-example
# or
pnpm run erc20-example
```

## Expected Output

```
─── ERC20 Token Transfer ─────────────────────────
  Method:                transfer(address,uint256)
  Network:               ethereum (chainId: 1)
  Type:                  eip1559
  Nonce:                 3
  Token Contract:        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  Recipient:             0x742d35Cc6634C0532925a3b844Bc454e4438f44e
  Amount:                100.000000 USDC
  Gas Limit:             65000
  Max Fee/Gas:           30 gwei
  Max Priority Fee/Gas:  1.5 gwei
─────────────────────────────────────────────────

Calldata:
  0xa9059cbb000000000000000000000000742d35cc...05f5e100

UR string:
  ur:eth-sign-request/taadaxonadgdaofgletobwhg...

QR payload (terminal render):
  [QR art rendered in terminal]
```

## Architecture: Shared Pipeline, New Decode Layer

The ERC20 example imports `encodeToCbor`, `encodeToUr`, `decodeUrPayload`, and `generateQrPayload` directly from `eth-transfer.ts`. These four functions operate on any `Eip4527SignRequest` — the ERC20 signing payload is structured identically at the CBOR/UR level.

What is new in `erc20-transfer.ts`:

- **`buildErc20TransferTx()`** — ABI-encodes the `transfer(address,uint256)` calldata using `ethers.Interface`, then builds the EIP-1559 transaction with `value=0` and `to=tokenContract`
- **`decodeErc20Transfer()`** — validates the 4-byte selector (`0xa9059cbb`), rejects short or mistyped calldata with typed `DgenError`, and ABI-decodes the recipient and amount
- **`renderHumanReadable()`** — displays the decoded recipient (from calldata), not `tx.to` (the contract)

The fixture at `fixtures/erc20-transfer.json` locks down the deterministic output of the full pipeline. Any change to ABI encoding, CBOR structure, or UR encoding will break the fixture tests — by design.

## Why Calldata Decoding Matters for Wallet Security

Hardware wallets and air-gapped signers that display only `tx.to` and `tx.value` are blind to ERC20 transfers. An attacker can craft a transaction that appears to send `0 ETH to some contract` while actually calling `transfer(attacker, 1_000_000_000_000)` on a user's token.

The minimum safe display for any transaction with non-empty calldata:
1. Decode the method selector — is it a known method?
2. ABI-decode the arguments and display them
3. If the calldata cannot be decoded, display it raw with a warning

This corpus example provides a tested, typed reference implementation that wallet teams can adapt directly.

---

# Permit2 Example

## Purpose

[Permit2](https://github.com/Uniswap/permit2) is Uniswap's canonical off-chain token approval protocol. Unlike ERC20 `approve()`, Permit2 signatures are:

- **Off-chain** — no gas cost, no on-chain transaction before the transfer
- **Typed** — EIP-712 structured data the wallet can parse and display
- **Expiring** — every approval has a deadline; unlimited approvals are a visible red flag
- **Revocable** — nonce-based, so a permit can be invalidated before use

This example demonstrates the key differences from the ETH and ERC20 corpus examples:

| Field | ETH Transfer | ERC20 Transfer | Permit2 |
|-------|-------------|----------------|---------|
| EIP-4527 `data-type` | `1` (transaction) | `1` (transaction) | `2` (typed-data) |
| `sign-data` content | RLP-encoded tx | RLP-encoded tx | JSON EIP-712 typed data |
| On-chain tx? | Yes | Yes | No |
| Signing hash | EIP-1559 tx hash | EIP-1559 tx hash | EIP-712 domain + message hash |

The Permit2 domain intentionally omits the `"version"` field — the Permit2 contract does not register one. Wallets that add `"version"` will compute a wrong signing hash and the approval will be rejected.

## Running the Permit2 Example

```bash
npm run permit2-example
# or
pnpm run permit2-example
```

## Expected Output

```
─── Permit2 Token Approval ───────────────────────
  Type:                  EIP-712 Typed Data
  Protocol:              Permit2 (Uniswap)
  Network:               ethereum (chainId: 1)
  Token:                 USDC (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
  Spender:               0x1111111254EEB25477B68fb85Ed929f73A960582
  Amount:                1000.000000 USDC
  Expiration:            2027-01-01T00:00:00.000Z
  Nonce:                 0
  Sig Deadline:          2027-01-01T00:00:00.000Z
  Signing Hash:          0xb2d86d3cd646da5...
─────────────────────────────────────────────────

Signing Hash:
  0xb2d86d3cd646da5...

CBOR hex:
  d90103a5015003579bdf13ce...

UR string:
  ur:eth-sign-request/taadaxonadgd...

QR payload (terminal render):
  [QR art rendered in terminal]
```

## Security Warning Analysis

`analyzePermit2(typedData)` inspects the permit and returns typed warnings:

| Code | Condition |
|------|-----------|
| `UNLIMITED_APPROVAL` | `amount === uint160.max` — spender can drain all tokens |
| `ZERO_AMOUNT` | `amount === 0` — permit grants no spending power |
| `EXPIRED_PERMIT` | `expiration <= now` — signing has no effect |
| `LONG_EXPIRATION` | `expiration > now + 1 year` — long-lived approval risk |
| `ZERO_ADDRESS_SPENDER` | `spender === 0x0000...0000` — unusable permit |

These warnings are displayed in `renderHumanReadable()` when present and are tested exhaustively in `tests/permit2.test.ts`.

## Architecture

What is new in `examples/permit2.ts`:

- **`buildPermit2Payload()`** — constructs the EIP-712 typed data, computes the signing hash via `TypedDataEncoder.hash()`, serializes the typed data as JSON → UTF-8 bytes for `sign-data`
- **`encodeToCbor()`** — local implementation using `data-type: 2` (typed-data), not `1` (transaction)
- **`decodePermit2Payload()`** — parses JSON from `sign-data` bytes, validates with Zod schema
- **`decodePermit2UrPayload()`** — full UR → CBOR → JSON → Zod roundtrip
- **`analyzePermit2()`** — security analysis returning typed `SecurityWarning[]`
- **`renderHumanReadable()`** — displays all approval fields and any warnings before signing

`encodeToUr()` and `generateQrPayload()` are imported from `eth-transfer.ts` — they operate on CBOR bytes and UR strings and are fully reusable regardless of `data-type`.

---

# Uniswap V3 Swap Example

## Why Swap Transactions Are Hard to Interpret

A Uniswap V3 swap looks like this at the raw transaction level:

| Field | Value | What users see without decoding |
|-------|-------|----------------------------------|
| `tx.to` | SwapRouter address | "Sending to an unknown contract" |
| `tx.value` | 0.5 ETH (for ETH input) | "Sending 0.5 ETH to a contract" |
| `tx.data` | 260 bytes of ABI-encoded calldata | Opaque hex string |

Without calldata decoding, a wallet cannot tell the user:
- Which tokens are being swapped
- What the minimum acceptable output is
- Whether slippage protection is set
- When the approval expires
- Whether the router is a recognized protocol

This example proves the full decode pipeline for `exactInputSingle` on Uniswap V3 SwapRouter.

## Running the Uniswap Swap Example

```bash
npm run swap-example
# or
pnpm run swap-example
```

## Expected Output

```
─── Uniswap V3 Swap ──────────────────────────────
  Swap:                  0.500000 ETH
  For at least:          1450.000000 USDC
  Protocol:              Uniswap V3 SwapRouter
  Route:                 ETH → USDC
  Router:                Uniswap V3 SwapRouter (0xE592427A0AEce92De3Edee1F18E0157C05861564)
  Recipient:             0x742d35Cc6634C0532925a3b844Bc454e4438f44e
  Fee Tier:              0.05% (500)
  Slippage Protection:   Enabled
  Deadline:              2027-01-01T00:00:00.000Z
  Network:               ethereum (chainId: 1)
  Gas Limit:             210000
  Max Fee/Gas:           30 gwei
  Max Priority Fee/Gas:  1.5 gwei
  ─── Security Notice ────────────────────────────
  If market price moves before execution, output may differ from estimate.
─────────────────────────────────────────────────
```

## Slippage and Deadlines

**Slippage** (`amountOutMinimum`): The minimum number of output tokens the user will accept. Setting this to `0` means the user will accept any amount — including 1 wei — making the trade immediately sandwichable. MEV bots monitor the mempool for zero-slippage swaps and extract essentially the full input value.

**Deadline**: The unix timestamp after which the swap reverts on-chain. Without a deadline, a signed transaction can be held in the mempool and executed at an arbitrarily unfavorable price days later. A short deadline (minutes, not hours) forces the swap to execute near the current market price or not at all.

## Security Warning Analysis

`validateSwapPayload(result, now?)` inspects the swap and returns typed warnings:

| Code | Condition |
|------|-----------|
| `ZERO_AMOUNT_OUT_MINIMUM` | `amountOutMinimum === 0` — 100% slippage, sandwichable |
| `EXPIRED_DEADLINE` | `deadline <= now` — tx reverts on-chain immediately |
| `UNKNOWN_ROUTER` | Router not in `KNOWN_ROUTERS` whitelist |
| `ZERO_RECIPIENT` | `recipient === 0x0000...` — output tokens are burned |
| `UNUSUAL_FEE_TIER` | Fee not in standard tiers (100, 500, 3000, 10000) |
| `EXCESSIVE_FEE_TIER` | Fee > 10000 — exceeds Uniswap protocol maximum |
| `ETH_VALUE_MISMATCH` | `tx.value !== amountIn` when tokenIn is WETH9 |

## How Calldata Decoding Improves Wallet UX

A hardware wallet or air-gapped signer that decodes `exactInputSingle` calldata can display:
1. The actual tokens being swapped (not just "sending ETH to a contract")
2. The minimum output — so users know their slippage floor
3. The deadline — so users can assess staleness risk
4. The pool fee tier — an unusual tier may signal a non-standard or malicious pool
5. The true recipient — important when the recipient differs from msg.sender

The fixture at `fixtures/uniswap-swap.json` locks the deterministic calldata, CBOR, and UR output. Any change to ABI encoding or CBOR structure will break the fixture tests — by design.

## Architecture

What is new in `examples/uniswap-swap.ts`:

- **`buildUniswapSwapTx()`** — ABI-encodes `exactInputSingle` calldata using `ethers.Interface`, builds the EIP-1559 transaction with `to = router`, `value = amountIn` for ETH swaps
- **`decodeSwapCalldata()`** — validates the 4-byte selector (`0x414bf389`), rejects short/malformed calldata with typed `DgenError`, ABI-decodes all struct fields, then validates through a Zod schema
- **`validateSwapPayload()`** — analyzes the decoded swap for security conditions (zero slippage, expired deadline, unknown router, etc.) and returns typed `SwapWarning[]`
- **`renderHumanReadable()`** — displays the swap intent (tokens, amounts, slippage, deadline) rather than raw tx fields, includes a static MEV notice and any dynamic warnings

`encodeToCbor()`, `encodeToUr()`, `decodeUrPayload()`, and `generateQrPayload()` are re-exported from `eth-transfer.ts` — the swap uses `data-type: 1` (transaction bytes), identical to ETH and ERC20 transfers.

## Future Extensibility

The architecture supports adding:
- **`exactInput` (multi-hop)**: Extend `decodeSwapCalldata` with a `decodePath(bytes)` helper that parses the `(address, uint24, address, uint24, ..., address)` path encoding
- **Uniswap V4**: Add hook address and hookData fields to `UniswapSwapDetails`
- **Universal Router**: Decode multicall `commands` array, each byte a sub-command type

---

# Example 5: Safe Multisig Transaction

```bash
pnpm run multisig-example
```

Demonstrates signing a Gnosis Safe (Safe{Wallet}) multisig transaction using EIP-712 typed data, transported via EIP-4527 QR encoding.

## What is a Safe multisig transaction?

A Safe is an on-chain smart contract wallet that requires M-of-N owner signatures before executing any transaction. Each proposed transaction is identified by a *SafeTx hash* — a deterministic EIP-712 hash that commits to:

- The Safe's address and chain (replay protection across chains and Safe deployments)
- All transaction fields: target, value, calldata, operation, gas parameters
- The nonce (prevents the same transaction being executed twice)

Each owner signs the SafeTx hash using `eth_signTypedData` (EIP-712). Once M signatures are collected, any address can call `execTransaction` on the Safe contract.

## Why is nested calldata decoding critical?

The `data` field of a Safe transaction contains ABI-encoded calldata for the nested action. Without decoding it, a signer sees only an opaque hex blob — they cannot verify what they are actually approving. `examples/multisig-payload.ts` decodes known selectors and surfaces the true intent:

- `0x` / empty → native ETH transfer (no contract call)
- `0xa9059cbb` → ERC20 `transfer(address,uint256)` — shows recipient and amount
- anything else → unknown, surfaced as `UNKNOWN_NESTED_CALLDATA` warning

## Expected output

```
─── Safe Multisig Transaction ────────────────────
  Safe:                  0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
  Network:               ethereum (chainId: 1)
  Threshold:             2 of 3 owner(s) required
  Nonce:                 14
  ─── Proposed Action ────────────────────────────
  Action:                ERC20 Transfer
  Token Contract:        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  Recipient:             0x742d35Cc6634C0532925a3b844Bc454e4438f44e
  Amount:                5000.000000 USDC
  ETH Value:             0 ETH
  Operation:             CALL
  ─── Gas & Refund ───────────────────────────────
  Safe Tx Gas:           0
  Base Gas:              0
  Gas Price:             0 (no reimbursement)
  Gas Token:             ETH (native)
  Refund Receiver:       None (tx.origin)
  ─── Signing ────────────────────────────────────
  Safe Tx Hash:          0x4003167279aac0971af7349e390730880dcf57220e01fea90cc0673b3935e0e3
  ─── Notice ─────────────────────────────────────
  This transaction executes only after 2 owner signature(s) are collected.
─────────────────────────────────────────────────
```

## Security warning codes

| Code | Meaning |
|------|---------|
| `DELEGATECALL` | `operation=1` — the target runs in the Safe's storage context. A malicious target can drain funds or modify ownership. Always warn prominently. |
| `ZERO_THRESHOLD` | `threshold=0` — any address can execute. The Safe is effectively unprotected. |
| `INVALID_THRESHOLD` | `threshold > owners.length` — quorum can never be reached. Safe is bricked. |
| `HIGH_SAFE_TX_GAS` | `safeTxGas > 500,000` — unusually high gas forwarded to the nested call. |
| `HIGH_BASE_GAS` | `baseGas > 100,000` — inflates the gas reimbursement. Combined with a malicious refundReceiver, can drain ETH. |
| `GAS_TOKEN_SET` | Non-zero `gasToken` — gas reimbursed in ERC20. Verify the token is legitimate. |
| `DANGEROUS_REFUND_RECEIVER` | Non-zero `refundReceiver` — gas reimbursement sent to a specific address. Verify it is Safe-owner-controlled. |
| `UNKNOWN_NESTED_CALLDATA` | Unrecognized selector in `data`. Signer cannot verify what action they are approving. |

## Updated folder structure

```
examples/
  eth-transfer.ts       # Example 1: native ETH transfer
  erc20-transfer.ts     # Example 2: ERC20 token transfer
  permit2.ts            # Example 3: Permit2 EIP-712 approval
  uniswap-swap.ts       # Example 4: Uniswap V3 exactInputSingle
  multisig-payload.ts   # Example 5: Safe multisig SafeTx (this example)
fixtures/
  eth-transfer.json
  erc20-transfer.json
  permit2.json
  uniswap-swap.json
  multisig-payload.json # Deterministic SafeTx hash, CBOR, UR golden snapshot
tests/
  eth-transfer.test.ts
  erc20-transfer.test.ts
  permit2.test.ts
  uniswap-swap.test.ts
  multisig-payload.test.ts
```

## Architecture

What is new in `examples/multisig-payload.ts`:

- **`buildMultisigPayload()`** — validates all addresses, builds the EIP-712 `SafeDomain` (no `name`/`version`), computes `safeTxHash` via `TypedDataEncoder.hash`, JSON-encodes the typed data as UTF-8 `signData`, decodes the nested calldata
- **`decodeNestedCalldata()`** — non-throwing; identifies ETH transfers, ERC20 `transfer()`, or unknown selectors; unknown state is a warning, not a fatal error
- **`decodeSafeTransaction()`** — parses UTF-8 sign-data bytes → JSON → Zod-validated `SafeTypedData`
- **`decodeMultisigUrPayload()`** — UR → CBOR → sign-data bytes → `decodeSafeTransaction`
- **`validateMultisigPayload()`** — returns typed `MultisigWarning[]` ordered by severity; DELEGATECALL > threshold issues > gas issues
- **`renderHumanReadable()`** — shows nested action intent, not raw hex; DELEGATECALL surfaces prominently in the operation line and the security warnings section

`encodeToCbor()` is local (uses `data-type: 2` for EIP-712 typed data, not `data-type: 1`). `encodeToUr()` and `generateQrPayload()` are re-exported from `eth-transfer.ts`.

## Safe EIP-712 domain

The Safe domain intentionally omits `name` and `version`:

```typescript
{ chainId: 1, verifyingContract: "0x9965507D..." }
```

Adding those fields produces an incorrect domain separator — the final `safeTxHash` would not match what the Safe contract verifies on-chain. This is a known Safe-specific divergence from the generic EIP-712 spec.

## Future Extensibility

The architecture supports adding:
- **Safe multiSend**: Extend `decodeNestedCalldata` with a `decodeMultiSendCalldata(data)` path for the `0x8d80ff0a` selector — each sub-call is a `(operation, to, value, dataLength, data)` tuple
- **ERC20 approve decoding**: Add `0x095ea7b3` to the selector dispatch table to surface unlimited approvals as high-severity warnings
- **Simulation**: Add a `simulationResult` field to `SafeMultisigResult` populated by Tenderly/Alchemy before display — show net asset changes alongside the static interpretation
- **EIP-4337 UserOperations**: Use `op.callData` as the nested data field, adjust the domain to the EntryPoint address
- **Permit2 + swap**: Combine a Permit2 `PERMIT` action with an `EXACT_INPUT` command in a single Universal Router multicall
- **Aggregators**: Extend `KNOWN_ROUTERS` and add a `routerType` discriminant to select the right decoder
---

# Example 6: Malformed QR Corpus

```bash
pnpm run malformed-qr-example
```

Defensive parser reference: intentionally generates 23 malformed payloads across every layer of the QR signing pipeline and demonstrates safe, typed rejection of each. Suitable for use as a reusable wallet security infrastructure corpus.

## Why malformed QR handling matters

QR-based transaction signing moves cryptographic signing off a networked device onto an air-gapped wallet. The QR transport is the trust boundary: anything that can be printed on a QR code can be scanned. A wallet that does not defensively validate every layer of the payload is vulnerable to attacks at each stage of the pipeline:

| Stage | Attack surface | Example |
|-------|---------------|---------|
| QR scanner | Partial read | Truncated UR string from low-quality print or partial scan |
| UR decode | Type confusion | `ur:btc-psbt/...` routed to the Ethereum decoder |
| UR checksum | Corruption | Bit-flip in transit changes the payload without the user knowing |
| CBOR structure | Structural injection | CBOR array instead of map — field access silently returns `undefined` |
| CBOR fields | Missing/null values | `signData = null` — wallet signs an empty hash |
| Chain ID | Cross-chain replay | `chainId = 0` — transaction unroutable to any network |
| sign-data bytes | Invalid encoding | Non-UTF-8 bytes crash a naive `TextDecoder` call |
| EIP-712 schema | Semantic confusion | Missing `primaryType` — struct hash is uncomputable |
| Safe domain | Replay attack | Extra `name`/`version` fields change the domain separator |
| Fragment sequence | State machine confusion | Fragment `5 of 3` — seqNum exceeds seqLen |
| Fragment count | DoS | `seqLen = 10000` — wallet allocates 10 000 fragment slots |
| Payload size | Memory exhaustion | 4 KB+ UR — unbounded allocation before any field validation |

## How the malformed corpus works

`examples/malformed-qr.ts` exports six deterministic generators and four validators:

**Generators** produce realistic corrupted payloads from a real ETH transfer base:
- `generateMalformedUr(baseUr, variant)` — 6 UR-level corruptions (truncate, wrong prefix, corrupt body, corrupt checksum, …)
- `generateMalformedCbor(variant)` — 10 CBOR structural corruptions (wrong type, missing field, null value, invalid chainId, …)
- `generateTruncatedPayload(input, keepChars)` — arbitrary truncation
- `generateOversizedPayload()` — UR exceeding `MAX_UR_CHARS` (4096)
- `generateInvalidFragmentSequence()` — multi-part fragments with impossible/invalid indices
- `generateCorruptedTypedData(variant)` — 7 EIP-712 schema corruptions

**Validators** return a typed `ValidationResult` discriminated union — they never throw:
- `validateQrPayload(input)` — top-level entry point; enforces size limit before calling URDecoder
- `validateUrPayload(urString)` — UR prefix, type, CBOR size
- `validateCborPayload(cbor)` — CBOR structure, required fields, chainId range, sign-data size
- `validateTypedData(signData)` — UTF-8 decode, JSON parse, Zod schema, primaryType presence, Safe domain strictness
- `validateFragmentString(fragment)` — seqNum/seqLen bounds for multi-part URs

## Defensive parsing principles

Every defensive principle is enforced in code and verified by test:

1. **Size limits before parsing** — `input.length > MAX_UR_CHARS` is checked before `URDecoder.decode()` to prevent allocation
2. **Never throw to caller** — all validators catch internally and return `{ ok: false; error: ClassifiedError }`
3. **Typed errors, not strings** — six error classes (`MalformedUrError`, `InvalidCborError`, …) each with `recoverable: false`
4. **Sanitized error rendering** — `renderHumanReadableError` embeds only classifier-controlled messages, never raw bytes from the payload
5. **Fragment count cap** — `seqLen > MAX_FRAGMENT_COUNT (100)` is rejected before any reconstruction loop
6. **Strict EIP-712 domain** — `validateTypedData` uses `z.strict()` on the domain schema and adds a SafeTx-specific check for disallowed `name`/`version` fields

## How implementers can reuse the corpus

The 23 corpus cases in `fixtures/malformed-qr.json` are deterministic (no randomness) and self-describing:

```json
{
  "id": "cbor_null_sign_data",
  "kind": "malformed_cbor",
  "description": "signData field is CBOR null — null-dereference when wallet hashes it",
  "payload": "a5011006...",
  "payloadType": "cbor_hex",
  "expectedErrorCode": "CBOR_MISSING_SIGN_DATA",
  "humanReadable": "─── QR Payload Validation Failed ───..."
}
```

**Fuzzing harness**: feed `corpus[i].payload` to your parser under test, verify it rejects with the `expectedErrorCode` (or any error). A parser that returns `ok: true` for a corpus case has a security bug.

**Differential testing**: run both `validateCborPayload` and your own parser on each `cbor_hex` payload. Any divergence (one accepts, one rejects) is worth investigating.

**Property-based testing**: use the generators as mutation operators. Take a valid transaction, apply a random generator variant, verify the validator rejects.

**CI integration**: `pnpm test` runs the full corpus and all fuzz-style mutation sweeps on every commit.

## Updated folder structure

```
examples/
  eth-transfer.ts        # Example 1: native ETH transfer
  erc20-transfer.ts      # Example 2: ERC20 token transfer
  permit2.ts             # Example 3: Permit2 EIP-712 approval
  uniswap-swap.ts        # Example 4: Uniswap V3 exactInputSingle
  multisig-payload.ts    # Example 5: Safe multisig SafeTx
  malformed-qr.ts        # Example 6: malformed QR corpus + validators (this example)
fixtures/
  eth-transfer.json
  erc20-transfer.json
  permit2.json
  uniswap-swap.json
  multisig-payload.json
  malformed-qr.json      # 23 malformed corpus cases with expected error codes
tests/
  eth-transfer.test.ts
  erc20-transfer.test.ts
  permit2.test.ts
  uniswap-swap.test.ts
  multisig-payload.test.ts
  malformed-qr.test.ts   # 114 tests: all corpus cases, fuzz sweeps, error classes
```

## Architecture

What is new in `examples/malformed-qr.ts`:

- **Six typed error classes** (`MalformedUrError`, `InvalidCborError`, `InvalidFragmentError`, `OversizedPayloadError`, `InvalidTypedDataError`, `ValidationError`) — each has `code: string`, `recoverable: false`, extends `Error`
- **`validateQrPayload()`** — never throws; size guard → UR decode → CBOR validate → typed-data validate
- **`classifyMalformedPayload(error)`** — maps any caught value (typed error class, generic Error, non-Error throw) to a `ClassifiedError` with a `MalformedKind` discriminant
- **`renderHumanReadableError(classified)`** — structured 8-line rejection notice with error type, code, reason, security notice, and recommended action
- **`buildMalformedCorpus()`** — generates all 23 cases; each case is validated at build time so the fixture's `humanReadable` field is the actual rendered error, not a template

## Future extensibility

The architecture supports adding:
- **Animated QR stress testing**: implement a full `URDecoder.receivePart()` harness that delivers the malformed fragment sequences and verifies `isComplete()` never returns `true`
- **Transaction simulation validation**: add a `simulationResult` field to `validateQrPayload` output, populated by Tenderly/Alchemy before display
- **Hardware wallet compatibility testing**: pipe corpus cases through the Ledger/Trezor signing SDK and verify they produce transport-layer rejections matching `expectedErrorCode`
- **Property-based testing**: use `fast-check` with the generators as arbitraries — any payload that passes `validateQrPayload` after mutation is a potential false negative

---

# Specification Companion Docs

Three specification documents in `docs/` provide the engineering rationale behind the implementation decisions in this corpus.

```
docs/
  animated-qr-timing.md    Transport timing, fragmentation, reliability
  ux-recommendations.md    Human-readable rendering, risk communication, UX patterns
  security-pitfalls.md     Attack surfaces, parser hardening, semantic deception techniques
```

These documents are written for wallet implementers, security auditors, and protocol integrators. They cover the decisions the EIP-4527 spec leaves to implementations — and the failure modes that emerge when those decisions are made poorly.

## `docs/animated-qr-timing.md`

The animated QR transport layer. Covers:

- **Fragment sizing** — QR version vs. scan distance vs. fragment size tradeoff table (50–300 bytes per fragment)
- **Frame timing** — recommended durations from 200ms (minimum) to 750ms (accessibility), with rationale for each
- **Adaptive timing** — algorithm for degrading gracefully when a scan session is taking too long
- **Fountain code mechanics** — why the first cycle carries the highest information density, and what "seqLen × 2 cycle penalty for 30% frame miss rate" means in practice
- **DoS considerations** — hard limits on seqLen and CBOR payload size, and why they must be enforced before reconstruction begins
- **Fragment replay attack mitigations** — `address` field binding, request-id registry, chain-id replay restrictions
- **Performance reference table** — one-cycle scan time for ETH transfer through contract deployment payloads

## `docs/ux-recommendations.md`

Human-readable rendering and confirmation UX. Covers:

- **Transaction rendering by type** — ETH, ERC20, Permit2, Safe multisig — the minimum required fields for each, and the dangerous anti-patterns that omit them
- **Warning severity levels** — four levels from informational to hard block, with concrete examples and the appropriate UI response for each
- **Progressive disclosure** — novice vs. expert mode, hardware wallet pagination requirements
- **QR scanning flow** — what to show before, during, and after scanning; when to show error UI vs. "stalled" UI
- **Amount display** — how to render ETH, ERC20, MaxUint256 allowances, and gas; never truncate or round signing amounts
- **Dangerous anti-patterns** — six concrete failure patterns found in shipped wallets, each with a description of the attack it enables

## `docs/security-pitfalls.md`

Attack surface catalog for EIP-4527 signing. Covers:

- **Transport layer attacks** — truncated UR injection, oversized fragment allocation, frame replay across devices, corrupt checksum bypass
- **Parse layer attacks** — CBOR integer key confusion, sign-data type confusion, chain ID mismatch between CBOR and RLP, oversized sign-data, deeply nested CBOR
- **Semantic layer attacks** — approval phishing via ERC20 display, calldata obfuscation via proxy contracts, EIP-712 type shadowing, Safe domain separator manipulation, safeTxHash forgery, Unicode homoglyph spoofing in `origin`, DELEGATECALL disguised as CALL, replay via request-id collision
- **Parser hardening requirements** — bounds checking table for every numeric field, null vs. missing field semantics, error specificity requirements, no-throw requirement for the parsing path
- **Supply chain considerations** — BC-UR library integrity, CBOR library attack surface, QR scanner library selection

All attacks listed in `security-pitfalls.md` have corresponding test coverage in `tests/malformed-qr.test.ts` or notes indicating where the defense is enforced in the corpus examples.
