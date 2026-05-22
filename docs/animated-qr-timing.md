# Animated QR Timing and Transport Reliability

## Overview

Animated QR codes are the only viable transport for EIP-4527 payloads that exceed the single-frame capacity of a QR code at a scannable density. This document specifies timing parameters, fragmentation strategies, failure recovery behavior, and implementation guidance for wallets that generate or consume animated QR sequences.

The underlying mechanism — BC-UR fountain codes — is designed for reliability in adversarial scanning conditions. Incorrect frame timing and fragment sizing can erase most of that reliability advantage. This document provides the concrete parameters needed to realize it.

For the CBOR and UR encoding layer, see `qr-encoding.md`. For signing UX considerations, see `ux-recommendations.md`.

---

## Transport Model

A BC-UR animated QR sequence is a *rateless fountain code* over the CBOR payload. The encoder produces an unbounded sequence of frames; any sufficiently large subset of frames is sufficient to reconstruct the original payload, regardless of which frames were missed and in what order they were received.

This differs fundamentally from a sequential chunking scheme (e.g., "frame 1 of 5, frame 2 of 5, ...") in two important ways:

1. **Frame order independence.** Missing frame 2 and receiving frame 7 instead is fine. The decoder accumulates any frames it can get.
2. **Redundancy past the original count.** After the encoder cycles through its "base" fragment set, it continues generating *repair fragments* — combinations of original fragments that can substitute for missed ones. The decoder does not need to receive exactly one copy of each original fragment; it needs to receive enough *linearly independent* fragments.

The practical implication: **frame timing and display continuity matter more than frame order.** The camera must be able to capture frames continuously; gaps caused by display latency, refresh artifacts, or user movement cause missed frames that the fountain code can recover from, but only if enough other frames are captured.

---

## QR Version and Density

### Choosing fragment size

QR version is determined by payload density. More bytes per frame → higher QR version → denser pattern → harder to scan at angle or distance.

| Fragment size | Approx. bytewords chars | Target QR version | Practical scan distance |
|--------------|------------------------|-------------------|------------------------|
| 50 bytes     | ~110 chars             | 8–10 (M)         | ~50 cm on 1080p display |
| 100 bytes    | ~220 chars             | 13–15 (M)         | ~35 cm on 1080p display |
| 150 bytes    | ~330 chars             | 17–18 (M)         | ~30 cm on 1080p display |
| 200 bytes    | ~440 chars             | 20–21 (M)         | ~25 cm on 1080p display |
| 300 bytes    | ~660 chars             | 25–26 (M)         | ~20 cm on 1080p display |

These distances assume: full-screen display on a 5-inch 1080p screen, 300ms frame duration, adequate lighting, level camera angle. Reduce fragment size by one step for hardware wallet displays (smaller physical size, limited brightness).

**Default recommendation: 100–150 bytes per fragment.**

This produces QR version 13–18 at error correction M — scannable at arm's length on a phone, and reliable on hardware wallet displays with sufficient pixel density.

### Error correction level

Use **Level M** (15% recovery) as the default for all animated frame QR codes.

Level L (7%) is not appropriate for animated QR: the user is scanning a continuously changing display, and camera angle variations during a multi-second scan session make the 15% recovery headroom critical. Level H (30%) wastes too much capacity and is not justified by real-world environmental conditions in typical signing scenarios.

Exception: use Level Q (25%) for hardware wallet displays that have high pixel density but are known to operate in dusty or bright-ambient-light environments (e.g., industrial signing devices).

### The quiet zone

The BC-UR multi-part fragments contain more data than a simple QR would at the same version. Wallet UI implementations must preserve the 4-module quiet zone (white border around the QR pattern). Overlay UI elements (progress indicators, frame counters) must be placed outside this boundary. A quiet zone violation that causes a scan failure is not recoverable — the user must move the camera, re-initiate the scan, or restart the sequence.

---

## Frame Timing

### Recommended durations

