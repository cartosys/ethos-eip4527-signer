# QR Encoding Notes

## BC-UR Overview

BC-UR (Blockchain Commons Uniform Resources) is the encoding layer that wraps CBOR payloads for QR transport. It adds:

1. **Bytewords encoding** — a human-readable, case-insensitive binary-to-text encoding using a 256-word dictionary. Each byte maps to a unique 4-letter English word (or 2-letter minimal form). Bytewords is more QR-efficient than base64 because it uses only alphanumeric characters that fit in QR alphanumeric mode.

2. **Fountain codes** — a rateless erasure code that allows animated QR sequences to be decoded from any sufficiently large subset of frames, even if some frames are missed or scanned out of order. This is critical for reliability when scanning from a moving or imperfectly-lit display.

3. **Type tagging** — each UR identifies its payload type (`eth-sign-request`, `crypto-psbt`, etc.), letting the decoder reject payloads of the wrong type before attempting CBOR decode.

---

## Single-Part vs Animated QR

The choice between a single static QR and an animated QR sequence is a function of payload size.

### Capacity thresholds

QR codes have four error correction levels (L, M, Q, H). At **Level M** (15% recovery capability — recommended for wallets):

| QR Version | Alphanumeric capacity |
|------------|----------------------|
| 10         | ~174 chars           |
| 15         | ~322 chars           |
| 20         | ~520 chars           |
| 25         | ~784 chars           |
| 30         | ~1066 chars          |
| 40 (max)   | ~1852 chars          |

A bytewords string is approximately 2.2 characters per source byte. An EIP-4527 `eth-sign-request` for a simple native ETH transfer is roughly 80–120 bytes of CBOR, expanding to ~175–265 bytewords characters — comfortably fitting in a single QR code at Version 15–20.

**Rule of thumb:**
- Payload ≤ ~500 bytes CBOR → single-part QR
- Payload 500 bytes to ~2 KB → animated QR at 100–200 byte fragments
- Payload > 2 KB (e.g., complex EIP-712 typed data) → animated QR at 100–150 byte fragments

### When to use animated QR

Use animated QR when:
- The payload is too large for a scannable single QR (Version 40 is the limit; larger is harder to scan reliably)
- You want the user to be able to scan even if they hold the camera at an angle
- The payload is a contract deployment or complex calldata

---

## Fragment Size Recommendations

Fragment size (`maxFragmentLength` in `UREncoder`) controls how many bytes go in each animated frame.

**100–200 bytes per fragment** is a practical target for hardware wallet displays:
- Smaller fragments → more frames → lower density per frame → easier to scan at an angle
- Larger fragments → fewer frames → faster overall transfer → harder to scan if small screen

A 1 KB payload at 150 bytes/fragment → ~7 frames. At 300ms/frame → ~2 seconds to cycle once.

```typescript
const encoder = new UREncoder(ur, 150); // 150 bytes max per fragment
while (!encoder.isSinglePart()) {
  displayQr(encoder.nextPart().toUpperCase());
  await sleep(300);
}
```

---

## Animated QR Frame Timing

**Target: 250–500ms per frame.**

- **250ms** — fastest reliable scan speed for modern phone cameras on a full-brightness display
- **300ms** — recommended default; balances scanning speed with display clarity
- **500ms** — conservative; use when targeting low-end cameras or displays with slow refresh

Do not use less than 200ms. Sub-200ms transitions exceed the capture speed of many integrated phone cameras and cause frame-miss rates above 30%, dramatically increasing decode time.

### Display requirements for animated QR

1. **Show the current frame index and total**: `3 / 7`. Users need to know the sequence is progressing and how long to hold the phone still.
2. **Loop continuously** until the receiving device signals completion. Do not stop after one cycle.
3. **Use maximum screen brightness.** QR scanner performance degrades sharply at < 50% brightness.
4. **Center-align and maximize the QR size** within safe margins. Taller devices have more pixels; use them.
5. **No decorations inside the QR quiet zone.** The 4-module quiet zone around the QR must be clear white/black — no rounded corners, logos, or borders that eat into it.

---

## QR Error Correction Level

Use **Level M** for wallet signing QR codes.

| Level | Recovery | Capacity impact | Use when |
|-------|----------|-----------------|----------|
| L     | 7%       | Maximum capacity | Controlled environment, high-quality display |
| **M** | **15%**  | **~20% smaller** | **Recommended default for wallets** |
| Q     | 25%      | ~33% smaller    | Dusty/dirty screen scenarios |
| H     | 30%      | ~50% smaller    | Extreme reliability requirements |

Level M balances capacity (keeping QR version lower = denser pattern = more scannable at distance) with the recovery headroom to handle minor camera angle or glare.

Level L saves capacity but is fragile. Level H wastes significant capacity for reliability gains most cameras don't need.

---

## Uppercase UR for QR Alphanumeric Mode

QR codes support multiple encoding modes. **Alphanumeric mode** stores characters from the set `[A-Z0-9$%*+-./:]` at ~5.5 bits per character. **Binary mode** stores arbitrary bytes at 8 bits per character.

BC-UR bytewords use only lowercase letters `[a-z]` plus `/` and `:`. **Uppercased UR strings** fall entirely within the alphanumeric mode character set, reducing QR capacity needed by roughly 30% compared to binary mode encoding of the lowercase string.

Always uppercase the full UR string before passing to your QR encoder:
```typescript
const qrPayload = urString.toUpperCase(); // "UR:ETH-SIGN-REQUEST/..."
```

The BC-UR decoder lowercases the string before parsing, so the case difference is transparent.

---

## Verifying Your QR Output

After generating a QR, validate the full pipeline:

```typescript
import { URDecoder } from "@ngraveio/bc-ur";

// Simulate what the scanner receives (scanner sees uppercase)
const scannedString = qrPayload.toLowerCase(); // decode normalizes case
const ur = URDecoder.decode(scannedString);
assert(ur.type === "eth-sign-request");
// then decode CBOR and verify sign-data[0] === 0x02
```

Use a real phone camera to scan the generated QR at least once during development. Simulation is not a substitute for physical validation — font rendering, display resolution, and brightness all affect real-world scanability.
