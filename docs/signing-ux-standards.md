# Signing UX Standards

## The Problem with Current Signing UX

Most wallet signing interfaces show users a raw hex blob and expect them to verify it. Almost nobody does. This is the root cause of the majority of crypto theft — users sign whatever the interface presents because verification is impossible without forensic tooling.

A hardware wallet or air-gapped signer is only as secure as the UX it presents. A device that shows "Confirm transaction?" for every signing request — regardless of what it contains — provides weaker security than a careful user with MetaMask. The device's air-gap means nothing if the user confirms blindly.

This document specifies what to show, how to show it, and what not to do.

---

## Security Pitfalls

### 1. Blind signing

Displaying only a hash (`Sign: 0x8d7e...`) or a success indicator without showing decoded transaction contents is blind signing. The user has no way to verify what they are authorizing.

**Minimum required display before any signing prompt:**
- Chain name and chain ID
- Transaction type (transfer, contract call, approval, etc.)
- Full recipient address (not truncated)
- Value in human units (ETH, not wei)
- Estimated total gas cost
- Origin/source application name

### 2. Address truncation

Displaying `0xd8dA...9045` instead of the full 42-character address is a UX convenience that creates a security vulnerability. A phishing payload can be crafted with the same first and last 4 characters as the intended address. The user's eyes pattern-match on the visible portion and miss the middle substitution.

**Never truncate addresses in the confirmation screen.** If the screen is too small, scroll the address or split it across lines. The user must be able to verify the complete address.

### 3. Value in wrong units

Showing `1000000000000000000` (wei) instead of `1.000000 ETH` is functionally blind signing for non-technical users. Showing `1 ETH` without a USD equivalent omits context that the user needs to evaluate the magnitude of the transaction.

Show:
```
Value:   1.000000 ETH
         ≈ $2,413.00 USD
```

### 4. Gas omission

A signing request that shows value but not gas cost hides the total economic exposure. In high-fee environments, gas can exceed the transaction value for small transfers.

Always show:
```
Gas:     21,000 gas limit
         30 gwei max fee
         1.5 gwei priority fee
         ≈ 0.000630 ETH max cost
```

### 5. Missing chain warning

A signing request without a verified chain ID should trigger a prominent warning. The signature is replayable on any chain with the same chain ID (or all chains if EIP-155 is not enforced). An attacker can construct a mainnet-looking request that is actually valid on a testnet with a higher token value.

If `chain-id` is absent from the `eth-sign-request`, display:

```
⚠ WARNING: Chain not specified
  This transaction is valid on any EVM chain.
  Confirm only if you trust the request source.
```

### 6. Contract interaction without calldata decoding

A transaction with `data !== "0x"` is not a simple transfer — it is a contract call. Displaying it as a "transfer" is a misrepresentation. If you cannot decode the calldata, say so explicitly:

```
Type:    Contract Interaction
Data:    [calldata — unable to decode]
         0xdeadbeef...
```

Do not hide undecoded calldata. Never label an unknown contract call as "transfer."

---

## What MUST Be Displayed Before Signing

This is the minimum required display for any `eth-sign-request` before presenting the sign/reject prompt:

```
┌─────────────────────────────────────────┐
│ TRANSACTION REQUEST                     │
│                                         │
│ From: ethos-eip4527-signer              │ ← origin field
│ Chain: Ethereum Mainnet (ID: 1)         │ ← chain name + chain-id
│                                         │
│ Type: Native ETH Transfer               │
│                                         │
│ To:                                     │
│   0xd8dA6BF26964aF9D7eEd9e03E           │ ← full address
│   53415D37aA96045                       │   split across lines
│                                         │
│ Value:  1.000000 ETH                    │
│         ≈ $2,413.00 USD                 │
│                                         │
│ Gas (max):                              │
│   Limit: 21,000                         │
│   Fee:   30 gwei / 1.5 gwei priority   │
│   Cost:  ≈ 0.000630 ETH ($1.52)        │
│                                         │
│ Nonce: 5                                │
│                                         │
│ [REJECT]              [CONFIRM]         │
└─────────────────────────────────────────┘
```

---

## Signing Flow Sequence

```
Watch App                    Air-Gapped Signer
─────────────────────────    ──────────────────────────────
Build transaction
Encode as EIP-4527 CBOR
Encode as UR string
Display QR code          ─── Scan QR code
                             Decode UR → CBOR → payload
                             Validate chain-id, address
                             Decode calldata (if any)
                             Display FULL transaction details
                             User reviews and confirms
                             Sign: keccak256(sign-data) → ECDSA
                             Encode signature as UR
                             Display QR code          ───┐
Scan QR code ◄───────────────────────────────────────────┘
Decode UR → signature
Broadcast to network
```

---

## Hardware Wallet Display Constraints

Small-screen signing devices (hardware wallets with 128×64 or similar displays) cannot show the full transaction on one screen. Standards for multi-screen flow:

1. **Screen 1:** Action type and chain. `ETH Transfer / Ethereum Mainnet`
2. **Screen 2:** Full recipient address. Scroll or paginate — do not truncate.
3. **Screen 3:** Amount. `1.000000 ETH / ~$2,413`
4. **Screen 4:** Gas cost. `Max: 0.000630 ETH`
5. **Screen 5:** Confirm / Reject.

Never allow the user to reach screen 5 by only pressing a single button (which might mean they paged through screens without reading). Require deliberate confirmation input on each sensitive screen, or a distinct confirmation gesture (hold button) on the final screen.

---

## Confirmation UX: Never Auto-Advance

The signer must **never** auto-advance through transaction details or auto-confirm after a timeout. Any automation of the confirmation step removes the human from the security chain.

- Auto-advancing through screens is acceptable for display only.
- Auto-confirming, auto-signing, or defaulting to "confirm" after a delay is a critical security regression.
- The reject path must always be available and equally prominent as confirm.

**Do not label the reject button "Back" or "Cancel."** These imply the user can return to reconsider. Label it "REJECT" or "DENY" — the transaction is being actively refused, not postponed.

---

## Trusted Display Model

An air-gapped signer's primary security property is **trusted display** — the screen shows exactly what will be signed, and the user's confirmation is meaningful. This only holds if:

1. The signer independently decodes and displays `sign-data`, not relying on metadata provided by the watch app.
2. The signer verifies that `sign-data` matches the fields shown (chain-id, nonce, value, to address) by parsing the RLP directly.
3. The signer ignores any watch-app-supplied "display hint" that contradicts what the bytes actually say.

A signer that displays watch-app-supplied text without cross-checking it against the actual `sign-data` bytes is vulnerable to a spoofed display attack: the watch app claims the transaction is "1 ETH to Alice" while the actual bytes authorize "100 ETH to attacker."

**Rule: parse and display from bytes, not from app-supplied metadata.**