| Frame duration | Use case |
|----------------|----------|
| 200ms          | Minimum viable; may cause frame misses on cameras with rolling shutter |
| 250ms          | Minimum for reliable operation; suitable for flagship-tier phone cameras (2022+) |
| **300ms**      | **Recommended default**; reliable across the broadest range of devices |
| 400ms          | Suitable for hardware wallet displays with slow LCD refresh; improves ambient-light robustness |
| 500ms          | Conservative; use when targeting cameras with ≤8 MP sensor or in dim environments |
| 750ms          | For accessibility mode or users who report scan failures at normal speed |

Do not use frame durations shorter than 200ms under any circumstance. Rolling shutter cameras (which describes the majority of mobile phone cameras) require a minimum exposure window to capture a stable QR pattern. At sub-200ms transitions, the display may change mid-exposure, producing a blurred or composite image that no QR decoder can read.

### Adaptive timing

A watch app that receives scan-side feedback can implement adaptive timing: if the user has been scanning for more than twice the expected completion time, offer to reduce frame rate. A progress bar on the signer side that has not advanced after 10 full cycles suggests the camera is missing frames — reducing the frame rate is preferable to asking the user to re-scan.

Implementation pattern:
1. Start at 300ms per frame.
2. If no completion signal after `(seqLen * 300ms * 3)` ms, offer to switch to 500ms.
3. If no completion signal after another `(seqLen * 500ms * 3)` ms, offer to switch to 750ms and reduce fragment size by one step.

The threshold multiplier of 3 accounts for the expected number of cycles to reach reconstruction probability above 99% with typical frame miss rates.

### Hardware wallet timing constraints

Hardware wallets with e-paper or segment-LCD displays have update latency of 50–200ms per frame. This latency must be added to the minimum frame duration. If a hardware wallet display has a 100ms refresh latency, the minimum safe display duration is 200ms + 100ms = 300ms, meaning frames should be scheduled at 300ms intervals but the display updates at the start of each interval.

Implementation note for firmware: the frame advance timer should be measured from display *completion*, not from display *initiation*. Schedule the next frame only after the previous one has finished rendering.

---

## Fragment Sequencing

### Fountain code mechanics

The BC-UR UREncoder generates frames in a defined sequence: the first `seqLen` frames are the original CBOR payload divided into equal fragments. Subsequent frames are XOR combinations of randomly selected original fragments, weighted by a distribution that maximizes decoding probability.

The key consequence: **the first complete cycle (`seqLen` frames) carries the most information density per frame**. Additional cycles add diminishing marginal value. The URDecoder's estimated completion probability grows rapidly in the first two cycles and asymptotes toward 100% in subsequent cycles.

For a well-behaved scan (no frame misses): reconstruction completes after `seqLen + small_constant` frames. For a poor scan (30% frame miss rate): reconstruction typically completes within `seqLen * 2` frames.

### Fragment count limits

Set `maxFragmentLength` to produce at most 100–200 fragments (`seqLen ≤ 200`) for any single payload. This limits the maximum time to first full cycle:

```
max_first_cycle_time = seqLen × frame_duration
= 200 × 300ms = 60 seconds
```

60 seconds is the practical user patience limit for a scan. If the payload requires more than 200 fragments at the minimum viable fragment size (50 bytes), the payload is too large for animated QR transport without a UX redesign (e.g., out-of-band chunking or payload compression).

For context: a 1 KB payload at 100 bytes/fragment produces 10 fragments. A 5 KB payload at 100 bytes/fragment produces 50 fragments. Payloads exceeding 15 KB are unusual in the EIP-4527 context but may arise with complex Safe multisig transactions containing large nested calldata.

### Cycle counter display

Display the current frame index and cycle count to the user:

```
Frame 3/7 (cycle 2)
```

The cycle count tells the user that reconstruction has not yet completed despite receiving the second pass — they may need to hold the phone steadier or adjust angle. Without the cycle count, a user who sees "7/7" may assume the scan is complete when the decoder is still waiting for missed frames.

---

## Scan Failure Recovery

### Failure modes

| Failure type | Cause | Recovery |
|-------------|-------|---------|
| Frame miss | Camera blink, user movement | Fountain code recovers automatically |
| Full scan abort | User moves phone away | Re-scan from any point in the sequence |
| Display stall | Watch app freezes, screen saver | Resume from current frame; no re-scan needed |
| Scanner decode failure | Camera out of focus, poor lighting | Refocus, increase brightness, reduce frame rate |
| Wrong payload scanned | User scanned different QR | Signer displays type mismatch error; user re-scans |

