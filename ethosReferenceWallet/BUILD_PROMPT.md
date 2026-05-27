# AI Build Prompt — ethosReferenceWallet (EIP-4527 Android Signer)

## What You Are Building

A React Native Android app called **ethosReferenceWallet** — a reference implementation
of an EIP-4527 air-gapped transaction signer. The app scans animated QR codes from a
watch-only wallet, decodes the UR/CBOR payload, renders a human-readable transaction
review screen, and calls a local signing abstraction that returns a signed transaction.

This is a security-critical signing interface. Every design and implementation choice
must prioritize clarity and correctness over cleverness.

---

## Current State

- React Native **0.85.3**, TypeScript strict, Hermes JS engine, New Architecture enabled
- Android emulator is running (x86_64, API 12), app installs and launches successfully
- `App.tsx` currently shows the default React Native welcome screen — replace it entirely
- Monorepo root: `ethos-eip4527-signer/`
- App root: `ethos-eip4527-signer/ethosReferenceWallet/`
- Library root: `ethos-eip4527-signer/src/` — **do not modify library source**

The library is already built and tested. You are building the UI layer on top of it.

---

## Library API (read-only — do not modify)

The signing library lives at `../../src` relative to the app root. Import only from
the barrel — never from internal files.

```typescript
// Key types available from the library:

interface TransactionEnvelope {
  chain: SupportedChain;           // "ethereum" | "arbitrum" | "optimism" | "base" | "polygon" | "solana"
  from?: string;
  to?: string;
  value?: string;                  // big-number string — NEVER coerce to number
  nonce?: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  data?: string;
  chainId?: number;
  type?: "legacy" | "eip1559";
  metadata?: TransactionMetadata;
}

interface SignerRequest {
  transaction: TransactionEnvelope;
  actions?: HumanReadableAction[];  // decoded intent: "transfer", "approve", "swap", etc.
  warnings?: SecurityWarning[];     // severity: "low" | "medium" | "high" | "critical"
}

interface SignerResponse {
  signedTx: string;
  signerAddress: string;
  signatureType: "transaction" | "message";
}

interface DecodedPayload {
  protocol: "eip4527" | "eip681" | "raw";
  raw: Uint8Array;
  decoded: unknown;
  fragments?: number;
  metadata?: PayloadMetadata;
}

interface DgenError {
  code: string;
  message: string;
  recoverable: boolean;   // MUST be set correctly — recoverable: true on an unrecoverable
                          // signing failure is a security bug
}

type ActionType = "transfer" | "approve" | "swap" | "contract-call" | "signature" | "unknown";

interface SecurityWarning {
  severity: "low" | "medium" | "high" | "critical";
  code: string;
  message: string;
}
```

The reference `eth-transfer` pipeline in `../../examples/eth-transfer.ts` shows the full
encode/decode/render flow and is a reliable reference for how the library is used.

---

## Features to Build

### 1. QR Scanner Screen (entry point)

The home screen. Full-screen camera viewfinder with a centered scan reticle.

- Use `react-native-vision-camera` v4 for camera access
- Use `react-native-camera-kit` QR decoder or the Vision Camera frame processor
  with `@mgcrea/react-native-vision-camera-mlkit` for QR detection
- Handle **animated (multi-frame) QR** as used in EIP-4527: accumulate UR fragments,
  show a progress ring filling as frames are captured, assemble when complete
- UR fragment assembly: use `@ngraveio/bc-ur` — its `URDecoder` class handles
  multi-part animated QR sequences. Feed each scanned string into `decoder.receivePart(part)`.
  When `decoder.isComplete()` is true, call `decoder.resultUR()` to get the assembled UR.
- On decode success, navigate to the Transaction Review screen passing the assembled UR string
- On decode failure, show an inline error banner (do not navigate away)
- Request `CAMERA` permission on mount; show a graceful permission-denied state

### 2. UR / CBOR Decoder

A pure utility module at `src/urDecoder.ts` (app-local, not library).

```typescript
// src/urDecoder.ts
import { URDecoder } from "@ngraveio/bc-ur";
import { decode as cborDecode } from "cbor-x";

export interface ParsedSignRequest {
  requestId: Uint8Array;
  signData: Uint8Array;       // EIP-1559 tx bytes — first byte must be 0x02
  chainId: number;
  origin?: string;
  dataType: number;
}

export function decodeUrFragment(decoder: URDecoder, fragment: string): boolean;
// Returns true when the UR is complete and ready to decode

export function assembleSignRequest(decoder: URDecoder): ParsedSignRequest;
// Throws DgenError({ code: "UR_INVALID", recoverable: false }) on any failure

export function newUrDecoder(): URDecoder;
// Factory — always create fresh decoder per scan session
```

