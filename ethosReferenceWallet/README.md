# ethosReferenceWallet

A React Native reference implementation of an EIP-4527 hardware-wallet signer. It demonstrates the full air-gap signing pipeline: scan an animated QR code from a watch-only wallet, review and sign the transaction locally, then copy the signed payload back.

---

## Architecture

```
ScannerScreen
  └─ react-native-vision-camera (bundled ML Kit barcode model)
       └─ urDecoder.ts
            ├─ decodeUrFragment()      bc-ur UR fragment accumulator
            └─ assembleSignRequest()   CBOR decode → ParsedSignRequest
                 └─ buildEnvelope()    EIP-1559 fields → display envelope
                      └─ TxReviewScreen
                           ├─ deriveWarnings()   security heuristics
                           ├─ localSigner.ts     ethers.js Wallet.signTransaction()
                           └─ SigningResultScreen
```

**Key files**

| Path | Role |
|------|------|
| `src/screens/ScannerScreen.tsx` | Camera + UR accumulation loop |
| `src/urDecoder.ts` | bc-ur / CBOR decoding utilities |
| `src/screens/TxReviewScreen.tsx` | Transaction display, warnings, sign action |
| `src/localSigner.ts` | Dev-only signing with Hardhat account #0 |
| `src/screens/SigningResultScreen.tsx` | Signed-tx display and clipboard copy |
| `src/navigation/AppNavigator.tsx` | React Navigation stack |
| `src/dev/testScenarios.ts` | Simulator test fixtures |

---

## Dev Simulator

Tap **⚡ DEV MENU** on the Scanner screen to open the Simulator, which runs 5 named scenarios covering every layer of the architecture:

| # | Scenario | Path tested | Expected outcome |
|---|----------|-------------|-----------------|
| 1 | ETH Transfer | UR decode → envelope build → TxReview → sign → SigningResult | Green, transfer badge |
| 2 | ERC20 Transfer (USDC) | Same full pipeline, real fixture UR | Green, contract-call badge |
| 3 | Uniswap V3 Swap | Same, larger calldata | Green, contract-call badge |
| 4 | Zero Value (Warning) | Direct to TxReview w/ crafted envelope | Yellow `ZERO_VALUE` warning |
| 5 | No Recipient (Critical) | Direct to TxReview, no `to` field | Red critical + confirmation modal |


1. ETH Transfer PASS (green)
A simple EIP-1559 ETH send. Runs the full pipeline — decodes the UR fragment through the Scanner screen, builds the envelope, lands in TxReview showing a "transfer" badge with no warnings. The happy path
  baseline.
  
2. ERC20 Transfer (USDC) PASS (green)
A USDC transfer(address, uint256) call. Also full UR pipeline, but the transaction has calldata. TxReview should show a "contract-call" badge instead of "transfer". Verifies the app correctly identifies an ERC20 transfer versus a plain ETH send.

3. Uniswap V3 Swap PASS (green)
0.5 ETH → USDC via Uniswap's exactInputSingle. Full UR pipeline with more complex calldata. Shows a "contract-call" badge. Tests that complex multicall/swap calldata parses and displays without crashing.

4. Zero Value (Warning) WARN (yellow)
Skips the QR/UR layer entirely — injects a crafted envelope directly into TxReview. The transaction has value: "0" and no calldata, which is a suspicious combination (sending nothing, doing nothing). Should trigger a ZERO_VALUE medium-severity warning in the review screen.

5. No Recipient (Critical) CRITICAL (red)
Also a direct envelope injection. The transaction has 1 ETH value but no to address — which means it would deploy a contract or get lost. Should trigger a critical warning and show the confirmation modal that requires explicit user acknowledgment before signing is even possible.

  ---
Cards 1–3 use the UR DECODE path (go through the scanner and full decode pipeline). Cards 4–5 use the DIRECT path (bypass the scanner, inject straight to TxReview). The bottom legend in the UI explains this distinction.

Scenarios 1–3 use real UR strings from `fixtures/` (see `src/dev/testScenarios.ts`) so the full UR decode pipeline is exercised, not bypassed.

**Navigation flow for UR scenarios:**

```
Simulator ──push('Scanner', { initialFragment })──▶ Scanner (auto-fires handleFragment on mount)
                                                          └──▶ TxReview ──▶ SigningResult
```

**Navigation flow for direct-envelope scenarios:**

```
Simulator ──navigate('TxReview', { envelopeJson })──▶ TxReview ──▶ SigningResult
```

---

## Running

### Prerequisites

- Node ≥ 22.11
- Android emulator with a **Play Store** or **AOSP + Google Services** image, **or** a physical device
- Metro must be running before launching the app

### Start Metro

```bash
cd ethosReferenceWallet
npx react-native start
```

### Install and launch

```bash
# separate terminal
npx react-native run-android
```

Or, if the APK is already installed:

```bash
adb shell am start -n com.ethosreferencewallet/.MainActivity
```

### Scanning real-world QR codes (webcam mode)

By default the emulator uses a virtual scene camera. To point the back camera at your host machine's physical webcam so you can scan real QR codes:

```bash
# Terminal 1 — start the emulator with the host webcam
npm run emulator:webcam
# or directly:
./scripts/emulator-webcam.sh

# Terminal 2 — Metro
npx react-native start

# Terminal 3 — install / launch
npx react-native run-android
```

`emulator-webcam.sh` accepts an optional camera argument (default `webcam0`).
If you have multiple webcams use `./scripts/emulator-webcam.sh webcam1`.

> **Note:** The emulator window may show a mirrored or rotated preview. Hold a QR code up to your webcam and point it at the camera viewfinder in the emulator — VisionCamera will decode it the same way it would on a physical device.

### ADB port forwarding (physical device / non-Play Store emulator)

```bash
adb reverse tcp:8081 tcp:8081
```

---

## Notes

- **Signing key** — `localSigner.ts` uses Hardhat account #0 (`0xac0974…`). This is a well-known public test key. Never use in production.
- **Bundled ML Kit** — `android/app/build.gradle` excludes `play-services-mlkit-barcode-scanning` (the unbundled GMS variant that downloads at runtime) and relies solely on `com.google.mlkit:barcode-scanning`, which ships inside the APK. This prevents the *"waiting for barcode module"* hang on emulators without Play Store access.
- **Monorepo** — the wallet lives inside the `ethos-eip4527-signer` monorepo. Metro watches `../src` (the library source) via `watchFolders` but does not watch the pnpm virtual store, avoiding the Metro hang on startup.