### Scanner-side recovery UI

The signer device should display the following states:

- **Receiving** (partial progress bar): scanning is in progress, frames are accumulating. Show percentage from `estimatedPercentComplete()`.
- **Stalled** (progress bar not advancing): no new frames received in the last 3 seconds. Suggest the user move closer or increase display brightness.
- **Complete** (full bar): sufficient frames received for reconstruction. The decoder transitions to payload validation immediately.
- **Error** (distinct visual): reconstruction succeeded but payload validation failed. Display the specific error (type mismatch, checksum failure, etc.) — do not show a generic "scan failed" message.

Never show a "scan failed" error for a stalled scan that could resume. Fountain codes are resilient; a scan that stalls for 5 seconds and then resumes can complete successfully. Premature error UI causes users to abort recoverable scans.

### Duplicate frame handling

The fountain code decoder handles duplicate frames correctly — a frame received twice contributes the same information as a frame received once, which is less than receiving a new unique frame. Duplicates are not harmful but they are wasteful. If the watch app is displaying frames and the camera is fixed in place, duplicates are inevitable (the camera captures the same frame multiple times per display cycle).

The decoder's `isComplete()` check correctly terminates reconstruction when sufficient unique information has been received, regardless of how many duplicates were also received.

**There is no need to detect or filter duplicate frames at the application layer.** The fountain code handles this internally.

### Dropped frame recovery

A frame-drop rate of up to ~40% is recoverable with a 2× cycle penalty. At >40% frame-drop rate, reconstruction time grows super-linearly and the user experience degrades significantly. The correct response is to reduce the fragment size (lowering QR density, increasing scannability) rather than increasing the frame rate.

---

## Camera and Scanning Constraints

### Mobile phone cameras

Modern mobile phone cameras (2019+) capture at 30–60 fps. A 300ms frame duration gives the camera 9–18 exposure opportunities per frame. This provides reliable capture probability >95% for frames where the display is stationary.

Key constraints:
- **Autofocus** takes 300–500ms when the camera is first pointed at the display. The first frame is frequently missed entirely. The fountain code absorbs this.
- **Rolling shutter artifacts** are most severe when the user moves the phone during a frame transition. Keep the phone steady during capture.
- **High ambient light** from windows or overhead lighting can wash out QR contrast. The display should be at maximum brightness in indoor environments.

### Hardware wallet cameras

Integrated cameras in hardware wallets (e.g., Passport, Foundation Devices) have fixed focal length and limited resolution. Fragment sizes for hardware wallet targets should be reduced to 75–100 bytes to keep QR versions at 12–15 (M), which are reliably scannable at the camera distances typical for hardware wallet use (20–30 cm from the phone screen).

Hardware wallet cameras typically lack autofocus and require the user to hold the phone at a specific distance. Provide a targeting reticle or distance guide in the watch app's QR display UI.

### Embedded camera systems

Desktop signing stations or point-of-sale devices with embedded cameras may have fixed focus at 30–50 cm. For these environments:
- Use fragment sizes of 100–200 bytes (moderate QR density)
- Display the QR at the largest size the monitor can render within safe margins
- Do not use animated QR frame durations below 300ms (industrial cameras often have higher latency than phone cameras)

---

## Denial-of-Service Considerations

### Payload size limits

The watch app is the payload generator. A malicious or buggy watch app could generate an oversized payload that causes the signer to:
1. Allocate an unreasonable amount of memory for reconstruction buffers
2. Display a fragment count that exceeds user patience
3. Produce high-density QR frames that are reliably unscannable at any normal distance

Signers MUST enforce a maximum payload size before beginning reconstruction. Recommended limits:
- `seqLen > 500`: reject immediately with "payload too large for animated QR transport"
- CBOR payload size > 50 KB after reconstruction: reject before parsing

These limits are enforced after the fountain code reconstruction, when the full CBOR bytes are available. The signer cannot know the total payload size before reconstruction completes.