Validate that `signData[0] === 0x02` (EIP-1559 type prefix). If not, throw
`DgenError({ code: "INVALID_TX_TYPE", recoverable: false })`.

### 3. Transaction Review Screen

Full-screen card that the user sees before signing. Show:

**Header row:**
- Chain badge (pill: chain name + chain ID)
- Action type badge (TRANSFER / APPROVE / SWAP / CONTRACT CALL — color-coded)
- Security warning indicator (shield icon; red if any `critical`/`high`, yellow if `medium`, green if none)

**Transaction details card:**
- From address (truncated: first 6 + "…" + last 4, full address on tap)
- To address (same truncation)
- Value in ETH (convert from wei string: `BigInt(value) / BigInt(1e18)` — format to 6 decimal places)
- Gas limit
- Max fee per gas (convert from wei to gwei: `BigInt(maxFeePerGas) / BigInt(1e9)`)
- Nonce
- If `data` is present and non-empty: show "Contract interaction" label + hex preview (first 10 bytes)

**Security warnings panel** (visible only if warnings exist):
- Each warning as a row with severity icon + message
- `critical` warnings shown in red with a pulsing glow border
- `high` in orange, `medium` in yellow, `low` in muted grey

**Action buttons (bottom of screen):**
- `REJECT` — secondary/destructive style, navigates back to scanner
- `SIGN` — primary CTA, only enabled when no `critical` warnings are present;
  if critical warnings exist, the button reads "SIGN ANYWAY (RISK)" and requires
  a second confirmation bottom sheet before proceeding

On sign tap, call the signing abstraction (see below) and navigate to the
Signing Result screen.

### 4. Local Signing Abstraction

A module at `src/localSigner.ts`. This is a **dev/reference implementation only** —
it uses a hardcoded test private key that is clearly marked as non-production.

```typescript
// src/localSigner.ts

import type { SignerRequest, SignerResponse } from "../../src";

// DEV ONLY — this key is public and for testing only. Never use in production.
const DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// (This is Hardhat's well-known account #0 — it is intentionally public)

export interface SigningResult {
  response: SignerResponse;
  elapsedMs: number;
}

export async function signLocally(request: SignerRequest): Promise<SigningResult>;
// Uses ethers.js Wallet.signTransaction under the hood
// Sets signatureType: "transaction"
// Times the signing operation and returns elapsedMs
```

Use `ethers` v6 (`npm install ethers`). The `Wallet.signTransaction` method accepts
the transaction fields directly. Reconstruct the ethers transaction object from
`TransactionEnvelope` fields. Keep Ethereum values as `bigint` throughout — do not
use `Number()` on any address, value, or fee field.

Wrap all thrown errors into `DgenError` before re-throwing.

### 5. Signing Result Screen

Shown after a successful sign. Display:

- Large green checkmark (animated in on mount)
- Truncated signed tx hash (first 10 + "…" + last 8 chars of `signedTx`)
- Signer address
- Time to sign (from `elapsedMs`)
- "Copy Signed TX" button — copies `signedTx` to clipboard
- "Scan Another" button — resets state and navigates back to scanner

On error, show the error screen (see below).

### 6. Error Screen

A reusable `ErrorView` component for unrecoverable errors:

- Red glow card
- Error code in monospace
- Human-readable message
- `recoverable: true` → show "Try Again" button; `recoverable: false` → show only "Back to Scanner"

---

## Navigation

Use `@react-navigation/native` + `@react-navigation/native-stack`.

```
Stack:
  Scanner (initial)
  → TxReview (params: { ur: string })
  → SigningResult (params: { response: SignerResponse; elapsedMs: number })
```

No drawer, no tabs. Linear flow. Back gesture is allowed on TxReview; disabled
on SigningResult (use explicit "Scan Another" button instead).

---

## Design System — Retro Synthwave + Material Design

### Color Palette

```typescript
export const Colors = {
  // Backgrounds
  bgDeep:       "#0A0A1A",   // near-black with blue undertone
  bgCard:       "#12122A",   // card surfaces
  bgElevated:   "#1A1A38",   // modals, bottom sheets

  // Neon primaries
  neonCyan:     "#00F5FF",   // primary action, scan reticle
  neonMagenta:  "#FF00FF",   // accent, warnings
  neonPurple:   "#9D00FF",   // chain badge, secondary elements
  neonGreen:    "#00FF9D",   // success states

  // Semantic
  critical:     "#FF2D55",   // critical warnings, reject button
  high:         "#FF6B00",
  medium:       "#FFD600",
  low:          "#8E8EA0",

  // Text
  textPrimary:  "#F0F0FF",
  textSecondary:"#8080B0",
  textMono:     "#00F5FF",   // monospace addresses, hex data

  // Borders / glows
  borderGlow:   "#3D3D7A",
  glowCyan:     "rgba(0, 245, 255, 0.15)",
  glowMagenta:  "rgba(255, 0, 255, 0.15)",
};
```

