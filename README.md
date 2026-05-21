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