For early rejection, use the `seqLen` value from the first fragment's sequence component. A `seqLen` value of 10 000 at 100 bytes/fragment implies a 1 MB payload — reject before accumulating any fragments.

### Fragment replay attacks

An attacker with access to the QR scanning channel (e.g., a camera pointed at the display) can replay captured fragments to a different signer device. This is a valid attack if:
1. The attacker can capture all frames before the legitimate signer
2. The `request-id` is not checked against a registry of seen requests

Mitigations:
- The `address` field (key 6) in the CBOR payload allows the signer to verify that the expected signing address matches the loaded key. A replay to a different device with a different key is rejected at this check.
- The `chain-id` field further restricts replay to the intended chain.
- A `request-id` registry (short-lived, in-memory) prevents the same signing request from being presented twice on the same device. Invalidate after 60 seconds or after first confirmation, whichever comes first.

---

## Multi-Device Interoperability

### Watch app to signer

EIP-4527 does not specify a particular fragment size or frame timing, creating interoperability ambiguity. A watch app using 50-byte fragments produces more frames than one using 300-byte fragments for the same payload. The signer's fountain code decoder handles any fragment size without configuration — fragment size is embedded in each frame's bytewords payload.

**Interoperability checklist for watch apps:**
- [ ] Fragment size is between 50 and 300 bytes
- [ ] Frame duration is between 250ms and 500ms
- [ ] QR error correction is Level M
- [ ] QR input is uppercased before encoding
- [ ] Frame counter (`N of M`) is visible during animation
- [ ] Animation loops continuously until completion signal

**Interoperability checklist for signers:**
- [ ] URDecoder.receivePart() is called for each scanned frame
- [ ] isComplete() is polled after each receivePart() call
- [ ] No assumption about fragment size or frame count
- [ ] seqLen is checked against a maximum before accumulation begins
- [ ] Reconstruction timeout after `seqLen × 2 × frame_duration × (1 / (1 - miss_rate))` ms

### Signer to watch app

The `eth-signature` response (the signed result returned to the watch app as a QR) is typically small (65-byte ECDSA signature + minimal metadata). A single-part UR is almost always sufficient. If multi-part is needed, apply the same timing and fragment size guidelines as for the signing request.

---

## Performance Reference

| Payload type | CBOR size (approx) | Fragments at 150 B | One cycle at 300ms |
|-------------|--------------------|--------------------|-------------------|
| ETH transfer | 80–100 bytes | 1 (single-part) | N/A |
| ERC20 transfer | 130–160 bytes | 1–2 (single-part) | N/A |
| Permit2 EIP-712 | 400–600 bytes | 3–4 | 0.9–1.2 s |
| Uniswap swap | 500–700 bytes | 4–5 | 1.2–1.5 s |
| Safe multisig | 600–900 bytes | 4–6 | 1.2–1.8 s |
| Safe + large calldata | 2–5 KB | 14–34 | 4.2–10.2 s |
| Contract deployment | 5–30 KB | 34–200 | 10–60 s |

Reconstruction probability after one full cycle (no frame misses): >99.9%.
Reconstruction probability after two full cycles (30% frame miss rate): >99.5%.
Reconstruction probability after three full cycles (50% frame miss rate): >99%.

These figures assume a properly implemented fountain code (BC-UR fountain decoder) and frame durations ≥250ms.

---

## Implementation Summary

| Parameter | Mobile wallet | Hardware wallet | Desktop wallet | Embedded camera |
|-----------|--------------|-----------------|----------------|-----------------|
| Fragment size | 100–150 bytes | 75–100 bytes | 150–200 bytes | 100–150 bytes |
| Frame duration | 300ms | 400ms | 300ms | 350ms |
| Error correction | M | M | M | M |
| Max seqLen | 200 | 100 | 200 | 150 |
| Max CBOR size | 30 KB | 10 KB | 50 KB | 20 KB |
| Frame counter | Required | Required | Required | Required |
| Adaptive timing | Recommended | Firmware-dependent | Recommended | Recommended |
| Loop display | Until completion | Until completion | Until completion | Until completion |