### Typography

- Primary font: system default (San Francisco / Roboto)
- Monospace elements (addresses, hex, tx hash): `Platform.select({ android: 'monospace', ios: 'Courier New' })`
- All address/hex values rendered in `textMono` color

### Component Conventions

**Cards** — `bgCard` background, 1px border in `borderGlow`, `borderRadius: 16`,
subtle shadow. Elevated variant (`bgElevated`) for modals.

**Neon glow effect** — use `shadowColor` + `shadowRadius: 8` + `shadowOpacity: 0.8`
pointing at the relevant neon color. On Android this renders as elevation; add a
semi-transparent colored View overlay for the glow halo where needed.

**Buttons:**
- Primary (SIGN): full-width, `neonCyan` background, `bgDeep` text, `borderRadius: 8`
- Secondary (REJECT): outlined, `critical` border + text
- Ghost (COPY, SCAN ANOTHER): `textSecondary` color, no border

**Scan reticle** — four corner brackets (L-shaped lines) in `neonCyan`, centered in
the camera view. Animate a horizontal scan line sweeping top-to-bottom using
`Animated.loop` + `Animated.timing`.

**Chain badge** — small pill: `bgElevated` background, `neonPurple` border,
chain name in `textMono`. Include a colored dot per chain:
ethereum=`#627EEA`, arbitrum=`#28A0F0`, optimism=`#FF0420`, base=`#0052FF`,
polygon=`#8247E5`, solana=`#9945FF`.

**Warning rows** — left border (4px) in severity color, `bgElevated` background,
icon + message. Critical rows have a pulsing opacity animation (0.7–1.0, 1.5s loop).

**StatusBar** — always `dark-content: false` (light icons on dark background).

**No rounded hero fonts, no skeuomorphic gradients.** Keep it flat-dark with
precise neon accents. Less is more.

---

## Dependencies to Install

```bash
# Navigation
npm install @react-navigation/native @react-navigation/native-stack
npm install react-native-screens react-native-safe-area-context

# Camera & QR
npm install react-native-vision-camera
npm install @mgcrea/react-native-vision-camera-mlkit  # QR frame processor plugin

# UR/CBOR
npm install @ngraveio/bc-ur cbor-x

# Ethereum signing
npm install ethers

# Clipboard
npm install @react-native-clipboard/clipboard
```

After installing, run `cd android && ./gradlew clean` before rebuilding.

---

## File Structure (App Layer)

```
ethosReferenceWallet/
  src/
    urDecoder.ts          # UR fragment assembly + CBOR decode
    localSigner.ts        # Dev signing abstraction (ethers Wallet)
    theme.ts              # Colors, typography, spacing constants
    screens/
      ScannerScreen.tsx   # Camera + QR + animated UR assembly
      TxReviewScreen.tsx  # Transaction details + sign/reject
      SigningResultScreen.tsx
    components/
      ChainBadge.tsx
      ActionBadge.tsx
      AddressText.tsx     # Truncated address with tap-to-expand
      WarningRow.tsx
      ScanReticle.tsx     # Animated corner brackets + scan line
      ErrorView.tsx
    navigation/
      AppNavigator.tsx    # Stack navigator setup
```

---

## Coding Rules (from CLAUDE.md — follow exactly)

- TypeScript strict — no `any`, no `@ts-ignore`, no `as unknown as T`
- Ethereum values (`value`, `gasLimit`, `maxFeePerGas`) are `string` or `bigint` — never `number`
- All errors are `DgenError` typed — `recoverable` must be set correctly
- No `console.log` in production paths — use error returns/throws only
- `src/index.ts` in the library is the only import path — never import from internal lib files
- Immutable: no mutating parameters, prefer `readonly` properties
- No comments explaining WHAT code does — only WHY if non-obvious

---

## Verification Before Claiming Complete

1. `npx react-native run-android` builds and installs without error
2. App launches to the Scanner screen (not the React Native welcome screen)
3. Camera viewfinder is visible with the scan reticle animation running
4. Tapping a hardcoded test QR string (paste into a `__DEV__` bypass button for testing)
   navigates to TxReview with correct fields rendered
5. Tapping SIGN navigates to SigningResult with a valid signed tx displayed
6. `npx tsc --noEmit` — zero type errors
7. `npx eslint src` — zero lint errors
