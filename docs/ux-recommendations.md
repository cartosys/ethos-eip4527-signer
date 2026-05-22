# Signer UX Recommendations

## Overview

This document specifies recommended rendering, warning, and interaction patterns for EIP-4527 signer implementations. The guidelines apply to both mobile software wallets and hardware wallet firmware.

The primary design constraint for a transaction signer is **asymmetric risk**: a false negative (user approves something they didn't intend to sign) can cause irreversible asset loss. A false positive (user rejects a legitimate transaction) causes mild friction. UX decisions must be biased accordingly — conservative rendering and prominent warnings are correct defaults.

For animated QR transport parameters, see `animated-qr-timing.md`. For known attack patterns and parser hardening, see `security-pitfalls.md`.

---

## Human-Readable Transaction Rendering

### General principles

1. **Show what the user is authorizing, not what the protocol does.** "Send 1 ETH to 0x742d...f44e" is useful. "Broadcast a type-2 EIP-1559 transaction with nonce 7 on chainId 1" is not.

2. **Never show raw hex without context.** Displaying `0xa9059cbb000000000000000000000000...` without decoding is worse than not displaying calldata at all — it signals "this is safe" by virtue of the wallet having shown it.

3. **Show addresses in full.** Do not truncate addresses in the confirmation screen. Truncation to "0x742d...f44e" is common in explorers and history views but is dangerous in the approval flow — attackers use addresses that share a prefix and suffix with a known address.

4. **Resolve amounts to human units.** Always convert from wei/raw units to the canonical display unit (ETH, USDC, DAI). Show the raw value as a secondary detail, not the primary amount.

5. **Use checksummed addresses (EIP-55).** A lowercase hex address is harder to read and provides no typo detection. Checksummed addresses have detectable case errors — display and accept only checksummed form.

---

### ETH transfer rendering

Minimum required fields:
```
Network:         Ethereum Mainnet (Chain 1)
Action:          Send ETH
To:              0x742d35Cc6634C0532925a3b844Bc454e4438f44e
Amount:          1.250000 ETH
Max gas fee:     0.0021 ETH
Nonce:           7
```

Anti-patterns:
- Showing `value: 0x11C37937E08000` — raw hex amount with no conversion
- Omitting the nonce — users who are replaying their own transactions (RBF patterns) need it
- Omitting the gas fee — the total authorization includes gas; a high-fee transaction is a valid concern
- Showing "Send to: my wallet" based on address book lookup without also showing the raw address

### ERC20 transfer rendering

An ERC20 transfer has `tx.to = tokenContract` and `tx.value = 0`. The recipient and amount are inside calldata. Wallets that do not decode calldata will display:

```
Network:  Ethereum Mainnet
To:       0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48  ← token contract, NOT recipient
Value:    0 ETH
Data:     0xa9059cbb... (68 bytes)
```

This is not a useful confirmation screen. The user cannot determine who receives funds or how much.

Required decoding output:
```
Network:         Ethereum Mainnet (Chain 1)
Action:          ERC20 Transfer
Token:           USDC (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
Recipient:       0x742d35Cc6634C0532925a3b844Bc454e4438f44e
Amount:          100.000000 USDC
Gas Limit:       65,000
Max Fee/Gas:     30 gwei
Max Priority:    1.5 gwei
Nonce:           3
```

If the token contract address is not in the signer's registry, display:

```
Token:  Unknown (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
        ⚠ Token symbol unverified — confirm in your watch app
```

Do not render a symbol from calldata or from any source the signer device cannot independently verify. A contract can return any string for `name()` and `symbol()`.

### EIP-712 typed data rendering

EIP-712 typed data requires the signer to render a structured message, not raw bytes. The minimal required display:

```
Action:          Sign Typed Data (EIP-712)
Network:         Ethereum Mainnet (Chain 1)
Primary Type:    Permit
Contract:        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

Fields:
  owner:         0x742d35Cc6634C0532925a3b844Bc454e4438f44e
  spender:       0xCc491f589b45d4a3C679016195B3fb87D7848210
  value:         115792089237316195423570985008687907853...
                 (MaxUint256 — unlimited approval)
  deadline:      2026-08-21 03:14:07 UTC
  nonce:         0
```

Key requirements:
- Resolve `MaxUint256` (0xffffffff...ffff) to a human-readable label. An allowance of `MaxUint256` is a permanent unlimited approval — do not show the raw integer.
- Resolve Unix timestamps in `deadline` fields to ISO 8601 UTC. A timestamp of `0` (already expired) or `2^256 - 1` (never expires) should be labeled as such.
- Identify the `primaryType` and show it prominently. Users who understand Permit vs PermitBatch have different risk tolerance for each.

### Permit2 rendering

Permit2 allows batch approvals and delegated transfers. Permit2 payloads include a `spender` address that will subsequently pull tokens from the user's account. The user is not approving a specific transfer — they are approving a future actor to transfer on their behalf.

Required Permit2 rendering:
```
⚠  APPROVAL — NOT A TRANSFER
   This signature authorizes a third party to transfer tokens.

Action:          Permit2 Token Approval
Token:           DAI (0x6B175474E89094C44Da98b954EedeAC495271d0F)
Spender:         0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B
Max Amount:      500.000000 DAI
Expires:         2026-06-15 12:00:00 UTC  (27 days from now)
Nonce:           42
```

The distinction between a transfer and a delegated approval is the most common point of user confusion in EVM signing. The warning header is mandatory, not optional.

### Safe multisig rendering

Safe transactions include a `safeTxHash` that commits to all parameters. The signer must display the hash and all parameters that were hashed.

```
⚠  MULTISIG TRANSACTION
   Signing shares your approval — execution requires additional signers.

Safe Wallet:     0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
Chain:           Ethereum Mainnet
SafeTx Hash:     0x4003167279aac0971af7349e390730880dcf57220e01fea90cc0673b3935e0e3

Transaction:
  To:            0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  Value:         0 ETH
  Operation:     CALL (0)
  Calldata:      transfer(0x742d35Cc..., 5000000000)  →  5000.000000 USDC
  Safe Nonce:    14

Verification:
  Computed hash matches safeTxHash ✓
```

**DELEGATECALL warning** (operation = 1):
```
⛔  DELEGATECALL DETECTED
   The target contract will execute with this Safe's storage and balance.
   This can drain all assets from the Safe.
   
   Target:  0xCc491f589b45d4a3C679016195B3fb87D7848210
```

A DELEGATECALL warning must be visually distinct from all other warnings. It must not be dismissable with a single tap. Hardware wallet firmware should require an explicit confirmation keypress on a separate screen.

---

## Warning Severity Levels

### Level 0 — Informational (no action required)

Shown in secondary detail, not highlighted. Example:
- Transaction type (EIP-1559, legacy)
- Gas limit
- Nonce

### Level 1 — Notice (display prominently, proceed normally)

Shown in the primary view with a neutral indicator. Example:
- Unknown token contract (symbol unverified)
- EIP-712 signature with no known contract binding
- Nonce gap (skipping nonces may strand subsequent transactions)

### Level 2 — Warning (requires explicit acknowledgment)

Shown full-screen or in a blocking modal before the confirmation button appears. Example:
- Unlimited token approval (MaxUint256 allowance)
- Permit2 delegated approval
- Expired deadline (signing an authorization that is already past its deadline)
- Address not in address book and first-time recipient

### Level 3 — Danger (requires separate confirmation step)

Shown on a dedicated screen with a descriptive explanation. The standard confirmation button must be replaced with an explicit acknowledgment that the user has read and understood the risk. Example:
- DELEGATECALL operation
- Zero-value Safe transaction with non-empty calldata (self-modification pattern)
- Signing data whose `dataType` is unrecognized

### Level 4 — Hard block (reject immediately, do not offer override)

Shown as a terminal error. No approval option. Example:
- Chain ID mismatch between domain and transaction
- Invalid safeTxHash (computed hash does not match claimed hash)
- seqLen > maximum fragment count before reconstruction completes

---

## Progressive Disclosure

### Novice mode (default)

Show only: action, recipient, amount, network, estimated gas cost in fiat if available.

Collapse: nonce, gas limit breakdown, raw calldata, full EIP-712 fields, ABI selector.

### Expert mode (opt-in)

Show all fields. Enable access to:
- Raw sign data (hex)
- Full decoded calldata
- EIP-712 domain separator
- All CBOR fields from the sign request

The toggle between modes should be accessible from the confirmation screen without leaving the flow. Do not require the user to go to Settings → Advanced → Developer to see a full calldata breakdown.

### Hardware wallet considerations

Hardware wallets have limited display area. Progressive disclosure on these devices uses pagination:
- Screen 1: Action and recipient
- Screen 2: Amount and gas cost
- Screen 3: Network and nonce
- Screen 4 (warnings only): Risk summary
- Final screen: Confirm/Reject

Never combine a warning with the confirm button on the same screen. A warning that the user can scroll past without reading defeats its purpose.

---

## QR Scanning Flow UX

### Before scanning begins

Show:
- A targeting frame indicating where to position the watch app display
- Instruction text: "Open your watch app and tap Sign to display the QR code"
- A "Cancel" option that does not require reaching the top of the screen

Do not start the camera before the user has acknowledged what they are about to scan. Pre-activating the camera creates an opportunity for QR injection if the camera is aimed at an attacker-controlled display before the signing flow begins.

### During scanning

Show:
- Progress bar derived from `estimatedPercentComplete()` — this gives users actionable feedback
- Current frame / total frames (e.g., "Frame 4 of 12")
- Cycle count if on second or subsequent pass (e.g., "Cycle 2")
- A hint when progress stalls: "Hold steady — move closer to the display"

Do not show:
- Raw CBOR or UR content during scanning — it is not meaningful to the user and could expose partial data
- A spinner without progress — users cannot tell if scanning is working

### After scanning completes

Transition immediately to the transaction review screen. Do not show a "scan complete" intermediate screen — it adds a tap with no information value.

If reconstruction fails (payload too large, hash mismatch, unknown type):
- Show the specific error with a plain-language explanation
- Offer "Try Again" only if the error is recoverable (e.g., scan aborted mid-way)
- Offer "Cancel" always
- Do not offer "Try Again" for semantic errors (wrong chain, malformed payload) — they will fail again

### Confirmation feedback

After the user approves, display the signature response as a QR code immediately. Do not add a "preparing signature..." spinner of more than 500ms — ECDSA signing is fast on modern hardware, and delays erode user trust.

The response QR should:
- Loop continuously at 300ms frame rate (same parameters as request QR)
- Show "Waiting for watch app to receive signature..." — do not transition away until the watch app signals completion or the user dismisses manually
- Not auto-dismiss after a timeout — the watch app may be slow to scan the response

---

## Amount Display

### ETH and native tokens

Use full decimal representation, not scientific notation. Minimum 6 decimal places. Do not round.

```
1.250000 ETH    ← correct
1.25 ETH        ← acceptable
1.25e0 ETH      ← wrong
≈1.25 ETH       ← wrong (never approximate signing amounts)
```

### ERC20 tokens

Use the token's declared decimal precision. A 6-decimal token (USDC) showing `100.000000` is correct. An 18-decimal token showing `100.000000000000000000` is technically correct but consider formatting with a separator after the 6th decimal place for readability.

Never truncate by rounding. If a user is signing a transfer of `99.999999 USDC`, showing `100.00 USDC` is both wrong and potentially harmful.

### MaxUint256 allowances

```
Amount:  Unlimited  (MaxUint256 = 2^256 - 1)
```

Never show the raw integer. The number is too large to be meaningful and its magnitude may cause users to dismiss it as a display error.

### Gas amounts

Show gas cost in the native token and, if exchange rate data is available from the watch app, in fiat. Do not fetch exchange rates from a network call in the signer — the signer must remain air-gapped.

```
Estimated gas:  0.002100 ETH  (≈ $5.24 at watch app rate)
                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                              Only if watch app provided rate in the payload
```

---

## Dangerous Anti-Patterns

The following patterns appear in shipped wallet implementations. They represent known UX failures that have contributed to real asset loss.

### Address truncation in confirmation

**Anti-pattern:** "Send to: 0x742d...f44e"

**Why it fails:** Attackers use addresses that match the prefix and suffix of a known target address. Full display is the only defense.

### "Contract interaction" as the transaction summary

**Anti-pattern:** Showing "Contract Interaction — 0xA0b86991..." when calldata is present but not decoded.

**Why it fails:** All ERC20 transfers, swaps, approvals, and malicious drains look identical. The label provides no useful information and conveys false safety by implying the wallet has "seen" and validated the interaction.

### Silent MaxUint256 approvals

**Anti-pattern:** Showing "Approve: 115792089237316195423570985008..." without labeling it as unlimited.

**Why it fails:** Users do not recognize MaxUint256 on sight. Wallets that show the raw integer have provided technically accurate information that is practically uninterpretable.

### EIP-712 message rendered as raw JSON

**Anti-pattern:** Showing the full `message` object as formatted JSON without field-level rendering.

**Why it fails:** JSON lacks units. A field named `value` set to `115792089237316195423570985008687907853269984665640564039457584007913129639935` conveys nothing without context from the type definition.

### Single-tap DELEGATECALL confirmation

**Anti-pattern:** A DELEGATECALL operation treated identically to a CALL — same confirmation UI, same button.

**Why it fails:** A DELEGATECALL from a Safe runs arbitrary code in the Safe's context. It can transfer all ETH and tokens, update owners, disable modules, and self-destruct. The confirmation must be proportional to the risk.

### Stale address book resolution without raw display

**Anti-pattern:** Showing "Send to: Alice" based on an address book entry without also showing the raw address.

**Why it fails:** Address book poisoning — if Alice's address was updated maliciously (in a compromised sync, a malicious import, or a UI-layer attack), the user sees "Alice" and approves without noticing the address changed.

### Auto-approval after timeout

**Anti-pattern:** Starting a countdown timer ("Confirm in 30 seconds or the request will expire") that auto-approves if the user does not act.

**Why it fails:** An attacker who can display a QR code in a hurried context (e.g., a payment terminal) can exploit the time pressure and the auto-approval to capture a signature without informed consent. Signing must always require explicit positive action.

---

## Accessibility

- Minimum tap target size: 44×44 pt (iOS HIG) / 48×48 dp (Android)
- Do not rely on color alone to distinguish warning severity — use icons, labels, and layout
- Provide a "read aloud" text summary accessible to screen readers for all fields on the confirmation screen
- Hardware wallet button combinations for confirm/reject must be documented in the device manual and shown on-screen during confirmation
- Offer 750ms frame duration in an accessibility QR scanning mode for users who report difficulty with standard speed

---

## Localization

- Format amounts using the user's locale for digit grouping and decimal separators, but always use the canonical token symbol in ASCII (not localized)
- Dates in deadline fields must include timezone explicitly — "UTC" is not implied and must be shown
- Do not localize addresses — EIP-55 checksummed hex is the canonical form regardless of locale
- Chain names should use the canonical name from the chain registry (e.g., "Ethereum Mainnet", "Arbitrum One") — do not invent regional variants
