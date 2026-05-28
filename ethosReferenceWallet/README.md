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

### ADB port forwarding (physical device / non-Play Store emulator)

```bash
adb reverse tcp:8081 tcp:8081
```

---

## Notes

- **Signing key** — `localSigner.ts` uses Hardhat account #0 (`0xac0974…`). This is a well-known public test key. Never use in production.
- **Bundled ML Kit** — `android/app/build.gradle` excludes `play-services-mlkit-barcode-scanning` (the unbundled GMS variant that downloads at runtime) and relies solely on `com.google.mlkit:barcode-scanning`, which ships inside the APK. This prevents the *"waiting for barcode module"* hang on emulators without Play Store access.
- **Monorepo** — the wallet lives inside the `ethos-eip4527-signer` monorepo. Metro watches `../src` (the library source) via `watchFolders` but does not watch the pnpm virtual store, avoiding the Metro hang on startup.
